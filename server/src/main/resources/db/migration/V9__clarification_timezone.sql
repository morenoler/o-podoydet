-- Historical recheck timestamps were calculated in Seoul time. Keep that provenance.
ALTER TABLE account_clarification_answers ADD COLUMN time_zone text NOT NULL DEFAULT 'Asia/Seoul';
