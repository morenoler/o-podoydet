-- Legacy prose is deliberately not promoted to structured or verified evidence.
ALTER TABLE account_listings ADD COLUMN amenity_evidence TEXT NOT NULL DEFAULT '{}';
