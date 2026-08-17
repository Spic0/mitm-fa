-- Customer profile fields + the progress denominator.
--
-- Purely additive: three nullable columns, no defaults to backfill, no data
-- rewritten, no constraint that existing rows could violate. Old application
-- code ignores all three, so this is safe to apply before the deploy that
-- reads them (see the deploy note in the project docs).
ALTER TABLE "User" ADD COLUMN "displayName" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "ProgramProgress" ADD COLUMN "totalKeys" INTEGER;
