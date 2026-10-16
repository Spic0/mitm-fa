-- AlterTable
ALTER TABLE "PendingCheckout" ADD COLUMN     "appliedPromotionsJson" TEXT,
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promotionId" TEXT;

