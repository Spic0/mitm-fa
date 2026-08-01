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
// 640 covers it at 1.5x.
const VIDEO_WIDTH = 640;
const MP4_BITRATE = "450k";
const VP9_CRF = 34;

// TWO RENDITIONS, AND WHY
//
// 640 covers the inline tile and nothing else. The comment above used to claim
// it also stayed "legible in the fullscreen lightbox"; measured against the
// source, that was wrong. Upscaled to a 1280-wide viewer the tile rendition
// scores SSIM 0.960 where a native 1280 encode scores 0.976 — and unlike the
// SSIM deltas between CRF values, that gap is the visible one, because it is
// resolution rather than quantisation. It shows up exactly where this content
// lives: limbs and barbells moving against a gym background.
//
// So the tile rendition stays EXACTLY as it is (it is the right answer for a
// 400px box and it is what the whole byte budget is built on) and fullscreen
// gets its own file, fetched only when someone actually taps a demo.
//
// Measured on two real demos, SSIM vs a lossless 1280x720 reference:
//
//   -vid 640 upscaled   0.960 / 0.964    84KB / 112KB   <- fullscreen today
//   vp9 crf34           0.972 / 0.978   200KB / 257KB
//   vp9 crf30           0.975 / 0.980   285KB / 350KB
//   vp9 crf28           0.976 / 0.981   330KB / 400KB   <- chosen
//   vp9 crf26           0.977 / 0.982   382KB / 459KB
//   vp9 crf24           0.979 / 0.983   463KB / 544KB
//   openh264 1200k      0.971 / 0.973   339KB / 322KB
//   openh264 1800k      0.975 / 0.978   507KB / 476KB
//   openh264 2500k      0.977 / 0.981   708KB / 663KB   <- chosen
//   openh264 3500k      0.979 / 0.982   989KB / 902KB
//
// CRF 28 is six steps below the tile's 34 and lands where the VP9 curve has
// gone flat: crf26 buys +0.001 for another 52KB. 2500k is picked to MATCH it
// rather than to hit a byte target — an iPhone and an Android phone showing
// the same demo should show the same thing, and openh264 needs roughly twice
// the bits of VP9 to get there (which is the same ~2x penalty the tile
// rendition pays). Past that point openh264 costs ~280KB per +0.002.
//
// Fullscreen is one clip, on demand, one at a time. It is the one place in
// this pipeline where fidelity outranks bytes.
const HD_LONG_EDGE = 1280;
const HD_MP4_BITRATE = "2500k";
const HD_VP9_CRF = 28;

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
function hdMp4PathFor(filePath) {
  return filePath.replace(/\.[^.]+$/, "") + "-hd.mp4";
}
function hdWebmPathFor(filePath) {
  return filePath.replace(/\.[^.]+$/, "") + "-hd.webm";
}

// The HD target: the source's long edge capped at 1280, NEVER enlarged, and
// even on both axes because H.264 with yuv420p cannot encode an odd dimension.
//
// This is computed here in JS rather than with a `min(iw,1280)` expression in
// the scale filter so that one function decides the number and the manifest
// can record it without probing the encoded file afterwards. Returns null when
// the source dimensions are unknown — HD is optional and the viewer falls back
// to the tile rendition, which is a better outcome than guessing.
function hdDimensions(width, height) {
  if (!width || !height) return null;
  const factor = Math.min(1, HD_LONG_EDGE / Math.max(width, height));
  const even = (n) => Math.max(2, Math.round((n * factor) / 2) * 2);
  return { width: even(width), height: even(height) };
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

// No -r anywhere in here, deliberately: the source fps is preserved and no
// frame is dropped. A demo is one or two seconds of movement and dropping
// frames is exactly the artefact this content cannot afford.
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

const hdScale = (dim) => `scale=${dim.width}:${dim.height}:flags=lanczos`;

function hdMp4Args(dim) {
  return (src, out) => [
    "-y", "-v", "error",
    "-i", src,
    "-an",
    "-vf", hdScale(dim),
    "-pix_fmt", "yuv420p",
    "-c:v", "libopenh264",
    "-b:v", HD_MP4_BITRATE,
    "-movflags", "+faststart",
    out,
  ];
}

function hdWebmArgs(dim) {
  return (src, out) => [
    "-y", "-v", "error",
    "-i", src,
    "-an",
    "-vf", hdScale(dim),
    "-c:v", "libvpx-vp9",
    "-crf", String(HD_VP9_CRF), "-b:v", "0",
    "-row-mt", "1", "-cpu-used", "4",
    out,
  ];
}

// Generates the tile renditions (MP4 + WebM at 640) and, when the source is
// big enough to be worth it, the fullscreen ones (-hd.mp4 / -hd.webm).
//
// opts.width / opts.height are the SOURCE dimensions; without them the HD pair
// is skipped rather than guessed. opts.only === "hd" regenerates just the HD
// pair and leaves the tile files untouched on disk — which matters more than
// it looks: those files are served `immutable` for a year, so rewriting their
// bytes under the same name is something to do deliberately, never as a side
// effect of adding a rendition beside them.
//
// Returns a manifest fragment; never throws.
async function generateVideoDerivatives(filePath, mime, opts = {}) {
  const bin = loadFfmpeg();
  if (!bin) return { skipped: "no-ffmpeg" };

  const result = {};
  let originalBytes = 0;
  try {
    originalBytes = (await fs.promises.stat(filePath)).size;
  } catch (err) {
    return { skipped: "unreadable" };
  }

  const targets = [];
  if (opts.only !== "hd") {
    targets.push(
      { key: "mp4", out: mp4PathFor(filePath), args: mp4Args },
      { key: "webm", out: webmPathFor(filePath), args: webmArgs },
    );
  }

  // A source at or below the tile width has no fullscreen rendition to give:
  // the HD encode would be the same pixels at a bigger file size, and the
  // viewer falling back to -vid is the honest outcome.
  const hd = hdDimensions(opts.width, opts.height);
  if (hd && hd.width > VIDEO_WIDTH) {
    targets.push(
      { key: "hdmp4", out: hdMp4PathFor(filePath), args: hdMp4Args(hd), dim: hd },
      { key: "hdwebm", out: hdWebmPathFor(filePath), args: hdWebmArgs(hd), dim: hd },
    );
  }

  for (const t of targets) {
    try {
      await run(bin, t.args(filePath, t.out));
      const { size } = await fs.promises.stat(t.out);
      // Never ship a "derivative" larger than what it replaces. A short,
      // already-tiny GIF can transcode bigger than the original.
      if (size > 0 && size < originalBytes) {
        result[t.key] = t.dim
          ? { bytes: size, width: t.dim.width, height: t.dim.height }
          : { bytes: size, width: VIDEO_WIDTH };
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
  hdMp4PathFor,
  hdWebmPathFor,
  hdDimensions,
  VIDEO_WIDTH,
  HD_LONG_EDGE,
};
