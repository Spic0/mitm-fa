# Security Audit Report — ProFit E-Commerce Platform

**Date:** 2026-07-10
**Scope:** Full application — Express/Prisma/PostgreSQL backend, vanilla JS storefront, admin dashboard, Stripe + PayPal payments, file uploads.

**Stack correction:** The original brief described this as a Next.js/Supabase application. It is actually **Node/Express + Prisma + PostgreSQL**, with a server-rendered vanilla HTML/JS frontend, cookie-based sessions, and a magic-link + optional-password hybrid auth system. There is no Supabase project and therefore no Row Level Security layer — the Express/Prisma API is the sole authorization boundary. All findings below are framed against the real stack; items from the original brief that assumed Supabase/Next.js-specific mechanisms (RLS policies, OTP endpoints) were re-scoped to their actual equivalents or marked not applicable.

Every fix below was verified by restarting the live dev server and exercising the actual code path (curl, a headless-browser CSP/console check, or a real exploit attempt), not by code review alone. Details are in the phase-by-phase conversation log; this document is the consolidated summary.

---

## Summary

| Severity | Count | Fixed | Needs your input |
|---|---|---|---|
| Critical | 1 | 1 | — |
| High | 5 | 5 | — |
| Medium | 10 | 10 | — |
| Low | 8 | 8 | — |
| Informational / business decisions | 5 | — | 5 |

No SQL injection or command injection surface exists anywhere in the codebase (Prisma ORM only, no raw queries, no shell-outs) — this eliminated two entire OWASP categories by design rather than requiring a fix.

---

## Findings

### CRITICAL

