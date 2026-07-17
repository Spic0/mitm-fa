const fs = require("fs");

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

  if (!detected || !allowedMimes.has(detected.mime)) {
    await fs.promises.unlink(filePath).catch(() => {});
    return { ok: false, reason: "The file's actual content doesn't match an allowed type" };
  }

  return { ok: true, ext: detected.ext, mime: detected.mime };
}

module.exports = { verifyUploadedFile };
