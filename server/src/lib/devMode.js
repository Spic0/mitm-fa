// Single source of truth for whether dev-only tooling (instant admin login,
// simulated purchases, the "Login as Admin (dev only)" button) is enabled.
// Two independent conditions, not one: never a single misconfigured/missing
// env var away from being live in production.
const isDevRoutesEnabled = process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_ROUTES === "true";

module.exports = { isDevRoutesEnabled };
