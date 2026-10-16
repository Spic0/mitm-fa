const express = require("express");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");
const { requirePromotionView } = require("../../middleware/auth");

const router = express.Router();

function serialize(n) {
  return {
    id: n.id,
    promotionId: n.promotionId,
    promotionName: n.promotion?.name,
    promotionCode: n.promotion?.code,
    type: n.type,
    status: n.status,
    snoozedUntil: n.snoozedUntil,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

// Fetched on topbar bell-dropdown open, not polled — see
// assets/js/admin/notifications.js. Snoozed notifications whose snooze has
// elapsed are treated as open again without a separate sweep job: the query
// itself widens to include them.
router.get("/", requirePromotionView, async (req, res) => {
  const notifications = await prisma.promotionNotification.findMany({
    where: {
      OR: [
        { status: "open" },
        { status: "snoozed", snoozedUntil: { lte: new Date() } },
      ],
    },
    include: { promotion: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ notifications: notifications.map(serialize), count: notifications.length });
});

router.post("/:id/dismiss", requirePromotionView, async (req, res) => {
  const notification = await prisma.promotionNotification.update({
    where: { id: req.params.id },
    data: { status: "dismissed" },
    include: { promotion: true },
  }).catch(() => null);
  if (!notification) return res.status(404).json({ error: "Notification not found" });
  await logEvent({
    category: "promotion",
    message: `Dismissed notification "${notification.type}" for "${notification.promotion.name}"`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { promotionId: notification.promotionId, action: "notification_dismissed" },
  });
  res.json({ notification: serialize(notification) });
});

router.post("/:id/snooze", requirePromotionView, async (req, res) => {
  const hours = Math.max(1, Math.min(24 * 30, parseInt(req.body.hours, 10) || 24));
  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  const notification = await prisma.promotionNotification
    .update({ where: { id: req.params.id }, data: { status: "snoozed", snoozedUntil }, include: { promotion: true } })
    .catch(() => null);
  if (!notification) return res.status(404).json({ error: "Notification not found" });
  await logEvent({
    category: "promotion",
    message: `Snoozed notification "${notification.type}" for "${notification.promotion.name}" until ${snoozedUntil.toISOString()}`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { promotionId: notification.promotionId, action: "notification_snoozed" },
  });
  res.json({ notification: serialize(notification) });
});

router.post("/:id/mark-done", requirePromotionView, async (req, res) => {
  const notification = await prisma.promotionNotification
    .update({ where: { id: req.params.id }, data: { status: "done" }, include: { promotion: true } })
    .catch(() => null);
  if (!notification) return res.status(404).json({ error: "Notification not found" });
  await logEvent({
    category: "promotion",
    message: `Marked notification "${notification.type}" for "${notification.promotion.name}" as done`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { promotionId: notification.promotionId, action: "notification_done" },
  });
  res.json({ notification: serialize(notification) });
});

module.exports = router;
