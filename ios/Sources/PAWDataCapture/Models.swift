import Foundation

public struct CaptureError: Error, LocalizedError, Sendable {
    public let code: String
    public var errorDescription: String? { code }
    public init(_ code: String) { self.code = code }
}

public struct Consent: Codable, Sendable {
    public let personalData: Bool
    public let location: Bool
    public let applications: Bool
    public let noticeVersion: String
    public let capturedAt: Double
    public init(personalData: Bool, location: Bool, applications: Bool, noticeVersion: String) {
        self.personalData = personalData; self.location = location; self.applications = applications
        self.noticeVersion = noticeVersion; self.capturedAt = Date().timeIntervalSince1970 * 1000
    }
}

public struct LocationSample: Codable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let accuracyMeters: Double
    /// Unix milliseconds, shared with Android and the backend.
    public let timestamp: Double
    public init(latitude: Double, longitude: Double, accuracyMeters: Double, timestamp: Double) {
        self.latitude = latitude; self.longitude = longitude
        self.accuracyMeters = accuracyMeters; self.timestamp = timestamp
    }
    public func validated(now: Double = Date().timeIntervalSince1970 * 1000, maxAccuracyMeters: Double = 100) throws -> Self {
        guard latitude.isFinite, abs(latitude) <= 90, longitude.isFinite, abs(longitude) <= 180,
              accuracyMeters.isFinite, accuracyMeters >= 0, timestamp.isFinite else { throw CaptureError("invalid_location") }
        guard now - timestamp <= 60_000, timestamp <= now + 5_000 else { throw CaptureError("stale_location") }
        guard maxAccuracyMeters.isFinite, maxAccuracyMeters > 0, accuracyMeters <= maxAccuracyMeters else { throw CaptureError("imprecise_location") }
        return self
    }
}

public struct ApplicationsReport: Codable, Sendable {
    public let status: String
    public let packages: [String]
    public let reason: String
    // iOS does not offer a general installed-app inventory. Scheme probing is not an inventory.
    public static let unsupported = ApplicationsReport(status: "unsupported", packages: [], reason: "ios_no_public_inventory_api")
}

public enum Validation {
    public static func name(_ value: String) throws -> String {
        let normalized = value.precomposedStringWithCanonicalMapping
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        guard !normalized.isEmpty, normalized.utf16.count <= 150,
              normalized.range(of: #"\p{L}"#, options: .regularExpression) != nil,
              normalized.range(of: #"[\p{Cc}\p{Cf}<>]"#, options: .regularExpression) == nil else { throw CaptureError("invalid_name") }
        return normalized
    }
    public static func phone(_ value: String) throws -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "[ ()-]", with: "", options: .regularExpression)
        guard normalized.range(of: #"^\+[1-9][0-9]{7,14}$"#, options: .regularExpression) != nil else { throw CaptureError("invalid_phone") }
        return normalized
    }
    public static func carrier(_ value: String) throws -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.utf16.count <= 100, normalized.range(of: #"[\p{Cc}\p{Cf}<>]"#, options: .regularExpression) == nil else { throw CaptureError("invalid_carrier") }
        return normalized
    }
}

public struct PhoneChallenge: Decodable, Sendable { public let challengeId: String; public let expiresAt: Double }
public struct PhoneVerification: Decodable, Sendable { public let verificationId: String; public let expiresAt: Double }
public struct CaptureReceipt: Decodable, Sendable { public let captureId: String; public let receivedAt: Double }
