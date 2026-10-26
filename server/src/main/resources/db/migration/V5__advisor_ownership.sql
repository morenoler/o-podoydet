-- Existing unscoped runs remain private and inaccessible to browser identities.
ALTER TABLE advisor_run ADD COLUMN owner_key text NOT NULL DEFAULT 'legacy-unowned';
CREATE INDEX advisor_run_owner_created_idx ON advisor_run(owner_key, created_at DESC);
