// The partnership setup wizard (estimate + enquiry form), shared by the
// private decks (private/presentation.html) and the public /partnership/offer
// frame. One copy of the markup in partials/offer-wizard.html; this inlines it
// at the marker, re-indented to the marker's own indentation, so a deck
// renders byte-for-byte what it did when the markup lived inline.
const fs = require("fs");
const path = require("path");

const PARTIAL_PATH = path.join(__dirname, "..", "..", "..", "partials", "offer-wizard.html");
const MARKER = /^([ \t]*)<!--OFFER_WIZARD-->$/m;

async function inlineOfferWizard(html) {
  if (!MARKER.test(html)) return html;
  const partial = (await fs.promises.readFile(PARTIAL_PATH, "utf8")).replace(/\n$/, "");
  return html.replace(MARKER, (_, indent) => partial.split("\n").map((l) => (l ? indent + l : l)).join("\n"));
}

module.exports = { inlineOfferWizard };
