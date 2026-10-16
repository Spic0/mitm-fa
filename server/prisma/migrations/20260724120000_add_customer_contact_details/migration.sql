-- Checkout collects Full Name / Phone / Email / Country, but only email was
-- ever persisted. "phone" is new; "country" already existed on User and was
-- simply never written. Both nullable and additive — no backfill, no rewrite
-- of existing rows, safe to apply to a live database.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;

-- PendingCheckout carries the PayPal-path customer details between
-- create-order and capture-order, mirroring what Stripe keeps in
-- PaymentIntent metadata.
-- AlterTable
ALTER TABLE "PendingCheckout" ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "customerCountry" TEXT;
