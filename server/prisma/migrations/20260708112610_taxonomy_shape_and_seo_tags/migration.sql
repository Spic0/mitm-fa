-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "seoTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Taxonomy" ADD COLUMN     "hasSubcategories" BOOLEAN NOT NULL DEFAULT false;

