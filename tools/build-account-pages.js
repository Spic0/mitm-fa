// Composes the four customer-area pages from the site's existing page shell.
//
// The shell — <head>, the shared-header marker, the cart drawer, the
// preloader, the footer and the whole script list — is LIFTED from a
// snapshot of the site's own page shell rather than retyped. That file is a known-good page that
// already loads the right stylesheets in the right order and mounts the cart,
// the branding hooks and the nav. Retyping ~120 lines of it four times is how
// four pages end up with three slightly different script lists, one of which
// is missing api.js and fails at runtime in a way nothing catches.
//
// So: this reads the shell once, and writes each page as
//   shell head + chrome  +  <main> that page's body </main>  +  shell tail
// with a per-page <title>, a per-page stylesheet and a per-page script.
//
// Re-run it after editing any body in bodies/, or after the shell page's own
// head/footer changes:
//
//   node build-account-pages.js
//
// It is a build step, not a runtime dependency: the output .html files are
// committed and served directly.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
// A SNAPSHOT of the shell, not a live page. Reading the shell from
// my-library.html would be circular — that file is also an output of this
// script, so the second run would read back its own injected stylesheets and
// its replaced script line. This copy is the stable input; refresh it
// deliberately (cp my-library.html tools/account-shell.html) when the site
// shell genuinely changes, then re-run.
const SHELL_SRC = path.join(__dirname, "account-shell.html");
const BODY_DIR = path.join(__dirname, "account-bodies");

function readShell() {
  const html = fs.readFileSync(SHELL_SRC, "utf8");

  // Boundaries are structural markers, not line numbers — line numbers would
  // silently pick up the wrong slice the first time the shell page grows.
  const bodyOpen = html.indexOf("<body>");
  const mainOpen = html.indexOf("<main>");
  const mainClose = html.lastIndexOf("</main>");
  if (bodyOpen === -1 || mainOpen === -1 || mainClose === -1) {
    throw new Error("Could not find <body>/<main> boundaries in the shell page");
  }

  return {
    // <!doctype> .. </head><body> .. everything before <main>
    head: html.slice(0, mainOpen),
    // </main> .. </html>
    tail: html.slice(mainClose),
  };
}

// Per-page: the <title>, the extra stylesheet(s) and the page script.
// account.css is on every one of them; anything else is named explicitly.
const PAGES = [
  {
    file: "my-library.html",
    body: "my-library.body.html",
    title: "My Library",
    styles: ["/assets/css/media-container.css", "/assets/css/account.css"],
    scripts: ["/assets/js/account-common.js", "/assets/js/my-library.js"],
  },
  {
    file: "my-profile.html",
    body: "my-profile.body.html",
    title: "My Profile",
    styles: ["/assets/css/account.css"],
    // countries.js is the checkout's own country reference data — reused
    // so the profile's country list cannot disagree with the checkout's.
    scripts: ["/assets/js/countries.js", "/assets/js/account-common.js", "/assets/js/my-profile.js"],
  },
  {
    file: "orders.html",
    body: "orders.body.html",
    title: "My Orders",
    styles: ["/assets/css/account.css"],
    scripts: ["/assets/js/account-common.js", "/assets/js/orders.js"],
  },
  {
    file: "order-success.html",
    body: "order-success.body.html",
    title: "Order Confirmed",
    styles: ["/assets/css/media-container.css", "/assets/css/account.css"],
    scripts: ["/assets/js/account-common.js", "/assets/js/order-success.js"],
  },
  {
    file: "welcome.html",
    body: "welcome.body.html",
    title: "Welcome",
    styles: ["/assets/css/account.css"],
    scripts: ["/assets/js/countries.js", "/assets/js/account-common.js", "/assets/js/welcome.js"],
    // The wizard is a focused, single-task flow. The site header is already
    // hidden for it server-side (HIDDEN_HEADER_PAGES); the footer has to go
    // for the same reason and would otherwise hang a full sitemap — Support,
    // Company, Legal, Social — underneath a half-finished account setup.
    bare: true,
  },
];

// The shell page's own script list ends with my-library.js. Every generated
// page replaces that ONE line with its own scripts, so all the shared
// machinery above it (api.js, media-container.js, script.js, branding.js,
// cart drawer) is inherited rather than restated.
const SHELL_PAGE_SCRIPT = '    <script src="/assets/js/my-library.js" defer></script>';

function build() {
  const shell = readShell();
  const written = [];

  for (const page of PAGES) {
    const bodyPath = path.join(BODY_DIR, page.body);
    const body = fs.readFileSync(bodyPath, "utf8").trimEnd();

    let head = shell.head;

    // Title: both the visible text and the data-brand-title template the
    // branding script rewrites when the site name changes.
    head = head.replace(
      /<title data-brand-title="\{brand\} - [^"]*">[^<]*<\/title>/,
      `<title data-brand-title="{brand} - ${page.title}">Fitness Agency - ${page.title}</title>`
    );

    // Stylesheets go last in <head> so they win over style.css without
    // needing !important anywhere.
    const styleTags = page.styles
      .map((href) => `    <link rel="stylesheet" href="${href}">`)
      .join("\n");
    head = head.replace("</head>", `${styleTags}\n</head>`);

    let tail = shell.tail;

    // `bare` strips the page furniture between </main> and the scripts: the
    // footer and the back-to-top control. Done here rather than with CSS
    // because the footer is a SIBLING of <main>, so nothing inside the page
    // body can reach it — and because not shipping it is better than
    // shipping it hidden.
    if (page.bare) {
      const footerStart = tail.indexOf("<footer");
      const footerEnd = tail.lastIndexOf("</footer>");
      if (footerStart === -1 || footerEnd === -1) {
        throw new Error("bare page: could not find the shell footer to strip");
      }
      tail = tail.slice(0, footerStart) + tail.slice(footerEnd + "</footer>".length);
      tail = tail.replace(/<div class="scroll-up">[\s\S]*?<\/div>/, "");
    }

    const scriptTags = page.scripts
      .map((src) => `    <script src="${src}" defer></script>`)
      .join("\n");
    if (!tail.includes(SHELL_PAGE_SCRIPT)) {
      throw new Error("Shell page script line not found — update SHELL_PAGE_SCRIPT");
    }
    tail = tail.replace(SHELL_PAGE_SCRIPT, scriptTags);

    const out = `${head}<main>\n${body}\n    </main>${tail}`;
    fs.writeFileSync(path.join(ROOT, page.file), out);
    written.push(`${page.file}  (${out.length} bytes)`);
  }

  console.log("Built:\n  " + written.join("\n  "));
}

build();
