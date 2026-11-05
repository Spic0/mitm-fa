// ?demo=1: the /partnership demo viewer frames REAL pages (storefront,
// product, plan preview) and they must stay real, so demo mode only ever
// SUBTRACTS:
//   * never indexed: X-Robots-Tag + <meta robots noindex>, and a canonical
//     to the clean URL when the page has none (the ones it frames already do);
//   * never sells: checkout (page and API) answers 403, and
//     assets/js/demo-mode.js disables every buy, add-to-cart and checkout
//     control in the page and blocks /api/checkout before it reaches the network;
//   * never counted: the PostHog scripts are stripped, so a demo click is not a
//     product view. The viewer page tracks the demo itself.
// Every replacement uses a function replacer: a "$" in page content must
// never be read as a replacement pattern (see fillBetween in routes/pages.js).
const SITE_ORIGIN = "https://fitness.agency";
const HEAD_TAGS =
  '<meta name="robots" content="noindex">' +
  '<link rel="stylesheet" href="/assets/css/demo-mode.css?v=20261105">' +
  '<script src="/assets/js/demo-mode.js?v=20261105"></script>';

function isDemoRequest(req) {
  return req.query.demo === "1" || req.get("x-fa-demo") === "1";
}

function isCheckoutPath(p) {
  return p === "/checkout" || p.startsWith("/checkout.") || p.startsWith("/checkout/") || p.startsWith("/api/checkout");
}

function cleanUrl(req) {
  const params = new URLSearchParams(req.query);
  params.delete("demo");
  const qs = params.toString();
  return SITE_ORIGIN + req.path + (qs ? "?" + qs : "");
}

function demoHtml(html, req) {
  let out = html
    .replace(/<meta\s+name=["']robots["'][^>]*>/gi, () => "")
    .replace(/<script\s+src="\/assets\/vendor\/posthog\/[^"]*"[^>]*><\/script>/g, () => "")
    .replace(/<script\s+src="\/assets\/js\/analytics\.js"[^>]*><\/script>/g, () => "")
    .replace(/<html\b/i, () => '<html data-demo="1"');
  let tags = HEAD_TAGS;
  if (!/<link\s+rel=["']canonical["']/i.test(out)) tags += `<link rel="canonical" href="${cleanUrl(req).replace(/"/g, "&quot;")}">`;
  // Right after the charset (which must stay first), before any page script.
  if (/<meta\s+charset[^>]*>/i.test(out)) return out.replace(/<meta\s+charset[^>]*>/i, (m) => m + tags);
  return out.replace(/<head\b[^>]*>/i, (m) => m + tags);
}

function demoMode(req, res, next) {
  const demo = isDemoRequest(req);
  // Checkout is never rendered inside a frame, demo flag or not: a script
  // navigation inside the viewer (script.js's Buy Now sets location.href
  // without the flag) must still land on a refusal, not a live payment form.
  const framed = req.get("sec-fetch-dest") === "iframe";
  if ((demo || framed) && isCheckoutPath(req.path)) {
    const msg = "Demo: checkout disabled";
    res.set("X-Robots-Tag", "noindex");
    return req.path.startsWith("/api/") ? res.status(403).json({ error: msg }) : res.status(403).type("text").send(msg);
  }
  if (!demo) return next();
  res.set("X-Robots-Tag", "noindex");
  const send = res.send.bind(res);
  res.send = function (body) {
    if (typeof body === "string" && /^text\/html/i.test(res.get("Content-Type") || "")) body = demoHtml(body, req);
    return send(body);
  };
  next();
}

module.exports = { demoMode, demoHtml, isDemoRequest };
