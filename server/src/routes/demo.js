// GET /api/demo — the public sneak peek.
//
// Mounted OUTSIDE the library router on purpose. Everything under
// /api/library requires a session and an entitlement; this is the one public
// window onto a paid program, and keeping it in its own file means the
// gate over there is never loosened to accommodate it.
//
// The response is built from lib/demo.js's slice, which is what makes the
// limit real: the full trainingContent is never serialized here, so there is
// nothing extra in the payload for a customer to find in DevTools. The blur
// on the client is presentation.
const express = require("express");
const { normalizeImageUrl, coverMedia } = require("../lib/media");
const { resolveMedia } = require("./library");
const { LIMITS, contentsOf, sliceOf, handbookPagesOf, resolveDemoProduct, publicExercise } = require("../lib/demo");

const router = express.Router();

// The cover at handbook size, never the stored original. The viewer's cover
// page paints whatever `imageUrl` it is handed into a ~450px box, and this
// product's original is a 2.3MB PNG — the exact renderer-ships-the-original
// bug this codebase has now hit on seven surfaces, caught here before an
// eighth. 640w covers the box at 2x; the original is only the fallback for
// an image with no derivatives, where it is all there is.
function coverAtHandbookSize(imageUrl) {
  const cover = coverMedia(imageUrl);
  if (cover && cover.sources && cover.sources.length) {
    const webp = cover.sources.find((s) => s.type === "image/webp") || cover.sources[0];
    const entries = String(webp.srcset).split(",").map((e) => e.trim().split(/\s+/));
    const at640 = entries.find((e) => e[1] === "640w");
    const pick = at640 || entries[entries.length - 1];
    if (pick && pick[0]) return pick[0];
  }
  return normalizeImageUrl(imageUrl);
}

// The overview is marketing copy and already public on the product page, but
// it runs long. The demo header wants a lede, not an essay.
function firstParagraph(text, max) {
  if (!text) return "";
  const para = String(text).split(/\n{2,}/)[0].trim();
  if (para.length <= max) return para;
  const cut = para.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd() + "…");
}

router.get("/", async (req, res) => {
  const product = await resolveDemoProduct();
  if (!product) return res.status(404).json({ error: "No demo program is configured" });

  const slice = sliceOf(product);
  if (!slice) return res.status(404).json({ error: "The demo program has no training content" });

  const contents = contentsOf(product);
  // A fact about the object being sold, computed the way the viewer
  // paginates it — see handbookPagesOf.
  contents.handbookPages = handbookPagesOf(product);

  res.json({
    limits: LIMITS,
    // Every field below is either already public on GET /api/products/:slug
    // or a COUNT derived from gated content. No gated content itself.
    product: {
      slug: product.slug,
      name: product.name,
      creator: product.creator,
      difficulty: product.difficulty,
      durationWeeks: product.durationWeeks,
      priceCents: product.priceCents,
      imageUrl: normalizeImageUrl(product.imageUrl),
      cover: coverMedia(product.imageUrl),
      lede: firstParagraph(product.overview, 240),
      categories: (product.taxonomies || [])
        .map((t) => t.taxonomyNode && t.taxonomyNode.name)
        .filter(Boolean),
      // The public gallery. Already served by the products API and from the
      // static webroot, so this adds no new exposure.
      gallery: (product.media || [])
        .filter((m) => m.type !== "video")
        .slice(0, 4)
        .map((m) => ({ url: normalizeImageUrl(m.url), alt: m.alt || product.name, cover: coverMedia(m.url) })),
    },
    contents,
    preview: {
      weekTitle: slice.week.title || "Week 1",
      dayTitle: slice.day.title || "Day 1",
      dayNotes: slice.day.notes || "",
      exercises: slice.exercises.map((ex) => publicExercise(ex, resolveMedia)),
    },
    lockedDayTitles: slice.lockedDayTitles,
    locked: slice.locked,
  });
});

// GET /api/demo/handbook — the handbook PREVIEW, shaped for the real viewer.
//
// This payload drives assets/js/program-viewer.js — the exact component a
// customer reads their purchased program in — so the preview is the product's
// own interface, not a landing-page imitation of it. What makes it a preview
// is what is in the payload, decided HERE:
//
//   * trainingContent holds ONE week holding ONE day holding LIMITS.exercises
//     exercises — the same slice /api/demo shows, cut before serialization.
//     The other nine weeks are never in the response.
//   * exercise media is the POSTER STILL, through publicExercise's allowlist
//     shape — the same two files the /api/demo gate already opens. No anim,
//     no video, no original.
//   * overview is included in full; it is already public on every product
//     card via GET /api/products.
//   * nutritionContent, faqs, resources and bonusNotes are OMITTED, so the
//     viewer paginates none of them. Their existence is stated as counts in
//     `preview.locked`, never their content.
//
// `preview` is what tells the viewer to end on a locked boundary page instead
// of pretending the fourth page is the back cover.
router.get("/handbook", async (req, res) => {
  const product = await resolveDemoProduct();
  if (!product) return res.status(404).json({ error: "No demo program is configured" });

  const slice = sliceOf(product);
  if (!slice) return res.status(404).json({ error: "The demo program has no training content" });

  res.json({
    product: {
      name: product.name,
      creator: product.creator,
      difficulty: product.difficulty,
      durationWeeks: product.durationWeeks,
      imageUrl: coverAtHandbookSize(product.imageUrl),
      overview: product.overview || "",
      trainingContent: {
        weeks: [
          {
            title: slice.week.title || "Week 1",
            days: [
              {
                title: slice.day.title || "Day 1",
                notes: slice.day.notes || "",
                exercises: slice.exercises.map((ex) => {
                  const pub = publicExercise(ex, resolveMedia);
                  return {
                    name: pub.name,
                    reps: pub.reps,
                    sets: pub.sets,
                    notes: pub.notes,
                    substitutions: pub.substitutions,
                    // The still, as the plain mediaUrl the viewer's static-
                    // image branch renders. No `media` facts object means no
                    // video path and no anim swap — there is nothing heavier
                    // for the viewer to reach for.
                    mediaUrl: pub.poster,
                    mediaType: pub.poster ? "image" : undefined,
                  };
                }),
              },
            ],
          },
        ],
      },
      // The locked boundary the viewer renders as its final page. Counts and
      // titles only — the same vocabulary the /demo lock uses.
      preview: {
        locked: slice.locked,
        lockedDayTitles: slice.lockedDayTitles,
        handbookPages: handbookPagesOf(product),
        priceCents: product.priceCents,
        href: `/program/${encodeURIComponent(product.slug)}`,
      },
    },
  });
});

module.exports = router;
