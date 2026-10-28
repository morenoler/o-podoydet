-- Active regions belong to one imported catalog. The default remains backward compatible.
CREATE TABLE catalog_region (
  region text PRIMARY KEY REFERENCES dataset(region),
  position integer NOT NULL UNIQUE
);
INSERT INTO catalog_region(region, position)
SELECT region, 0 FROM catalog_runtime WHERE singleton;
