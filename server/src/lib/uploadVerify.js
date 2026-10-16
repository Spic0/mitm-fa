const fs = require("fs");
const { sanitizeSvgFile } = require("./svgSanitize");

// Multer's fileFilter only ever sees the client-declared Content-Type of a
// multipart field — entirely attacker-controlled and trivially spoofed
// (curl -F "file=@shell.svg;type=image/png"). It's a UX nicety, not a
// security control. Real verification has to happen after the bytes are on
// disk, by sniffing the file's actual magic-byte signature.
//
// file-type is ESM-only from v17+; dynamically imported so this file can
// stay CommonJS like the rest of the server.
async function detectRealFileType(filePath) {
  const { fileTypeFromFile } = await import("file-type");
  return fileTypeFromFile(filePath);
}

// Cheap "is this plausibly XML/SVG at all" probe over the first chunk, used
// only to pick which rejection message the caller should produce. Real
// validation is svgSanitize.js's job.
async function looksLikeSvg(filePath) {
  let handle;
  try {
    handle = await fs.promises.open(filePath, "r");
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(1024), 0, 1024, 0);
    // Strip a UTF-8 BOM and leading whitespace before looking at the markup.
    const head = buffer.subarray(0, bytesRead).toString("utf8").replace(/^﻿/, "").trimStart();
    return /^<(?:\?xml|!--|!DOCTYPE|svg)/i.test(head) || /<svg[\s>]/i.test(head);
  } catch (err) {
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

// Verifies an already-uploaded file's real content matches one of
// allowedMimes. Deletes the file and returns a rejection reason if not —
// callers must check `ok` and respond accordingly, never trust req.file
// alone once this has been wired in.
async function verifyUploadedFile(filePath, allowedMimes) {
  let detected;
  try {
    detected = await detectRealFileType(filePath);
  } catch (err) {
    await fs.promises.unlink(filePath).catch(() => {});
    return { ok: false, reason: "Could not read the uploaded file" };
  }

  // SVG is XML text, so it has no magic-byte signature and file-type returns
  // undefined for it — the check below would delete every valid SVG. It gets
  // its own content gate instead: parsed, stripped of executable constructs,
  // and rejected outright if anything dangerous survives. See svgSanitize.js
  // for why that sanitizer is only one of three layers.
  //
  // The looksLikeSvg() guard matters for the error message, not for safety:
  // file-type returns undefined for ANY unrecognized binary, so routing every
  // undetected file here would tell someone who uploaded a corrupt .zip that
  // their file "isn't a valid SVG", which is a confusing dead end. Anything
  // that isn't plausibly XML falls through to the normal rejection below.
  if (!detected && allowedMimes.has("image/svg+xml") && (await looksLikeSvg(filePath))) {
    return sanitizeSvgFile(filePath);
  }

  if (!detected || !allowedMimes.has(detected.mime)) {
    await fs.promises.unlink(filePath).catch(() => {});
    return { ok: false, reason: "The file's actual content doesn't match an allowed type" };
  }

  return { ok: true, ext: detected.ext, mime: detected.mime };
}

module.exports = { verifyUploadedFile };
