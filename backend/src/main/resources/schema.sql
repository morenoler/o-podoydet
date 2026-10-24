PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS metadata (
  region TEXT NOT NULL, key TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(region,key)
);
CREATE TABLE IF NOT EXISTS hotels (
  region TEXT NOT NULL, id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(region,id)
);
CREATE TABLE IF NOT EXISTS rooms (
  region TEXT NOT NULL, hotel_id TEXT NOT NULL, id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(region,hotel_id,id), FOREIGN KEY(region,hotel_id) REFERENCES hotels(region,id)
);
CREATE TABLE IF NOT EXISTS facts (
  region TEXT NOT NULL, id TEXT NOT NULL, hotel_id TEXT NOT NULL, room_id TEXT,
  feature TEXT NOT NULL, seeded INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(region,id),
  FOREIGN KEY(region,hotel_id) REFERENCES hotels(region,id)
);
CREATE INDEX IF NOT EXISTS facts_scope ON facts(region,hotel_id,room_id,feature);
CREATE TABLE IF NOT EXISTS questions (
  region TEXT NOT NULL, id TEXT NOT NULL, hotel_id TEXT NOT NULL, room_id TEXT NOT NULL,
  feature TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
  PRIMARY KEY(region,id), UNIQUE(region,hotel_id,room_id,feature),
  FOREIGN KEY(region,hotel_id,room_id) REFERENCES rooms(region,hotel_id,id)
);
CREATE TABLE IF NOT EXISTS drafts (
  region TEXT NOT NULL, id TEXT NOT NULL, question_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(region,id),
  FOREIGN KEY(region,question_id) REFERENCES questions(region,id)
);
