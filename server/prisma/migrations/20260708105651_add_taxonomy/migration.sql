-- AlterTable
ALTER TABLE "Product" DROP COLUMN "category",
DROP COLUMN "goals",
DROP COLUMN "tags";

-- CreateTable
CREATE TABLE "Taxonomy" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Taxonomy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxonomyNode" (
    "id" TEXT NOT NULL,
    "taxonomyId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxonomyNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTaxonomy" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "taxonomyNodeId" TEXT NOT NULL,

    CONSTRAINT "ProductTaxonomy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Taxonomy_key_key" ON "Taxonomy"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Taxonomy_route_key" ON "Taxonomy"("route");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyNode_taxonomyId_parentId_slug_key" ON "TaxonomyNode"("taxonomyId", "parentId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTaxonomy_productId_taxonomyNodeId_key" ON "ProductTaxonomy"("productId", "taxonomyNodeId");

-- AddForeignKey
ALTER TABLE "TaxonomyNode" ADD CONSTRAINT "TaxonomyNode_taxonomyId_fkey" FOREIGN KEY ("taxonomyId") REFERENCES "Taxonomy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyNode" ADD CONSTRAINT "TaxonomyNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TaxonomyNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTaxonomy" ADD CONSTRAINT "ProductTaxonomy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTaxonomy" ADD CONSTRAINT "ProductTaxonomy_taxonomyNodeId_fkey" FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

