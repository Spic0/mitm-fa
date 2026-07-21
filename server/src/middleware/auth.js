const { SESSION_COOKIE, getUserBySessionToken, ensureCsrfCookie } = require("../lib/session");
const { logEvent } = require("../lib/adminLog");

// Attaches req.user when a valid session cookie is present; never blocks the request.
async function attachUser(req, res, next) {
  const token = req.cookies ? req.cookies[SESSION_COOKIE] : null;
  req.user = await getUserBySessionToken(token);
  if (req.user) ensureCsrfCookie(req, res, token);
  next();
}

// Use after attachUser on routes that require a logged-in user.
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}

// Use after attachUser on API routes that require an admin. Returns JSON, since
// these are fetch() calls, not page navigations.
//
// Only the authenticated-but-forbidden case is logged here, not plain
// unauthenticated 401s — a logged-out visitor hitting a gated endpoint is
// routine background traffic (e.g. every page's own auth check) and would
// drown out the actually meaningful signal: a real account attempting
// something its role doesn't permit, which is what privilege-escalation
// probing looks like.
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "admin") {
    logEvent({
      category: "auth",
      message: `Access denied (non-admin): ${req.user.email} attempted ${req.method} ${req.originalUrl}`,
      actorId: req.user.id,
    });
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Gates the admin static page bundle itself (mounted in front of express.static
// for /admin), so the dashboard's HTML/JS/CSS is never served to non-admins.
// Redirects rather than returning JSON, since this guards page navigations.
// The login and 403 pages themselves must stay reachable for everyone.
//
// Admits "manager" as well as "admin" — managers only have real access to
// the Promotions section (enforced per-route below and hidden client-side
// in assets/js/admin/layout.js), but they still need the SPA shell itself
// to load. Every *other* admin route still gates on requireAdmin alone, so
// a manager hitting e.g. /api/admin/orders still gets a 403 — this only
// widens who can load manage.html, not what any API route accepts.
function requireAdminPage(req, res, next) {
  if (req.path === "/login.html" || req.path === "/403.html") return next();
  if (!req.user) return res.redirect("/admin/login.html");
  if (req.user.role !== "admin" && req.user.role !== "manager") {
    logEvent({
      category: "auth",
      message: `Access denied (non-admin): ${req.user.email} attempted to open ${req.originalUrl}`,
      actorId: req.user.id,
    });
    return res.redirect("/admin/403.html");
  }
  next();
}

// Promotions-specific RBAC (the brief's only role split): admins can
// create/update/delete/expire/clone; managers may only view/pause/resume.
// Both middlewares still require requireAdmin's own 401 semantics for a
// logged-out caller — mounted after requireAuth in admin/index.js like
// every other admin route.
function requirePromotionView(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "admin" && req.user.role !== "manager") {
    logEvent({
      category: "auth",
      message: `Access denied (non-admin/manager): ${req.user.email} attempted ${req.method} ${req.originalUrl}`,
      actorId: req.user.id,
    });
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

function requirePromotionManage(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "admin") {
    logEvent({
      category: "auth",
      message: `Access denied (manager attempted admin-only promotion action): ${req.user.email} attempted ${req.method} ${req.originalUrl}`,
      actorId: req.user.id,
    });
    return res.status(403).json({ error: "Forbidden — this action requires an admin account" });
  }
  next();
}

module.exports = {
  attachUser,
  requireAuth,
  requireAdmin,
  requireAdminPage,
  requirePromotionView,
  requirePromotionManage,
};
