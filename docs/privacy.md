# Platform constraints and release responsibilities

Checked against platform documentation on 2026-09-16. These are implementation constraints, not a certification of legal compliance or an assurance of store approval.

## What the SDK can establish

Full names come from the person. Normalization and validation do not establish legal identity. Use a separate identity verification workflow if that is required.

Both SDKs ask the person for an international phone number and use a server OTP contract. Android's phone-number API can return unavailable or unreliable values and still requires additional verification. This implementation avoids SIM/phone-state permissions and SMS inbox access. A successful SMS challenge establishes control of that number at verification time, not that it belongs to a specific SIM or person. [Android phone-number API](https://developer.android.com/reference/android/telephony/SubscriptionManager#getPhoneNumber(int)).

Carrier is deliberately user-declared and unverified on both platforms. Apple's carrier API is deprecated; do not use its output as trusted data. Add an appropriately contracted backend carrier lookup when needed, keeping provenance separate from user input. [Apple carrierName](https://developer.apple.com/documentation/coretelephony/ctcarrier/carriername).

Foreground location requires consent plus OS permission. Accuracy is requested, not guaranteed. The SDKs accept reported uncertainty ≤100 metres and samples no older than 60 seconds, reject reduced/approximate permission, and allow the host to omit location. Coordinates, device clocks and reported accuracy can be spoofed; this is not cryptographic location proof. [Apple location authorization](https://developer.apple.com/documentation/corelocation/cllocationmanager/requestwheninuseauthorization()) and [Android LocationManager](https://developer.android.com/reference/android/location/LocationManager).

## Installed applications

iOS has no general public installed-app inventory API. `canOpenURL` only checks declared schemes with limits; scheme handlers do not prove a specific app is present and undeclared/absent handlers are indistinguishable. This SDK returns an explicit unsupported report and performs no probing. [Apple canOpenURL](https://developer.apple.com/documentation/uikit/uiapplication/canopenurl(_:)).

Android package visibility is limited. This SDK queries only a developer-provided allowlist (maximum 50); the host must also declare corresponding `<queries>` entries and justify the user-facing purpose. It requests no `QUERY_ALL_PACKAGES` permission. Absent results can mean not installed or not visible. Consent alone does not override store policy. [Android package visibility](https://developer.android.com/training/package-visibility/declaring) and [Google Play broad visibility policy](https://support.google.com/googleplay/android-developer/answer/10158779?hl=en).

## Data and retention boundaries

The SDK makes no collection at initialization. The host must render the actual notice before calling grantConsent, request independent optional location/app consent, expose withdrawal, and never fabricate consent from a preselected checkbox. The SDK keeps consent only in memory and gates collection/submission. Host inputs, cached snapshots, screenshots, crash reports, backups and analytics are outside the SDK; configure those to exclude sensitive fields and tokens.

Production data must be protected in transit and at rest, scoped to the authenticated tenant/user, retained only as long as justified, and deletable through an authorized route. SDK withdrawal stops pending work; it does not delete already-submitted data. Android socket I/O may take up to its timeout to unwind. Do not promise immediate erasure of previously sent bytes or OS-managed memory.

The iOS resource manifest declares potentially collected name, phone, precise location, user linkage and other data (carrier/consent) for app functionality, with no tracking. The host must reconcile actual usage with its full privacy report and store labels. No required-reason API is intentionally used by this package; review the combined app and all dependencies. [Apple privacy manifests](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests).

## Before release

- Supply the existing app stack, backend authentication and SMS provider, countries, controller identity, allowed purposes and relevant Android packages.
- Finalize the notice, lawful basis, optionality, retention, deletion, residency and subprocessors for the actual jurisdictions. This repository makes no GDPR/CCPA or other jurisdiction-specific compliance claim.
- Implement the production API and storage described in `api.md`; remove all test credentials, test OTP behaviour and inspection hooks from the production deployment.
- Audit App Store privacy labels/manifest and Google Play Data safety declarations against actual host behaviour. Document each requested permission and SDK data recipient. [Apple App Review privacy rules](https://developer.apple.com/app-store/review/guidelines/#privacy).
- Test real devices: first permission request, denial, approximate-only selection, permission revocation, backgrounding, no GPS/SIM, dual SIM, poor accuracy, airplane mode, expired/replayed code, logout during requests, and duplicate submission after a timeout. Verify only intended packages are visible on Android.
- Integrate server deletion, audit controls, encrypted durable storage, access reviews, tenant-isolation tests and operational rate limits before collecting real customer information.
