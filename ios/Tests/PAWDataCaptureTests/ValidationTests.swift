import XCTest
@testable import PAWDataCapture

final class ValidationTests: XCTestCase {
    func testInternationalNamesAndPhones() throws {
        XCTAssertEqual(try Validation.name("  李  "), "李")
        XCTAssertEqual(try Validation.name(" محمد   علي "), "محمد علي")
        XCTAssertEqual(try Validation.phone("+92 (300) 123-4567"), "+923001234567")
        XCTAssertThrowsError(try Validation.phone("03001234567"))
        XCTAssertThrowsError(try Validation.name("<script>"))
        XCTAssertThrowsError(try Validation.name("a\u{202E}b"))
    }
    func testLocationQualityAndFreshness() throws {
        let now = Date().timeIntervalSince1970 * 1000
        XCTAssertNoThrow(try LocationSample(latitude: 0, longitude: 0, accuracyMeters: 20, timestamp: now).validated(now: now))
        XCTAssertThrowsError(try LocationSample(latitude: .nan, longitude: 0, accuracyMeters: 20, timestamp: now).validated(now: now))
        XCTAssertThrowsError(try LocationSample(latitude: 0, longitude: 0, accuracyMeters: 101, timestamp: now).validated(now: now))
        XCTAssertThrowsError(try LocationSample(latitude: 0, longitude: 0, accuracyMeters: 20, timestamp: now - 60_001).validated(now: now))
    }
    @MainActor func testConsentAndHTTPS() async throws {
        XCTAssertThrowsError(try DataCapture(baseURL: URL(string: "http://example.com")!, accessToken: { "token" }))
        let sdk = try DataCapture(baseURL: URL(string: "https://example.com/api")!, accessToken: { "token" })
        do { _ = try await sdk.startPhoneVerification(phone: "+923001234567"); XCTFail("Expected consent gate") }
        catch let error as CaptureError { XCTAssertEqual(error.code, "consent_required") }
        try sdk.grantConsent(Consent(personalData: true, location: false, applications: false, noticeVersion: "v1"))
        XCTAssertEqual(try sdk.installedApplications().status, "unsupported")
        sdk.withdrawConsent()
        XCTAssertThrowsError(try sdk.installedApplications())
    }
}
