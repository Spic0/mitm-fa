// Subsets the FontAwesome webfonts down to only the glyphs this site actually
// references. Same class names, same markup, same CSS — just fonts that carry
// the ~100 icons in use instead of all ~3700.
//
// Reads the PRISTINE fonts from tools/fontawesome-src/webfonts/ and writes
// assets/webfonts/. This directionality is the whole point: the previous
// version read and wrote the same directory, so the served font WAS the only
// copy of the source. Once a glyph had been dropped, no later run could bring
// it back — which is exactly how the dashboard, analytics and logout icons
// ended up as empty boxes in production while their CSS rules still existed.
//
// The icon inventory comes from tools/fontawesome-inventory.js, shared with the
// CSS subsetter and the verifier so the three cannot disagree. Run order no
// longer matters, because neither tool consumes the other's output.
const fs = require("fs");
const path = require("path");
const subsetFont = require("subset-font"); // devDependency, see tools/README.md
const { SRC_FONTS, OUT_FONTS, resolveUsed } = require("./fontawesome-inventory");

const { used, extras } = resolveUsed();

// Keep the ASCII range as well as the icon glyphs. FontAwesome uses a handful
// of plain characters as icons in their own right (`.fa-dollar-sign` is U+0024,
// `.fa-percent` is U+0025), and a subset built from icon codepoints alone drops
// them — they were among the icons rendering blank.
const KEEP_ALWAYS = [0x20, 0xa0];
for (let c = 0x21; c <= 0x7e; c++) KEEP_ALWAYS.push(c);

const codepoints = [...new Set([...used.values(), ...KEEP_ALWAYS])].sort((a, b) => a - b);
const text = codepoints.map((c) => String.fromCodePoint(c)).join("");

console.log(`icons in use (incl. ${extras.length} runtime-built): ${used.size}`);
console.log(`glyphs kept per font:                    ${codepoints.length}`);

(async () => {
  fs.mkdirSync(OUT_FONTS, { recursive: true });
  const targets = fs.readdirSync(SRC_FONTS).filter((f) => f.endsWith(".woff2"));
  let before = 0, after = 0;
  let failed = false;

  for (const file of targets) {
    const src = path.join(SRC_FONTS, file);
    const dest = path.join(OUT_FONTS, file);
    const buf = fs.readFileSync(src);
    before += buf.length;
    try {
      const out = await subsetFont(buf, text, { targetFormat: "woff2" });
      // A subset that is empty or somehow larger than the original means the
      // subsetter misunderstood the font; ship the pristine file rather than a
      // suspect one. (It can legitimately be larger for a font like
      // fa-v4compatibility that is already tiny.)
      if (out.length && out.length < buf.length) {
        fs.writeFileSync(dest, out);
        after += out.length;
        console.log(`  ${file.padEnd(28)} ${(buf.length / 1024).toFixed(0).padStart(4)}KB -> ${(out.length / 1024).toFixed(0).padStart(4)}KB`);
      } else {
        fs.copyFileSync(src, dest);
        after += buf.length;
        console.log(`  ${file.padEnd(28)} copied pristine (subset not smaller)`);
      }
    } catch (e) {
      // Copy the pristine font through rather than leaving whatever happened to
      // be in assets/ from a previous run. A big font is a performance problem;
      // a stale/stripped one is a correctness problem, and correctness wins.
      fs.copyFileSync(src, dest);
      after += buf.length;
      failed = true;
      console.log(`  ${file.padEnd(28)} SUBSET FAILED, copied pristine: ${e.message}`);
    }
  }

  console.log(`\ntotal ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB  (saved ${((1 - after / before) * 100).toFixed(1)}%)`);
  console.log(failed ? "\nAt least one font could not be subset — see above." : "");
  console.log("Now run: node tools/verify-fontawesome.js");
})();
