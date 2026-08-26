-- Navigation presentation columns on Taxonomy.
--
-- Purely additive. Every value below is BACKFILLED from what routes/pages.js
-- previously hardcoded, so the storefront renders byte-identical URLs before
-- and after: goals -> /goal/:slug, athletes -> /sport/:slug + /athlete/:slug,
-- creators -> /creator/:slug. Old code that does not know these columns is
-- unaffected, which is what makes it safe to apply before the code merge.

ALTER TABLE "Taxonomy" ADD COLUMN "showInNav" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Taxonomy" ADD COLUMN "navLayout" TEXT NOT NULL DEFAULT 'auto';
-- Added nullable so the existing rows survive the ALTER, backfilled, then
-- tightened to NOT NULL. A bare `ADD COLUMN ... NOT NULL` with no default
-- fails on a non-empty table.
ALTER TABLE "Taxonomy" ADD COLUMN "nodeRoute" TEXT;
ALTER TABLE "Taxonomy" ADD COLUMN "groupRoute" TEXT;

UPDATE "Taxonomy" SET "nodeRoute" = 'goal',    "groupRoute" = NULL,    "navLayout" = 'list'   WHERE "key" = 'goals';
UPDATE "Taxonomy" SET "nodeRoute" = 'athlete', "groupRoute" = 'sport', "navLayout" = 'people' WHERE "key" = 'athletes';
UPDATE "Taxonomy" SET "nodeRoute" = 'creator', "groupRoute" = NULL,    "navLayout" = 'people' WHERE "key" = 'creators';

-- Any taxonomy created outside the three seeded ones (none exist today, but
-- the migration must not leave a NULL behind if one did): fall back to the
-- key itself, which is what lib/taxonomy.js derives for new taxonomies.
UPDATE "Taxonomy" SET "nodeRoute" = "key" WHERE "nodeRoute" IS NULL;

ALTER TABLE "Taxonomy" ALTER COLUMN "nodeRoute" SET NOT NULL;

-- A URL segment must resolve to exactly one taxonomy, and nodeRoute and
-- groupRoute share one namespace (/sport/... and /athlete/... are both
-- looked up in the same table), so both are unique.
CREATE UNIQUE INDEX "Taxonomy_nodeRoute_key" ON "Taxonomy"("nodeRoute");
CREATE UNIQUE INDEX "Taxonomy_groupRoute_key" ON "Taxonomy"("groupRoute");
