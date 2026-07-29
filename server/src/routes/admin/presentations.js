// Admin CRUD + analytics for private presentations.
//
// Mounted admin-only in routes/admin/index.js. The public, unauthenticated
// half of this feature (the deck itself, its unlock/track/contact endpoints)
// lives in routes/presentation.js — the two files share only lib/presentations.js.
const express = require("express");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");
const { generateSlug, hashPassword, normalizeContent } = require("../../lib/presentations");

const router = express.Router();

const STATUSES = new Set(["enabled", "disabled"]);
const SORTABLE_FIELDS = new Set(["createdAt", "title", "updatedAt"]);

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Never leak the bcrypt hash to the client. The admin UI only needs to know
// THAT a password is set (to show the badge and offer "remove"), never what
// it hashes to.
function toClient(row, extra) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    recipient: row.recipient,
    status: row.status,
    expiresAt: row.expiresAt,
    hasPassword: !!row.passwordHash,
    content: normalizeContent(row.content),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy ? row.createdBy.email : null,
    ...(extra || {}),
  };
}

// A deck can be "enabled" and still be dead because its date passed. The list
// needs that as one field, since "enabled" alone would be misleading in a
// table an admin scans quickly.
function effectiveState(row) {
  if (row.status !== "enabled") return "disabled";
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return "expired";
  return "live";
}

// Shared validation for create + update. Throws a plain Error with a
// user-facing message on the first problem, matching admin/promotions.js.
function validatePayload(body, { partial } = { partial: false }) {
  const data = {};

  if (!partial || body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (!title) throw new Error("Title is required");
    data.title = title.slice(0, 200);
  }

  if (body.recipient !== undefined) {
    const recipient = String(body.recipient || "").trim();
    data.recipient = recipient ? recipient.slice(0, 160) : null;
  }

  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) throw new Error("Invalid status");
    data.status = body.status;
  }

  if (body.expiresAt !== undefined) {
    if (!body.expiresAt) {
      data.expiresAt = null;
    } else {
      const expires = parseDate(body.expiresAt);
      if (!expires) throw new Error("Invalid expiry date");
      data.expiresAt = expires;
    }
  }

  if (body.content !== undefined) {
    const content = normalizeContent(body.content);
    // Section toggles are stored only where they differ from the default
    // (everything on) — but normalizeContent already resolved them to a full
    // boolean map, so this just persists that map as-is. Storing the resolved
    // shape means a later change to SECTION_KEYS can't silently re-enable a
    // section an admin had switched off.
    data.content = content;
  }

  return data;
}