**C1. Unauthenticated instant-admin-login endpoint, gated by a single env var** — Phase 1
`POST /api/dev/login-as-admin` mints a valid admin session with zero credentials. It was gated only by `NODE_ENV !== "production"` — a single point of failure. If a production deploy ever left `NODE_ENV` unset or misconfigured (common on PaaS platforms that don't set it by default), this becomes a live, unauthenticated full-admin takeover.
**Fixed:** Added a second, independent required flag (`ENABLE_DEV_ROUTES=true`, never set in production) alongside `NODE_ENV`. Verified live: with `NODE_ENV` misconfigured to non-production and the new flag absent, the route now 404s. The client-side "Login as Admin (dev only)" button visibility was also fixed to match (was checking only `NODE_ENV`, now uses the same shared two-factor check).

### HIGH

**H1. Admin logo upload accepted any file type into the public webroot** — Phase 4
`POST /api/admin/settings/logo` had no file-type restriction at all (any file, up to 5MB), written directly into `assets/images/logo/uploads/` and served statically. An admin session (or a hijacked one) could upload an HTML or SVG file with embedded `<script>` and reach it directly by URL — stored XSS on the site's own origin.
**Fixed:** Added a real allowlist (PNG/JPEG/WebP/GIF; SVG deliberately excluded — see rationale in the code comment, regex-based SVG sanitization is a known-weak control), real content verification via magic-byte sniffing (not just the client-declared `Content-Type`), and UUID-only filenames. **Live-tested:** an HTML payload disguised as `image/png` (spoofed header) was rejected on real-content inspection; a genuine PNG succeeded and was renamed to a UUID.

**H2. No rate limiting or lockout on any auth endpoint** — Phase 1
`/login-password`, `/magic-link`, `/verify` had no rate limiting and no account lockout — open to credential stuffing and email-bombing.
**Fixed:** IP-based rate limiting on all three endpoints, a per-email limit on `/magic-link` (so an attacker can't email-bomb one inbox from many IPs), and exponential-backoff account lockout after 5 failed password attempts. **Live-tested:** the 6th rapid bad-password attempt returned 429.

**H3. Storefront cart/checkout had zero HTML-escaping anywhere** — Phase 3
`assets/js/script.js` (cart drawer, full cart page, checkout order summary) had no `escapeHtml` helper at all. A product name or image URL containing HTML would execute in **any site visitor's** browser, unauthenticated, the moment they viewed their cart.
**Fixed:** escaping added at all 6 sink locations. **Live-tested** with an actual `<img src=x onerror=alert(document.domain)>` payload injected through the real cart-add flow and rendered through the real cart drawer, cart page, and checkout summary — confirmed inert (renders as literal text, no dialog fires) in all three.

**H4. No CSRF protection on any state-changing request** — see the dedicated **CSRF Protection** section below for full design and live attack-simulation proof. A cross-site page could ride a logged-in admin's or customer's session cookie to perform actions on their behalf (change settings, create records, etc.) with no token required. Fixed with a per-session HMAC-derived token, validated on every mutating request from an authenticated session.

**H5. Downloads of paid content were permanent, non-expiring URLs** — see the dedicated **Download Endpoint Security** section below. A leaked resource/media URL (browser history, referrer header, screenshot, proxy log) stayed usable for as long as the finder's session lasted — up to 30 days — with no way to shrink that window short of revoking the whole session. Fixed with short-lived, HMAC-signed download tokens (5–15 min TTL) re-verified against live ownership at the moment of serving, not just at mint time.

### MEDIUM

**M1. `set-password` allowed overwriting an existing password with no re-authentication** — Phase 1. A hijacked session cookie could be used to plant a permanent password and retain access after the real owner's session expired. Fixed: requires the current password when one is already set; frontend updated to match.

**M2. Suspended-account login leaked account existence via a distinct error/status code** — Phase 1. Fixed: now returns the same generic message as a bad password.

**M3. No HTTPS redirect, HSTS, or Content-Security-Policy anywhere** — Phase 1. Fixed via `helmet`: CSP (verified via headless-browser console-error sweep across every major page, catching and fixing two self-introduced regressions — Google Fonts and an inline admin-login script — along the way), HSTS, `X-Content-Type-Options`, `X-Frame-Options`, production-only HTTPS redirect.

**M4. Product cover/thumbnail images and exercise media only checked the client-declared `Content-Type` header, not real file content** — Phase 4. Fixed: same magic-byte verification as H1, applied to all four upload surfaces (logo, product images, exercise media, bonus resources). Bonus-resource uploads previously had **zero** type restriction at all (any file, unlimited type) — now allowlisted to PDF/Office docs/zip/images.

**M5. `resolveCheckoutItems` didn't filter by product status** — Phase 2. A customer who discovered a draft/archived product's ID (visible in the admin dashboard) could complete a real Stripe/PayPal purchase for it, bypassing the intended "not yet purchasable" state. Fixed: checkout now only resolves `published` products, matching the public catalog's existing behavior.

**M6. Bonus-resource "link" URLs were unescaped in the program view, with a double issue** — Phase 3. The URL both broke out of its HTML attribute *and*, independently, could use a `javascript:` scheme to execute on click regardless of escaping. Fixed both: HTML-escaped on render, and the server now rejects any resource URL that isn't `http:`/`https:`.

**M7. Featured product name unescaped in the sitewide header mega-menu** — Phase 3. Fires on every page load once any product is marked featured. Fixed.

**M8. Access-denied (403) events were never logged** — Phase 8. Fixed: logged at both the API and page-level authorization gates, scoped to authenticated-but-forbidden (not every anonymous 401, which would be pure noise). Live-verified in the admin System Logs view.

**M9. No refund revocation existed at all** — see the dedicated **Download Endpoint Security** section below. `Order.status` had `"refunded"` as a documented possible value with no code path that ever set it — a Stripe/PayPal refund issued directly through the payment provider's dashboard had zero effect on the customer's continued access to the paid content. Fixed with an admin action plus an automatic Stripe `charge.refunded` webhook handler; entitlement already correctly excluded any non-`"paid"` status, it just needed a way to actually get flipped.

### LOW

**L1.** Product slug shown unescaped in the admin product table, and had no server-side format validation despite being used as a URL segment. Fixed both (Phase 3).

**L2.** The shared `confirmDialog()` admin UI helper didn't escape its title/message, which meant a malicious taxonomy-node name could execute in another admin's browser on delete. Fixed at the shared-helper level (Phase 3), which also silently closed that specific case.

**L3.** JSON request body had no size limit. Capped at 1MB (Phase 1).

**L4.** No server-level request/header timeouts (slow-request/slowloris exposure). Added 2-minute timeouts, sized to not cut off legitimate large uploads (Phase 5).

**L5.** `file-type` (the package added for upload content-verification) was initially pinned to a version with a known moderate-severity DoS advisory (infinite loop on malformed input). Caught during the same session and upgraded to the patched version before it shipped (Phase 4).

**L6.** Admin API and checkout endpoints had no rate limiting (defense-in-depth against automated abuse via a compromised admin session, or checkout-endpoint cost/fraud abuse). Added (Phase 5).

**L7.** No audit logging existed for "Preview as Customer" usage (an admin bypassing entitlement to view a draft/unpurchased program). Fixed — see the dedicated **"Preview as Customer" Feature** section below. Also fixed, same section: a bug where preview mode was silently broken for bonus-resource downloads specifically (missing admin bypass on that one route, inconsistent with the rest of the feature).

---

## CSRF Protection

**Design:** token-based, not SameSite-only. Every session gets a companion CSRF cookie whose value is `HMAC-SHA256(session_raw_token, CSRF_SECRET)` — computed server-side, not randomly generated and stored. This makes it a "signed double-submit cookie": no database row needed for it, and it's a genuine per-session token (not one global site-wide secret) since it's derived from that session's own unique token.

- **Generation:** issued alongside the session cookie in `server/src/lib/session.js`'s `setSessionCookie()`. The cookie (`profit_csrf`) is deliberately **not** `HttpOnly` — the frontend JS needs to read it and echo it back — but it's useless to an attacker without also knowing the value of the real, `HttpOnly` session cookie to derive it from, and useless to forge without the server-only `CSRF_SECRET`.
- **Validation:** `server/src/middleware/csrf.js`, mounted globally on `/api/*` for every `POST`/`PUT`/`PATCH`/`DELETE` request. Requires an `X-CSRF-Token` header that matches the value re-derived server-side from the trusted session cookie (constant-time comparison, not a plain `===`).
- **Scope:** only enforced when `req.user` is set — i.e., only when a request is actually relying on an authenticated session's ambient authority, which is the entire premise of CSRF. Anonymous, pre-session requests (login, magic-link request, guest checkout) have no session to protect and are correspondingly out of scope; they're covered instead by the rate limiting from Phase 1/5. The Stripe webhook is exempt by construction (mounted before cookie parsing even happens) and authenticated by Stripe's own request signature, not a cookie.
- **Rotation:** automatic and free — since the token is derived from the session's own raw token, a new login (new session) produces a new CSRF token with no extra code. Logout clears both cookies together.
- **Migration:** sessions that existed before this feature (or any session that loses its CSRF cookie without losing the session itself) get the CSRF cookie silently backfilled on their very next authenticated GET request — before they'd ever attempt a mutating request. Verified live: a session created without a CSRF cookie was rejected on `POST` until one authenticated `GET` request, after which the mutating request succeeded with the newly-issued token.
- **Frontend:** both `assets/js/api.js` and `assets/js/admin/api.js` (the two centralized fetch wrappers everything routes through) automatically attach `X-CSRF-Token` on every non-GET/HEAD request — no per-call-site changes needed anywhere else in the codebase.

**Live attack simulation (not just code review):** stood up a second local origin (`localhost:4001`) serving a page that, in one real logged-in-admin browser session, attempted two forged requests against the real app on `localhost:3000`:
1. A `fetch()`-based forgery — blocked by the browser's CORS policy before it even reached the CSRF check (this app sends no `Access-Control-Allow-Origin` header, so cross-origin `fetch` reads are refused by design).
2. A classic hidden-iframe **HTML form POST** (the vector CORS doesn't cover at all) attempting to create a fake customer account. This one is the meaningful test: the response came back `403`, meaning the browser *did* attach the session cookie to this cross-site POST (consistent with Chromium's grace-period exception for freshly-set `SameSite=Lax` cookies) — **`SameSite=Lax` alone did not stop this request.** The CSRF token requirement is what rejected it. Confirmed server-side: no forged customer account was created.

This is direct evidence for why the brief's "or document why SameSite is sufficient" alternative would have been the wrong call here — in this real browser, it wasn't sufficient on its own.

**Also verified:** the real admin dashboard UI (not curl) — logged in, opened Settings, changed a value through the actual form, confirmed it persisted — proving the frontend wiring works transparently, not just the backend logic in isolation.

---

## Business Logic Security (Phase X)

Every vector tested live against the running app, not by code review alone. Two real findings; everything else was already correctly enforced.

| Vector | Result |
|---|---|
| Purchasing products for $0 | **Blocked.** `qty: 0` is clamped to 1 (`Math.max(1, ...)`); price is always recomputed server-side from the DB, never accepted from the client. |
| Changing prices client-side | **Blocked.** Sent `priceCents: 1` for a $59.00 product — server charged $59.00, the forged value was never read. |
| Negative quantities | **Blocked.** `qty: -5` clamps to 1 via the same `Math.max(1, ...)` — confirmed no negative-total or free-item path exists. |
| Multiple webhook replays | **Safe, but exposed a bug** — see Race conditions below. An exact-duplicate webhook event returns `200` both times with only one `Order` row created (idempotent by design), confirmed live. |
| Duplicate order creation | **Safe.** `Order.providerRef` has a database-level `@unique` constraint — this is the real backstop, not just the idempotency check in application code. |
| Coupon abuse | **N/A** — no coupon/discount/promo-code system exists anywhere in this codebase (confirmed by search). Nothing to abuse. |
| Race conditions during checkout | **[MEDIUM] Found and fixed.** See below — this is the significant finding of this phase. |
| Downloading products without ownership | **Blocked.** Re-verified live with two fresh accounts: a non-owner gets `403` on `/api/library/program/:id`, the real owner gets `200`. Same entitlement check already proven in the Phase 2 IDOR audit. |
| Purchasing archived products | **Blocked** — this was the fix from Phase 2 (`resolveCheckoutItems` filters to `status: "published"`); re-verified it still holds by creating a fresh archived product and attempting to check out with it (`"Unknown product"` error). |
| Manipulating discounts | **N/A** — same as coupons, no discount mechanism exists to manipulate. |
| Double-click checkout | **Hardened.** The UI-level guard (`.disabled { pointer-events: none }` on the Place Order button) is real and effective for an actual human double-click. Added a synchronous JS re-entrancy flag (`checkoutInFlight`) as a second, independent layer that can't be bypassed by a programmatic double-invocation (e.g. a stray duplicate event listener) — cheap insurance directly against the vector you named, on top of Stripe's own PaymentIntent state machine, which would independently reject a second confirmation of an already-processing payment. |
| Payment replay attacks | **Blocked.** Signed a webhook payload with a 10-minute-old timestamp using Stripe's own test-signing helper — rejected: `"Timestamp outside the tolerance zone"` (Stripe SDK's default 300-second replay window). |

### [MEDIUM] Race condition in `fulfillOrder()` — found and fixed

Every real purchase fulfills through **two independent paths that race by design**: the Stripe webhook (the durable source of truth) and the browser's `/stripe/finalize` call (which exists purely to log the browser in, since a webhook response can't set a cookie in the shopper's browser). Both call the same `fulfillOrder()` function for the same payment, and there was a classic check-then-act gap: `findUnique(providerRef)` → not found → `create()`, with no atomicity between the check and the write.

**Live-tested with 5 truly concurrent requests for the same PaymentIntent:** before the fix, only 1 of 5 succeeded — the other 4 returned raw `500 Fulfillment failed` responses and wrote spurious `"failed"` entries into the admin Payment Logs, for a payment that had actually succeeded. Data integrity itself was never at risk (`Order.providerRef`'s database-level unique constraint meant exactly one `Order` row was created every time, in every test), but this is a real reliability bug: a normal customer's checkout could occasionally 500 on the client-side finalize call whenever the webhook happened to win the race, and Stripe's dashboard would show a confusing failed-then-retried delivery for an order that fulfilled correctly the first time. The same pattern existed one level up, in first-time-customer `User` creation (racing on the `email` unique constraint) — same root cause, same fix.

**Fixed:** `server/src/lib/fulfillOrder.js` now catches the specific database unique-constraint error (Prisma `P2002`) on both the `User.email` and `Order.providerRef` collisions and, instead of throwing, re-fetches and returns the record the concurrent request actually won with. Re-ran the identical 5-concurrent-request test after the fix: **all 5 return `200`, exactly one `Order`, one `User`, one `OrderItem`, zero spurious failure log entries.**

### [LOW] Unbounded cart size — found and fixed

Not on your list, but surfaced while testing the $0/quantity vectors: `resolveCheckoutItems` had no cap on cart size. A single request with 10,000 line items forced a ~510KB JSON blob into the database (via the PayPal `PendingCheckout` path, which stores the raw item list in an unbounded text column) and ~2 seconds of server-side computation building the resolved-items array, before either payment provider's API had a chance to reject anything. The Stripe path happened to be incidentally protected by Stripe's own 500-character metadata-field limit — but that's a side effect of an unrelated Stripe constraint, not a real guard, and the PayPal path had no such luck. No monetary exploit (the computed total legitimately reflected the huge cart), but a genuine resource-exhaustion vector.

**Fixed:** added an explicit cap (50 line items, 100 total units after quantity expansion) directly in `resolveCheckoutItems`, rejected before the database is even queried. **Live-tested:** the same 10,000-item request that took ~2.3s and wrote a 510KB row now rejects in ~150ms with no DB write at all; normal-sized carts are unaffected.

---

## Stripe Webhook Idempotency

Two independent layers now, deliberately not just one:

1. **Event-level (new this pass):** every signature-verified webhook event's Stripe `event.id` is atomically claimed in a new `WebhookEvent` table (`provider`, `eventId` — `@unique`, `eventType`, `receivedAt`) before any processing happens, via `prisma.webhookEvent.create()` and catching the unique-constraint violation as the duplicate signal — the same insert-first pattern used for the race fix above, chosen specifically to avoid re-introducing that exact class of check-then-act race. A duplicate delivery returns `200 {"received": true, "duplicate": true}` immediately, doing none of the work again.
2. **Business-outcome-level (already in place from the race-condition fix above):** `Order.providerRef`'s database unique constraint, which guarantees no duplicate order regardless of what happens at the event layer.

**Why both, not just one:** the event-level table is what actually satisfies "each event must only be processed once" for event types with no natural idempotency key of their own — `payment_intent.payment_failed` only ever writes log rows, so before this fix a duplicate delivery would have silently written duplicate `SystemLog`/`PaymentEvent` entries with **zero** protection. `payment_intent.succeeded` already had order-level protection from the previous fix, but the event-level table stops it from even *attempting* redundant work, which is cleaner and cheaper than relying on the create-then-catch fallback every time.

**Live-tested, all four scenarios:**
- **Sequential replay** — same signed event sent twice: first `200 {"received":true}`, second `200 {"received":true,"duplicate":true}`. Exactly one `Order` and one `WebhookEvent` row.
- **Concurrent duplicate delivery** — the same event fired 5 times *simultaneously*: exactly 1 of 5 processed, the other 4 returned the duplicate response immediately (no fulfillment work attempted). Exactly one `Order`, and — notably better than the previous fix alone — exactly **one** `PaymentEvent` log row, not five.
- **The previously-unguarded `payment_intent.payment_failed` path** — 3 concurrent identical failed-payment deliveries: exactly 1 processed. Confirmed exactly one `PaymentEvent` and one `SystemLog` row (would have been 3 of each before this fix).
- **Correct scoping (not over-broad)** — sent two *genuinely distinct* events (different `event.id`, different `event.type`: a `payment_failed` followed by a `succeeded`) for the *same* PaymentIntent, simulating a declined-card-then-retry flow. Both processed normally, neither blocked the other — confirmed one `Order` plus both `PaymentEvent` rows (`succeeded` and `failed`) present. This matters: deduping on `providerRef` alone instead of `event.id` would have incorrectly dropped one of these two legitimate, different events.

**Duplicate library access:** follows directly from "no duplicate orders" — entitlement (`hasEntitlement`) is `OrderItem` existence via `findFirst`, not a count, so even in a hypothetical world with duplicate `OrderItem` rows a customer would never gain more or different access than one purchase grants. With order-level duplication now structurally prevented at two independent layers, this was never separately at risk.

**Deliberate trade-off, documented in code:** if processing fails *after* an event is claimed, a later Stripe retry of that exact `event.id` will be treated as a duplicate and skipped, not reprocessed. This is acceptable specifically because `payment_intent.succeeded` fulfillment has a fully independent second path — the browser's `POST /stripe/finalize` call, which isn't gated by this table at all — so a webhook-side failure doesn't strand an order. Worth knowing about, not worth engineering around given that safety net already exists.

**Migration:** `server/prisma/migrations/20260710093904_add_webhook_event_dedup/`.

---

## Download Endpoint Security

Every file-serving endpoint audited against all seven requirements. Two real gaps found and fixed (signed URLs, refund revocation); everything else was already solid or is protected by mechanisms already documented above.

| Requirement | Status |
|---|---|
| Verify ownership | **Already solid**, re-confirmed live: `hasEntitlement()` checked before serving; a non-owner gets `403` even before a download link is minted. |
| Short-lived signed URLs | **Gap — built.** Previously bare, permanent, session-gated paths (`/api/library/resource/:id`, `/api/library/media/:productId/:file`). See design below. |
| Expire automatically | **Gap — built**, same change. Live-tested: a genuinely expired (but correctly signed) token is rejected with `410`. |
| Prevent direct file enumeration | **Already solid.** Files are stored under UUID names (Phase 4 fix) outside the public webroot; the only way to reach one is through the database-driven, entitlement-checked route. |
| Prevent hotlinking | **Already solid, and stronger than expected.** Live cross-origin `<img>` embed test: blocked outright by `Cross-Origin-Resource-Policy: same-origin` (a `helmet` default already in place) before the request even completed — `net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`. `SameSite=Lax` would independently have stopped the session cookie from riding along even without CORP. |
| Prevent guessing URLs | **Already solid**, plus reinforced. Resource IDs are Prisma `cuid()`s, media filenames are `crypto.randomUUID()`s — not practically guessable. The new signed tokens add a second, cryptographic (HMAC-SHA256) layer on top. One informational note: Prisma's default `cuid()` (v1) has a loosely time/counter-structured format, unlike a fully random UUID — a theoretical, low-severity note, not something fixed here, since guessing a valid ID still doesn't bypass the entitlement check behind it (see below); flagging only for completeness. |
| Prevent access after refunds | **Gap — built.** No refund mechanism existed at all before this pass. See below. |

### Signed, short-lived download URLs — design

Went with a mint-and-redirect pattern rather than rewriting every place a download URL is referenced (`Product.trainingContent` bakes media URLs into a stored JSON blob at upload time — rewriting those in place would mean walking arbitrary nested JSON on every read):

- The existing stable URLs (`/api/library/resource/:resourceId`, `/api/library/media/:productId/:fileName`) are unchanged in shape — nothing else in the codebase needed to change — but now do the ownership check and then `302` redirect to a freshly minted, HMAC-signed token URL (`server/src/lib/signedDownload.js`) instead of serving bytes directly.
- The token is self-contained (type, resource id, user id, expiry) and signed with the same server-only secret used for CSRF tokens — no database row, nothing to clean up.
- TTL: 5 minutes for one-off resource downloads, 15 minutes for media (a `<video>` element can re-request the same `src` while a viewer seeks, so it gets a longer window).
- **Re-verified, not just signature-checked:** the actual byte-serving endpoint (`/api/library/download/{resource,media}/:token`) re-runs the *same* live ownership check again, plus confirms the token's embedded `userId` matches the current session's user — not just that the signature is valid. This is what makes refund revocation actually work mid-flight (below), not just at future mint time.

**Live-tested, all of it, with a real purchased product and a real customer/stranger pair:**
- Full flow end-to-end: mint → redirect → signed serve → byte-for-byte identical file delivered, for both a PDF resource (`Content-Disposition: attachment` with the correct title) and an image (exercise media).
- A stranger is blocked at the *first* gate — never even gets a token minted.
- A stranger who somehow obtains the owner's valid, unexpired signed URL is still blocked (`403`) — the embedded `userId` doesn't match their session.
- A tampered payload (single byte flipped) and a forged token (correct shape, guessed signature) both correctly rejected.
- A genuinely expired-but-correctly-signed token rejected with `410` — and deliberately given the *same* error message as a tampered/forged token, so a failed forgery attempt can't be distinguished from "just expired," consistent with this audit's established practice of not leaking *why* a check failed.

### Access revocation after refunds

Nothing like this existed before this pass — `Order.status` had `"refunded"` as a documented possible value in the schema comment, but no code path ever set it.

- **Admin action:** `POST /api/admin/orders/:id/refund` sets `status: "refunded"`, idempotent (refunding an already-refunded order just returns it rather than erroring). Wired into the admin dashboard's order detail view — there was already a disabled "Refund (coming soon)" button placeholder, now live, behind the same `confirmDialog` pattern used for other destructive admin actions.
- **Automatic, via Stripe:** a new `charge.refunded` webhook handler looks up the order by the charge's `payment_intent` (= `Order.providerRef`) and flips it to `refunded` automatically — no admin action needed when a refund is issued directly from the Stripe dashboard. Benefits from the same event-id dedup and signature-timestamp protections documented above, since it's the same webhook endpoint.
- **Why this alone is sufficient to cut off access, everywhere:** `hasEntitlement()` (`server/src/lib/entitlements.js`) has always strictly checked `status: "paid"` — never anything else. There was no separate "access" flag to keep in sync; flipping `status` away from `"paid"` was always going to work, it just had no way to actually get flipped before now.
- **PayPal refunds are not automated.** PayPal webhook infrastructure (signature verification, subscription) doesn't exist anywhere in this codebase and would be a meaningfully larger, separately-scoped addition. The manual admin action covers PayPal orders today — flagging this gap explicitly rather than leaving it implicit.

**Live-tested, the scenario that actually matters:** minted a valid, unexpired signed download token for the owner *before* refunding their order, then issued the refund, then tried to use that still-cryptographically-valid, still-unexpired token — rejected (`403`), because the byte-serving endpoint re-checks ownership live rather than trusting the token's validity alone. Also confirmed via the Stripe webhook path (signed `charge.refunded` test event → order flipped automatically, verified in the database) and via the real admin UI (not just the API) with a headless-browser click-through: search → view → Mark Refunded → confirm → order status updated.

---

## "Preview as Customer" Feature

**Architecture correction first:** this isn't a separate-session or impersonation feature — there's no session-switching, no "become this customer," no distinct preview token or cookie of any kind. The entire feature is: an admin's own, ordinary, already-authenticated session is allowed to bypass the entitlement check on `GET /api/library/program/:productId` (and the media/resource routes it links to) whenever `req.user.role === "admin"`, re-evaluated fresh on every single request from current session state — nothing is cached, minted, or granted ahead of time. The "Preview" links in the admin product wizard and product table are plain `<a href="/program.html?product=X" target="_blank">` tags; opening one just loads the ordinary customer-facing page in a new browser tab, and the existing admin session cookie rides along automatically because it's the same browser on the same origin. Several of the literal requirements below don't apply to this design for that reason — explained rather than force-fit.

| Requirement | Result |
|---|---|
| Preview sessions cannot escape into production sessions | **N/A by construction** — there is no separate preview session to escape from. Preview mode is a per-request, stateless re-evaluation of `role === "admin"` against the current, ordinary session; there's nothing else it could "become." |
| Preview cookies are isolated | **N/A, and verified live** — inspected the full cookie jar after extensive preview usage (viewing a draft program, downloading its bonus resource): exactly `profit_session` and `profit_csrf`, the same two cookies used everywhere else in the app. No preview-specific cookie exists. |
| Preview mode cannot be exploited by normal users | **Confirmed, live, the important one.** Created a real non-admin customer session and a real draft (unpublished, never-purchasable) product with a bonus resource attached. The customer got `403` on the program view, `403` on the resource download — never `preview: true`, never any bypass — while the admin session correctly got both. `isAdmin` is derived server-side from `req.user.role`, sourced from the session lookup, never from anything client-supplied — there's no parameter or header that could flip it. |
| Preview sessions expire automatically | **N/A, and verified live** — since preview isn't a separate session, there's nothing extra to expire. It inherits whatever lifecycle the admin's real session already has. Live-tested: revoked the admin's session token directly, then attempted preview access with it — `401`, immediately, no grace window. |
| All preview actions are logged | **Gap found and fixed** — previously, zero preview activity was logged anywhere. Now logs (`SystemLog`, category `admin`) both opening a program in preview mode and downloading a bonus resource while previewing, each with the actor, product/resource id, and (for the program view) the draft/archived status being previewed. Live-verified both fire correctly, **and** that genuine entitled access — an admin viewing something they actually purchased — does *not* generate a preview log entry, matching this audit's established practice of logging the meaningful signal, not every routine request. Deliberately **not** logged per-item: individual exercise media (GIF/video/image) fetched while a program is open in preview — that's incidental to having opened the program (which *is* logged), not a distinct action; logging every image load would be noise, the same reasoning already applied to not logging every anonymous 401 in Phase 8. |

**Bug found and fixed along the way:** `GET /api/library/resource/:resourceId` had no admin bypass at all, despite its own code comment claiming it was "gated the same way as the program view itself." In practice this meant preview mode was silently broken for bonus-resource downloads — an admin could see a resource listed while previewing a draft, but downloading it 403'd. Fixed to match the media route's existing pattern; live-verified an admin can now download a draft product's bonus PDF while previewing, byte-for-byte correct.

---

## Content Security Policy

**Stack correction, again:** the requested allowlist (Stripe / Resend / Supabase / Cloudflare / self) doesn't match what this app actually loads in a browser. Supabase isn't part of this stack at all (established at the start of this engagement — this is Express/Prisma/Postgres). Resend is a server-to-server email API (`server/src/lib/email.js`) the browser never talks to directly — CSP only governs what the *browser* fetches, so it needs no entry regardless of stack. Cloudflare isn't used anywhere in this codebase today (confirmed by search) — no CDN, no Turnstile, nothing; if that changes, whatever specific Cloudflare product gets added (e.g. Turnstile would need `challenges.cloudflare.com`) gets its own specific entry then, not a speculative one now. Meanwhile, the app has real, load-bearing browser-side dependencies on **PayPal** (a full second payment provider, not in the original list) and, on two secondary pages, **Google Maps** and **YouTube** — all confirmed with you directly before proceeding rather than either silently breaking them or silently going outside your list.

### What "avoid unsafe-inline / unsafe-eval" actually required

The previous CSP (from Phase 1 of this audit) still had `'unsafe-inline'` in `style-src` — a real gap relative to this request. Closing it meant eliminating **every** inline `style=""` attribute and inline `<style>`/`<script>` block across the entire site first, not just editing the policy string:

- **74 inline `style=""` attributes** across 9 HTML files (`admin/manage.html` alone had 38) — moved to a small set of shared utility classes (`assets/css/style.css`'s "CSP hardening" section: `.u-hidden`, `.u-text-body`, `.u-flex-gap-10`, etc.) plus a couple of page-specific ones. Verified safe *before* starting: this codebase's show/hide JS universally uses `element.style.display = "x"` (the CSSOM property setter) or jQuery's `.show()`/`.hide()` (which does the same internally) — neither is affected by `style-src` at all, only the HTML `style=""` attribute and `setAttribute('style', ...)` are. That's what made a mechanical class-swap safe without touching any JS logic.
- **3 inline `<style>` blocks** (`checkout.html`, `program.html`, `shop-single.html`) — moved to new external stylesheets (`assets/css/program.css`, `assets/css/shop-single.css`) or folded into `style.css` for the one trivial one-liner.
- **2 inline `<script>` blocks** remaining from before this pass (`login.html`, `register.html`) — externalized to `assets/js/login.js` and `assets/js/register-redirect.js`, same pattern as Phase 1's `checkout.html`/`admin/login.html` fixes.
- **One server-side-injected inline style**, found only by live-testing, not by grepping HTML files: `server/src/index.js` was string-replacing `<header class="site-header">` → `<header class="site-header" style="display:none;">` for `checkout.html` specifically (hiding the header on that one page). Fixed to inject a class instead.
- **`'unsafe-eval'`**: never present in either the old or new policy — no library in use (jQuery, Bootstrap, Swiper, Chart.js, Stripe.js, PayPal SDK) requires it, confirmed by it simply never coming up across the entire live-testing pass below.

### Eliminating two CDN dependencies, not just allowlisting them

Two existing dependencies — Google Fonts and jsDelivr (for Chart.js) — weren't in your allowed list either. Rather than adding two more undocumented exceptions, both were **self-hosted**, which is strictly better than an exception: one less third-party origin in scope, one less thing that can go down and take styling/charts with it, and it fully complies with "only required domains" instead of asking for a pass on it.
- **Inter webfont**: vendored via `@fontsource/inter` (latin subset only, the exact weights the site uses — 400/500/600/700/800 + 400 italic) into `assets/fonts/inter/`, referenced by local `@font-face` rules. `fonts.googleapis.com`/`fonts.gstatic.com` no longer appear anywhere.
- **Chart.js**: the official v4.4.4 UMD build copied into `assets/js/vendor/chart.umd.js`, loaded from `/assets/js/vendor/chart.umd.js` instead of `cdn.jsdelivr.net`.

### Final policy — every directive, every domain justified

```
default-src 'self'
script-src 'self' https://js.stripe.com https://www.paypal.com
style-src 'self'
style-src-attr 'self'   (+ 'unsafe-inline', /admin/* requests only — see below)
img-src 'self' data: https://www.paypalobjects.com
font-src 'self' data:
connect-src 'self' https://api.stripe.com https://www.paypal.com
frame-src https://js.stripe.com https://hooks.stripe.com https://www.paypal.com https://www.google.com https://www.youtube.com
object-src 'none'
base-uri 'self'
frame-ancestors 'self'
form-action 'self'
upgrade-insecure-requests   (production only)
```

| Domain | Directive(s) | Why |
|---|---|---|
| `js.stripe.com` | script-src, frame-src | Stripe Elements (card entry UI, fraud detection) and its 3D Secure iframe. |
| `api.stripe.com` | connect-src | Stripe Elements' own tokenization/Radar XHR calls. |
| `hooks.stripe.com` | frame-src | Bank-redirect/3D-Secure authentication flows Stripe opens. |
| `www.paypal.com` | script-src, connect-src, frame-src | The PayPal Buttons SDK (loaded dynamically at checkout — `checkout-payments.js`), its own XHR calls, and its checkout/login iframes and popups. Not in the original named list; confirmed with you before adding, since excluding it would have broken PayPal checkout entirely. |
| `www.paypalobjects.com` | img-src | Card-brand/PayPal logo icons the PayPal SDK itself renders. |
| `www.google.com` | frame-src | The Google Maps embed on `contact.html` (a real, footer-linked, reachable page — confirmed with you before keeping it). |
| `www.youtube.com` | frame-src | The video lightbox on `about.html`/`blog.html` (`.video-popup` → magnific-popup iframe embed — also confirmed with you). |
| `data:` | font-src | `swiper-bundle.min.css`'s own bundled icon font (base64-embedded) — unrelated to the Inter webfont, which is `'self'`-only now. |
| `data:` | img-src | Small inline images/placeholders already in use sitewide (unchanged from the pre-existing policy). |

**Resend, Supabase, Cloudflare: intentionally absent**, per the explanation above — not omissions.

### The one narrow, documented exception: `style-src-attr` on `/admin/*` only

Chart.js (used only on the admin Dashboard/Analytics panels) sets canvas backing-store sizing via `style.setProperty(..., "important")` for crisp high-DPI rendering — confirmed empirically to be unavoidable (neither `responsive: false` nor `devicePixelRatio: 1` avoids it; it's inherent to how canvas elements achieve sharp rendering on retina displays, not a resize-specific code path, and it's a widely-documented upstream Chart.js/CSP friction point with no clean workaround). Rather than either giving up on a strict policy entirely or silently shipping a broken admin dashboard, the CSP is **conditional per-request** (`helmet`'s directive-value-as-function support): `style-src-attr` — a narrower CSP3 directive that governs *only* the `style=""` HTML attribute, not `<style>` blocks or stylesheets, which stay `'self'`-only everywhere including `/admin/*` — gets `'unsafe-inline'` **only** when `req.path` starts with `/admin`. The customer-facing storefront and checkout — where the stakes of any relaxation are highest — get the fully strict policy with zero exceptions of any kind. Verified with the actual response header on both a storefront and an admin request: `style-src-attr 'self'` vs. `style-src-attr 'self' 'unsafe-inline'`, respectively.

### Live-tested, not just written

Every page on the site (storefront, shop, product detail, cart, checkout, my-library, program, login, register, about, blog, contact, error, and every admin page including the SPA shell and both chart-bearing panels) swept with a headless browser listening for `securitypolicyviolation` events and console errors — all clean except the one pre-existing, unrelated `program.html` bug already flagged earlier in this document. Beyond the page-load sweep:
- **Real checkout, not just an empty-cart redirect**: seeded a real cart item, loaded checkout.html, filled the email field to trigger Stripe Elements — confirmed a real Stripe card-entry iframe mounted with zero CSP violations. The PayPal SDK script and its network calls also went through cleanly (confirmed by them reaching PayPal's real servers and getting a real `400` back for this dev environment's placeholder sandbox credentials — a pre-existing, unrelated test-environment limitation, not a CSP block).
- **The YouTube video popup**: actually clicked the trigger on `about.html` and confirmed the iframe mounted with the correct `youtube.com/embed/...` URL.
- **Chart.js actually rendering**, not just loading without error: read back real non-transparent pixel data from the canvas after the fix (37,953 non-blank pixels) — confirms the chart genuinely drew, not just that no exception was thrown.
- **No regressions in prior phases' work**: CSRF protection (missing token → `403`, valid token → `200`), session auth, and admin CRUD all re-confirmed working after this pass.

---

## Explicit confirmations you asked for

**1. IDOR testing performed on orders, user profiles, and admin endpoints — results:**
Created two real customer accounts and one real purchase (Phase 2), then tested cross-account access with live sessions (not just code review):
- Customer B could not view Customer A's purchased program (`403`), while Customer A could (`200`).
- Customer B's own `/api/library` and `/api/library/orders` correctly showed only their own (empty) data, never A's.
- Unauthenticated requests to `/api/library` correctly returned `401`.
- Customer B was correctly blocked (`403`) from every tested admin endpoint (customer list, product creation) despite having a valid, logged-in session.
- Non-admin sessions hitting the admin dashboard's page routes were correctly redirected to `/admin/403.html` rather than served the admin UI.
All customer-facing data queries were also confirmed to filter by `req.user.id` at the database-query level (not just at the response-shaping level), which is what makes the above hold rather than being coincidental.

**2. File upload bypass techniques tested and blocked:**
Live-tested spoofed-`Content-Type` uploads (HTML content declared as `image/png`, a binary payload declared as `application/pdf`) against all three real upload endpoints (admin logo, product cover image, bonus resource) — all three rejected the payload based on actual file-content inspection and deleted the rejected file rather than leaving it on disk. Filenames are UUID-only server-side; the original client filename is never trusted or persisted, closing off double-extension and path-traversal-via-filename tricks structurally rather than via a blocklist.

**3. No secrets exist client-side:**
Confirmed via repo-wide grep for Stripe secret key patterns, `RESEND_API_KEY`, `DATABASE_URL`, and any `process.env.*SECRET*` reference reaching a frontend file — none found. Only `STRIPE_PUBLISHABLE_KEY` (by design, meant to be public) reaches the client. `.env` is gitignored and confirmed never committed in this repo's history. The admin settings API has a hard-coded field allowlist that structurally prevents any secret from ever becoming editable/exposable through the dashboard, even accidentally.

---

## Needs your decision (not built — genuine tradeoffs, not oversights)

1. **MFA for admin accounts** — none exists today (magic-link or password, nothing else). This is a scoped feature build, not a quick hardening fix; flagging for your prioritization rather than building it unprompted. If you want it, the natural fit given the existing magic-link infrastructure is a TOTP second factor gating the admin role specifically.
2. **Real-time alerting** (failed-login spikes, 403 spikes, upload abuse, cost spikes) — needs you to pick a channel (email/Slack/PagerDuty/etc.) and requires a job scheduler this app doesn't currently have. The underlying data (`SystemLog`) is already there and queryable today; wiring automated alerting is a scoped follow-up once you pick a tool.
3. **Malware/AV scanning on uploads** — the brief's "if feasible" item. Given no shell-based file processing exists anywhere (ruling out the classic exploit chain) and content-type verification now blocks the obvious executable/script-smuggling vectors, I'd treat this as a nice-to-have rather than urgent, but it's your call given this handles real customer uploads at scale.
4. **Production database least-privilege and backup policy** — cannot be verified or fixed from this codebase; depends entirely on your hosting provider's configuration. No migration in this repo requires superuser/extension privileges, so a restricted DB role is achievable — worth confirming with whoever provisioned the production database.
5. **Dependency major-version upgrades** — `npm audit` shows 0 known vulnerabilities, but several packages (Express 4→5, Stripe 17→22, Prisma 6→7) are behind their latest major. I did not upgrade these since major versions carry real breaking-change risk with no security justification right now — routine maintenance item for your own timeline.

---

## Files changed

New: `server/src/middleware/rateLimit.js`, `server/src/middleware/csrf.js`, `server/src/lib/csrf.js`, `server/src/lib/loginAttempts.js`, `server/src/lib/uploadVerify.js`, `server/src/lib/devMode.js`, `server/src/lib/signedDownload.js`, `assets/js/admin/login.js`, `assets/js/checkout-floating-labels.js`, `assets/js/login.js`, `assets/js/register-redirect.js`, `assets/css/program.css`, `assets/css/shop-single.css`, `assets/fonts/inter/*.woff2` (6 files), `assets/js/vendor/chart.umd.js`, `INCIDENT_RESPONSE.md`, this file.

Modified: `server/src/index.js`, `server/src/routes/auth.js`, `server/src/routes/config.js`, `server/src/routes/checkout.js`, `server/src/routes/webhooksStripe.js`, `server/src/routes/library.js`, `server/src/routes/products.js`, `server/src/routes/admin/orders.js`, `server/src/middleware/auth.js`, `server/src/lib/session.js`, `server/src/lib/checkoutItems.js`, `server/src/lib/fulfillOrder.js`, `server/prisma/schema.prisma`, `server/src/routes/admin/index.js`, `server/src/routes/admin/products.js`, `server/src/routes/admin/settings.js`, `server/.env.example`, `assets/css/style.css`, `assets/css/admin.css`, `assets/js/script.js`, `assets/js/nav-featured.js`, `assets/js/program.js`, `assets/js/admin/ui.js`, `assets/js/admin/products.js`, `assets/js/admin/orders.js`, `assets/js/admin/router.js`, `assets/js/api.js`, `assets/js/admin/api.js`, `assets/js/my-library.js`, `assets/js/checkout-payments.js`, `my-library.html`, `admin/login.html`, `checkout.html`, `program.html`, `shop-single.html`, `login.html`, `register.html`, `cart.html`, `partials/header.html` (indirectly, via `index.js`'s injection logic), `server/package.json` / `package-lock.json` (added `express-rate-limit`, `helmet`, `file-type`).

**Local-dev-only note:** `server/.env` was updated to add `ENABLE_DEV_ROUTES="true"` (dev tooling) and `CSRF_SECRET` (a freshly generated random value — do not reuse this, generate a fresh production value with `openssl rand -hex 32`). Confirm `ENABLE_DEV_ROUTES` is **never** set in any deployed environment; `CSRF_SECRET` **must** be set (and set to a unique, unpublished value) in production — the server refuses to start without it.
