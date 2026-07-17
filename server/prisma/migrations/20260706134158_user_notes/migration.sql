-- AlterTable: admin-only free-text notes for a customer, set when manually creating/editing them
ALTER TABLE "User" ADD COLUMN "notes" TEXT;
