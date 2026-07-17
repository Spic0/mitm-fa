const { prisma } = require("../db");

// The only settings ever writable — or readable — through the admin API. This
// is a store-admin surface, not a developer/ops one: real secrets (Stripe/
// PayPal/Resend keys, DB/storage/cloud credentials, anything env-var-shaped)
// must never appear here in any form, not even masked/read-only. Those stay
// exclusively in the server's environment configuration.
const DEFAULTS = {
  storeName: "ProFit",
  currency: "USD",
  taxRate: "0",
  emailFromName: "ProFit",
  logoUrl: "",
};

async function getSettings() {
  const rows = await prisma.setting.findMany();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored };
}

async function getStoreName() {
  const settings = await getSettings();
  return settings.storeName;
}

module.exports = { DEFAULTS, getSettings, getStoreName };
