const express = require("express");
const { prisma } = require("../../db");

const router = express.Router();

router.get("/", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
  const search = String(req.query.search || "").trim();
  const status = req.query.status;

  const where = {
    AND: [
      status ? { status } : {},
      search
        ? {
            OR: [
              { recipient: { contains: search, mode: "insensitive" } },
              { subject: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  const [total, logs] = await Promise.all([
    prisma.emailLog.count({ where }),
    prisma.emailLog.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({
    total,
    page,
    pageSize,
    logs: logs.map((l) => ({
      id: l.id,
      recipient: l.recipient,
      subject: l.subject,
      status: l.status,
      sentAt: l.sentAt,
      openedAt: l.openedAt,
      providerResponse: l.providerResponse,
    })),
  });
});

module.exports = router;
