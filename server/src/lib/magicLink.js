const crypto = require("crypto");
const { prisma } = require("../db");

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

async function createMagicLinkToken(userId) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  await prisma.magicLinkToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return rawToken;
}

function buildMagicLinkUrl(rawToken) {
  const base = process.env.APP_URL || "http://localhost:3000";
  return `${base}/api/auth/verify?token=${rawToken}`;
}

// Validates and consumes a magic-link token in one step; returns the user or null.
async function consumeMagicLinkToken(rawToken) {
  const record = await prisma.magicLinkToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) return null;

  await prisma.magicLinkToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });
  return record.user;
}

module.exports = { createMagicLinkToken, buildMagicLinkUrl, consumeMagicLinkToken };
