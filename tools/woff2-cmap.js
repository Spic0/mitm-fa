// Minimal WOFF2 reader: returns the set of Unicode codepoints a font's cmap
// actually maps to a real glyph.
//
// This exists so the build can PROVE an icon will render, rather than assuming
// the subsetter honoured the list it was given. `cmap` is a WOFF2 "known table"
// and is never transformed, so it can be read straight out of the
// brotli-decompressed table stream without decoding glyf/loca. Node ships
// brotli in zlib, so this needs no dependency.
const fs = require("fs");
const zlib = require("zlib");

// WOFF2 known-table indices, in spec order.
const KNOWN = ["cmap","head","hhea","hmtx","maxp","name","OS/2","post","cvt ","fpgm","glyf","loca","prep","CFF ","VORG","EBDT","EBLC","gasp","hdmx","kern","LTSH","PCLT","VDMX","vhea","vmtx","BASE","GDEF","GPOS","GSUB","EBSC","JSTF","MATH","CBDT","CBLC","COLR","CPAL","SVG ","sbix","acnt","avar","bdat","bloc","bsln","cvar","fdsc","feat","fmtx","fvar","gvar","hsty","just","lcar","mort","morx","opbd","prop","trak","Zapf","Silf","Glat","Gloc","Feat","Sill"];

function readBase128(buf, pos) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[pos++];
    v = (v << 7) | (b & 0x7f);
    if (!(b & 0x80)) return [v >>> 0, pos];
  }
  throw new Error("malformed UIntBase128");
}

function codepoints(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a WOFF2 file");
  const numTables = buf.readUInt16BE(12);

  let pos = 48; // fixed-size WOFF2 header
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++];
    const idx = flags & 0x3f;
    let tag;
    if (idx === 0x3f) { tag = buf.toString("latin1", pos, pos + 4); pos += 4; }
    else tag = KNOWN[idx];
    const tv = (flags >> 6) & 0x03;
    let origLength, transformLength = null;
    [origLength, pos] = readBase128(buf, pos);
    // glyf/loca invert the convention: transform version 0 means TRANSFORMED
    // (version 3 is the null transform). Every other table is transformed only
    // when the version is non-zero. Either way a transformLength follows.
    const transformed = (tag === "glyf" || tag === "loca") ? tv === 0 : tv !== 0;
    if (transformed) [transformLength, pos] = readBase128(buf, pos);
    tables.push({ tag, length: transformed ? transformLength : origLength });
  }

  const data = zlib.brotliDecompressSync(buf.subarray(pos));

  let off = 0, cmap = null;
  for (const t of tables) {
    if (t.tag === "cmap") { cmap = data.subarray(off, off + t.length); break; }
    off += t.length;
  }
  if (!cmap) throw new Error("font has no cmap table");

  // Prefer a format 12 subtable (full Unicode) over format 4 (BMP only).
  const n = cmap.readUInt16BE(2);
  let best = null;
  for (let i = 0; i < n; i++) {
    const rec = 4 + i * 8;
    const plat = cmap.readUInt16BE(rec), enc = cmap.readUInt16BE(rec + 2), o = cmap.readUInt32BE(rec + 4);
    const fmt = cmap.readUInt16BE(o);
    const unicode = (plat === 3 && (enc === 1 || enc === 10)) || plat === 0;
    if (unicode && (!best || fmt > best.fmt)) best = { fmt, o };
  }
  if (!best) throw new Error("font has no Unicode cmap subtable");

  const out = new Set();
  if (best.fmt === 4) {
    const segX2 = cmap.readUInt16BE(best.o + 6), seg = segX2 / 2;
    const endO = best.o + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
    for (let s = 0; s < seg; s++) {
      const end = cmap.readUInt16BE(endO + s * 2), start = cmap.readUInt16BE(startO + s * 2);
      const delta = cmap.readInt16BE(deltaO + s * 2), ro = cmap.readUInt16BE(rangeO + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = rangeO + s * 2 + ro + (c - start) * 2;
          if (gi + 1 >= cmap.length) continue;
          g = cmap.readUInt16BE(gi);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) out.add(c); // glyph id 0 is .notdef — i.e. not actually mapped
      }
    }
  } else if (best.fmt === 12) {
    const ng = cmap.readUInt32BE(best.o + 12);
    for (let i = 0; i < ng; i++) {
      const g = best.o + 16 + i * 12;
      const start = cmap.readUInt32BE(g), end = cmap.readUInt32BE(g + 4);
      for (let c = start; c <= end; c++) out.add(c);
    }
  }
  return out;
}

module.exports = { codepoints };
