// The Fitness Agency transactional email design system.
//
// ONE shell and ONE set of components for every message the platform sends,
// so a customer who has seen the site recognises the email before reading a
// word of it. Nothing here is designed per-email: a template chooses an
// eyebrow, a heading, and which of these blocks it needs.
//
// Email clients are not browsers. Outlook renders through Word, Gmail strips
// <style> in several contexts, and none of them can be relied on for flexbox,
// grid, or web fonts. So this is table-based with inline styles — the one
// approach that survives everywhere — and the <style> block carries only
// progressive enhancement (the mobile breakpoint) that degrades harmlessly
// when stripped. Border radius is used freely because Outlook simply ignores
// it and renders square corners, which is a fine degradation. WebP and AVIF
// are never used: Outlook cannot display either, which also rules out the
// site's own product derivatives.
//
// Colours are the site's palette (assets/css/style.css :root), resolved to
// solid hex because email cannot do custom properties and several clients
// mishandle rgba() in inline styles.

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(cents, currency) {
  const amount = (Number(cents || 0) / 100).toFixed(2);
  return `${currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$"}${amount}`;
}

// The site's tokens. --color-border is rgba(26,26,26,0.1) over #fdfdfc, which
// is #e8e7e4 solid; the muted/faint pair are --color-text-muted and
// --color-text-faint verbatim.
const BRAND = {
  ink: "#1a1a1a",
  body: "#55534f",
  faint: "#9c9993",
  line: "#e8e7e4",
  bg: "#f2f1ee",
  card: "#ffffff",
  panel: "#faf9f7",
  accent: "#1a1a1a",
  success: "#0d6b46",
  successBg: "#e3efe9",
};

// No web font survives Outlook, and a font that half-loads is worse than one
// that never tries. Inter first for the clients that have it (it is the
// site's face), then the native UI stack, which is what the rest will use.
const FONT = "'Montserrat',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const COMPANY = {
  name: "Fitness Agency",
  city: "Winnipeg, Canada",
};

