// Server-side validation is authoritative; clients independently validate for prompt feedback.
export class CaptureError extends Error {
  constructor(code, message) { super(message); this.name = 'CaptureError'; this.code = code; }
}
export function requireValue(condition, code, message) {
  if (!condition) throw new CaptureError(code, message);
}
export function normalizeName(value) {
  requireValue(typeof value === 'string', 'invalid_name', 'Enter your full name.');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  requireValue(name.length > 0 && name.length <= 150 && /\p{L}/u.test(name) && !/[\p{Cc}\p{Cf}<>]/u.test(name), 'invalid_name', 'Enter a name of up to 150 characters without control characters.');
  return name;
}
export function normalizePhone(value) {
  requireValue(typeof value === 'string', 'invalid_phone', 'Enter an international phone number.');
  const phone = value.trim().replace(/[ ()-]/g, '');
  requireValue(/^\+[1-9]\d{7,14}$/.test(phone), 'invalid_phone', 'Use an international number, for example +923001234567.');
  return phone;
}
export function normalizeCarrier(value) {
  requireValue(typeof value === 'string' && value.trim().length <= 100 && !/[\p{Cc}\p{Cf}<>]/u.test(value), 'invalid_carrier', 'Carrier must be up to 100 characters.');
  return value.trim();
}
export function validateLocation(value, { now = Date.now(), maxAgeMs = 60_000, maxAccuracyMeters = 100 } = {}) {
  requireValue(value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 && Number.isFinite(value.accuracyMeters) && value.accuracyMeters >= 0, 'invalid_location', 'The device returned an invalid location.');
  requireValue(Number.isFinite(value.timestamp) && now - value.timestamp <= maxAgeMs && value.timestamp <= now + 5_000, 'stale_location', 'Capture a fresh location before continuing.');
  requireValue(value.accuracyMeters <= maxAccuracyMeters, 'imprecise_location', `Location accuracy must be within ${maxAccuracyMeters} metres. Try again near a window or outdoors.`);
  return { latitude: value.latitude, longitude: value.longitude, accuracyMeters: value.accuracyMeters, timestamp: value.timestamp };
}
