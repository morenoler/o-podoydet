ALTER TABLE account_listings
  ADD COLUMN longitude DOUBLE PRECISION,
  ADD COLUMN latitude DOUBLE PRECISION,
  ADD COLUMN sleeping_places INTEGER CHECK (sleeping_places BETWEEN 1 AND 40),
  ADD COLUMN beds TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN demo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT account_listing_coordinate_pair CHECK (
    (longitude IS NULL AND latitude IS NULL) OR
    (longitude IS NOT NULL AND latitude IS NOT NULL
      AND longitude BETWEEN -180 AND 180 AND latitude BETWEEN -90 AND 90)
  );
