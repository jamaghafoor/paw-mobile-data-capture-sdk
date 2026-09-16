# Native integration

The host supplies an HTTPS base URL ending in `/api`, a short-lived user access token, the approved notice version, UI and backend implementation. Never embed SMS credentials or a shared production API secret in either SDK. Use the host's existing Keychain/Keystore-backed authentication storage. Bind server records to the authenticated user and tenant, never a client-supplied user ID.

## iOS

In Xcode, add the local `ios` directory as a Swift package and link `PAWDataCapture`. Add a specific purpose string to the **host** Info.plist:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Share your current location with your account details for this verification.</string>
```

The packaged `PrivacyInfo.xcprivacy` describes this SDK's collection for app functionality without tracking. Review it together with the host's privacy manifest and App Store disclosure. Do not add URL-scheme inventories or background location modes.

```swift
import PAWDataCapture

// On the main actor, with your host auth session available:
let capture = try DataCapture(
    baseURL: URL(string: "https://your-api.example/api")!,
    accessToken: { try await authSession.freshAccessToken() }
)

// Only after the person accepts your visible, versioned notice.
// Pass the actual choices from separate optional location/app controls.
try capture.grantConsent(Consent(
    personalData: true, location: shareLocation,
    applications: false, noticeVersion: "v1"
))
let challenge = try await capture.startPhoneVerification(phone: enteredPhone)
// Show the OTP input and await the person's code; do not hard-code a production code.
let verified = try await capture.verifyPhone(challengeID: challenge.challengeId, code: enteredCode)
// Capture immediately before review/submission, while the app is active.
var point: LocationSample?
if shareLocation { point = try await capture.captureLocation() }
// Keep this key and the exact payload for retries. Create a new key when editing data.
let requestID = UUID().uuidString
let receipt = try await capture.submit(
    fullName: enteredName, phone: enteredPhone,
    verificationID: verified.verificationId, carrier: enteredCarrier,
    location: point, idempotencyKey: requestID
)
// Show only the receipt needed by your UI; never log the submitted fields or token.
```

Keep the SDK instance alive for the flow. Handle `CaptureError.code` in the UI. Denied, reduced accuracy, timeout and unavailable location should offer retry or continuation without location; do not claim a precise capture occurred. If location is necessary for a specific service, explain that dependency and offer an alternate process.

Call `withdrawConsent()` when consent is revoked or the capture screen is abandoned. It cancels SDK requests and pending location collection. Also cancel the host Task when the scene becomes inactive, clear host form/models, and invoke your backend deletion/revocation workflow for already-sent records. A request already accepted by a server cannot be undone by cancelling a client Task.

## Android

Include `android/datacapture` as a Gradle project, or publish the module through your existing internal Maven repository. Add `implementation(project(":datacapture"))` to the host. Standalone AAR consumers also need `org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.1`.

The library manifest declares Internet, coarse location and fine location. It never opens a permission prompt. The host requests **both** fine and coarse location through its Activity Result API only when the person chooses location sharing, and handles Android's approximate-only choice. Call capture only from a resumed, focused Activity, after the permission sheet closes. Cancel the collection job on `onPause`; there is no background location service.

For an approved application-presence use case, declare only relevant packages in the host manifest:

```xml
<queries>
    <package android:name="com.example.partner" />
</queries>
```

Do not copy this placeholder into production; replace it with your reviewed package names. Use the same allowlist on the SDK and backend. Consent does not by itself make an app-inventory use case eligible under Play policies.

```kotlin
import com.paw.datacapture.*
import java.util.UUID

val capture = DataCapture(
    context = applicationContext,
    baseUrl = "https://your-api.example/api",
    accessToken = { authSession.freshAccessToken() },
    allowedPackages = setOf("com.example.partner"),
)
// After rendering the actual notice and receiving the person's choices:
capture.grantConsent(Consent(
    personalData = true, location = shareLocation,
    applications = shareRelevantApps, noticeVersion = "v1",
))
// In a host-owned coroutine, cancelled when the Activity pauses:
val challenge = capture.startPhoneVerification(enteredPhone)
// Collect the code in a separate UI step.
val verified = capture.verifyPhone(challenge.challengeId, enteredCode)
val point = if (shareLocation) capture.captureLocation(thisActivity) else null
val requestID = UUID.randomUUID().toString()
val receipt = capture.submit(
    fullName = enteredName, phone = enteredPhone,
    verificationId = verified.verificationId, carrier = enteredCarrier,
    location = point, idempotencyKey = requestID,
)
```

Map `CaptureException.code`, permission denial, network errors and coroutine cancellation to appropriate UI states. Withdraw consent on logout, revocation or abandoning the flow, cancel host jobs, and clear host data. Kotlin network I/O uses bounded socket timeouts; cancellation prevents accepting the result but cannot retract bytes already sent.

## Recommended UI sequence

1. Explain the controller, purpose, fields, recipients, retention and deletion route. Personal data consent is required only to enter this capture flow; location and relevant-app consent remain separate.
2. Enter name, international phone number and optional carrier. Allow single-word and non-Latin names. Clarify that entered carrier is unverified.
3. Send a server OTP challenge, display the real delivery state, and collect the code. A phone change requires a new challenge.
4. Offer one-time foreground location capture; display reported accuracy and recapture if stale. Do not label denied or approximate capture as successful.
5. Review the fields, submit once, reuse the same request ID only for an identical retry, and clear client state after success.

The current SDK revalidates location before each submission. If more than 60 seconds elapses after an ambiguous network outcome, consult your host backend for the prior receipt before recapturing and sending a new request. Backend idempotency still permits exact stale retries, but the clients deliberately require fresh local data.
