const express = require("express");
const fs = require("fs");
const path = require("path");
const { prisma } = require("../db");
const { variantFileName, STRICT_VARIANTS, readManifest } = require("../lib/animatedMedia");
const { requireAuth } = require("../middleware/auth");
const { hasEntitlement } = require("../lib/entitlements");
const { mintDownloadToken, verifyDownloadToken } = require("../lib/signedDownload");
const { apiLimiter } = require("../middleware/rateLimit");
const { logEvent } = require("../lib/adminLog");
const { normalizeImageUrl } = require("../lib/media");

const router = express.Router();
const RESOURCE_DIR = path.join(__dirname, "..", "..", "storage", "resources");
const MEDIA_DIR = path.join(__dirname, "..", "..", "storage", "media");

// X-Accel-Redirect offload for program media.
//
// Without it, one demo GIF costs two HTTP round trips and four DB queries:
// /media/:productId/:fileName authorizes and 302s to /download/media/:token,
// which authorizes AGAIN and then streams the bytes out of Node with
// res.sendFile. Measured over a full handbook traverse of the largest real
// program: 24 requests, ~48 queries and 1.17MB of image data pushed through
// the event loop, for content that is immutable, UUID-named and sitting on
// local disk — exactly what a static server exists to do.
//
// When MEDIA_X_ACCEL is on, the first endpoint still does the whole
// entitlement check, then hands nginx an internal path instead of bytes. The
// redirect and its duplicate check disappear: one request, two queries, zero
// media bytes through Node, and nginx serves the file with sendfile().
//
// Off by default, and deliberately so — the offload only works behind an
// nginx that defines the matching `internal` location (see
// docs/media-x-accel.md). A dev run, a spare-port QA instance or anything
// else hitting Node directly would get an empty 200 with a header no one
// honours, so the token path below stays the fallback rather than being
// replaced. `/download/media/:token` is also kept live regardless: tokens
// already minted stay valid, and a <video> element re-requesting its src
// while seeking must not start 404ing mid-scrub.
const USE_X_ACCEL = process.env.MEDIA_X_ACCEL === "true";
const ACCEL_MEDIA_PREFIX = "/internal-media/";

const KNOWN_VARIANTS = new Set(["poster", "thumb", "anim", "mp4", "webm", "hdmp4", "hdwebm"]);

