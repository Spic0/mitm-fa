const express = require("express");
const { getSettings } = require("../lib/settings");
const { isDevRoutesEnabled } = require("../lib/devMode");

const router = express.Router();

// Publishable/client IDs and non-secret branding only — never secrets. Safe
// to expose to the browser.
router.get("/", async (req, res) => {
  const settings = await getSettings();
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    paypalClientId: process.env.PAYPAL_CLIENT_ID || "",
    devMode: isDevRoutesEnabled,
    storeName: settings.storeName,
    logoUrl: settings.logoUrl,
  });
});

module.exports = router;
