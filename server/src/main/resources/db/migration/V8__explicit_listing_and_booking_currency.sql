-- All previously stored amounts were exposed as KRW. Preserve that denomination, even
-- for a listing whose city was already Sochi; changing a city never converts its price.
ALTER TABLE account_listings ADD COLUMN currency text NOT NULL DEFAULT 'KRW'
  CHECK (currency IN ('KRW', 'RUB'));
ALTER TABLE account_bookings ADD COLUMN currency text NOT NULL DEFAULT 'KRW'
  CHECK (currency IN ('KRW', 'RUB'));
