-- Freeze the priced cart at checkout-creation time instead of re-deriving it
-- at fulfillment. Additive only: every column is nullable or defaulted, so
-- code running before this migration ignores them and rows written before it
-- still read back (both fulfillment paths fall back to itemsJson).
ALTER TABLE "PendingCheckout" ADD COLUMN "resolvedItemsJson" TEXT;
ALTER TABLE "PendingCheckout" ADD COLUMN "subtotalCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PendingCheckout" ADD COLUMN "provider" TEXT;
ALTER TABLE "PendingCheckout" ADD COLUMN "providerRef" TEXT;
ALTER TABLE "PendingCheckout" ADD COLUMN "consumedAt" TIMESTAMP(3);

CREATE INDEX "PendingCheckout_providerRef_idx" ON "PendingCheckout"("providerRef");
CREATE INDEX "PendingCheckout_createdAt_idx" ON "PendingCheckout"("createdAt");
