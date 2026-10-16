const { isValidCountryCode } = require("./countries");

// Validation for the checkout Contact & Billing block. The browser validates
// the same four fields inline for feedback; this is the authority, because the
// browser copy is trivially bypassed and these values end up on the User
// record, on the Stripe PaymentIntent, and in the receipt email.
//
// Deliberately permissive about *shape* and strict about *bounds*: names and
// phone formats vary far more internationally than a regex can usefully
// capture, and rejecting a legitimate buyer at the payment step is much more
// expensive than storing a slightly odd name. The one hard format requirement
// is E.164 for phone, which the client composes from its country picker.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// E.164: "+", country calling code, subscriber number — 15 digits max total.
// The 8-digit floor rejects a bare dial code with nothing after it, which is
// what an untouched country picker submits.
const E164_RE = /^\+[1-9]\d{7,14}$/;

const MAX = { name: 100, email: 200, phone: 20 };

function clean(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\x00-\x1f\x7f]/g, "") // control chars: these reach an HTML email and a Stripe metadata field
    .trim()
    .slice(0, max);
}

// Strips spaces, hyphens, parens and a leading "00" international prefix so
// that "+44 (0)20 7946 0958", "0044 20 7946 0958" and "+442079460958" all
// normalize to one stored value. Digits are never invented or dropped beyond
// that formatting noise.
function normalizePhone(raw) {
  let phone = clean(raw, 40);
  // "(0)" is the conventional way of writing an optional national trunk
  // prefix that must be dropped when dialling internationally — "+44 (0)20
  // 7946 0958" is "+442079460958", not "+4402079460958". Removed before the
  // generic punctuation strip, which would otherwise leave the 0 behind.
  phone = phone.replace(/\(0\)/g, "");
  phone = phone.replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  return phone.slice(0, MAX.phone);
}

// Returns { name, email, phone, country } with everything normalized, or
// throws the first validation error. Callers surface err.message directly to
// the shopper, so every message here has to read as customer-facing copy.
function parseCustomerDetails(body) {
  const name = clean(body.name, MAX.name);
  const email = clean(body.email, MAX.email).toLowerCase();
  const phone = normalizePhone(body.phone);
  const country = clean(body.country, 2).toUpperCase();

  if (name.length < 2) throw new Error("Please enter your full name");
  if (!EMAIL_RE.test(email)) throw new Error("Please enter a valid email address");
  if (!E164_RE.test(phone)) throw new Error("Please enter a valid phone number, including the country code");
  if (!isValidCountryCode(country)) throw new Error("Please select your country");

  return { name, email, phone, country };
}

module.exports = { parseCustomerDetails, normalizePhone, EMAIL_RE };
