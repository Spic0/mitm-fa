const { prisma } = require("../db");

// A user is entitled to a product if they have at least one paid order item
// for it — the same ownership check the library list has always used,
// pulled out so every gated route (program content, resource downloads)
// shares one definition instead of re-deriving it.
//
// There is now a second way in, and it is deliberately in THIS function
// rather than in the routes: the page gate and the media gate both call
// hasEntitlement, so anything that opens one and not the other produces a
// program page whose every demo is a 403. One definition, both gates.
async function hasEntitlement(userId, productId) {
  // Scoped by construction: the flag is a column on the row being asked
  // about, so this can only ever answer "yes" for the product in the URL.
  // Swap the productId for a paid product and that row comes back with
  // freeAccess false, leaving the order check below as the only way in.
  if (await isFreeAccess(productId)) return true;

  // Guests get no further. Everything past here is ownership.
  if (!userId) return false;

  const orderItem = await prisma.orderItem.findFirst({
    where: { productId, order: { userId, status: "paid" } },
  });
  return !!orderItem;
}

// True only for a product explicitly flagged free-to-access. Accepts an id or
// a slug because /program/:productId has always accepted either, and the guest
// guard in routes/library.js has to answer this question about the same value
// the route will later resolve.
async function isFreeAccess(idOrSlug) {
  if (!idOrSlug) return false;
  const key = String(idOrSlug);
  const product = await prisma.product.findFirst({
    where: { freeAccess: true, OR: [{ id: key }, { slug: key }] },
    select: { id: true },
  });
  return !!product;
}

module.exports = { hasEntitlement, isFreeAccess };
