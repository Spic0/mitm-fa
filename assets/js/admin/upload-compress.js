// Client-side image compression, applied before an upload leaves the browser.
//
// This is a bandwidth and patience optimization, NOT a validation step and
// NOT the thing that keeps oversized files out. The server enforces its own
// limits (multer), verifies the real content type by magic bytes, and does
// its own optimization pass — none of which trusts anything decided here,
// because anything decided here is trivially bypassed by not using this UI.
//
// What it buys: a 40MB phone photo becomes a ~2MB upload, which on a typical
// connection is the difference between a 30-second progress bar and an
// instant one.
window.AdminUpload = (function () {
  // Below this, compressing costs more (decode + re-encode + a jank frame on
  // a big image) than the transfer time it saves.
  var COMPRESS_ABOVE_BYTES = 4 * 1024 * 1024;

  // Matches MAX_WIDTH in server/src/lib/imageOptimize.js. Sending something
  // the server will immediately downscale anyway is wasted upload.
  var MAX_DIMENSION = 2560;
  var QUALITY = 0.82;

  // GIF and SVG are deliberately absent. Re-encoding a GIF through a canvas
  // keeps only the first frame — it would silently destroy every animated
  // exercise demo. SVG is vector text; a canvas would rasterize it, which is
  // a worse file and no longer the format that was chosen.
  var COMPRESSIBLE = { "image/jpeg": true, "image/png": true, "image/webp": true };

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + "MB";
    if (bytes >= 1024) return Math.round(bytes / 1024) + "KB";
    return bytes + " bytes";
  }

  function canCompress(file) {
    return !!(
      file &&
      COMPRESSIBLE[file.type] &&
      file.size > COMPRESS_ABOVE_BYTES &&
      window.createImageBitmap &&
      window.HTMLCanvasElement
    );
  }

  // Returns a Promise for either a smaller File or — on any failure, any
  // format it won't touch, or any result that isn't actually smaller — the
  // ORIGINAL file, unchanged. Compression is an optimization, so it must never
  // be the reason an upload fails.
  function maybeCompressImage(file) {
    if (!canCompress(file)) return Promise.resolve(file);

    // imageOrientation:"from-image" applies the EXIF rotation while decoding.
    // Without it, every portrait photo from a phone is re-encoded on its side,
    // because the canvas drops the EXIF tag that was describing the rotation.
    return createImageBitmap(file, { imageOrientation: "from-image" })
      .then(function (bitmap) {
        var scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
        var width = Math.round(bitmap.width * scale);
        var height = Math.round(bitmap.height * scale);

        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, width, height);
        if (bitmap.close) bitmap.close();

        return new Promise(function (resolve) {
          canvas.toBlob(
            function (blob) {
              // Keep whichever is smaller. Re-encoding can lose: a PNG
              // screenshot of flat colour is often already smaller than
              // anything a canvas will produce.
              if (!blob || blob.size >= file.size) return resolve(file);
              var compressed = new File([blob], file.name, {
                type: file.type,
                lastModified: Date.now(),
              });
              compressed.wasCompressed = true;
              compressed.originalSize = file.size;
              resolve(compressed);
            },
            file.type,
            QUALITY
          );
        });
      })
      .catch(function () {
        return file;
      });
  }

  // Human-readable note for the UI, or "" when nothing was compressed.
  function compressionNote(file) {
    if (!file || !file.wasCompressed) return "";
    return "Compressed " + formatBytes(file.originalSize) + " → " + formatBytes(file.size) + " before upload";
  }

  return {
    maybeCompressImage: maybeCompressImage,
    compressionNote: compressionNote,
    formatBytes: formatBytes,
    canCompress: canCompress,
    MAX_DIMENSION: MAX_DIMENSION,
  };
})();