// Resolves every exercise's media to FINISHED urls, server-side, at
// serialization time.
//
// This used to be a `mediaManifest` map that the client looked demos up in and
// then built variant urls from. That design put the resolution step in the
// browser, and it failed exactly the way an optional step fails: one of the two
// renderers (assets/js/program.js) never performed the lookup at all and shipped
// the raw stored url straight into <img src>. The stored url is the ORIGINAL —
// so a page that should have cost 61,983 bytes of posters cost 28,581,172 bytes
// of source GIFs, a 461x overshoot, and nothing anywhere reported a problem
// because every request succeeded.
//
// The fix is structural rather than careful: a client that receives finished
// urls cannot forget to resolve them. Each exercise now carries a `media`
// object with every url pre-built, and `mediaUrl` itself is rewritten to the
// POSTER whenever derivatives exist, so even a renderer that ignores `media`
// entirely and does the naive thing gets a 19KB still instead of a 12.9MB GIF.
//
// trainingContent on disk is untouched. The stored url remains the permanent
// reference; this rewrite happens on the way out and nowhere else.
const MEDIA_URL_RE = /^\/api\/library\/media\/([^/]+)\/([^/?"]+)/;

function withVariant(url, variant) {
  return url + (url.indexOf("?") === -1 ? "?" : "&") + "variant=" + variant;
}

// null when the url is not gated program media (an external link, a malformed
// value, or a path trying to escape the media directory) — those are passed
// through untouched rather than guessed at.
function resolveMedia(url) {
  if (!url) return null;
  const m = MEDIA_URL_RE.exec(url);
  if (!m) return null;
  const [, productId, fileName] = m;
  // Same containment rule as the media route: never let a crafted
  // trainingContent value turn into a path outside the media dir.
  if (path.basename(fileName) !== fileName || path.basename(productId) !== productId) return null;

  const manifest = readManifest(path.join(MEDIA_DIR, productId, fileName));
  // No manifest at all means nothing was ever derived from this file (a PNG, or
  // an upload predating the pipeline). It stays exactly as it is — for a still
  // image that is already the right answer.
  if (!manifest) return { kind: "image", src: url, animated: false, aspectRatio: null };

  const aspectRatio = manifest.aspectRatio || null;

  // Static source: one frame, nothing to animate, no derivative worth serving.
  // These are the 42-byte placeholders — the legacy <img> path is correct here
  // and deliberately kept.
  if (!manifest.animated) {
    return { kind: "image", src: manifest.poster ? withVariant(url, "poster") : url, animated: false, aspectRatio };
  }

  // Animated WITH both renditions: the <video> path.
  //
  // hdMp4/hdWebm are the FULLSCREEN pair and are null whenever they do not
  // exist — a source too small to have one, or media derived before they did.
  // The client treats null as "use the tile rendition", so a missing HD file
  // degrades to the old behaviour instead of breaking the viewer. They are
  // urls in the payload and nothing more: nothing fetches them until someone
  // taps a demo.
  if (manifest.video) {
    return {
      kind: "video",
      src: withVariant(url, "poster"),
      poster: withVariant(url, "poster"),
      thumb: manifest.thumb ? withVariant(url, "thumb") : null,
      mp4: withVariant(url, "mp4"),
      webm: withVariant(url, "webm"),
      hdMp4: manifest.hdVideo ? withVariant(url, "hdmp4") : null,
      hdWebm: manifest.hdVideo ? withVariant(url, "hdwebm") : null,
      animated: true,
      aspectRatio,
    };
  }

  // Animated but not transcoded (ffmpeg absent, or the job failed). The
  // poster/anim <img> path — still never the original.
  return {
    kind: "animated-image",
    src: withVariant(url, "poster"),
    poster: withVariant(url, "poster"),
    anim: manifest.anim ? withVariant(url, "anim") : url,
    animated: true,
    aspectRatio,
  };
}

// Rewrites trainingContent for the response. Returns a new structure; the
// Prisma result is not mutated.
function resolveTrainingMedia(trainingContent) {
  if (!trainingContent || !Array.isArray(trainingContent.weeks)) return trainingContent;
  const cache = new Map();
  const resolve = (url) => {
    if (!cache.has(url)) cache.set(url, resolveMedia(url));
    return cache.get(url);
  };

  return {
    ...trainingContent,
    weeks: trainingContent.weeks.map((week) => ({
      ...week,
      days: (week.days || []).map((day) => ({
        ...day,
        exercises: (day.exercises || []).map((ex) => {
          const media = ex && ex.mediaUrl ? resolve(ex.mediaUrl) : null;
          if (!media) return ex;
          // mediaUrl becomes the poster (or the original when there is nothing
          // better). A renderer that only reads mediaUrl still cannot download
          // a multi-megabyte source file.
          return { ...ex, mediaUrl: media.src, media };
        }),
      })),
    })),
  };
}

router.use(requireAuth);
router.use(apiLimiter);

// One row per distinct product ever purchased (so re-purchases still show a
// single library entry) — this is the "My Library" grid, linking into the
// gated in-platform program view rather than a file download.
router.get("/", async (req, res) => {
  const items = await prisma.orderItem.findMany({
    where: { order: { userId: req.user.id, status: "paid" } },
    include: { product: true, order: true },
    orderBy: { order: { createdAt: "desc" } },
  });

  const byProduct = new Map();
  for (const item of items) {
    if (!byProduct.has(item.productId)) {
      byProduct.set(item.productId, {
        product: {
          id: item.product.id,
          slug: item.product.slug,
          name: item.product.name,
          imageUrl: normalizeImageUrl(item.product.imageUrl),
          description: item.product.description,
          creator: item.product.creator,
          difficulty: item.product.difficulty,
          durationWeeks: item.product.durationWeeks,
        },
        purchasedAt: item.order.createdAt,
      });
    }
  }

  res.json({ library: [...byProduct.values()] });
});

router.get("/orders", async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id, status: "paid" },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    orders: orders.map((order) => ({
      id: order.id,
      provider: order.provider,
      totalCents: order.totalCents,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({ name: item.product.name, priceCents: item.priceCents })),
    })),
  });
});

