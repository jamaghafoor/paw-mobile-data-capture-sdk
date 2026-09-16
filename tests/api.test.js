import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceApi } from '../server/api.js';
import { normalizeName, normalizePhone, validateLocation } from '../server/validation.js';

function fixture() {
  let time = Date.now();
  const consent = { personalData: true, location: true, applications: false, noticeVersion: 'v1', capturedAt: time };
  const api = createReferenceApi({ authenticate: async token => ({ alice: 'alice', bob: 'bob' })[token], otp: { mode: 'test', start: async () => 'provider', verify: async (_, code) => code === '123456' }, now: () => time });
  const request = (path, body, subject = 'alice') => api.request(path, body, subject);
  async function verify() {
    const challenge = await request('/phone/start', { phone: '+923001234567', consent });
    assert.equal(challenge.status, 200);
    const result = await request('/phone/verify', { challengeId: challenge.body.challengeId, code: '123456' });
    assert.equal(result.status, 200); return result.body.verificationId;
  }
  const capture = verificationId => ({ fullName: 'محمد علي', phone: '+923001234567', verificationId, carrier: 'Example carrier', location: { latitude: 0, longitude: 0, accuracyMeters: 20, timestamp: time }, consent, applications: { status: 'unsupported', packages: [] }, idempotencyKey: 'unique-request-id-1234' });
  return { api, request, verify, capture, consent, advance: milliseconds => { time += milliseconds; } };
}
test('international input and location quality validation', () => {
  assert.equal(normalizeName(' 李 '), '李');
  assert.equal(normalizePhone('+92 (300) 123-4567'), '+923001234567');
  assert.throws(() => normalizeName('a\u202Eb')); assert.throws(() => normalizePhone('03001234567'));
  assert.throws(() => validateLocation({ latitude: 91, longitude: 0, accuracyMeters: 20, timestamp: Date.now() }));
});
test('authenticated end-to-end capture with single-use verification and idempotency', async () => {
  const f = fixture(), verificationId = await f.verify(), body = f.capture(verificationId);
  const results = await Promise.all([f.request('/captures', body), f.request('/captures', body)]);
  assert.equal(results[0].status, 200); assert.deepEqual(results[0], results[1]);
  assert.equal(f.api.inspectForTesting().length, 1);
  assert.equal(f.api.inspectForTesting()[0].phoneVerification, 'test_only');
  assert.equal((await f.request('/captures', { ...body, idempotencyKey: 'another-request-1234' })).body.error, 'phone_verification_required');
  assert.equal((await f.request('/captures', { ...body, fullName: 'Changed' })).status, 409);
  f.advance(61_000);
  assert.equal((await f.request('/captures', body)).status, 200);
});
test('rejects unauthenticated requests, missing consent and subject/phone mismatch', async () => {
  const f = fixture();
  assert.equal((await f.request('/phone/start', {}, 'stranger')).status, 401);
  assert.equal((await f.request('/phone/start', { phone: '+923001234567' })).body.error, 'consent_required');
  const id = await f.verify(), body = f.capture(id);
  assert.equal((await f.request('/captures', body, 'bob')).body.error, 'phone_verification_required');
  assert.equal((await f.request('/captures', { ...body, phone: '+923001234568' })).body.error, 'phone_verification_required');
  assert.equal((await f.request('/captures', { ...body, consent: { ...f.consent, location: false } })).body.error, 'location_consent_required');
});
test('enforces OTP attempt limits, resend throttles and expiry', async () => {
  const f = fixture();
  const challenge = await f.request('/phone/start', { phone: '+923001234567', consent: f.consent });
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/phone/verify', { challengeId: challenge.body.challengeId, code: '000000' })).body.error, 'invalid_code');
  assert.equal((await f.request('/phone/verify', { challengeId: challenge.body.challengeId, code: '123456' })).body.error, 'invalid_challenge');
  for (let i = 0; i < 4; i++) await f.request('/phone/start', { phone: '+923001234567', consent: f.consent });
  assert.equal((await f.request('/phone/start', { phone: '+923001234567', consent: f.consent })).status, 429);
  const g = fixture(), id = await g.verify(); g.advance(600_001);
  assert.equal((await g.request('/captures', g.capture(id))).body.error, 'phone_verification_required');
});
test('rejects imprecise, stale and excessive application collection; purges retained data', async () => {
  const f = fixture(), id = await f.verify(), body = f.capture(id);
  assert.equal((await f.request('/captures', { ...body, location: { ...body.location, accuracyMeters: 1000 } })).body.error, 'imprecise_location');
  assert.equal((await f.request('/captures', { ...body, location: { ...body.location, timestamp: body.location.timestamp - 60_001 } })).body.error, 'stale_location');
  assert.equal((await f.request('/captures', { ...body, applications: { status: 'limited', packages: ['com.other.app'] } })).body.error, 'invalid_applications');
  assert.equal((await f.request('/captures', body)).status, 200);
  f.advance(900_001); f.api.prune(); assert.equal(f.api.inspectForTesting().length, 0);
});
