// Renders every transactional email in a real browser and checks the things
// that actually break in mail clients: an image that does not load, a table
// wider than the phone it is read on, text clipped out of its box.
//
// Mail clients are not Chrome, so this cannot prove Outlook. What it does
// prove is that the markup is sound, every asset URL resolves over the public
// internet, and the layout holds at the widths people read mail on. Client
// specific behaviour is handled by construction instead: tables, inline
// styles, no WebP/AVIF, no flexbox.
//
//   node test-email-rendering.js [--dir /path/to/rendered/emails] [--shots]
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DIR = arg("--dir", "/tmp/claude-0/-root/81bccab9-f66d-4016-9fb8-0989a4d859fd/scratchpad/emails");
const SHOTS = arg("--shots", "/tmp/claude-0/-root/81bccab9-f66d-4016-9fb8-0989a4d859fd/scratchpad/email-shots");

const PHONE = [320, 375, 390, 430];
const DESKTOP = [600, 800];

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail !== undefined && detail !== "" ? "  — " + detail : ""}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  return path.join(root, builds[builds.length - 1], "chrome-linux64", "chrome");
}

(async () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".html")).sort();
  if (!files.length) throw new Error(`no rendered emails in ${DIR} — run send-test-emails.js first`);
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  for (const file of files) {
    const key = file.replace(/\.html$/, "");
    const html = fs.readFileSync(path.join(DIR, file), "utf8");
    console.log(`\n---- ${key} ----`);

    // Source-level rules that no screenshot would catch.
    check("no WebP or AVIF image (Outlook renders neither)", !/\.(webp|avif)("|')/i.test(html));
    check("no SVG image (Gmail strips it)", !/<img[^>]+\.svg/i.test(html));
    check("logo is the official mark, not text", /fa-logo-email\.png/.test(html));
    check("every asset URL is absolute", !/(src|href)="\/(?!\/)/.test(html));
    check("no server filesystem path leaked", !/\/var\/www/.test(html) && !/ideja/i.test(html));
    check("no old brand name", !/ProFit|Odor/i.test(html.replace(/ProFitAPI/g, "")));
    check("has a preheader", /max-height:0/.test(html));
    check("footer carries the company block", /Winnipeg, Canada/.test(html) && /office@fitness\.agency/.test(html));

    for (const width of [...PHONE, ...DESKTOP]) {
      const page = await browser.newPage();
      // The app 301s anything without this to https, and an image request the
      // browser makes on its own cannot carry it — against a local origin
      // that redirect fails the TLS handshake and reads as "logo broken".
      // Harmless against production, where nginx sets it anyway.
      await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
      await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
      const failed = [];
      page.on("requestfailed", (r) => failed.push(r.url()));
      await page.setContent(html, { waitUntil: "networkidle0" });
      await wait(250);

      const state = await page.evaluate(() => {
        const imgs = Array.from(document.images).map((i) => ({
          src: i.currentSrc || i.src,
          loaded: i.complete && i.naturalWidth > 0,
          w: Math.round(i.getBoundingClientRect().width),
        }));
        // Anything painting past the viewport edge is a horizontal scrollbar
        // in a mail client, which is the classic broken-email symptom.
        const over = [];
        document.querySelectorAll("table, td, img, p, h1, a").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
            over.push({ tag: el.tagName.toLowerCase(), right: Math.round(r.right) });
          }
        });
        // Text taller than its own box means a clipped line.
        const clipped = [];
        document.querySelectorAll("td, p, h1").forEach((el) => {
          if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflow === "hidden") {
            clipped.push(el.tagName.toLowerCase());
          }
        });
        const btns = Array.from(document.querySelectorAll("a")).filter((a) => /padding/.test(a.getAttribute("style") || ""));
        return {
          imgs,
          overflow: over,
          clipped,
          docWidth: Math.round(document.documentElement.scrollWidth),
          minBtnHeight: btns.length ? Math.min(...btns.map((b) => Math.round(b.getBoundingClientRect().height))) : null,
        };
      });

      const label = `@${width}`;
      check(`${label} every image loads`, state.imgs.every((i) => i.loaded),
        state.imgs.filter((i) => !i.loaded).map((i) => i.src).join(",") || `${state.imgs.length} image(s)`);
      check(`${label} no horizontal overflow`, state.docWidth <= width && state.overflow.length === 0,
        `doc=${state.docWidth} over=${state.overflow.length}`);
      check(`${label} no clipped text`, state.clipped.length === 0, state.clipped.join(","));
      if (state.minBtnHeight !== null) {
        check(`${label} buttons stay tappable (>=44px)`, state.minBtnHeight >= 44, `${state.minBtnHeight}px`);
      }
      check(`${label} no failed requests`, failed.length === 0, failed.slice(0, 2).join(","));

      if (width === 390 || width === 600) {
        await page.screenshot({ path: path.join(SHOTS, `${key}-${width}.png`), fullPage: true });
      }
      await page.close();
    }
  }

  await browser.close();
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : `\nAll email rendering checks passed (${files.length} templates)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
