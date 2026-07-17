// Per-account failed-login backoff, independent of the IP-based rate limiter
// in middleware/rateLimit.js — this catches a credential-stuffing attempt
// that's distributed across many source IPs but targets one email address.
// In-memory only: fine for the current single-instance deployment; would
// need a shared store (Redis) behind a load balancer.

const attempts = new Map(); // email -> { count, lockedUntil }

const MAX_ATTEMPTS = 5;
const BASE_LOCK_MS = 30 * 1000; // 30s, doubles per additional failure past the threshold
const RESET_AFTER_MS = 15 * 60 * 1000; // stale attempt windows don't compound forever

function keyFor(email) {
  return String(email || "").trim().toLowerCase();
}

function isLocked(email) {
  const rec = attempts.get(keyFor(email));
  if (!rec || !rec.lockedUntil) return false;
  if (rec.lockedUntil <= Date.now()) return false;
  return true;
}

function lockedForMs(email) {
  const rec = attempts.get(keyFor(email));
  if (!rec || !rec.lockedUntil) return 0;
  return Math.max(0, rec.lockedUntil - Date.now());
}

function recordFailure(email) {
  const key = keyFor(email);
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.lastFailureAt > RESET_AFTER_MS) {
    attempts.set(key, { count: 1, lastFailureAt: now, lockedUntil: 0 });
    return;
  }
  rec.count += 1;
  rec.lastFailureAt = now;
  if (rec.count >= MAX_ATTEMPTS) {
    const extra = rec.count - MAX_ATTEMPTS;
    rec.lockedUntil = now + BASE_LOCK_MS * Math.pow(2, extra);
  }
}

function recordSuccess(email) {
  attempts.delete(keyFor(email));
}

module.exports = { isLocked, lockedForMs, recordFailure, recordSuccess };
