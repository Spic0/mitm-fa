// MP4 + WebM derivatives for gated program media (exercise demo GIFs).
//
// This is the third media module and the boundary between them is by TOOL,
// not by file type:
//
//   lib/mediaDerivatives.js  public product imagery      sharp   (responsive stills)
//   lib/animatedMedia.js     gated demos, still frames   sharp   (poster/thumb/anim)
//   lib/videoDerivatives.js  gated demos, motion         ffmpeg  (mp4/webm)   <- here
//
// WHY VIDEO AND NOT JUST THE ANIMATED WEBP
//
// The animated WebP already took a 15.5MB GIF to ~226KB, so this is not
// primarily about bytes. It is about what the browser will let us DO with the
// result. An <img> playing an animated WebP cannot be paused, cannot have its
// decoded frames released, and has no preload control. A handbook with 70-100
// demos therefore accumulates decoded animation buffers that nothing can
// reclaim, and keeps decoding them on the main thread. <video> is pausable,
// releasable (drop src + load()), hardware-decoded, and honours
// preload="metadata". At 6 demos that difference is invisible; at 70 it is the
// whole ballgame.
//
// Bytes improve too. Measured over the six real demos in the largest program:
//
//   originals        74,048 KB
//   anim.webp         1,090 KB   (what we serve today)
//   mp4  @450k          623 KB
//   webm vp9 crf34      520 KB   <- what Chrome/Firefox/Android get
//
// ENCODER CHOICE
//
// This box has ffmpeg-free, which has no libx264 (patent-encumbered and not in
// any configured repo). H.264 comes from libopenh264 instead. It is less
// efficient than x264 — at matched quality it costs roughly 30% more bits —
// but it is the only patent-cleared H.264 encoder available, and H.264 is not
// optional: it is the ONLY one of these two formats iOS Safari will play.
//
// Bitrate/CRF were picked from measured SSIM against a high-bitrate reference,
// not by feel:
//
//   mp4 350k  SSIM 0.9676   99KB
//   mp4 450k  SSIM 0.9703  128KB   <- knee; +150k buys +0.001
//   mp4 600k  SSIM 0.9713  170KB
//   webm 34   SSIM 0.9714   84KB   (VP9 matches mp4@600k at half the size)
//
// Everything here is best-effort and never throws. The verified original is
// always on disk and serveable, the poster/anim path still works, and the
// handbook falls back to <img> for any demo that has no video derivative — so
// a program uploaded before this existed, or one whose transcode failed,
// renders exactly as it did before.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// Same width as the animated WebP it replaces: a demo box is ~400 CSS px, and
// 640 covers it at 1.5x while staying legible in the fullscreen lightbox.
const VIDEO_WIDTH = 640;
const MP4_BITRATE = "450k";
const VP9_CRF = 34;

// A 15MB GIF transcodes in ~1s. Ten times that means something has gone wrong
// (a corrupt file that ffmpeg is chewing on, a pathological frame count), and
// this runs on the same box that serves requests.
const TIMEOUT_MS = 60_000;

let ffmpegState = "unloaded";
let ffmpegPath = null;

// Resolved once. `ffmpeg -version` rather than a PATH lookup, because a
// binary that exists but cannot execute is the same as no binary here, and we
// would rather find that out at boot than inside a job.
function loadFfmpeg() {
  if (ffmpegState === "unloaded") {
    const candidate = process.env.FFMPEG_PATH || "ffmpeg";
    try {
      require("child_process").execFileSync(candidate, ["-version"], { stdio: "ignore", timeout: 10_000 });
      ffmpegPath = candidate;
      ffmpegState = "ready";
    } catch (err) {
      ffmpegState = "unavailable";
      console.warn("[videoDerivatives] ffmpeg unavailable — demos stay on the animated-WebP path.");
    }
  }
  return ffmpegState === "ready" ? ffmpegPath : null;
}

function isAvailable() {
  return !!loadFfmpeg();
}

function mp4PathFor(filePath) {
  return filePath.replace(/\.[^.]+$/, "") + "-vid.mp4";
}
function webmPathFor(filePath) {
  return filePath.replace(/\.[^.]+$/, "") + "-vid.webm";
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || "").slice(-400)));
      resolve(stdout);
    });
  });
}

// scale to VIDEO_WIDTH, and force EVEN dimensions — H.264 with yuv420p cannot
// encode an odd width or height, and a GIF is under no obligation to be even.
const SCALE = `scale=${VIDEO_WIDTH}:-2:flags=lanczos`;

function mp4Args(src, out) {
  return [
    "-y", "-v", "error",
    "-i", src,
    "-an",                        // demos are silent; never carry an audio track
    "-vf", SCALE,
    "-pix_fmt", "yuv420p",        // the only chroma format Safari reliably decodes
    "-c:v", "libopenh264",
    "-b:v", MP4_BITRATE,
    "-movflags", "+faststart",    // moov atom first, so preload="metadata" is one small range request
    out,
  ];
}

function webmArgs(src, out) {
  return [
    "-y", "-v", "error",
    "-i", src,
    "-an",
    "-vf", SCALE,
    "-c:v", "libvpx-vp9",
    "-crf", String(VP9_CRF), "-b:v", "0",   // constant-quality mode
    "-row-mt", "1", "-cpu-used", "4",       // knee of the speed/size curve for a background job
    out,
  ];
}

// Generates MP4 + WebM for one already-verified animated upload.
// Returns a manifest fragment; never throws.
async function generateVideoDerivatives(filePath, mime) {
  const bin = loadFfmpeg();
  if (!bin) return { skipped: "no-ffmpeg" };

  const result = {};
  let originalBytes = 0;
  try {
    originalBytes = (await fs.promises.stat(filePath)).size;
  } catch (err) {
    return { skipped: "unreadable" };
  }

  const targets = [
    { key: "mp4", out: mp4PathFor(filePath), args: mp4Args },
    { key: "webm", out: webmPathFor(filePath), args: webmArgs },
  ];

  for (const t of targets) {
    try {
      await run(bin, t.args(filePath, t.out));
      const { size } = await fs.promises.stat(t.out);
      // Never ship a "derivative" larger than what it replaces. A short,
      // already-tiny GIF can transcode bigger than the original.
      if (size > 0 && size < originalBytes) {
        result[t.key] = { bytes: size, width: VIDEO_WIDTH };
      } else {
        await fs.promises.unlink(t.out).catch(() => {});
      }
    } catch (err) {
      console.error(`[videoDerivatives] ${t.key} failed for ${path.basename(filePath)}:`, err.message);
      await fs.promises.unlink(t.out).catch(() => {});
    }
  }

  return result;
}

module.exports = {
  generateVideoDerivatives,
  isAvailable,
  mp4PathFor,
  webmPathFor,
  VIDEO_WIDTH,
};