// A "bulletproof" button: a single-cell table rather than a styled <a>, the
// only form Outlook fills with a real background colour. mso-padding-alt plus
// the &nbsp; padding trick keeps the tap target intact there too.
function button(label, href, variant = "primary") {
  const solid = variant === "primary";
  const bg = solid ? BRAND.accent : BRAND.card;
  const fg = solid ? "#ffffff" : BRAND.ink;
  const border = solid ? BRAND.accent : BRAND.line;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="fa-btn" style="margin:0 0 12px;">
      <tr>
        <td align="center" bgcolor="${bg}" style="border-radius:10px;border:1px solid ${border};mso-padding-alt:16px 30px;">
          <a href="${esc(href)}" class="fa-btn__a"
             style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:${fg};text-decoration:none;border-radius:10px;mso-line-height-rule:exactly;">
            ${esc(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

// Primary and secondary CTAs, side by side on desktop and stacked on a phone.
function buttonPair(primary, secondary) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px;">
      <tr>
        <td class="fa-stack" style="padding-right:10px;">${button(primary.label, primary.href, "primary")}</td>
        <td class="fa-stack">${button(secondary.label, secondary.href, "secondary")}</td>
      </tr>
    </table>`;
}

// Quiet surface for security notes and references. Deliberately not a tinted
// "alert" box — nothing here is an alert.
function panel(html) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:22px 0;">
    <tr><td style="background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:12px;padding:16px 18px;font-family:${FONT};font-size:14px;line-height:1.6;color:${BRAND.body};">${html}</td></tr>
  </table>`;
}

function eyebrow(text) {
  return `<p style="margin:0 0 10px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.faint};">${esc(text)}</p>`;
}

// Label/value pairs — order number, date, payment method. Right-aligned
// values on desktop, stacked left on a phone.
function metaRows(rows) {
  const body = rows
    .filter((r) => r && r.value)
    .map(
      (r) => `
      <tr>
        <td class="fa-stack" style="padding:9px 0;border-bottom:1px solid ${BRAND.line};font-family:${FONT};font-size:14px;color:${BRAND.body};">${esc(r.label)}</td>
        <td class="fa-stack fa-stack--right" align="right" style="padding:9px 0;border-bottom:1px solid ${BRAND.line};font-family:${FONT};font-size:14px;font-weight:600;color:${BRAND.ink};white-space:nowrap;">${esc(r.value)}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:20px 0 6px;">${body}</table>`;
}

// The purchased item, the way the site shows it: cover, name, creator.
// `imageUrl` must already be an absolute, email-safe raster (see
// lib/emailImage.js) — passing a WebP derivative here would render as a
// broken image in Outlook.
function productCard({ name, creator, imageUrl, priceLabel }) {
  const cover = imageUrl
    ? `<td width="76" style="width:76px;padding-right:16px;vertical-align:top;">
         <img src="${esc(imageUrl)}" alt="" width="76" height="76"
              style="display:block;width:76px;height:76px;border:0;border-radius:10px;object-fit:cover;background:${BRAND.panel};">
       </td>`
    : "";
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:20px 0 4px;">
      <tr>
        <td style="padding:16px;background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
            <tr>
              ${cover}
              <td style="vertical-align:top;font-family:${FONT};">
                <p style="margin:0 0 3px;font-size:16px;font-weight:700;line-height:1.3;color:${BRAND.ink};">${esc(name)}</p>
                ${creator ? `<p style="margin:0 0 6px;font-size:14px;line-height:1.4;color:${BRAND.body};">${esc(creator)}</p>` : ""}
                ${priceLabel ? `<p style="margin:0;font-size:14px;font-weight:600;color:${BRAND.ink};">${esc(priceLabel)}</p>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

// Order lines and totals.
function orderTable({ orderItems, totalCents, discountCents = 0, currency = "USD" }) {
  const rows = orderItems
    .map(
      (item) => `
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${BRAND.line};font-family:${FONT};font-size:14px;line-height:1.4;color:${BRAND.ink};">
          ${esc(item.product ? item.product.name : item.name)}
        </td>
        <td align="right" style="padding:11px 0;border-bottom:1px solid ${BRAND.line};font-family:${FONT};font-size:14px;color:${BRAND.ink};white-space:nowrap;">
          ${money(item.priceCents, currency)}
        </td>
      </tr>`
    )
    .join("");

  const subtotalCents = Number(totalCents || 0) + Number(discountCents || 0);
  const discountRow = discountCents
    ? `<tr>
         <td style="padding:8px 0 0;font-family:${FONT};font-size:14px;color:${BRAND.body};">Discount</td>
         <td align="right" style="padding:8px 0 0;font-family:${FONT};font-size:14px;color:${BRAND.success};white-space:nowrap;">&minus;${money(discountCents, currency)}</td>
       </tr>`
    : "";

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:4px 0 0;">
      ${rows}
      <tr>
        <td style="padding:12px 0 0;font-family:${FONT};font-size:14px;color:${BRAND.body};">Subtotal</td>
        <td align="right" style="padding:12px 0 0;font-family:${FONT};font-size:14px;color:${BRAND.body};white-space:nowrap;">${money(subtotalCents, currency)}</td>
      </tr>
      ${discountRow}
      <tr>
        <td style="padding:14px 0 0;font-family:${FONT};font-size:15px;font-weight:700;color:${BRAND.ink};border-top:1px solid ${BRAND.ink};">Total paid</td>
        <td align="right" style="padding:14px 0 0;font-family:${FONT};font-size:19px;font-weight:700;color:${BRAND.ink};white-space:nowrap;border-top:1px solid ${BRAND.ink};">${money(totalCents, currency)}</td>
      </tr>
    </table>`;
}

// preheader: the grey line clients show beside the subject in the inbox list.
// Left unset it fills with whatever text comes first, which for a receipt
// would be the logo's alt text, so every template sets one.
function renderLayout({ storeName, logoUrl, appUrl, supportEmail, preheader, eyebrow: eyebrowText, heading, bodyHtml }) {
  const safeStore = esc(storeName || COMPANY.name);
  const site = String(appUrl || "").replace(/\/$/, "");

  // The mark, never a text substitute. If the URL is ever missing, the alt
  // text carries the name rather than a styled wordmark pretending to be one.
  const brandMark = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${safeStore}" width="148" height="83"
            style="display:block;width:148px;height:auto;border:0;outline:none;text-decoration:none;">`
    : `<span style="font-family:${FONT};font-size:20px;font-weight:700;color:${BRAND.ink};">${safeStore}</span>`;
  const markLinked = site ? `<a href="${esc(site)}" style="text-decoration:none;border:0;">${brandMark}</a>` : brandMark;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(heading || safeStore)}</title>
<style>
  /* Enhancement only, stripped by some clients, and nothing below is load-bearing.
     560px, not 600: the card itself is 600 wide, and a max-width:600px query
     matches a client rendering at exactly that, which stacked the order rows
     on desktop. Every phone this has to hold at is 430 or narrower. */
  @media only screen and (max-width:560px) {
    .fa-wrap { width:100% !important; }
    .fa-pad { padding-left:22px !important; padding-right:22px !important; }
    .fa-h1 { font-size:24px !important; }
    .fa-stack { display:block !important; width:100% !important; text-align:left !important; }
    .fa-stack--right { text-align:left !important; padding-top:2px !important; padding-bottom:8px !important; }
    /* Full-width tap targets on a phone, where the thumb is the pointer. */
    .fa-btn { width:100% !important; }
    .fa-btn td { display:block !important; width:100% !important; }
    .fa-btn__a { display:block !important; width:auto !important; text-align:center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;color:${BRAND.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader || "")}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.bg};">
    <tr>
      <td align="center" style="padding:32px 12px 40px;">
        <!-- width attribute for Outlook, which needs a fixed number; width:100%
             with a max for everything else, so a narrow reading pane shrinks
             the card instead of overflowing it. -->
        <table role="presentation" class="fa-wrap" cellpadding="0" cellspacing="0" border="0" width="600"
               style="width:100%;max-width:600px;background:${BRAND.card};border-radius:16px;border:1px solid ${BRAND.line};">
          <tr>
            <td class="fa-pad" style="padding:30px 36px 0;">${markLinked}</td>
          </tr>
          <tr>
            <td class="fa-pad" style="padding:26px 36px 32px;font-family:${FONT};color:${BRAND.body};font-size:15px;line-height:1.65;">
              ${eyebrowText ? eyebrow(eyebrowText) : ""}
              ${heading ? `<h1 class="fa-h1" style="margin:0 0 12px;font-size:27px;line-height:1.22;font-weight:700;letter-spacing:-0.02em;color:${BRAND.ink};">${esc(heading)}</h1>` : ""}
              ${bodyHtml}
            </td>
          </tr>
          <!-- Three short lines. An address, a way to reach us, and the
               legal line. Anything more turns the footer into a paragraph
               nobody reads. -->
          <tr>
            <td class="fa-pad" style="padding:22px 36px 28px;border-top:1px solid ${BRAND.line};font-family:${FONT};font-size:13px;line-height:1.7;color:${BRAND.faint};">
              <p style="margin:0 0 2px;color:${BRAND.ink};font-weight:600;">${safeStore}</p>
              <p style="margin:0 0 8px;">${esc(COMPANY.city)}</p>
              <p style="margin:0;">
                <a href="mailto:${esc(supportEmail)}" style="color:${BRAND.faint};text-decoration:underline;">${esc(supportEmail)}</a>
                ${site ? ` &middot; <a href="${esc(site)}" style="color:${BRAND.faint};text-decoration:underline;">${esc(site.replace(/^https?:\/\//, ""))}</a>` : ""}
                &middot; &copy; ${new Date().getFullYear()}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = {
  renderLayout,
  orderTable,
  productCard,
  metaRows,
  button,
  buttonPair,
  panel,
  eyebrow,
  esc,
  money,
  BRAND,
  FONT,
  COMPANY,
};
