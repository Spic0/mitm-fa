const bcrypt = require("bcryptjs");

// ONE definition of how a user password is hashed and checked.
//
// The cost and the minimum length used to live as literals inside
// routes/auth.js — `bcrypt.hash(password, 12)` in set-password, `length < 8`
// in the same handler — which meant anything else that needed to create or
// change a password (an admin CLI, a seed, a future invite flow) had to
// restate them and would drift the first time either changed. They are
// constants here instead, and auth.js imports them like everyone else.
//
// Deck passwords are deliberately NOT routed through this: lib/presentations.js
// hashes those, and they are a different credential for a different subject.
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

// The application's password policy, in the one place that defines it.
// Returns a human-readable reason, or null when the password is acceptable.
function passwordPolicyError(password) {
  const value = String(password == null ? "" : password);
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

function hashPassword(password) {
  return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

// Always compare through bcrypt rather than anything shorter-circuiting: a
// missing hash must not be a way in.
function verifyPassword(password, hash) {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(String(password), hash);
}

module.exports = {
  BCRYPT_ROUNDS,
  MIN_PASSWORD_LENGTH,
  passwordPolicyError,
  hashPassword,
  verifyPassword,
};
