-- A private, revisioned shortlist and an explicitly shared, revocable snapshot.
CREATE TABLE account_shortlists (
    owner_id TEXT PRIMARY KEY REFERENCES account_users(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    revision BIGINT NOT NULL CHECK (revision >= 1),
    updated_at TEXT NOT NULL
);
CREATE TABLE account_shortlist_shares (
    owner_id TEXT PRIMARY KEY REFERENCES account_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
