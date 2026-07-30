// Public (unlisted) side of private presentations.
//
// Exports two routers:
//   pageRouter — GET /presentation/:slug, the gated deck itself.
//   apiRouter  — /api/presentation/:slug/{unlock,track,contact}.
//
// Everything a visitor can reach is anonymous by design, so all of it sits
// outside CSRF scope (middleware/csrf.js skips requests with no session —
// there is no ambient authority to steal) and leans on the dedicated rate
// limiters in middleware/rateLimit.js instead, exactly like /api/contact.
//
// The deck template lives at private/presentation.html rather than beside
// the other page templates in the site root. That is load-bearing: every
// *.html in the root is also reachable through the express.static mount at
// the bottom of index.js, so a template sitting there could be fetched
// directly and would hand out the entire deck without ever passing the
// access gate below. index.js 404s the whole /private path to close that
// door — see the comment next to the /partials guard there.
const path = require("path");
const fs = require("fs");
const express = require("express");
const { prisma } = require("../db");
const { logEvent } = require("../lib/adminLog");
const {
  presentationUnlockLimiter,
  presentationTrackLimiter,
  apiLimiter,
} = require("../middleware/rateLimit");
const {
  SECTION_KEYS,
  generateVisitorKey,
  verifyPassword,
  issueUnlockCookie,
  resolveAccess,
  normalizeContent,
} = require("../lib/presentations");
const { sendContactNotificationEmail } = require("../lib/email");

const SITE_ROOT = path.join(__dirname, "..", "..", "..");
const TEMPLATE_PATH = path.join(SITE_ROOT, "private", "presentation.html");
const VISITOR_COOKIE = "fa_pres_visitor";
const VISITOR_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const CONTACT_INBOX = process.env.CONTACT_INBOX || "office@fitness.agency";

const pageRouter = express.Router();
const apiRouter = express.Router();

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Only ever emit a URL we're willing to put behind a button. A deck is
// authored by an admin, but "admin-authored" is not the same as "safe to
// interpolate into href" — javascript: and data: URLs would both execute in
// the visitor's browser, so the allowlist is http/https/mailto or nothing.
function safeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(https?:|mailto:)/i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  return "";
}

async function readTemplate() {
  try {
    return await fs.promises.readFile(TEMPLATE_PATH, "utf8");
  } catch {
    return null;
  }
}

function findBySlug(slug) {
  const value = String(slug || "").trim();
  // Bail before touching the database on anything that can't be a slug —
  // /presentation/<4kb of junk> shouldn't cost a query.
  if (!value || value.length > 64 || !/^[a-z0-9-]+$/i.test(value)) return null;
  return prisma.privatePresentation.findUnique({ where: { slug: value } });
}

// Same generic 404 the rest of the site serves. Wrong slug, disabled deck and
// genuinely nonexistent page must be indistinguishable from the outside.
function notFound(req, res) {
  const { render404 } = require("./pages");
  return render404(req, res);
}

function readVisitorKey(req, res) {
  let key = req.cookies ? req.cookies[VISITOR_COOKIE] : null;
  if (typeof key !== "string" || !/^[a-f0-9]{32}$/.test(key)) {
    key = generateVisitorKey();
    res.cookie(VISITOR_COOKIE, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: VISITOR_TTL_MS,
      path: "/",
    });
  }
  return key;
}

// ---------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------

// Sections the admin switched off are removed here, server-side, rather than
// hidden with CSS on the client. For a deck shown to investors that's the
// difference between "not displayed" and "not sent" — a hidden section is
// still sitting in view-source. The paired <!--SECTION:key--> ...
// <!--/SECTION:key--> markers in the template make the cut unambiguous even
// though sections nest other elements.
function stripHiddenSections(html, sections) {
  let out = html;
  SECTION_KEYS.forEach((key) => {
    const open = `<!--SECTION:${key}-->`;
    const close = `<!--/SECTION:${key}-->`;
    if (sections[key]) {
      out = out.split(open).join("").split(close).join("");
      return;
    }
    const start = out.indexOf(open);
    const end = out.indexOf(close);
    if (start !== -1 && end !== -1 && end > start) {
      out = out.slice(0, start) + out.slice(end + close.length);
    }
  });
  return out;
}