// The gated "open program" view: full structured content for a purchased
// product, rendered inside the platform instead of downloaded as a file.
//
// Customer Preview Mode: admins are allowed through without an entitlement
// (flagged with preview:true so the UI can show a "you're previewing" bar).
// This is the pre-ads QA path — the exact page a paying customer gets,
// including draft products that aren't purchasable yet.
router.get("/program/:productId", async (req, res) => {
  const { productId } = req.params;
  const product = await prisma.product.findFirst({
    where: { OR: [{ id: productId }, { slug: productId }] },
    include: {
      faqs: { orderBy: { order: "asc" } },
      resources: { orderBy: { order: "asc" } },
      // Gallery ordering is admin-defined; `id` only breaks ties so two rows
      // sharing an order value don't shuffle between requests. `id` is also
      // what the client derives its stable "video:<id>" progress key from,
      // so it must be selected, unlike on the public product endpoint.
      media: {
        select: { id: true, url: true, type: true, alt: true },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      },
      taxonomies: { include: { taxonomyNode: { select: { name: true } } } },
    },
  });
  if (!product) return res.status(404).json({ error: "Program not found" });

  const isAdmin = req.user.role === "admin";
  const entitled = await hasEntitlement(req.user.id, product.id);
  if (!entitled && !isAdmin) return res.status(403).json({ error: "You don't have access to this program" });

  const isPreview = isAdmin && !entitled;
  if (isPreview) {
    // Fire-and-forget: an audit-trail write must never slow down or fail
    // the actual preview request it's recording.
    logEvent({
      category: "admin",
      message: `Preview mode: opened "${product.name}" (status: ${product.status}) without a purchase`,
      metadata: { productId: product.id, productStatus: product.status },
      actorId: req.user.id,
    });
  }

  // The hero's "purchased on" / "owned since" line. Earliest paid order
  // containing this product — a re-purchase (or a gifted second copy) must
  // not make the customer look newer than they are.
  const firstOrder = isPreview
    ? null
    : await prisma.orderItem.findFirst({
        where: { productId: product.id, order: { userId: req.user.id, status: "paid" } },
        orderBy: { order: { createdAt: "asc" } },
        select: { order: { select: { createdAt: true } } },
      });

  // Progress is read before it's touched, so the hero can say "last opened
  // 3 days ago" on this very request rather than "just now" — opening the
  // program is exactly what's being recorded here. Admins previewing
  // without an entitlement never write progress: preview is a QA view of
  // someone else's experience, not their own.
  let progress = null;
  if (!isPreview) {
    const existing = await prisma.programProgress.findUnique({
      where: { userId_productId: { userId: req.user.id, productId: product.id } },
      select: { completedKeys: true, lastKey: true, lastSection: true, lastOpenedAt: true },
    });
    progress = existing || { completedKeys: [], lastKey: null, lastSection: null, lastOpenedAt: null };

    // Fire-and-forget: recording that the program was opened must never
    // delay or fail the render of the program itself.
    prisma.programProgress
      .upsert({
        where: { userId_productId: { userId: req.user.id, productId: product.id } },
        create: { userId: req.user.id, productId: product.id, lastOpenedAt: new Date() },
        update: { lastOpenedAt: new Date() },
      })
      .catch(() => {});
  }

  res.json({
    preview: isPreview,
    productStatus: product.status,
    purchasedAt: firstOrder ? firstOrder.order.createdAt : null,
    progress,
    product: {
      id: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: normalizeImageUrl(product.imageUrl),
      // Publication date — the anchor of the Updates timeline, which is
      // built from real timestamps rather than a changelog model.
      createdAt: product.createdAt,
      creator: product.creator,
      // Taxonomy replaced the old free-text Product.category; the leaf node
      // names are what the hero shows as topic chips.
      categories: (product.taxonomies || [])
        .map((t) => t.taxonomyNode && t.taxonomyNode.name)
        .filter(Boolean),
      difficulty: product.difficulty,
      durationWeeks: product.durationWeeks,
      overview: product.overview,
      // Media urls are resolved to finished variant urls here, on the way out.
      // See resolveTrainingMedia above for why this is not left to the client.
      trainingContent: resolveTrainingMedia(product.trainingContent),
      nutritionContent: product.nutritionContent,
      bonusNotes: product.bonusNotes,
      faqs: product.faqs,
      media: (product.media || []).map((m) => ({
        id: m.id,
        url: normalizeImageUrl(m.url),
        type: m.type,
        alt: m.alt || product.name,
      })),
      resources: product.resources.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        type: r.type,
        createdAt: r.createdAt,
        url: r.type === "link" ? r.url : `/api/library/resource/${r.id}`,
      })),
    },
  });
});

