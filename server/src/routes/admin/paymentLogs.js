const express = require("express");
const { prisma } = require("../../db");

const router = express.Router();

router.get("/", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
  const search = String(req.query.search || "").trim();
  const provider = req.query.provider;
  const status = req.query.status;

  const where = {
    AND: [
      provider ? { provider } : {},
      status ? { status } : {},
      search
        ? {
            OR: [
              { customerEmail: { contains: search, mode: "insensitive" } },
              { providerRef: { contains: search, mode: "insensitive" } },
              { eventType: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  const [total, events] = await Promise.all([
    prisma.paymentEvent.count({ where }),
    prisma.paymentEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const orderIds = [...new Set(events.map((e) => e.orderId).filter(Boolean))];
  const orders = orderIds.length
    ? await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, totalCents: true } })
    : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));

  res.json({
    total,
    page,
    pageSize,
    events: events.map((e) => ({
      id: e.id,
      provider: e.provider,
      eventType: e.eventType,
      status: e.status,
      providerRef: e.providerRef,
      customerEmail: e.customerEmail,
      orderId: e.orderId,
      orderTotalCents: e.orderId && orderById.has(e.orderId) ? orderById.get(e.orderId).totalCents : null,
      providerResponse: e.providerResponse,
      createdAt: e.createdAt,
    })),
  });
});

module.exports = router;
