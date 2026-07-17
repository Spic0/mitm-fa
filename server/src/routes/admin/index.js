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

const router = express.Router();

router.use(requireAuth, requireAdmin, apiLimiter);

router.use("/dashboard", dashboardRoutes);
router.use("/orders", ordersRoutes);
router.use("/products", productsRoutes);
router.use("/customers", customersRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/email-logs", emailLogsRoutes);
router.use("/payment-logs", paymentLogsRoutes);
router.use("/system-logs", systemLogsRoutes);
router.use("/settings", settingsRoutes);
router.use("/taxonomy", taxonomyRoutes);

module.exports = router;
