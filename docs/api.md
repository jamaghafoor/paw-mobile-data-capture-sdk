# Shared capture API

All routes are authenticated POST requests with JSON bodies. Set `Authorization: Bearer <user-session-token>`. Production transport is HTTPS, responses are `Cache-Control: no-store`, and errors must not echo PII, tokens or OTPs. Native SDKs reject HTTP and redirects. Timestamps are Unix milliseconds throughout.

The base URL passed to each SDK contains `/api`. The endpoints below are relative to that base.

## Consent

```json
{
  "personalData": true,
  "location": true,
  "applications": false,
  "noticeVersion": "v1",
  "capturedAt": 1790000000000
}
```

Use current timestamps; the example timestamp is illustrative. The reference validates the configured notice version and a receipt age of at most 24 hours. This is evidence of the client's declaration, not proof of a lawful basis. The production host should issue and retain server-bound consent sessions if it needs stronger auditability.

## Start phone verification — `/phone/start`

Request: `{ "phone": "+923001234567", "consent": { ... } }`.

Response: `{ "challengeId": "opaque-random-id", "expiresAt": 1790000300000 }`.

The reference normalizes international syntax, limits sends to five per subject and phone in 15 minutes, binds a random challenge to the authenticated subject/phone/provider reference, and expires it after five minutes. Syntax validation alone does not establish country-specific number validity; the production provider must reject non-deliverable numbers and enforce country rules.

## Verify phone — `/phone/verify`

Request: `{ "challengeId": "...", "code": "123456" }`.

Response: `{ "verificationId": "opaque-single-use-id", "expiresAt": 1790000600000 }`.

At most five code attempts per challenge. Success consumes the challenge and creates a subject-bound and phone-bound receipt lasting ten minutes. A client `verified: true` flag is never accepted. The literal code above is only the local test fixture; production verification must occur through the server's provider integration.

## Submit — `/captures`

```json
{
  "fullName": "Example Customer",
  "phone": "+923001234567",
  "verificationId": "opaque-single-use-id",
  "carrier": "User-entered carrier",
  "location": {
    "latitude": 24.86,
    "longitude": 67.01,
    "accuracyMeters": 25,
    "timestamp": 1790000000000
  },
  "applications": {
    "status": "unsupported",
    "packages": [],
    "reason": "ios_no_public_inventory_api"
  },
  "consent": {
    "personalData": true,
    "location": true,
    "applications": false,
    "noticeVersion": "v1",
    "capturedAt": 1790000000000
  },
  "idempotencyKey": "unique-request-id-1234"
}
```

Location may be omitted/null; carrier may be blank. iOS reports apps as `unsupported`; Android reports `not_requested` without consent or `limited` with only allowlisted packages visible to the host. Never interpret an empty report as an empty device. The reference discards arbitrary client reason strings and stores its own provenance fields.

Response: `{ "captureId": "opaque-id", "receivedAt": 1790000000000 }`.

Before storing, the server revalidates consent, names, phone, location age/ranges/accuracy, package allowlists and the bound phone receipt. Carrier is stored as `{value, source: "user_declared", verified: false}`. Optional production carrier lookup must preserve independent lookup source, timestamp, and unavailable status; number portability and dual-SIM mean a number prefix does not prove the active device carrier.

The verification receipt is consumed once. An exact duplicate with the same subject and idempotency key returns the original response within 15 minutes. A changed payload with that key returns HTTP 409. New payloads require a new key and unused phone receipt. Retry only network/5xx failures with bounded backoff; honour rate limits and do not blindly retry code submissions or SMS sends.

## Errors

`{ "error": "stable_machine_code", "message": "Safe human-readable explanation" }`.

| HTTP | Example codes |
|---|---|
| 400 | `invalid_name`, `invalid_phone`, `invalid_code`, `invalid_challenge`, `consent_required`, `phone_verification_required`, `stale_location`, `imprecise_location`, `invalid_applications` |
| 401 | `unauthorized` |
| 404 | `not_found` |
| 409 | `idempotency_conflict` |
| 413 / 415 | `body_too_large` / `json_required` |
| 429 | `rate_limited` |
| 503 | `service_unavailable`, `capacity_reached` |

Native-only errors also cover consent gating, HTTPS configuration, permission denial, reduced accuracy, foreground requirement and cancellation. Swift wraps API error codes in `CaptureError`; Kotlin uses `CaptureException`. Transport errors/cancellation can also be native networking/coroutine errors.

## Reference versus production

`createReferenceApi({ authenticate, otp, noticeVersion, allowedPackages })` exposes adapter seams. `authenticate(header)` returns a stable tenant/user subject or null. `otp.start(phone)` returns a server-private provider challenge ID; `otp.verify(providerId, code)` returns a boolean. Production adapters must bound provider timeouts and never return a truthy provider object in place of an explicit verification decision. Only local tests should use `otp.mode: "test"`.

The included HTTP host accepts only the local test token, refuses NODE_ENV=production and binds loopback. Test captures are labelled `test_only`. State is memory-only and pruned on requests plus every minute. Captures expire after 15 minutes; restart loses all state. Inspection is available to unit tests only, with no HTTP read/export endpoint. The reference serializes work globally, including provider calls, so it is deliberately not a scalable production server.

For production, implement the contract in the existing backend with authenticated tenant isolation, distributed OTP/rate state, provider timeouts and abuse controls. Use a database transaction and uniqueness constraints on `(tenant, subject, idempotency_key)` and verification consumption. Atomically consume verification and persist capture + receipt; roll back all three on failure. Use KMS-managed encryption at rest, least-privilege access, audited access without payload logging, deletion/revocation workflows and a configured retention job. Replace process-local locks and maps before adding replicas; do not horizontally scale this reference unchanged.
