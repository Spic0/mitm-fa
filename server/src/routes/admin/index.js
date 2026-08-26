const express = require("express");
const { requireAuth, requireAdmin } = require("../../middleware/auth");
const { adminLimiter } = require("../../middleware/rateLimit");
const { invalidateNavigation } = require("../../lib/navigation");

const dashboardRoutes = require("./dashboard");
const ordersRoutes = require("./orders");
const productsRoutes = require("./products");
const customersRoutes = require("./customers");
const analyticsRoutes = require("./analytics");
const emailLogsRoutes = require("./emailLogs");
const paymentLogsRoutes = require("./paymentLogs");
const systemLogsRoutes = require("./systemLogs");
const settingsRoutes = require("./settings");
const taxonomyRoutes = require("./taxonomy");
const promotionsRoutes = require("./promotions");
const influencersRoutes = require("./influencers");
const promotionNotificationsRoutes = require("./promotionNotifications");
const presentationsRoutes = require("./presentations");
const partnersRoutes = require("./partners");
const builderRoutes = require("./builder");

const router = express.Router();

// Every /api/admin/* route requires a logged-in user, at minimum. The
// admin-only gate (requireAdmin) used to be blanket-applied here too, but
// Promotions now has a real "manager" tier (view/pause/resume only) — so
// requireAdmin is applied per-section below instead, and promotions.js/
// influencers.js/promotionNotifications.js do their own finer-grained
// requirePromotionView/requirePromotionManage gating per route. Every other
// section's access is unchanged: still admin-only.
router.use(requireAuth, adminLimiter);

// The header navigation is rendered once and cached (it is byte-identical on
// every page of the site — see lib/navigation.js). Anything an admin WRITES
// can change what it shows: a taxonomy edit obviously, but also a product
// edit, because the menu carries per-category plan counts and one featured
// card, and because publishing/unpublishing a product changes which of them
// count at all.
//
// One hook on every admin mutation rather than a call in each of ~30 route
// handlers: the failure mode of forgetting one is an admin who saves a change
// and does not see it, which reads as a broken CMS, and it is the kind of
// thing that only gets forgotten in the handler someone adds next year. The
// rebuild is a handful of indexed queries on the next page render, so being
// generous here costs nothing.
router.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") invalidateNavigation();
  next();
});

router.use("/dashboard", requireAdmin, dashboardRoutes);
router.use("/orders", requireAdmin, ordersRoutes);
router.use("/products", requireAdmin, productsRoutes);
router.use("/customers", requireAdmin, customersRoutes);
router.use("/analytics", requireAdmin, analyticsRoutes);
router.use("/email-logs", requireAdmin, emailLogsRoutes);
router.use("/payment-logs", requireAdmin, paymentLogsRoutes);
router.use("/system-logs", requireAdmin, systemLogsRoutes);
router.use("/settings", requireAdmin, settingsRoutes);
router.use("/taxonomy", requireAdmin, taxonomyRoutes);
router.use("/presentations", requireAdmin, presentationsRoutes);
// Partner Profiles. Admin-only like every other publishing section — a
// "manager" (the promotions-only tier) has no business creating public pages.
router.use("/partners", requireAdmin, partnersRoutes);
// Product Builder support (template library, media library). Mounted under its
// own prefix rather than folded into /products so the builder's cross-product
// concerns don't have to pretend to belong to one product id.
router.use("/builder", requireAdmin, builderRoutes);
router.use("/promotions", promotionsRoutes);
router.use("/influencers", influencersRoutes);
router.use("/promotion-notifications", promotionNotificationsRoutes);

module.exports = router;
