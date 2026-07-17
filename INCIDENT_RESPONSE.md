# Incident Response Plan

Quick-reference for the four scenarios most likely to come up. This assumes access to: the production database (via `DATABASE_URL`), the hosting platform's environment variable settings, and the Stripe/PayPal/Resend dashboards.

## Revoke a user's sessions (compromised account, or as part of any other response below)

Sessions are server-side records (`Session` table), not stateless tokens — deleting the row invalidates it immediately, no waiting for expiry.

- **Via admin dashboard** (fastest, no DB access needed): Customers → find the user → **Reset Login Sessions**. This deletes all of that user's sessions immediately (`server/src/routes/admin/customers.js`, `POST /api/admin/customers/:id/reset-login`).
- **Via database directly**: `DELETE FROM "Session" WHERE "userId" = '<user id>';`
- **Suspending an account** (stronger — also blocks future logins, not just current sessions): same Customers page → **Suspend**. This sets `status = "suspended"`, which both deletes existing sessions and makes `getUserBySessionToken`/`login-password` reject that account going forward (`server/src/lib/session.js`, `server/src/routes/auth.js`).
- **Revoke every session platform-wide** (suspected session-store compromise, not just one account): `DELETE FROM "Session";` — logs everyone out; not scoped to a single user, use only if the whole session store is suspect.

## Block/suspend a user

Admin dashboard → Customers → find the account → **Suspend**. This is idempotent and reversible (**Reactivate** toggles it back). Suspension is enforced at three points independently — `login-password`, magic-link `verify`, and every `getUserBySessionToken` call — so a suspended account can't slip through by using a session that was already open before the suspension.

There is currently no IP-ban or device-ban mechanism — suspension is account-level only. If the abuse is unauthenticated (e.g. hitting `/api/auth/magic-link` repeatedly from one IP), the rate limiter (`server/src/middleware/rateLimit.js`) already throttles it automatically; for a sustained attack you'd block the IP at the hosting platform/firewall/CDN level, which is outside this application.

## Rotate a compromised key or secret

All secrets live only in environment variables (`server/.env` locally; your hosting platform's env var settings in production) — never in the database or in code. Rotating any of them requires no code change, only:

1. Generate a new value at the source (Stripe/PayPal/Resend dashboard, or `openssl rand -hex 32` for `SESSION_SECRET`-shaped values).
2. Update the environment variable on the hosting platform.
3. Restart/redeploy the app so the new process picks up the new value (Node reads `process.env` once at startup via `dotenv`).

Specific notes per secret:
- **`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`**: rotate in the Stripe dashboard (Developers → API keys / Webhooks). The webhook secret is per-endpoint — if you roll it, update the webhook endpoint's signing secret too, or signature verification (`server/src/routes/webhooksStripe.js`) will start rejecting all events.
- **`PAYPAL_CLIENT_SECRET`**: rotate in the PayPal developer dashboard for that app.
- **`RESEND_API_KEY`**: rotate in the Resend dashboard.
- **`DATABASE_URL`** (if the DB password is what's compromised): rotate the Postgres user's password at the DB host, update the connection string.
- Old keys should be **revoked**, not just replaced — a leaked key that's merely "no longer used" by your app is still valid and usable by an attacker until revoked at the source.

If the compromised secret is `STRIPE_SECRET_KEY`, also check the Stripe dashboard's request logs for that key for any unrecognized activity (charges, refunds, payouts) during the exposure window — key rotation stops *future* misuse, it doesn't undo anything already done with it.

## Restore service after an outage or bad deploy

- **Bad deploy** (new code broke something): redeploy the last known-good commit/build. No database migration rollback is needed unless that deploy also ran a Prisma migration — check `server/prisma/migrations/` for anything with a recent timestamp before reverting code only.
- **Database issue**: restore from your hosting provider's Postgres backup (frequency/retention is provider-dependent — see the open item in `SECURITY_AUDIT.md` about confirming this with whoever manages the production database).
- **Suspected data tampering**: before restoring anything, check `SystemLog` (`GET /api/admin/system-logs` in the admin dashboard) for the relevant time window — every admin action, login, and access-denied event is recorded there with an actor, which is usually the fastest way to see what actually happened.
- After any restore, verify the Stripe webhook is still reachable and its signing secret still matches (`STRIPE_WEBHOOK_SECRET`) — a stale secret after a restore silently blocks all future order fulfillment via the webhook path (the client-side `/stripe/finalize` fallback still works, but only when the shopper's browser makes it back to the confirmation page).
