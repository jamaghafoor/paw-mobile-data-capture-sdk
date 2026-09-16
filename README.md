# PAW native data capture

Native Swift and Kotlin SDKs for explicit-consent customer capture, with a shared HTTP contract and an executable local backend reference. The user's selected implementation is native; no PWA is included.

**Status:** integration foundation, not a deployed production service. The workspace contained no existing app. Authentication, real SMS, carrier verification, persistent storage, jurisdiction-specific notice/retention, and integration into the host app still need the host's configuration and implementation. The reference server uses simulated OTP and memory-only storage; it must never handle real customer data.

| Field | iOS SDK | Android SDK | Meaning of validation |
|---|---|---|---|
| Full name | User input | User input | Unicode normalization, length/control checks; not legal identity verification |
| Mobile number | User input + backend OTP | User input + backend OTP | International syntax plus server challenge; no SIM ownership inference |
| Carrier | Optional user input | Optional user input | Format only; explicitly unverified. Add a backend lookup if authoritative carrier data is required |
| Location | Foreground Core Location | Foreground LocationManager GPS | Permission, numeric range, age ≤60 seconds, reported accuracy ≤100 metres |
| Installed apps | Explicitly unsupported | Consented, host-defined package allowlist | Partial visibility, never a full inventory or proof of absence |

The SDKs do not request contacts, SMS inbox, background location, advertising IDs, IMEI, or broad application visibility. All network endpoints must use HTTPS; redirects are rejected. Neither SDK logs or persists captured data. Host-owned objects and form values remain the host's responsibility.

## Packages

- `ios/`: Swift Package Manager library, iOS 15+. A macOS target enables core unit tests; location capture is iOS-only.
- `android/`: Android library and Gradle wrapper, Android 11/API 30+, compile SDK 36, Java 17.
- `server/`: single-process Node 20+ reference API with provider/authentication seams, replay protection and short-lived in-memory state.
- `docs/integration.md`: Swift/Kotlin examples and host responsibilities.
- `docs/api.md`: shared requests, responses, errors and production persistence requirements.
- `docs/privacy.md`: platform restrictions, disclosure requirements and remaining release work.

## Build and test

```sh
# From repository root; Node tests have no third-party dependencies.
npm test
npm run check

cd ios
swift test
xcodebuild -scheme PAWDataCapture -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .build/xcode CODE_SIGNING_ALLOWED=NO build

cd ../android
# Set ANDROID_HOME, or local.properties sdk.dir, to the installed Android SDK.
./gradlew :datacapture:assembleRelease :datacapture:testDebugUnitTest :datacapture:lintRelease
```

Android output: `android/datacapture/build/outputs/aar/datacapture-release.aar`. Prefer a Gradle project or Maven dependency when integrating so transitive coroutine dependencies are resolved. A manually copied AAR alone does not supply those dependencies.

`npm start` runs the reference API on loopback port 8787. Its test-only bearer token is `local-test-token` and simulated OTP is `123456`; it sends no SMS. Native clients intentionally refuse this plain HTTP endpoint. To exercise native networking, put a developer-controlled, trusted HTTPS proxy in front of it, or use an HTTPS staging implementation of the contract. Do not disable certificate validation or ATS.

Unit tests cover validation and key backend security boundaries; SDK builds are also checked. Real device permissions, physical GPS accuracy, dual-SIM workflows, real SMS delivery and host authentication require integration testing before release.
