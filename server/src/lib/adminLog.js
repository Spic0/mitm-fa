const { prisma } = require("../db");

// Writes a SystemLog row. Never throws — logging must not break the action it's
// recording, so failures are swallowed after being reported to the console.
async function logEvent({ category, message, metadata, actorId, ip }) {
  try {
    await prisma.systemLog.create({
      data: {
        category,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null,
        actorId: actorId || null,
        ip: ip || null,
      },
    });
  } catch (err) {
    console.error("Failed to write SystemLog:", err);
  }
}

module.exports = { logEvent };
