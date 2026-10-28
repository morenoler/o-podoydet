-- Private operational reply to a request. It is not an evidence source or booking confirmation.
ALTER TABLE account_bookings
  ADD COLUMN host_reply TEXT NOT NULL DEFAULT '' CHECK (char_length(host_reply) <= 3000),
  ADD COLUMN replied_at TEXT;
