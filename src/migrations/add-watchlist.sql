-- src/migrations/add-watchlist.sql — Phase 21 Watchlist ("Your Companies").
-- Mirrored in src/schema.sql and the idempotent runBootMigrations() block in
-- src/server.js (detected via user_watchlist's presence; all three ship
-- together). daily_prices is market data (NOT scrubbed); user_watchlist +
-- user_watchlist_prefs are per-user (added to recordDeletionRequest()'s scrub).

CREATE TABLE IF NOT EXISTS daily_prices (
  price_date     DATE     NOT NULL,
  ticker         TEXT     NOT NULL,
  price          NUMERIC,
  change_pct     NUMERIC,
  previous_close NUMERIC,
  PRIMARY KEY (price_date, ticker)
);

CREATE TABLE IF NOT EXISTS user_watchlist (
  user_id         UUID     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker          TEXT     NOT NULL,
  followed_since  DATE     NOT NULL,
  price_at_follow NUMERIC  NOT NULL,
  milestone_hit   SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, ticker)
);

CREATE TABLE IF NOT EXISTS user_watchlist_prefs (
  user_id                UUID     PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  offers_made            SMALLINT NOT NULL DEFAULT 0,
  status                 TEXT     NOT NULL DEFAULT 'none'
                                  CHECK (status IN ('none', 'skipped', 'declined', 'active')),
  first_offer_active_day SMALLINT
);