// Progress write-back for the program view. The client owns the completed
// set (it's a few dozen keys at most) and PUTs the whole thing debounced,
// rather than the server maintaining it item by item — one upsert per
// change instead of a read-modify-write round trip per checkbox.
//
// Keys are opaque here on purpose: see the ProgramProgress comment in
// schema.prisma for why they're clamped rather than validated.
const MAX_KEYS = 600;
const MAX_KEY_LEN = 200;

function clampKeys(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  for (const key of value) {
    if (typeof key !== "string" || !key) continue;
    seen.add(key.slice(0, MAX_KEY_LEN));
    if (seen.size >= MAX_KEYS) break;
  }
  return [...seen];
}

function clampField(value) {
  if (value == null) return null;
  return typeof value === "string" ? value.slice(0, MAX_KEY_LEN) : null;
}

router.put("/program/:productId/progress", async (req, res) => {
  const product = await prisma.product.findFirst({
    where: { OR: [{ id: req.params.productId }, { slug: req.params.productId }] },
    select: { id: true },
  });
  if (!product) return res.status(404).json({ error: "Program not found" });

  // Entitlement only — an admin previewing a program they don't own is
  // looking at the customer experience, not accruing progress of their own,
  // so this deliberately does not have the isAdmin escape hatch the read
  // path above has. The client treats the 403 as "don't sync", not an error.
  const entitled = await hasEntitlement(req.user.id, product.id);
  if (!entitled) return res.status(403).json({ error: "You don't have access to this program" });

  const completedKeys = clampKeys(req.body && req.body.completedKeys);
  const data = {
    lastKey: clampField(req.body && req.body.lastKey),
    lastSection: clampField(req.body && req.body.lastSection),
  };
  // Omitted (rather than empty) completedKeys means "position only" — a
  // section change shouldn't be able to wipe completions if the two
  // requests ever race.
  if (completedKeys) data.completedKeys = completedKeys;

  const saved = await prisma.programProgress.upsert({
    where: { userId_productId: { userId: req.user.id, productId: product.id } },
    create: { userId: req.user.id, productId: product.id, ...data },
    update: data,
    select: { completedKeys: true, lastKey: true, lastSection: true, lastOpenedAt: true },
  });

  res.json({ progress: saved });
});

// Exercise demo media (GIFs / short videos / images) uploaded through the
// admin product wizard. Stored under server/storage/media/<productId>/ and
// served only to entitled customers or admins — program media is part of the
// paid product, so it never lives in the public assets folder.
//
// This is the stable, permanent reference — the URL baked into
// Product.trainingContent at upload time (see admin/products.js) and never
// rewritten — so nothing else in the codebase needs to change. It does the
// real ownership check, then hands off a short-lived signed token rather
// than the bytes themselves: the actual file is only ever served from
// /download/media/:token below, which re-verifies ownership again at the
// moment it's used and expires automatically a few minutes later. A leaked
// link to *this* URL still requires a live, valid session to do anything;
// a leaked link to the *signed* URL it redirects to stops working shortly
// after it's issued even with a valid session.
// ?variant=poster asks for the still first frame (~19KB for a 15.5MB demo
// GIF), ?variant=anim for the width-capped animated WebP (~226KB). Anything
// else, including no variant at all, serves the original.
//
// Resolving by naming convention rather than by a stored URL is deliberate:
// the URL baked into Product.trainingContent at upload time is the stable,
// permanent reference and is never rewritten, so there is nowhere to put a
// second URL without a migration and a backfill of every existing program.
// A variant that hasn't been generated yet — an upload whose background job
// is still queued, or a program that predates this — falls back to the
// original, so the handbook degrades to exactly its old behaviour instead of
// showing a broken image.
router.get("/media/:productId/:fileName", async (req, res) => {
  const { productId, fileName } = req.params;
  // The upload endpoint only ever writes sanitized basenames, so anything
  // with a path separator (or that changes under basename()) is an attempt
  // to escape the product's media folder.
  if (path.basename(fileName) !== fileName) return res.status(400).json({ error: "Invalid file name" });

  const entitled = await hasEntitlement(req.user.id, productId);
  if (!entitled && req.user.role !== "admin") {
    return res.status(403).json({ error: "You don't have access to this media" });
  }

  let served = fileName;
  const variant = String(req.query.variant || "");
  if (KNOWN_VARIANTS.has(variant)) {
    const candidate = variantFileName(fileName, variant);
    // basename() again: variantFileName only ever appends a suffix, but this
    // is the value that becomes a filesystem path, so it is re-checked rather
    // than trusted to have stayed clean.
    const ok = path.basename(candidate) === candidate &&
      fs.existsSync(path.join(MEDIA_DIR, productId, candidate));
    if (ok) {
      served = candidate;
    } else if (STRICT_VARIANTS.has(variant)) {
      // A still variant may fall back to the original — that is just the old,
      // heavier behaviour and it still renders. A video variant may NOT: the
      // caller is a <video> element, which cannot decode a GIF, so falling
      // back would hand it 15MB it can't play. 404 is the signal the handbook
      // uses to drop to the <img> poster/anim path.
      return res.status(404).json({ error: "No video derivative for this media" });
    }
  }

  warnIfServingRedundantOriginal(productId, fileName, served);

  if (USE_X_ACCEL) return sendMediaViaAccel(res, productId, served);

  const token = mintDownloadToken("media", `${productId}/${served}`, req.user.id);
  res.redirect(`/api/library/download/media/${token}`);
});