// ---------------------------------------------------------------------
// The featured product
//
// The deck's two "View Product" buttons and the showcase's dressing all
// point at one product the admin chose in the builder. It is stored as an
// id and resolved here, on every render, for two reasons: a slug or a URL
// frozen into the presentation record would rot the first time the product
// was renamed, and a draft/archived product must stop being advertised the
// moment it stops being for sale — not whenever someone remembers to edit
// the deck.
//
// A miss is not an error. Returning null simply strips the buttons (see the
// IFPRODUCT markers below), which is the same state as a deck where no
// product was picked at all.
// Product images are stored root-relative but WITHOUT a leading slash
// ("assets/images/product/uploads/x.webp"), which resolves correctly from
// "/" and from "/shop" but not from "/presentation/:slug" — a deck two path
// segments deep would ask for /presentation/assets/... and render a broken
// image in front of an investor. Absolutise before it reaches the template.
function productImageSrc(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith("/") ? raw : `/${raw.replace(/^\.?\//, "")}`;
}

async function loadFeaturedProduct(productId) {
  if (!productId) return null;
  try {
    return await prisma.product.findFirst({
      where: { id: String(productId), status: "published" },
      select: {
        slug: true,
        name: true,
        imageUrl: true,
        thumbnailUrl: true,
        priceCents: true,
        creator: true,
      },
    });
  } catch (err) {
    console.error("Failed to load presentation featured product:", err);
    return null;
  }
}

// Same paired-marker trick as stripHiddenSections, for fragments that only
// make sense in some renders. Two conditions are in play and they are not
// the same one: IFPRODUCT guards the "View Product" buttons (needs only a
// product), IFPRODUCTIMAGE guards the <img> tags in the hero and showcase
// (needs a product that actually has artwork — an <img src=""> re-requests
// the current page, which on this route means a second visit row and a
// second render of the whole deck).
//
// Unlike a section marker, these appear many times in the template, so the
// removal loops rather than cutting once. They must NOT nest — the loop
// pairs each open with the next close, so an inner pair would be matched
// against the outer open and leave a stray marker in the output.
function stripConditionalBlocks(html, name, keep) {
  const open = `<!--${name}-->`;
  const close = `<!--/${name}-->`;
  if (keep) return html.split(open).join("").split(close).join("");
  let out = html;
  for (;;) {
    const start = out.indexOf(open);
    const end = out.indexOf(close, start);
    if (start === -1 || end === -1) break;
    out = out.slice(0, start) + out.slice(end + close.length);
  }
  return out;
}

