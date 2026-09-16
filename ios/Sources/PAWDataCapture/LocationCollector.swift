#if os(iOS)
@preconcurrency import CoreLocation
import UIKit

@MainActor
final class LocationCollector: NSObject, CLLocationManagerDelegate {
    private var manager: CLLocationManager?
    private var continuation: CheckedContinuation<LocationSample, Error>?
    private var timeout: Task<Void, Never>?
    private var requestID: UUID?

    func capture() async throws -> LocationSample {
        guard continuation == nil else { throw CaptureError("location_busy") }
        guard UIApplication.shared.applicationState == .active else { throw CaptureError("foreground_required") }
        guard let purpose = Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") as? String, !purpose.isEmpty else { throw CaptureError("missing_location_purpose") }
        try Task.checkCancellation()
        let id = UUID(); requestID = id
        // A manager per capture lets us discard late callbacks from a cancelled request.
        let manager = CLLocationManager()
        manager.delegate = self; manager.desiredAccuracy = kCLLocationAccuracyBest
        self.manager = manager
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                timeout = Task { [weak self] in
                    do { try await Task.sleep(nanoseconds: 20_000_000_000) } catch { return }
                    self?.finish(.failure(CaptureError("location_timeout")))
                }
                authorizeOrCapture()
            }
        } onCancel: {
            Task { @MainActor in if self.requestID == id { self.cancel() } }
        }
    }
    func cancel() { finish(.failure(CaptureError("cancelled"))) }
    private func authorizeOrCapture() {
        guard continuation != nil, let manager else { return }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            guard manager.accuracyAuthorization == .fullAccuracy else { finish(.failure(CaptureError("precise_location_not_authorized"))); return }
            manager.requestLocation()
        default: finish(.failure(CaptureError("location_denied")))
        }
    }
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in
            guard let self, self.manager === manager else { return }
            self.authorizeOrCapture()
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let sample = locations.last.map { LocationSample(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude, accuracyMeters: $0.horizontalAccuracy, timestamp: $0.timestamp.timeIntervalSince1970 * 1000) }
        Task { @MainActor [weak self] in
            guard let self, self.manager === manager else { return }
            guard UIApplication.shared.applicationState == .active else { self.finish(.failure(CaptureError("foreground_required"))); return }
            guard let sample else { self.finish(.failure(CaptureError("location_unavailable"))); return }
            self.finish(Result { try sample.validated() })
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor [weak self] in
            guard let self, self.manager === manager else { return }
            self.finish(.failure(CaptureError("location_unavailable")))
        }
    }
    private func finish(_ result: Result<LocationSample, Error>) {
        let pending = continuation; continuation = nil; requestID = nil
        timeout?.cancel(); timeout = nil
        manager?.stopUpdatingLocation(); manager?.delegate = nil; manager = nil
        pending?.resume(with: result)
    }
}
#endif