// The alarm for the failure that started all this.
//
// Serving an original is legitimate when nothing was ever derived from it.
// Serving an original for a file that HAS derivatives sitting next to it means
// a caller asked for the source when a 19KB poster or a 110KB WebM was
// available — which is not an error anyone would notice, because the request
// succeeds and the image renders. It just costs 461x the bytes. That is
// precisely how this went unnoticed in production, so it gets logged loudly
// with everything needed to find the caller.
function warnIfServingRedundantOriginal(productId, fileName, served) {
  if (served !== fileName) return;               // a derivative was resolved; fine
  const manifest = readManifest(path.join(MEDIA_DIR, productId, fileName));
  if (!manifest) return;                          // nothing was ever derived; fine
  if (!manifest.poster && !manifest.anim && !manifest.video) return;

  const available = ["poster", "thumb", "anim", "mp4", "webm", "hdmp4", "hdwebm"].filter((k) => manifest[k]);
  console.error(
    `[media] SERVED ORIGINAL despite derivatives — productId=${productId} file=${fileName} ` +
    `available=[${available.join(",")}] animated=${!!manifest.animated} video=${!!manifest.video}. ` +
    `A caller requested the source file; it should have asked for a variant.`
  );
}

// Hands the file off to nginx. Every header that matters for safety is set
// here rather than in the nginx config, so the two cannot drift apart: the
// route that authorizes the file is the one that decides how it may be
// cached and what it is allowed to execute.
function sendMediaViaAccel(res, productId, fileName) {
  // `private` because access is entitlement-checked: the browser may keep it,
  // no shared/intermediate cache may. `immutable` because every one of these
  // filenames is a UUID (or a suffixed derivative of one) whose bytes never
  // change — an upload is never rewritten in place, it becomes a new UUID.
  //
  // This was max-age=60, which for immutable UUID-named content meant every
  // reload past the first minute re-downloaded the entire day's media.
  //
  // The cost of `immutable`: re-running the backfill with DIFFERENT encoder
  // settings regenerates derivatives under the SAME filename, and browsers
  // holding a cached copy will not see the new bytes for a year. If encoder
  // settings ever change materially, the derivative suffix has to change with
  // them (`-vid.mp4` -> `-vid2.mp4`) rather than relying on cache expiry.
  res.set("Cache-Control", "private, max-age=31536000, immutable");

  // SVG is the one gated media type that is both user-supplied and a
  // scriptable document, and the token path defends it explicitly. nginx
  // serving the bytes changes nothing about that risk, so the same two
  // headers ride along on the accel response.
  if (path.extname(fileName).toLowerCase() === ".svg") {
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.set("X-Content-Type-Options", "nosniff");
  }

  // Both segments are already validated basenames, but they become a URI that
  // nginx re-parses, so they are encoded rather than interpolated raw — a
  // literal '?' or '#' in a filename would otherwise truncate the path and
  // serve the wrong file.
  const uri = ACCEL_MEDIA_PREFIX + encodeURIComponent(productId) + "/" + encodeURIComponent(fileName);
  res.set("X-Accel-Redirect", uri);
  res.end();
}

