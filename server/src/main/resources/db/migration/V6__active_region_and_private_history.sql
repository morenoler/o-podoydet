-- One active region per server, with private history retained when datasets are switched.
CREATE TABLE catalog_runtime (singleton boolean PRIMARY KEY DEFAULT TRUE CHECK(singleton), region text NOT NULL);
INSERT INTO catalog_runtime(singleton, region)
SELECT TRUE, region FROM dataset ORDER BY imported_at DESC, region LIMIT 1;

ALTER TABLE advisor_run ADD COLUMN region text NOT NULL DEFAULT '';
UPDATE advisor_run SET region = COALESCE(NULLIF(body::jsonb #>> '{context,trip,region}', ''),
    (SELECT region FROM catalog_runtime WHERE singleton), '');
CREATE INDEX advisor_run_region_owner_created_idx ON advisor_run(region, owner_key, created_at DESC);
ALTER TABLE catalog_question ADD COLUMN region text NOT NULL DEFAULT '';
UPDATE catalog_question q SET region = h.region FROM hotel h WHERE h.id = q.hotel_id;
ALTER TABLE catalog_question DROP CONSTRAINT catalog_question_hotel_id_room_id_feature_key;
ALTER TABLE catalog_question ADD CONSTRAINT catalog_question_region_scope UNIQUE(region, hotel_id, room_id, feature);
ALTER TABLE catalog_draft ADD COLUMN region text NOT NULL DEFAULT '';
UPDATE catalog_draft d SET region = q.region FROM catalog_question q WHERE q.id = d.question_id;
