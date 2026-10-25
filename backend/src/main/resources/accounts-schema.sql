PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS account_users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','host')),
 name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', about TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_session_user ON account_sessions(user_id);
CREATE TABLE IF NOT EXISTS account_listings (
 id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES account_users(id),
 title TEXT NOT NULL, description TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL,
 room_type TEXT NOT NULL, capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 20),
 price_per_night INTEGER NOT NULL CHECK(price_per_night BETWEEN 1 AND 100000000),
 amenities TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_listing_host ON account_listings(host_id);
CREATE TABLE IF NOT EXISTS account_listing_search_profiles (
 listing_id TEXT PRIMARY KEY REFERENCES account_listings(id) ON DELETE CASCADE,
 notes TEXT NOT NULL DEFAULT '', floor INTEGER CHECK(floor BETWEEN -3 AND 200),
 window_directions TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS account_bookings (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES account_listings(id), user_id TEXT NOT NULL REFERENCES account_users(id),
 check_in TEXT NOT NULL, check_out TEXT NOT NULL, guests INTEGER NOT NULL,
 nights INTEGER NOT NULL, price_per_night INTEGER NOT NULL, total_price INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','confirmed','completed','cancelled')),
 note TEXT NOT NULL, listing_title TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_booking_user ON account_bookings(user_id);
CREATE INDEX IF NOT EXISTS account_booking_listing ON account_bookings(listing_id,check_in,check_out);
CREATE TABLE IF NOT EXISTS account_questions (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES account_listings(id), user_id TEXT NOT NULL REFERENCES account_users(id),
 text TEXT NOT NULL, answer TEXT, created_at TEXT NOT NULL, answered_at TEXT
);
CREATE INDEX IF NOT EXISTS account_question_listing ON account_questions(listing_id);
CREATE TABLE IF NOT EXISTS account_migrations (
 name TEXT PRIMARY KEY, applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_uploaded_photos (
 url TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES account_users(id),
 mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png')),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 2400),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 2400),
 byte_size INTEGER NOT NULL CHECK(byte_size>0), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_uploaded_photo_owner ON account_uploaded_photos(owner_id);
