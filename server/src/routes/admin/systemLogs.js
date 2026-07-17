const express = require("express");
const { prisma } = require("../../db");

const router = express.Router();

router.get("/", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
  const search = String(req.query.search || "").trim();
  const category = req.query.category;

  const where = {
    AND: [
      category ? { category } : {},
      search ? { message: { contains: search, mode: "insensitive" } } : {},
    ],
  };

  const [total, logs, categories] = await Promise.all([
    prisma.systemLog.count({ where }),
    prisma.systemLog.findMany({
      where,
      include: { actor: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.systemLog.findMany({ distinct: ["category"], select: { category: true } }),
  ]);

  res.json({
    total,
    page,
    pageSize,
    categories: categories.map((c) => c.category).sort(),
    logs: logs.map((l) => ({
      id: l.id,
      category: l.category,
      message: l.message,
      metadata: l.metadata,
      actorEmail: l.actor ? l.actor.email : null,
      createdAt: l.createdAt,
    })),
  });
});

module.exports = router;
