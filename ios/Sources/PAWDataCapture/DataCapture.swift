import Foundation

private struct APIFailure: Decodable { let error: String }

private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

/// Create and use from the main actor. The host owns UI, authentication and retention.
@MainActor
public final class DataCapture {
    private let baseURL: URL
    private let accessToken: () async throws -> String
    private var consent: Consent?
    private var generation = UUID()
    private var requests: [UUID: Task<(Data, URLResponse), Error>] = [:]
    private let session: URLSession
    #if os(iOS)
    private let locationCollector = LocationCollector()
    #endif

    public init(baseURL: URL, accessToken: @escaping () async throws -> String) throws {
        guard baseURL.scheme == "https", baseURL.host != nil, baseURL.user == nil, baseURL.password == nil, baseURL.query == nil, baseURL.fragment == nil else { throw CaptureError("https_endpoint_required") }
        self.baseURL = baseURL; self.accessToken = accessToken
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil; configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 15; configuration.timeoutIntervalForResource = 20
        session = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }

    public func grantConsent(_ consent: Consent) throws {
        guard consent.personalData, !consent.noticeVersion.isEmpty else { throw CaptureError("consent_required") }
        withdrawConsent(); self.consent = consent
    }
    /// Cancels pending work and clears consent. Host must also clear its UI/model and request server deletion.
    public func withdrawConsent() {
        consent = nil; generation = UUID()
        requests.values.forEach { $0.cancel() }; requests.removeAll()
        #if os(iOS)
        locationCollector.cancel()
        #endif
    }
    private func requireConsent() throws -> Consent {
        guard let consent, consent.personalData else { throw CaptureError("consent_required") }; return consent
    }
    public func startPhoneVerification(phone: String) async throws -> PhoneChallenge {
        struct Body: Encodable { let phone: String; let consent: Consent }
        return try await post("phone/start", Body(phone: Validation.phone(phone), consent: requireConsent()))
    }
    public func verifyPhone(challengeID: String, code: String) async throws -> PhoneVerification {
        guard code.range(of: #"^[0-9]{6}$"#, options: .regularExpression) != nil else { throw CaptureError("invalid_code") }
        struct Body: Encodable { let challengeId: String; let code: String }
        return try await post("phone/verify", Body(challengeId: challengeID, code: code))
    }
    public func captureLocation() async throws -> LocationSample {
        guard try requireConsent().location else { throw CaptureError("location_consent_required") }
        #if os(iOS)
        return try await locationCollector.capture()
        #else
        throw CaptureError("ios_only")
        #endif
    }
    public func installedApplications() throws -> ApplicationsReport {
        _ = try requireConsent()
        return .unsupported
    }
    public func submit(fullName: String, phone: String, verificationID: String, carrier: String = "", location: LocationSample? = nil, idempotencyKey: String) async throws -> CaptureReceipt {
        let consent = try requireConsent()
        guard location == nil || consent.location else { throw CaptureError("location_consent_required") }
        guard idempotencyKey.range(of: #"^[A-Za-z0-9_-]{16,100}$"#, options: .regularExpression) != nil else { throw CaptureError("invalid_request_id") }
        struct Body: Encodable {
            let fullName: String; let phone: String; let verificationId: String; let carrier: String
            let location: LocationSample?; let applications: ApplicationsReport; let consent: Consent; let idempotencyKey: String
        }
        return try await post("captures", Body(fullName: Validation.name(fullName), phone: Validation.phone(phone), verificationId: verificationID, carrier: Validation.carrier(carrier), location: location?.validated(), applications: .unsupported, consent: consent, idempotencyKey: idempotencyKey))
    }
    private func post<Body: Encodable, Response: Decodable>(_ path: String, _ body: Body) async throws -> Response {
        _ = try requireConsent(); let current = generation
        let token = try await accessToken()
        try Task.checkCancellation()
        guard current == generation else { throw CaptureError("cancelled") }
        guard !token.isEmpty, !token.contains("\r"), !token.contains("\n") else { throw CaptureError("authentication_required") }
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"; request.httpBody = try JSONEncoder().encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let id = UUID()
        let task = Task { try await session.data(for: request) }
        requests[id] = task; defer { requests[id] = nil }
        let (data, response) = try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
        guard current == generation else { throw CaptureError("cancelled") }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw CaptureError((try? JSONDecoder().decode(APIFailure.self, from: data).error) ?? "request_failed")
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
