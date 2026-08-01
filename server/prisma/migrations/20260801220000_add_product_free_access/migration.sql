-- Access, as opposed to visibility. Additive and defaulted, so existing rows
-- and the code running before this deploy both keep their exact behaviour:
-- every product is false until an admin says otherwise.
ALTER TABLE "Product" ADD COLUMN "freeAccess" BOOLEAN NOT NULL DEFAULT false;
