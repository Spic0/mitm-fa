-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promotionId" TEXT;

-- AlterTable
ALTER TABLE "SystemLog" ADD COLUMN     "ip" TEXT;

-- CreateTable
CREATE TABLE "Influencer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "type" TEXT NOT NULL,
    "commissionPct" DOUBLE PRECISION,
    "commissionType" TEXT,
    "commissionFixedCents" INTEGER,
    "paymentRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Influencer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "freeProductId" TEXT,
    "codeKind" TEXT NOT NULL DEFAULT 'STANDARD',
    "maxUses" INTEGER,
    "maxUsesPerCustomer" INTEGER,
    "minSpendCents" INTEGER,
    "maxDiscountCents" INTEGER,
    "firstPurchaseOnly" BOOLEAN NOT NULL DEFAULT false,
    "singleUse" BOOLEAN NOT NULL DEFAULT false,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "activatesAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "createdById" TEXT NOT NULL,
    "influencerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionProduct" (
    "promotionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "PromotionProduct_pkey" PRIMARY KEY ("promotionId","productId")
);

-- CreateTable
CREATE TABLE "PromotionCategory" (
    "promotionId" TEXT NOT NULL,
    "taxonomyNodeId" TEXT NOT NULL,

    CONSTRAINT "PromotionCategory_pkey" PRIMARY KEY ("promotionId","taxonomyNodeId")
);

-- CreateTable
CREATE TABLE "PromotionUser" (
    "promotionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PromotionUser_pkey" PRIMARY KEY ("promotionId","userId")
);

-- CreateTable
CREATE TABLE "PromotionRedemption" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionNotification" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRedemption_orderId_key" ON "PromotionRedemption"("orderId");

-- CreateIndex
CREATE INDEX "PromotionRedemption_promotionId_createdAt_idx" ON "PromotionRedemption"("promotionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionNotification_promotionId_type_key" ON "PromotionNotification"("promotionId", "type");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_freeProductId_fkey" FOREIGN KEY ("freeProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionProduct" ADD CONSTRAINT "PromotionProduct_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionProduct" ADD CONSTRAINT "PromotionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionCategory" ADD CONSTRAINT "PromotionCategory_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionCategory" ADD CONSTRAINT "PromotionCategory_taxonomyNodeId_fkey" FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionUser" ADD CONSTRAINT "PromotionUser_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionUser" ADD CONSTRAINT "PromotionUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRedemption" ADD CONSTRAINT "PromotionRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionNotification" ADD CONSTRAINT "PromotionNotification_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

