-- 2026-11-05 ROLLBACK of update.sql: back to the demo SVG covers (still on disk).
-- Product.imageUrl for the four published products (homepage hero carousel,
-- shop grid, product pages). Stored like every other imageUrl: a bare
-- relative path. Guarded: a row only changes if it still holds the expected
-- current value, and the whole transaction aborts unless exactly 4 change.
-- Unqualified table name: run with the target schema on the search_path
-- (production: public, the psql default).
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  UPDATE "Product" SET "imageUrl" = CASE slug
      WHEN 'elena-cho-strength-size-peak' THEN 'assets/images/product/uploads/demo-cover-strength-size-peak.svg'
      WHEN 'jordan-blake-mass-strength-split' THEN 'assets/images/product/uploads/demo-cover-mass-strength-split.svg'
      WHEN 'marcus-reyes-elite-athleticism' THEN 'assets/images/product/uploads/demo-cover-elite-athleticism-conditioning.svg'
      WHEN 'derrick-owens-longevity-power' THEN 'assets/images/product/uploads/demo-cover-elite-longevity-power.svg'
    END
  WHERE (slug, "imageUrl") IN (
    ('elena-cho-strength-size-peak', 'assets/images/product/uploads/c240553a-d099-40ee-8675-4eb7f0a64ed2.jpg'),
    ('jordan-blake-mass-strength-split', 'assets/images/product/uploads/0e15bda5-81d8-4340-a386-7d6d53337c59.jpg'),
    ('marcus-reyes-elite-athleticism', 'assets/images/product/uploads/78f596d0-608e-401b-b5d3-7a3cb9c06312.jpg'),
    ('derrick-owens-longevity-power', 'assets/images/product/uploads/b85443ad-ac32-4904-bd6c-beb108bf304a.jpg')
  );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 4 THEN
    RAISE EXCEPTION 'expected 4 products to change, got %', n;
  END IF;
END $$;
COMMIT;
