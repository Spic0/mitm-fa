// PUBLIC DEMO — a deliberately small slice of a real, paid program.
//
// The whole point of this module is that the slicing happens HERE, on the
// server, before anything is serialized. The public demo endpoint never
// receives the full `trainingContent` and therefore cannot leak it: there is
// no "hidden" field for DevTools to find, because the rest of the program is
// never put in the response in the first place. CSS blur on the client is a
// visual affordance for the customer, not the access control.
//
// Nothing here touches entitlements. `hasEntitlement` remains the only thing
// that decides who can read a purchased program; this is a separate, much
// narrower door that opens onto exactly LIMITS-worth of one chosen product.
const { prisma } = require("../db");

// The size of the sneak peek. Deliberately conservative: enough to judge the
// quality of the writing and the exercise selection, nowhere near enough to
// train off. A 10-week program exposes 1 day of 1 week — under 1% of it.
const LIMITS = { weeks: 1, days: 1, exercises: 2 };

// Fallback chain for "which product is the demo". `demoProductSlug` in the
// Setting table wins (admin-selectable, see routes/admin/settings.js), then
// this constant, then any published product that actually has training
// content. The last step means the demo cannot 500 the homepage just because
// someone renamed a slug.
const DEFAULT_DEMO_SLUG = "sulek-strength-size-peak";

function weeksOf(product) {
  const tc = product && product.trainingContent;
  return tc && Array.isArray(tc.weeks) ? tc.weeks : [];
}

// A "training day" is one with at least one exercise. Sam Sulek's week 1 has a
// Tuesday active-recovery day carrying notes and no exercises, and counting
// that as a training day would overstate what the customer is buying.
function isTrainingDay(day) {
  return !!(day && Array.isArray(day.exercises) && day.exercises.length);
}

// The FACTS shown on the landing page and in the demo header. Every one is
// counted from real stored content — none of it is written by hand, so it
// cannot drift away from the product it describes.
function contentsOf(product) {
  const weeks = weeksOf(product);
  let trainingDays = 0;
  let exercises = 0;
  let demos = 0;
  let coachingNotes = 0;
  let swaps = 0;
  const movements = new Set();
  weeks.forEach((w) => {
    (w.days || []).forEach((d) => {
      if (!isTrainingDay(d)) return;
      trainingDays += 1;
      exercises += d.exercises.length;
      d.exercises.forEach((e) => {
        if (!e) return;
        if (e.mediaUrl) demos += 1;
        if (e.notes) coachingNotes += 1;
        if (e.substitutions) swaps += 1;
        if (e.name) movements.add(e.name);
      });
    });
  });
  const nutrition = product.nutritionContent;
  // Counted, never asserted. `demos` is reported alongside the rest precisely
  // so a caller can decide whether it is worth showing: the current demo
  // product carries 4 across 210 exercises, which is a real number and not a
  // feature worth headlining. The landing page checks the ratio rather than
  // printing "exercise demonstrations" over a program that barely has any.
  return {
    weeks: weeks.length,
    trainingDays,
    exercises,
    movements: movements.size,
    coachingNotes,
    swaps,
    demos,
    meals: nutrition && Array.isArray(nutrition.meals) ? nutrition.meals.length : 0,
    hasNutrition: !!(nutrition && (nutrition.notes || (nutrition.meals || []).length || (nutrition.samplePlans || []).length)),
  };
}

// THE slice. Everything else in this file — the payload, the media allowlist,
// the locked counts — is derived from this one function, so the bytes that go
// out and the files that become fetchable can never describe different
// content.
function sliceOf(product) {
  const weeks = weeksOf(product);
  const week = weeks[0];
  if (!week) return null;

  const days = (week.days || []).filter(isTrainingDay);
  const day = days[0];
  if (!day) return null;

  return {
    weekIndex: 0,
    week,
    day,
    exercises: day.exercises.slice(0, LIMITS.exercises),
    // The TITLES of the rest of week 1 — a real teaser, and a cheap one: a day
    // heading says what the week covers without giving up a single set, rep,
    // cue or substitution. Week 1 only, and titles only; no other week's
    // structure is described at all.
    lockedDayTitles: days.slice(LIMITS.days, LIMITS.days + 4).map((d) => d.title || "Training day"),
    // What is being held back, as counts only. The customer is told the size
    // of what they have not seen; they are never sent it.
    locked: {
      exercisesInThisDay: Math.max(day.exercises.length - LIMITS.exercises, 0),
      daysInThisWeek: Math.max(days.length - LIMITS.days, 0),
      weeks: Math.max(weeks.length - LIMITS.weeks, 0),
    },
  };
}

async function resolveDemoProduct() {
  const row = await prisma.setting.findUnique({ where: { key: "demoProductSlug" } });
  const configured = row && row.value ? row.value.trim() : "";

  const candidates = [configured, DEFAULT_DEMO_SLUG].filter(Boolean);
  for (const slug of candidates) {
    // `status: "published"` is not optional. An admin pointing the demo at a
    // draft or an archived product must not publish it by side effect.
    const found = await prisma.product.findFirst({
      where: { slug, status: "published" },
      include: {
        media: { select: { url: true, type: true, alt: true }, orderBy: [{ order: "asc" }, { id: "asc" }] },
        taxonomies: { include: { taxonomyNode: { select: { name: true } } } },
      },
    });
    if (found && weeksOf(found).length) return found;
  }

  // Last resort: any published product with training content, newest first.
  const all = await prisma.product.findMany({
    where: { status: "published", NOT: { trainingContent: { equals: null } } },
    include: {
      media: { select: { url: true, type: true, alt: true }, orderBy: [{ order: "asc" }, { id: "asc" }] },
      taxonomies: { include: { taxonomyNode: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
  return all.find((p) => weeksOf(p).length) || null;
}

// Trims an exercise down to the fields the preview renders. Written as an
// allowlist rather than a delete-list: a field added to the stored shape later
// stays private by default instead of silently appearing in a public response.
function publicExercise(ex, resolveMedia) {
  const media = ex.mediaUrl ? resolveMedia(ex.mediaUrl) : null;
  return {
    name: ex.name || "Exercise",
    reps: ex.reps || "",
    sets: ex.sets || "",
    notes: ex.notes || "",
    substitutions: ex.substitutions || "",
    // POSTER ONLY. `media.poster` is a ~19KB still derivative; `media.anim`
    // and the mp4/webm renditions are the heavy files and are not sent. The
    // customer sees the real exercise, the platform does not ship the
    // animation it sells.
    poster: media && media.poster ? media.poster : null,
    aspectRatio: media ? media.aspectRatio : null,
  };
}

// The exact set of gated media files the demo exposes, recomputed from the
// same slice. routes/library.js checks membership before its 403, so precisely
// these files — and no others, for no other product — are publicly fetchable.
async function demoMediaAllowlist() {
  const product = await resolveDemoProduct();
  const slice = product && sliceOf(product);
  const out = new Set();
  if (!product || !slice) return { productId: null, files: out };
  slice.exercises.forEach((ex) => {
    if (!ex.mediaUrl) return;
    const m = /^\/api\/library\/media\/([^/]+)\/([^/?"]+)/.exec(ex.mediaUrl);
    if (m && m[1] === product.id) out.add(m[2]);
  });
  return { productId: product.id, files: out };
}

module.exports = {
  LIMITS,
  DEFAULT_DEMO_SLUG,
  contentsOf,
  sliceOf,
  resolveDemoProduct,
  publicExercise,
  demoMediaAllowlist,
  isTrainingDay,
};
