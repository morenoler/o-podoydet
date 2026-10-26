-- Private clarification history, provenance and non-reversible listing scope generations.
-- ISO date strings and JSON text preserve the established API and SQLite import format.
CREATE TABLE account_clarifications (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES account_listings(id),
 user_id TEXT NOT NULL REFERENCES account_users(id), feature TEXT NOT NULL,
 question_text TEXT NOT NULL, note TEXT NOT NULL, trip TEXT NOT NULL, context TEXT NOT NULL,
 scope_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
 request_key TEXT NOT NULL, payload_hash TEXT NOT NULL, UNIQUE(user_id,request_key)
);
CREATE INDEX account_clarification_listing ON account_clarifications(listing_id);
CREATE INDEX account_clarification_user ON account_clarifications(user_id);
CREATE TABLE account_clarification_answers (
 id TEXT PRIMARY KEY, clarification_id TEXT NOT NULL REFERENCES account_clarifications(id),
 host_id TEXT NOT NULL REFERENCES account_users(id), version INTEGER NOT NULL,
 value INTEGER CHECK(value IS NULL OR value IN (0,1)), answer_text TEXT NOT NULL,
 observed_on TEXT, recorded_at TEXT NOT NULL, valid_from TEXT, valid_to TEXT, recheck_at TEXT NOT NULL,
 scope_fingerprint TEXT NOT NULL, supersedes TEXT NOT NULL, superseded_by TEXT,
 request_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
 UNIQUE(clarification_id,version), UNIQUE(host_id,request_key)
);
CREATE INDEX account_clarification_answer_question ON account_clarification_answers(clarification_id);
CREATE TABLE account_listing_scopes (
 listing_id TEXT PRIMARY KEY REFERENCES account_listings(id),
 generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0)
);
