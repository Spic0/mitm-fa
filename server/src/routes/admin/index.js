const express = require("express");
const { requireAuth, requireAdmin } = require("../../middleware/auth");
const { apiLimiter } = require("../../middleware/rateLimit");

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

const router = express.Router();

// Every /api/admin/* route requires a logged-in user, at minimum. The
// admin-only gate (requireAdmin) used to be blanket-applied here too, but
// Promotions now has a real "manager" tier (view/pause/resume only) — so
// requireAdmin is applied per-section below instead, and promotions.js/
// influencers.js/promotionNotifications.js do their own finer-grained
// requirePromotionView/requirePromotionManage gating per route. Every other
// section's access is unchanged: still admin-only.
router.use(requireAuth, apiLimiter);

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
router.use("/promotions", promotionsRoutes);
router.use("/influencers", influencersRoutes);
router.use("/promotion-notifications", promotionNotificationsRoutes);

module.exports = router;
