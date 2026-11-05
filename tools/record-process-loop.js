// Exports the /partnership "What you get" process diagram as a looping GIF
// and webm for social and sales use (not loaded by the page):
//   assets/images/partnership/process-loop.{gif,webm}           1200x675
//   assets/images/partnership/process-loop-portrait.{gif,webm}  1080x1350
//
// It renders the REAL section from a running server, alone on the page, and
// steps the diagram's own clock (root.ptProcess.draw(t), assets/js/pt-process.js)
// frame by frame, so every frame is exact and the loop closes on itself.
// Needs ffmpeg. Budgets: GIF <= 2 MB, webm <= 1 MB (checked at the end).
//
//   node record-process-loop.js [--base http://127.0.0.1:3200] [--tmp DIR]
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const puppeteer = require("puppeteer-core");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:3200");
const TMP = arg("--tmp", os.tmpdir()); // where the PNG frames go (deleted after)
const OUT = path.join(__dirname, "..", "assets", "images", "partnership");
const FPS = 20;
const GIF_FPS = 12;
// cssWidth picks the layout: >= 1024 is the snake, below it the timeline.
const FORMATS = [
  { name: "process-loop", w: 1200, h: 675, cssWidth: 1440 },
  { name: "process-loop-portrait", w: 1080, h: 1350, cssWidth: 760 },
];

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const build = fs.readdirSync(root).sort().pop();
  return path.join(root, build, "chrome-linux64", "chrome");
}

// The section alone: no header, footer or demo button, everything revealed,
// vertically centred in the frame.
async function isolate(page) {
  await page.evaluate(() => {
    const sec = document.querySelector(".pt-proc-sec");
    const main = document.createElement("main");
    main.className = "pt";
    main.appendChild(sec);
    const act = sec.querySelector(".pt-actions");
    if (act) act.remove();
    document.body.replaceChildren(main);
    document.documentElement.classList.remove("reveal-on");
    sec.querySelectorAll("[data-reveal]").forEach((e) => e.classList.add("is-revealed"));
    sec.style.cssText = "min-height:100vh;display:flex;align-items:center;padding:40px 0;box-sizing:border-box;";
    sec.firstElementChild.style.width = "100%";
    document.body.style.cssText = "margin:0;background:#0a0a09;overflow:hidden;";
  });
}

(async () => {
  if (!fs.existsSync("/usr/bin/ffmpeg")) throw new Error("ffmpeg not found");
  const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const results = [];
  try {
    for (const fmt of FORMATS) {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
      // Measure the content at the chosen CSS width, then scale it to fit the frame.
      await page.setViewport({ width: fmt.cssWidth, height: 2000, deviceScaleFactor: 1 });
      await page.goto(BASE + "/partnership", { waitUntil: "networkidle0" });
      await isolate(page);
      await page.evaluate(() => document.fonts.ready);
      const contentH = await page.evaluate(() => {
        const sec = document.querySelector(".pt-proc-sec");
        sec.style.minHeight = "0";
        const h = sec.getBoundingClientRect().height;
        sec.style.minHeight = "100vh";
        return h;
      });
      const dpr = Math.min(fmt.w / fmt.cssWidth, fmt.h / contentH);
      await page.setViewport({ width: Math.round(fmt.w / dpr), height: Math.round(fmt.h / dpr), deviceScaleFactor: dpr });
      await new Promise((r) => setTimeout(r, 400));
      const loop = await page.evaluate(() => {
        const root = document.querySelector("[data-process]");
        root.ptProcess.stop();
        root.ptProcess.build();
        return root.ptProcess.loop;
      });

      const dir = fs.mkdtempSync(path.join(TMP, "proc-"));
      const frames = Math.round((loop / 1000) * FPS);
      for (let i = 0; i < frames; i++) {
        await page.evaluate((t) => document.querySelector("[data-process]").ptProcess.draw(t), (i * 1000) / FPS);
        await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`) });
      }
      await page.close();

      const input = path.join(dir, "f%04d.png");
      const webm = path.join(OUT, fmt.name + ".webm");
      const gif = path.join(OUT, fmt.name + ".gif");
      const size = `${fmt.w}:${fmt.h}`;
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", input, "-vf", `scale=${size}:flags=lanczos`, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "42", "-row-mt", "1", "-pix_fmt", "yuv420p", "-an", webm]);
      const palette = path.join(dir, "palette.png");
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", input, "-vf", `fps=${GIF_FPS},scale=${size}:flags=lanczos,palettegen=max_colors=48:stats_mode=diff`, palette]);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", input, "-i", palette, "-lavfi", `fps=${GIF_FPS},scale=${size}:flags=lanczos[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`, "-loop", "0", gif]);
      fs.rmSync(dir, { recursive: true, force: true });
      results.push({ fmt, gif: fs.statSync(gif).size, webm: fs.statSync(webm).size, frames, dpr });
    }
  } finally {
    await browser.close();
  }
  let over = 0;
  for (const r of results) {
    const gifOk = r.gif <= 2 * 1024 * 1024;
    const webmOk = r.webm <= 1024 * 1024;
    if (!gifOk || !webmOk) over++;
    console.log(`${r.fmt.name} ${r.fmt.w}x${r.fmt.h}: gif ${(r.gif / 1024).toFixed(0)} KB${gifOk ? "" : " OVER 2 MB"}, webm ${(r.webm / 1024).toFixed(0)} KB${webmOk ? "" : " OVER 1 MB"} (${r.frames} frames, css scale ${r.dpr.toFixed(3)})`);
  }
  process.exit(over ? 1 : 0);
})();
