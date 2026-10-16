-- DropIndex
DROP INDEX "PromotionRedemption_orderId_key";

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRedemption_orderId_promotionId_key" ON "PromotionRedemption"("orderId", "promotionId");