function renderDeck(html, { presentation, content, visitId, product }) {
  const recipient = presentation.recipient ? presentation.recipient.trim() : "";
  const boot =
    `<div id="presBoot" class="u-hidden"` +
    ` data-slug="${escapeHtml(presentation.slug)}"` +
    ` data-visit-id="${escapeHtml(visitId || "")}"></div>`;

  // The product's own image is the only photographic content in the deck, and
  // it sits above the fold in the hero slideshow. When there is no product,
  // every slot below resolves to neutral copy and the slideshow's own drawn
  // panels carry the section on their own.
  const productUrl = product ? `/program/${encodeURIComponent(product.slug)}` : "";
  const productImage = product ? productImageSrc(product.imageUrl || product.thumbnailUrl) : "";
  const productMeta = product
    ? [product.creator, `$${(product.priceCents / 100).toFixed(2)}`].filter(Boolean).join(" · ")
    : "";

  let out = stripHiddenSections(html, content.sections);
  out = stripConditionalBlocks(out, "IFPRODUCT", !!product);
  out = stripConditionalBlocks(out, "IFPRODUCTIMAGE", !!productImage);

  return out
    .replace(/<!--PRES_PRODUCT_URL-->/g, escapeHtml(productUrl))
    .replace(/<!--PRES_PRODUCT_NAME-->/g, escapeHtml(product ? product.name : "Your product"))
    .replace(/<!--PRES_PRODUCT_META-->/g, escapeHtml(productMeta))
    .replace(/<!--PRES_PRODUCT_IMAGE-->/g, escapeHtml(safeUrl(productImage)))
    .replace(/<!--PRES_TITLE-->/g, escapeHtml(presentation.title))
    .replace(/<!--PRES_EYEBROW-->/g, escapeHtml(content.heroEyebrow))
    .replace(/<!--PRES_HERO_TITLE-->/g, escapeHtml(content.heroTitle))
    .replace(/<!--PRES_HERO_SUBTITLE-->/g, escapeHtml(content.heroSubtitle))
    .replace(
      /<!--PRES_RECIPIENT-->/g,
      recipient
        ? `<p class="pres-hero__recipient">Prepared for <strong>${escapeHtml(recipient)}</strong></p>`
        : ""
    )
    .replace(
      /<!--PRES_WELCOME-->/g,
      content.welcomeNote
        ? `<p class="pres-hero__note">${escapeHtml(content.welcomeNote)}</p>`
        : ""
    )
    .replace(/<!--PRES_CTA_PARTNERSHIP-->/g, escapeHtml(safeUrl(content.ctaPartnershipUrl)))
    .replace(/<!--PRES_CTA_MEETING-->/g, escapeHtml(safeUrl(content.ctaMeetingUrl)))
    .replace(/<!--PRES_CTA_DEMO-->/g, escapeHtml(safeUrl(content.ctaDemoUrl)))
    .replace(/<!--PRES_BOOT-->/g, boot);
}

