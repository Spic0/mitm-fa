// Generates responsive derivatives + sidecar manifests for landing-page
// marketing imagery dropped into assets/images/landing/.
//
// This is the one step between "I copied a JPEG onto the VPS" and "the
// homepage is serving AVIF/WebP at the right width". It reuses the product
// upload pipeline verbatim (server/src/lib/mediaDerivatives.js) rather than
// having a second, subtly-different one for marketing images.
//
//   node tools/build-landing-assets.js            # build what's new
//   node tools/build-landing-assets.js --force    # rebuild everything
//   node tools/build-landing-assets.js --dry      # report only, write nothing
//
// Safe to re-run: a source that already has a manifest is skipped unless
// --force. Generated `-<width>.<ext>` files are never treated as sources, so
// re-running cannot produce derivatives-of-derivatives.
//
// See server/docs/landing-assets.md for the full operator workflow.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { generateDerivatives, manifestPathFor, describeForAdmin } = require(path.join(ROOT, "server/src/lib/mediaDerivatives"));
const {
  SLOTS,
  SOURCE_EXTS,
  MIME_BY_EXT,
  DERIVATIVE_SUFFIX,
  LANDING_DIR,
  LANDING_URL,
} = require(path.join(ROOT, "server/src/lib/landingAssets"));

const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry");

function bytes(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;
}

(async () => {
  if (!fs.existsSync(LANDING_DIR)) {
    console.error(`No landing asset directory at ${LANDING_DIR}`);
    console.error(`Create it with:  mkdir -p "${LANDING_DIR}"`);
    process.exit(1);
  }

  const entries = fs.readdirSync(LANDING_DIR);
  const filled = new Set();
  let done = 0, skipped = 0, failed = 0;

  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) continue;
    if (DERIVATIVE_SUFFIX.test(name)) continue; // a derivative, not a source

    const base = path.basename(name, path.extname(name));
    const file = path.join(LANDING_DIR, name);
    if (!fs.statSync(file).isFile()) continue;

    // A file whose name isn't a known slot will never be rendered by anything,
    // so say so loudly rather than silently generating derivatives nobody
    // reads. A typo'd filename is the most likely reason a slot "didn't work".
    if (!Object.prototype.hasOwnProperty.call(SLOTS, base)) {
      console.warn(`SKIP  ${name} — "${base}" is not a slot name. Valid slots: ${Object.keys(SLOTS).join(", ")}`);
      continue;
    }
    filled.add(base);

    if (!FORCE && fs.existsSync(manifestPathFor(file))) {
      skipped++;
      console.log(`ok    ${name.padEnd(30)} already built (--force to redo)`);
      continue;
    }
    if (DRY) {
      console.log(`would build ${name}`);
      done++;
      continue;
    }

    try {
      const m = await generateDerivatives(file, mime, LANDING_URL);
      const derivatives = m.derivatives || [];
      const smallest = derivatives.length ? Math.min(...derivatives.map((d) => d.bytes)) : null;
      console.log(
        `BUILT ${name.padEnd(30)} ${m.width || "?"}x${m.height || "?"}  fit=${String(m.fit).padEnd(7)} ` +
        `${derivatives.length} derivatives${smallest ? `  smallest ${bytes(smallest)}` : ""}`
      );

      // The same size/shape advice the admin upload UI gives, so a marketing
      // image dropped by hand gets the identical quality check an uploaded
      // product cover would have got.
      const note = describeForAdmin(m);
      if (note) console.log(`      ${note.level}: ${note.message}`);

      const spec = SLOTS[base];
      if (m.width && spec.ideal && m.width < spec.ideal.width) {
        console.log(`      notice: ${base} renders best at ${spec.ideal.width}x${spec.ideal.height}; this is ${m.width}px wide.`);
      }
      done++;
    } catch (err) {
      console.error(`FAILED ${name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nbuilt ${done}, skipped ${skipped}, failed ${failed}`);

  const empty = Object.keys(SLOTS).filter((s) => !filled.has(s));
  if (empty.length) {
    console.log(`\nEmpty slots (the page renders its branded fallback for these):`);
    for (const s of empty) {
      const spec = SLOTS[s];
      console.log(`  ${s.padEnd(20)} ${spec.label} — ${spec.ideal.width}x${spec.ideal.height}, ratio ${spec.ratio}`);
    }
    console.log(`\nDrop a file named <slot>.<jpg|png|webp|avif> into ${LANDING_DIR} and re-run.`);
  }

  if (failed) process.exit(1);
})();