// ---------------------------------------------------------------------
// Analytics
//
// Computed on read rather than maintained as counters. These are small
// tables scoped to one presentation, the numbers are only ever looked at
// by an admin opening the panel, and a derived read can never drift out of
// sync with the rows it summarizes the way an incremented counter can.
// ---------------------------------------------------------------------
async function buildAnalytics(presentationId) {
  const [visits, events] = await Promise.all([
    prisma.presentationVisit.findMany({
      where: { presentationId },
      select: {
        visitorKey: true,
        dwellMs: true,
        maxSectionIndex: true,
        wizardCompleted: true,
        startedAt: true,
        referrer: true,
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.presentationEvent.groupBy({
      by: ["type"],
      where: { presentationId },
      _count: { _all: true },
    }),
  ]);

  const counts = {};
  events.forEach((row) => {
    counts[row.type] = row._count._all;
  });

  const uniqueVisitors = new Set(visits.map((v) => v.visitorKey)).size;
  const completed = visits.filter((v) => v.wizardCompleted).length;

  // Median, not mean. One deck left open on a second monitor for two hours
  // drags a mean far past anything that describes a real viewing, and "how
  // long does a typical visitor spend" is the question actually being asked.
  const dwellValues = visits.map((v) => v.dwellMs).filter((ms) => ms > 0).sort((a, b) => a - b);
  let medianDwellMs = 0;
  if (dwellValues.length) {
    const mid = Math.floor(dwellValues.length / 2);
    medianDwellMs =
      dwellValues.length % 2 === 0
        ? Math.round((dwellValues[mid - 1] + dwellValues[mid]) / 2)
        : dwellValues[mid];
  }

  return {
    visits: visits.length,
    uniqueVisitors,
    medianDwellMs,
    totalDwellMs: visits.reduce((sum, v) => sum + v.dwellMs, 0),
    wizardCompleted: completed,
    // Guarded: with no visits this is 0, not NaN.
    wizardCompletionPct: visits.length ? Math.round((completed / visits.length) * 100) : 0,
    ctaClicks: counts.cta_click || 0,
    contactSubmissions: counts.contact_submit || 0,
    failedUnlocks: counts.unlock_failed || 0,
    lastVisitAt: visits.length ? visits[0].startedAt : null,
    recentVisits: visits.slice(0, 12).map((v) => ({
      startedAt: v.startedAt,
      dwellMs: v.dwellMs,
      maxSectionIndex: v.maxSectionIndex,
      wizardCompleted: v.wizardCompleted,
      referrer: v.referrer,
    })),
  };
}

// ---------------------------------------------------------------------
// GET / — list
// ---------------------------------------------------------------------
router.get("/", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "").trim();
  const [sortField, sortDir] = String(req.query.sort || "createdAt-desc").split("-");
  const orderBy = SORTABLE_FIELDS.has(sortField) ? sortField : "createdAt";
  const direction = sortDir === "asc" ? "asc" : "desc";

  const where = {};
  if (STATUSES.has(status)) where.status = status;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { recipient: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.privatePresentation.findMany({
    where,
    orderBy: { [orderBy]: direction },
    include: { createdBy: { select: { email: true } } },
  });

  // Two grouped aggregates for the whole list rather than N queries in a
  // loop — the list view only needs headline counts per row, and this stays
  // flat as the number of decks grows.
  const ids = rows.map((r) => r.id);
  const [visitGroups, eventGroups] = await Promise.all([
    ids.length
      ? prisma.presentationVisit.groupBy({
          by: ["presentationId"],
          where: { presentationId: { in: ids } },
          _count: { _all: true },
        })
      : [],
    ids.length
      ? prisma.presentationEvent.groupBy({
          by: ["presentationId", "type"],
          where: { presentationId: { in: ids }, type: "contact_submit" },
          _count: { _all: true },
        })
      : [],
  ]);

  const visitsById = {};
  visitGroups.forEach((g) => { visitsById[g.presentationId] = g._count._all; });
  const leadsById = {};
  eventGroups.forEach((g) => { leadsById[g.presentationId] = g._count._all; });

  res.json({
    presentations: rows.map((row) =>
      toClient(row, {
        state: effectiveState(row),
        visits: visitsById[row.id] || 0,
        contactSubmissions: leadsById[row.id] || 0,
      })
    ),
  });
});

// ---------------------------------------------------------------------
// GET /:id — one, with full analytics
// ---------------------------------------------------------------------
router.get("/:id", async (req, res) => {
  const row = await prisma.privatePresentation.findUnique({
    where: { id: req.params.id },
    include: { createdBy: { select: { email: true } } },
  });
  if (!row) return res.status(404).json({ error: "Presentation not found" });

  const analytics = await buildAnalytics(row.id);
  res.json({ presentation: toClient(row, { state: effectiveState(row) }), analytics });
});

// ---------------------------------------------------------------------
// POST / — create
// ---------------------------------------------------------------------
router.post("/", async (req, res) => {
  let data;
  try {
    data = validatePayload(req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (req.body && req.body.password) {
    data.passwordHash = await hashPassword(req.body.password);
  }

  const row = await prisma.privatePresentation.create({
    data: {
      ...data,
      slug: generateSlug(),
      status: data.status || "enabled",
      content: data.content || normalizeContent(null),
      createdById: req.user ? req.user.id : null,
    },
    include: { createdBy: { select: { email: true } } },
  });

  await logEvent({
    category: "presentation",
    message: `Private presentation created: "${row.title}"`,
    actorId: req.user ? req.user.id : null,
    ip: req.ip,
  });

  res.status(201).json({ presentation: toClient(row, { state: effectiveState(row) }) });
});

// ---------------------------------------------------------------------
// PATCH /:id — update
// ---------------------------------------------------------------------
router.patch("/:id", async (req, res) => {
  const existing = await prisma.privatePresentation.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Presentation not found" });

  let data;
  try {
    data = validatePayload(req.body || {}, { partial: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Three distinct intents, and they have to stay distinct: a password field
  // the admin left untouched (undefined -> keep), one they cleared
  // (removePassword -> null), and one they typed into (-> rehash). Collapsing
  // "" into "remove" would silently drop protection every time the drawer was
  // saved without re-entering the password.
  const body = req.body || {};
  if (body.removePassword === true) {
    data.passwordHash = null;
  } else if (body.password) {
    data.passwordHash = await hashPassword(body.password);
  }

  const row = await prisma.privatePresentation.update({
    where: { id: existing.id },
    data,
    include: { createdBy: { select: { email: true } } },
  });

  await logEvent({
    category: "presentation",
    message: `Private presentation updated: "${row.title}"`,
    actorId: req.user ? req.user.id : null,
    ip: req.ip,
  });

  res.json({ presentation: toClient(row, { state: effectiveState(row) }) });
});

// ---------------------------------------------------------------------
// POST /:id/duplicate
// ---------------------------------------------------------------------
router.post("/:id/duplicate", async (req, res) => {
  const source = await prisma.privatePresentation.findUnique({ where: { id: req.params.id } });
  if (!source) return res.status(404).json({ error: "Presentation not found" });

  const row = await prisma.privatePresentation.create({
    data: {
      // A fresh slug, always: a duplicate that shared the original's URL
      // would be a second deck at an address someone has already been given.
      slug: generateSlug(),
      title: `${source.title} (copy)`,
      recipient: source.recipient,
      content: source.content === null ? undefined : source.content,
      expiresAt: source.expiresAt,
      // Copy is created switched off. The whole point of duplicating is to
      // edit it for a different audience first, and a copy that went live at
      // the moment of the click could be handed out mid-edit.
      status: "disabled",
      // Password is deliberately NOT copied. The hash is not recoverable, so
      // carrying it over would leave the admin with a protected deck whose
      // password they cannot tell anyone.
      createdById: req.user ? req.user.id : null,
    },
    include: { createdBy: { select: { email: true } } },
  });

  await logEvent({
    category: "presentation",
    message: `Private presentation duplicated from "${source.title}"`,
    actorId: req.user ? req.user.id : null,
    ip: req.ip,
  });

  res.status(201).json({ presentation: toClient(row, { state: effectiveState(row) }) });
});

// ---------------------------------------------------------------------
// POST /:id/regenerate-link
// ---------------------------------------------------------------------
router.post("/:id/regenerate-link", async (req, res) => {
  const existing = await prisma.privatePresentation.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Presentation not found" });

  const row = await prisma.privatePresentation.update({
    where: { id: existing.id },
    data: { slug: generateSlug() },
    include: { createdBy: { select: { email: true } } },
  });

  // Worth an explicit log line of its own: this is the action that silently
  // breaks every link already sent out, and someone will need to know when
  // it happened.
  await logEvent({
    category: "presentation",
    message: `Private presentation link regenerated for "${row.title}" — all previously shared URLs are now dead`,
    actorId: req.user ? req.user.id : null,
    ip: req.ip,
  });

  res.json({ presentation: toClient(row, { state: effectiveState(row) }) });
});

// ---------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------
router.delete("/:id", async (req, res) => {
  const existing = await prisma.privatePresentation.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Presentation not found" });

  // Visits and events go with it via onDelete: Cascade in the schema.
  await prisma.privatePresentation.delete({ where: { id: existing.id } });

  await logEvent({
    category: "presentation",
    message: `Private presentation deleted: "${existing.title}"`,
    actorId: req.user ? req.user.id : null,
    ip: req.ip,
  });

  res.json({ ok: true });
});

module.exports = router;
