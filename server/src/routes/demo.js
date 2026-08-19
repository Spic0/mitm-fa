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
const { LIMITS, contentsOf, sliceOf, resolveDemoProduct, publicExercise } = require("../lib/demo");

const router = express.Router();

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

module.exports = router;
