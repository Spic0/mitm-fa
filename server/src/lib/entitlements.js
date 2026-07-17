const { prisma } = require("../db");

// A user is entitled to a product if they have at least one paid order item
// for it — the same ownership check the library list has always used,
// pulled out so every gated route (program content, resource downloads)
// shares one definition instead of re-deriving it.
async function hasEntitlement(userId, productId) {
  const orderItem = await prisma.orderItem.findFirst({
    where: { productId, order: { userId, status: "paid" } },
  });
  return !!orderItem;
}

module.exports = { hasEntitlement };
