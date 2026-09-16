import { randomUUID, createHash } from 'node:crypto';
import { CaptureError, requireValue, normalizeName, normalizePhone, normalizeCarrier, validateLocation } from './validation.js';

/** Single-process reference only. Replace state/locking with shared transactions for production. */
export function createReferenceApi({ authenticate, otp, noticeVersion = 'v1', allowedPackages = [], now = Date.now }) {
  const challenges = new Map(), verifications = new Map(), captures = new Map(), idempotency = new Map(), limits = new Map();
  let lock = Promise.resolve();
  const ttl = 15 * 60_000;
  function prune() {
    for (const map of [challenges, verifications, captures, idempotency, limits]) {
      for (const [key, record] of map) if (record.expiresAt <= now()) map.delete(key);
    }
  }
  function limit(key, count) {
    const record = limits.get(key) ?? { count: 0, expiresAt: now() + ttl };
    requireValue(record.count < count, 'rate_limited', 'Too many attempts. Try again later.');
    record.count++; limits.set(key, record);
  }
  function consent(value) {
    requireValue(value?.personalData === true && typeof value.location === 'boolean' && typeof value.applications === 'boolean' && value.noticeVersion === noticeVersion && Number.isFinite(value.capturedAt) && value.capturedAt <= now() + 5_000 && value.capturedAt >= now() - 24 * 60 * 60_000, 'consent_required', 'A current consent receipt is required.');
    return { personalData: true, location: value.location, applications: value.applications, noticeVersion, capturedAt: value.capturedAt };
  }
  function applications(value, receipt) {
    requireValue(value && ['unsupported', 'not_requested', 'limited'].includes(value.status) && Array.isArray(value.packages) && value.packages.length <= 50, 'invalid_applications', 'Invalid application report.');
    requireValue(value.packages.every(p => typeof p === 'string' && allowedPackages.includes(p)), 'invalid_applications', 'Application report exceeds the approved allowlist.');
    requireValue((value.status !== 'limited' || receipt.applications) && (value.packages.length === 0 || value.status === 'limited'), 'applications_consent_required', 'Application collection requires consent.');
    return { status: value.status, packages: [...new Set(value.packages)].sort(), source: 'client_reported', completeness: 'not_a_full_inventory' };
  }
  async function execute(path, body, subject) {
    prune();
    requireValue(body && typeof body === 'object' && !Array.isArray(body), 'invalid_request', 'A JSON object is required.');
    requireValue(challenges.size + verifications.size + captures.size + limits.size < 10_000, 'capacity_reached', 'Reference server capacity reached.');
    limit(`all:${subject}`, 100);
    if (path === '/phone/start') {
      consent(body.consent);
      const phone = normalizePhone(body.phone);
      limit(`send:${subject}`, 5); limit(`phone:${phone}`, 5);
      const providerId = await otp.start(phone);
      const challengeId = randomUUID(), expiresAt = now() + 5 * 60_000;
      challenges.set(challengeId, { subject, phone, providerId, expiresAt, attempts: 0 });
      return { challengeId, expiresAt };
    }
    if (path === '/phone/verify') {
      requireValue(typeof body.code === 'string' && /^[0-9]{6}$/.test(body.code), 'invalid_code', 'Enter a six-digit code.');
      const challenge = challenges.get(body.challengeId);
      requireValue(challenge?.subject === subject && challenge.attempts < 5, 'invalid_challenge', 'Challenge expired or unavailable.');
      challenge.attempts++;
      requireValue((await otp.verify(challenge.providerId, body.code)) === true, 'invalid_code', 'Verification failed.');
      challenges.delete(body.challengeId);
      const verificationId = randomUUID(), expiresAt = now() + 10 * 60_000;
      verifications.set(verificationId, { subject, phone: challenge.phone, expiresAt });
      return { verificationId, expiresAt };
    }
    if (path === '/captures') {
      requireValue(typeof body.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(body.idempotencyKey), 'invalid_request_id', 'A stable request ID is required.');
      const receipt = consent(body.consent);
      const data = {
        fullName: normalizeName(body.fullName), phone: normalizePhone(body.phone),
        carrier: { value: normalizeCarrier(body.carrier ?? '') || null, source: 'user_declared', verified: false },
        // Validate freshness after replay lookup, so a successful retry can return its original receipt.
        location: body.location ?? null, applications: applications(body.applications, receipt), consent: receipt,
      };
      const key = `${subject}:${body.idempotencyKey}`;
      const fingerprint = createHash('sha256').update(JSON.stringify({ ...data, verificationId: body.verificationId })).digest('hex');
      const prior = idempotency.get(key);
      if (prior) {
        requireValue(prior.fingerprint === fingerprint, 'idempotency_conflict', 'This request ID was already used for different data.');
        return prior.result;
      }
      requireValue(!data.location || receipt.location, 'location_consent_required', 'Location consent is required.');
      if (data.location) data.location = validateLocation(data.location, { now: now() });
      const verified = verifications.get(body.verificationId);
      requireValue(verified?.subject === subject && verified.phone === data.phone, 'phone_verification_required', 'Verify this phone number first.');
      const result = { captureId: randomUUID(), receivedAt: now() };
      captures.set(result.captureId, { subject, ...data, phoneVerification: otp.mode === 'test' ? 'test_only' : 'provider_verified', receivedAt: result.receivedAt, expiresAt: now() + ttl });
      verifications.delete(body.verificationId);
      idempotency.set(key, { fingerprint, result, expiresAt: now() + ttl });
      return result;
    }
    throw new CaptureError('not_found', 'Unknown endpoint.');
  }
  return {
    async request(path, body, authorization) {
      try {
        const subject = await authenticate(authorization);
        requireValue(typeof subject === 'string' && subject.length > 0 && subject.length <= 200, 'unauthorized', 'Authentication required.');
        // Serialize receipt consumption and idempotency in this single-process reference.
        const task = lock.then(() => execute(path, body, subject));
        lock = task.catch(() => {});
        return { status: 200, body: await task };
      } catch (error) {
        if (!(error instanceof CaptureError)) return { status: 503, body: { error: 'service_unavailable', message: 'Service unavailable. Try again later.' } };
        const status = { unauthorized: 401, not_found: 404, rate_limited: 429, capacity_reached: 503, idempotency_conflict: 409 }[error.code] ?? 400;
        return { status, body: { error: error.code, message: error.message } };
      }
    },
    // Schedule cleanup even while idle. Host calls this from an interval.
    prune,
    // Test inspection only; do not expose through an HTTP endpoint.
    inspectForTesting: () => structuredClone([...captures.values()]),
  };
}
