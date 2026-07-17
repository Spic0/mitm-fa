-- AlterTable: add new platform-content fields to Product (pdfFileName drops later, after data migration)
ALTER TABLE "Product"
ADD COLUMN     "bonusNotes" TEXT,
ADD COLUMN     "creator" TEXT,
ADD COLUMN     "difficulty" TEXT,
ADD COLUMN     "durationWeeks" INTEGER,
ADD COLUMN     "goals" TEXT,
ADD COLUMN     "nutritionContent" JSONB,
ADD COLUMN     "overview" TEXT,
ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "trainingContent" JSONB;

-- CreateTable
CREATE TABLE "ProductFaq" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductFaq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductResource" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "fileName" TEXT,
    "url" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductResource_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProductFaq" ADD CONSTRAINT "ProductFaq_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductResource" ADD CONSTRAINT "ProductResource_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data migration: carry every existing uploaded PDF forward as an optional
-- bonus resource instead of silently dropping it when ProductFile goes away.
-- Files themselves were already copied from storage/pdfs to storage/resources
-- by prisma/migrateProductFiles.js — this just recreates the DB rows pointing
-- at them. Reuses ProductFile.id as the new row's id (cuids don't collide
-- across tables in practice, and it keeps this step a single INSERT).
INSERT INTO "ProductResource" ("id", "productId", "title", "type", "fileName", "order", "createdAt")
SELECT pf."id", pf."productId", p."name" || ' — Original PDF', 'file', pf."fileName", 0, pf."uploadedAt"
FROM "ProductFile" pf
JOIN "Product" p ON p."id" = pf."productId";

-- DropForeignKey
ALTER TABLE "ProductFile" DROP CONSTRAINT "ProductFile_productId_fkey";

-- DropTable
DROP TABLE "ProductFile";

-- AlterTable: pdfFileName is no longer the product — it's superseded by
-- structured content on Product plus optional ProductResource rows.
ALTER TABLE "Product" DROP COLUMN "pdfFileName";