// The lock and expiry screens reuse the deck's own stylesheet and type scale
// rather than being bare text — this is the first thing a high-value visitor
// sees, and a browser-default password prompt would undo the whole point.
function renderGateScreen({ title, heading, body, formSlug }) {
  const form = formSlug
    ? `<form class="pres-gate__form" id="presUnlockForm" data-slug="${escapeHtml(formSlug)}">` +
      `<label class="pres-gate__label" for="presPassword">Access password</label>` +
      `<input class="pres-gate__input" type="password" id="presPassword" name="password"` +
      ` autocomplete="current-password" autofocus required>` +
      `<p class="pres-gate__error u-hidden" id="presUnlockError" role="alert"></p>` +
      `<button class="pres-btn pres-btn--primary pres-gate__submit" type="submit">` +
      `<span>View presentation</span></button>` +
      `</form>`
    : "";

  return (
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n` +
    `<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n` +
    `<meta name="robots" content="noindex, nofollow, noarchive">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<link rel="shortcut icon" href="/assets/images/favicon.png">\n` +
    `<link rel="stylesheet" href="/assets/css/presentation.css">\n` +
    `</head>\n<body class="pres-body pres-body--gate">\n` +
    `<main class="pres-gate">\n<div class="pres-gate__card">\n` +
    `<div class="pres-gate__mark" aria-hidden="true"></div>\n` +
    `<h1 class="pres-gate__title">${escapeHtml(heading)}</h1>\n` +
    `<p class="pres-gate__body">${escapeHtml(body)}</p>\n` +
    form +
    `</div>\n</main>\n` +
    `<script src="/assets/js/presentation-gate.js" defer></script>\n` +
    `</body>\n</html>\n`
  );
}

// ---------------------------------------------------------------------
// GET /presentation/:slug
// ---------------------------------------------------------------------
pageRouter.get("/presentation/:slug", async (req, res) => {
  const presentation = await findBySlug(req.params.slug);
  const access = resolveAccess(presentation, req);

  // Belt and braces alongside the robots.txt Disallow and the sitemap
  // exclusion: a header covers the case where the link is pasted somewhere
  // that gets crawled, which a meta tag on a page nobody links to would not.
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  // Never let a shared proxy or CDN hold a copy of a private deck.
  res.setHeader("Cache-Control", "private, no-store");

  if (access.state === "missing") return notFound(req, res);

  if (access.state === "expired") {
    return res
      .status(410)
      .type("html")
      .send(
        renderGateScreen({
          title: "Presentation expired",
          heading: "This link has expired",
          body:
            "The access window for this presentation has closed. Please contact your Fitness Agency representative for an updated link.",
        })
      );
  }

  if (access.state === "locked") {
    return res
      .status(401)
      .type("html")
      .send(
        renderGateScreen({
          title: "Private presentation",
          heading: "Private presentation",
          body: "This presentation is password protected. Enter the password you were given to continue.",
          formSlug: presentation.slug,
        })
      );
  }

  const html = await readTemplate();
  if (html == null) return notFound(req, res);

  const content = normalizeContent(presentation.content);
  const product = await loadFeaturedProduct(content.featuredProductId);

  // One visit row per page load, created before the HTML goes out so its id
  // can ride along in the boot element — the client never has to round-trip
  // to start measuring. A failure here must not cost the visitor the deck,
  // so analytics degrades to "untracked" rather than erroring the page.
  let visitId = "";
  try {
    const visitorKey = readVisitorKey(req, res);
    const visit = await prisma.presentationVisit.create({
      data: {
        presentationId: presentation.id,
        visitorKey,
        ip: req.ip || null,
        userAgent: (req.get("user-agent") || "").slice(0, 400) || null,
        referrer: (req.get("referer") || "").slice(0, 400) || null,
      },
      select: { id: true },
    });
    visitId = visit.id;
  } catch (err) {
    console.error("Failed to record presentation visit:", err);
  }

  res.type("html").send(renderDeck(html, { presentation, content, visitId, product }));
});

// ---------------------------------------------------------------------
// POST /api/presentation/:slug/unlock
// ---------------------------------------------------------------------
apiRouter.post("/:slug/unlock", presentationUnlockLimiter, async (req, res) => {
  const presentation = await findBySlug(req.params.slug);
  const access = resolveAccess(presentation, req);

  // "missing" and "expired" answer the same way a wrong password does, so
  // the endpoint can't be used to probe which slugs are real.
  if (access.state === "missing" || access.state === "expired") {
    return res.status(401).json({ error: "That password is incorrect." });
  }
  if (access.state === "open") return res.json({ ok: true });

  const ok = await verifyPassword(req.body ? req.body.password : "", presentation.passwordHash);
  if (!ok) {
    // Recorded against the presentation (not a visit — there is no visit yet)
    // so an admin can see a link being probed.
    await prisma.presentationEvent
      .create({ data: { presentationId: presentation.id, type: "unlock_failed" } })
      .catch(() => {});
    return res.status(401).json({ error: "That password is incorrect." });
  }

  issueUnlockCookie(res, presentation);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// POST /api/presentation/:slug/track
//
// Engagement heartbeat. Everything it accepts is clamped server-side: the
// caller is an anonymous browser, so treating dwell time or section index as
// trustworthy would let anyone write arbitrary numbers into the analytics an
// admin reads. Monotonic updates only — a visit's furthest section and dwell
// time can go up, never down, so an out-of-order beacon can't undo progress.
// ---------------------------------------------------------------------
const TRACKABLE_EVENTS = new Set(["cta_click", "wizard_complete"]);
// Plausibility ceilings, NOT clamps. An out-of-range value is discarded and
// the stored value kept, rather than pinned to the ceiling — because these
// fields are written with Math.max (a visit's progress only ever moves
// forward, so late/out-of-order beacons can't undo it), and clamping upward
// would let one bad beacon permanently set every visit to the maximum. A
// visitor who really did sit on the deck for three hours still gets counted;
// only a value that could not have come from this page is dropped.
const MAX_DWELL_MS = 3 * 60 * 60 * 1000;
const MAX_SECTION_INDEX = 50;

apiRouter.post("/:slug/track", presentationTrackLimiter, async (req, res) => {
  const presentation = await findBySlug(req.params.slug);
  const access = resolveAccess(presentation, req);
  if (access.state !== "open") return res.status(204).end();

  const body = req.body || {};
  const visitId = String(body.visitId || "");
  if (!visitId) return res.status(204).end();

  // Scoped by presentationId as well as id: a visit id from one deck must
  // never be writable through another deck's endpoint.
  const visit = await prisma.presentationVisit.findFirst({
    where: { id: visitId, presentationId: presentation.id },
    select: { id: true, dwellMs: true, maxSectionIndex: true, wizardCompleted: true },
  });
  if (!visit) return res.status(204).end();

  // `null` means "the client sent nothing usable for this field" — leave
  // whatever is already stored alone.
  function inRange(value, max) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  }
  const dwellMs = inRange(body.dwellMs, MAX_DWELL_MS);
  const sectionIndex = inRange(body.maxSectionIndex, MAX_SECTION_INDEX);

  await prisma.presentationVisit.update({
    where: { id: visit.id },
    data: {
      lastSeenAt: new Date(),
      dwellMs: dwellMs === null ? visit.dwellMs : Math.max(visit.dwellMs, dwellMs),
      maxSectionIndex:
        sectionIndex === null ? visit.maxSectionIndex : Math.max(visit.maxSectionIndex, sectionIndex),
      wizardCompleted: visit.wizardCompleted || body.wizardCompleted === true,
    },
  });

  const event = body.event && typeof body.event === "object" ? body.event : null;
  if (event && TRACKABLE_EVENTS.has(event.type)) {
    await prisma.presentationEvent.create({
      data: {
        presentationId: presentation.id,
        visitId: visit.id,
        type: event.type,
        label: event.label ? String(event.label).slice(0, 80) : null,
      },
    });
  }

  res.status(204).end();
});

// ---------------------------------------------------------------------
// POST /api/presentation/:slug/contact
//
// The deck's own enquiry form. Mirrors /api/contact's contract deliberately
// (same clamps, same permissive email check, same "record it even if mail
// fails" ordering) — a lead from a private meeting is the highest-value lead
// this platform receives and must not be lost to a mail outage.
// ---------------------------------------------------------------------
function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

apiRouter.post("/:slug/contact", apiLimiter, async (req, res) => {
  const presentation = await findBySlug(req.params.slug);
  const access = resolveAccess(presentation, req);
  if (access.state !== "open") return res.status(404).json({ error: "Not found" });

  const body = req.body || {};
  const name = clean(body.name, 120);
  const email = clean(body.email, 200);
  const company = clean(body.company, 160);
  const message = clean(body.message, 4000);
  const intent = clean(body.intent, 60) || "Schedule meeting";

  if (!name) return res.status(400).json({ error: "Please tell us your name" });
  if (!looksLikeEmail(email)) return res.status(400).json({ error: "Please enter a valid email address" });

  const visitId = String(body.visitId || "");
  const visit = visitId
    ? await prisma.presentationVisit.findFirst({
        where: { id: visitId, presentationId: presentation.id },
        select: { id: true },
      })
    : null;

  // Written before the email is attempted. If Resend is down, the enquiry is
  // still in the database and still counted in the admin's analytics — the
  // admin sees a system-log failure rather than silently losing the lead.
  await prisma.presentationEvent
    .create({
      data: {
        presentationId: presentation.id,
        visitId: visit ? visit.id : null,
        type: "contact_submit",
        label: intent.slice(0, 80),
      },
    })
    .catch(() => {});

  const lines = [
    `Presentation: ${presentation.title}`,
    presentation.recipient ? `Prepared for: ${presentation.recipient}` : null,
    `Intent: ${intent}`,
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    company ? `Company: ${company}` : null,
    "",
    message || "(no message)",
  ].filter((line) => line !== null);

  try {
    const result = await sendContactNotificationEmail(CONTACT_INBOX, { name, email, lines });
    if (result && result.error) {
      throw new Error(result.error.message || "Email provider rejected the message");
    }
  } catch (err) {
    await logEvent({
      category: "presentation",
      message: `Presentation enquiry from ${email} on "${presentation.title}" FAILED to send: ${err.message}`,
    }).catch(() => {});
    return res.status(502).json({ error: "We couldn't send that just now. Please email us directly." });
  }

  await logEvent({
    category: "presentation",
    message: `Presentation enquiry from ${name} <${email}> on "${presentation.title}" — ${intent}`,
  }).catch(() => {});

  res.json({ ok: true });
});

module.exports = { pageRouter, apiRouter };
