-- src/migrations/add-engagement-tables.sql
-- Phase 11 — server-side engagement state.
--
-- Drops the never-populated placeholder `engagement` table from Phase 6.1's
-- schema.sql and replaces it with four purpose-built tables:
--
--   user_progress     — one row per user; the canonical state (Market Coins,
--                       streak, shields, rank, lifetime counters).
--   engagement_events — append-only audit log of every tracked event.
--   user_badges       — one row per (user, badge family); current_tier +
--                       progress toward next tier.
--   personal_records  — one row per (user, record_key); the kid's own bests.
--
-- runBootMigrations() in src/server.js applies this idempotently by checking
-- information_schema for `user_progress`. The standalone file is kept for
-- manual one-shots (psql) and for documentation.
--
-- COPPA note: storage.recordDeletionRequest also DELETEs from all four
-- tables in the same transaction as the user soft-delete.

-- Phase 11 drops the empty placeholder. No code path ever inserted into it.
DROP TABLE IF EXISTS engagement;

-- ============================================================
-- user_progress — single row per user, server-side source of truth
-- ============================================================
CREATE TABLE IF NOT EXISTS user_progress (
  user_id           UUID         PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  market_coins      INTEGER      NOT NULL DEFAULT 0,
  current_streak    INTEGER      NOT NULL DEFAULT 0,
  longest_streak    INTEGER      NOT NULL DEFAULT 0,
  streak_shields    INTEGER      NOT NULL DEFAULT 0,
  rank_key          VARCHAR(50)  NOT NULL DEFAULT 'rookie',
  perfect_days      INTEGER      NOT NULL DEFAULT 0,
  games_played      INTEGER      NOT NULL DEFAULT 0,
  correct_answers   INTEGER      NOT NULL DEFAULT 0,
  sunday_challenges INTEGER      NOT NULL DEFAULT 0,
  weeks_active      INTEGER      NOT NULL DEFAULT 0,
  words_learned     INTEGER      NOT NULL DEFAULT 0,
  last_active_date  DATE,
  last_streak_date  DATE,
  last_iso_week     VARCHAR(8),  -- 'YYYY-Www' to detect new-week boundary
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- engagement_events — append-only audit log + analytics source
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_events (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  VARCHAR(50)  NOT NULL,
  event_data  JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_user_date
  ON engagement_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_type
  ON engagement_events (event_type);

-- ============================================================
-- user_badges — one row per (user, badge family). Tier 0 = locked.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_badges (
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key    VARCHAR(50)  NOT NULL,
  current_tier INTEGER      NOT NULL DEFAULT 0,
  progress     INTEGER      NOT NULL DEFAULT 0,
  unlocked_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, badge_key)
);

-- ============================================================
-- personal_records — one row per (user, record_key). Survives streak resets.
-- ============================================================
CREATE TABLE IF NOT EXISTS personal_records (
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_key  VARCHAR(50)  NOT NULL,
  value       INTEGER      NOT NULL DEFAULT 0,
  achieved_at DATE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, record_key)
);
