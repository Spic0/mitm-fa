// Shared HTML shell for every transactional email.
//
// Email clients are not browsers: Outlook renders through Word, Gmail strips
// <style> blocks in some contexts, and none of them can be relied on for
// flexbox or grid. So this is deliberately table-based with inline styles —
// the one layout approach that survives everywhere — with a <style> block
// carrying only progressive enhancements (the mobile breakpoint) that degrade
// harmlessly when stripped.
//
// Brand values come from Settings (storeName, logoUrl) rather than being
// hardcoded, so renaming the store in the admin panel renames it in email too.

// Every interpolated value passes through this. Product names and store names
// are admin-controlled, but the customer's own name now reaches these
// templates straight from the checkout form, and an unescaped "<" there would
// corrupt the markup of a real customer's receipt.
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

const BRAND = {
  ink: "#0f172a",
  body: "#475569",
  muted: "#94a3b8",
  line: "#e2e8f0",
  bg: "#f1f5f9",
  accent: "#1a1a1a",
};

// A "bulletproof" button: a single-cell table rather than a styled <a>, which
// is the only form Outlook renders with a real background colour.
function button(label, href) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">
      <tr>
        <td align="center" bgcolor="${BRAND.accent}" style="border-radius:10px;">
          <a href="${esc(href)}"
             style="display:inline-block;padding:15px 34px;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
            ${esc(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

// preheader: the grey line clients show next to the subject in the inbox
// list. Left unset it gets filled with whatever text comes first, which for a
// receipt would be the logo alt text — so every template sets one.
function renderLayout({ storeName, logoUrl, appUrl, supportEmail, preheader, heading, bodyHtml }) {
  const safeStore = esc(storeName || "");
  const brandMark = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${safeStore}" width="132" style="display:block;border:0;max-width:132px;height:auto;">`
    : `<span style="font-family:Helvetica,Arial,sans-serif;font-size:21px;font-weight:800;letter-spacing:-0.02em;color:${BRAND.ink};">${safeStore}</span>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<title>${esc(heading || safeStore)}</title>
<style>
  /* Stripped by some clients — everything here is an enhancement only. */
  @media only screen and (max-width:600px) {
    .co-wrap { width:100% !important; }
    .co-pad { padding-left:22px !important; padding-right:22px !important; }
    .co-h1 { font-size:23px !important; }
    .co-stack { display:block !important; width:100% !important; text-align:left !important; }
    .co-stack-right { text-align:left !important; padding-top:4px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;color:${BRAND.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader || "")}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.bg};">
    <tr>
      <td align="center" style="padding:26px 12px;">
        <table role="presentation" class="co-wrap" cellpadding="0" cellspacing="0" border="0" width="600"
               style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${BRAND.line};">
          <tr>
            <td class="co-pad" style="padding:28px 34px 0;">${brandMark}</td>
          </tr>
          <tr>
            <td class="co-pad" style="padding:22px 34px 30px;font-family:Helvetica,Arial,sans-serif;color:${BRAND.body};font-size:15px;line-height:1.6;">
              ${heading ? `<h1 class="co-h1" style="margin:0 0 14px;font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${BRAND.ink};">${esc(heading)}</h1>` : ""}
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td class="co-pad" style="padding:20px 34px 28px;border-top:1px solid ${BRAND.line};font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.muted};">
              <p style="margin:0 0 6px;">
                Need a hand? Email
                <a href="mailto:${esc(supportEmail)}" style="color:${BRAND.ink};font-weight:600;text-decoration:underline;">${esc(supportEmail)}</a>
                and a human will reply.
              </p>
              <p style="margin:0;">&copy; ${new Date().getFullYear()} ${safeStore}${appUrl ? ` &middot; <a href="${esc(appUrl)}" style="color:${BRAND.muted};text-decoration:underline;">${esc(String(appUrl).replace(/^https?:\/\//, ""))}</a>` : ""}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Order lines + totals, shared by the purchase receipt and any admin resend
// of it. Two columns that stack on narrow screens via .co-stack.
function orderTable({ orderItems, totalCents, discountCents = 0, currency = "USD" }) {
  const rows = orderItems
    .map(
      (item) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${BRAND.line};font-family:Helvetica,Arial,sans-serif;font-size:15px;color:${BRAND.ink};font-weight:600;">
          ${esc(item.product ? item.product.name : item.name)}
        </td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid ${BRAND.line};font-family:Helvetica,Arial,sans-serif;font-size:15px;color:${BRAND.ink};white-space:nowrap;">
          ${money(item.priceCents, currency)}
        </td>
      </tr>`
    )
    .join("");

  const subtotalCents = Number(totalCents || 0) + Number(discountCents || 0);
  const discountRow = discountCents
    ? `<tr>
         <td style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.body};">Discount</td>
         <td align="right" style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#16a34a;white-space:nowrap;">&minus;${money(discountCents, currency)}</td>
       </tr>`
    : "";

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:8px 0 4px;">
      ${rows}
      <tr>
        <td style="padding:12px 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.body};">Subtotal</td>
        <td align="right" style="padding:12px 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.body};white-space:nowrap;">${money(subtotalCents, currency)}</td>
      </tr>
      ${discountRow}
      <tr>
        <td style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.body};">Delivery</td>
        <td align="right" style="padding:6px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#16a34a;white-space:nowrap;">Instant</td>
      </tr>
      <tr>
        <td style="padding:14px 0 0;border-top:2px solid ${BRAND.ink};font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;color:${BRAND.ink};">Total paid</td>
        <td align="right" style="padding:14px 0 0;border-top:2px solid ${BRAND.ink};font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:${BRAND.ink};white-space:nowrap;">${money(totalCents, currency)}</td>
      </tr>
    </table>`;
}

// Neutral info panel used for order references and security notes.
function panel(html) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:20px 0;">
    <tr><td style="background:${BRAND.bg};border-radius:10px;padding:15px 18px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:${BRAND.body};">${html}</td></tr>
  </table>`;
}

module.exports = { renderLayout, orderTable, button, panel, esc, money, BRAND };
