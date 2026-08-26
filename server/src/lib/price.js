// Display price of a PRODUCT, in one place.
//
// A plan at 0 is free, and rendering that as "$0.00" on a storefront reads as
// a pricing bug rather than an offer — the catalog has one such product
// published and featured today, so this is a live case.
//
// Kept in step with ProFitAPI.formatProductPrice in assets/js/api.js, which
// renders the same two values client-side; anything the server renders and
// the client later re-renders must never disagree.
function formatProductPrice(cents) {
  return cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}`;
}

module.exports = { formatProductPrice };
