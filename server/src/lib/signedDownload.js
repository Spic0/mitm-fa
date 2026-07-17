const crypto = require("crypto");

// Short-lived, HMAC-signed download tokens. Purely a token format — no DB
// row, no state to clean up — since everything needed to validate a token
// (who it's for, what it's for, when it expires) travels inside the token
// itself, signed so it can't be tampered with, and the signing key never
// leaves the server.
//
// Why this exists on top of the session+entitlement check that already
// gates every download (library.js): a bare, permanent URL like
// /api/library/resource/:resourceId only needs a valid session to work
// forever. If that URL leaks — browser history, a referrer header, a
// screenshot, a proxy log — it stays useful for as long as the session
// does (today: 30 days). A signed token narrows that window to minutes,
// and — because it's re-verified at the moment the bytes are actually
// served, not just at mint time — a refund or access revocation that
// happens *after* a token was minted but before it's used still takes
// effect immediately.
const TTL_MS = {
  resource: 5 * 60 * 1000,
  media: 15 * 60 * 1000, // longer: a <video> element may re-request the same src while seeking
};

function sign(payloadB64) {
  const secret = process.env.CSRF_SECRET; // reusing the same server-only HMAC secret; no need for a second one
  if (!secret) throw new Error("CSRF_SECRET is not configured");
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

// type: "resource" | "media". id: the resourceId, or "productId/fileName" for media.
function mintDownloadToken(type, id, userId) {
  const payload = { type, id, userId, exp: Date.now() + TTL_MS[type] };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

function verifyDownloadToken(token, expectedType) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expected = sign(payloadB64);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null; // tampered, or forged without knowing the secret
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (payload.type !== expectedType) return null;
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null; // expired
  return payload;
}

module.exports = { mintDownloadToken, verifyDownloadToken };