router.get("/download/media/:token", async (req, res) => {
  const payload = verifyDownloadToken(req.params.token, "media");
  if (!payload) return res.status(410).json({ error: "This link has expired. Reopen the program to get a fresh one." });
  // The token is only valid for the user it was minted for — a still-logged-in
  // session belonging to someone else can't reuse a link they happened to see.
  if (payload.userId !== req.user.id) return res.status(403).json({ error: "You don't have access to this media" });

  const [productId, fileName] = payload.id.split("/");
  if (path.basename(fileName) !== fileName) return res.status(400).json({ error: "Invalid file name" });

  // Re-check ownership at serve time, not just at mint time — closes the
  // window where access is revoked (e.g. a refund) after a token was
  // minted but before it's actually used.
  const entitled = await hasEntitlement(req.user.id, productId);
  if (!entitled && req.user.role !== "admin") {
    return res.status(403).json({ error: "You don't have access to this media" });
  }

  // Signed, short-lived, and re-verified — but still never cached by any
  // shared/intermediate cache, since the URL itself is single-use-ish and
  // scoped to one viewer; the browser may still cache it locally per fetch.
  res.set("Cache-Control", "private, max-age=60");
  // Program media may now include SVG, which unlike every other allowed type
  // is a scriptable document. Same defence as the public static handler in
  // src/index.js — see the comment there for why the sanitizer alone isn't
  // relied on. Applied here too because this route bypasses that handler
  // entirely.
  if (path.extname(fileName).toLowerCase() === ".svg") {
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.set("X-Content-Type-Options", "nosniff");
  }
  res.sendFile(path.join(MEDIA_DIR, productId, fileName), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "Media not found" });
  });
});

// Optional bonus attachment download/redirect — gated the same way as the
// program view itself, since a resource is only ever reachable through it.
// Same stable-reference + signed-redirect pattern as media, above.
router.get("/resource/:resourceId", async (req, res) => {
  const resource = await prisma.productResource.findUnique({ where: { id: req.params.resourceId } });
  if (!resource) return res.status(404).json({ error: "Resource not found" });

  const entitled = await hasEntitlement(req.user.id, resource.productId);
  if (!entitled && req.user.role !== "admin") {
    return res.status(403).json({ error: "You don't have access to this resource" });
  }

  if (resource.type === "link") return res.redirect(resource.url);

  const token = mintDownloadToken("resource", resource.id, req.user.id);
  res.redirect(`/api/library/download/resource/${token}`);
});

router.get("/download/resource/:token", async (req, res) => {
  const payload = verifyDownloadToken(req.params.token, "resource");
  if (!payload) return res.status(410).json({ error: "This link has expired. Go back and click download again." });
  if (payload.userId !== req.user.id) return res.status(403).json({ error: "You don't have access to this resource" });

  const resource = await prisma.productResource.findUnique({ where: { id: payload.id } });
  if (!resource) return res.status(404).json({ error: "Resource not found" });

  const entitled = await hasEntitlement(req.user.id, resource.productId);
  const isAdmin = req.user.role === "admin";
  if (!entitled && !isAdmin) return res.status(403).json({ error: "You don't have access to this resource" });

  if (!entitled && isAdmin) {
    logEvent({
      category: "admin",
      message: `Preview mode: downloaded bonus resource "${resource.title}" without a purchase`,
      metadata: { resourceId: resource.id, productId: resource.productId },
      actorId: req.user.id,
    });
  }

  res.download(path.join(RESOURCE_DIR, resource.fileName), resource.title);
});

module.exports = router;
// Exported for tools/test-program-page-media.js, which used to re-implement
// this shape and therefore could not fail when the real one drifted. The test
// that guards the 461x regression should exercise the function that caused it.
module.exports.resolveTrainingMedia = resolveTrainingMedia;
module.exports.resolveMedia = resolveMedia;
