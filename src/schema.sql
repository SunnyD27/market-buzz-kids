-- src/schema.sql — Market Juice · Neon PostgreSQL schema
-- Run against the Neon database in Phase 6 (creates extension + tables).
-- Phase 5 mirrors this shape in-memory via src/storage.js so the API
-- contract is identical when we swap stores.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

-- ============================================================
-- users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity (signup form)
  -- parent_email + kid_age are nullable so storage.recordDeletionRequest()
  -- can scrub them when a parent requests deletion (COPPA compliance).
  -- The partial index `users_parent_email_active` (deleted_at IS NULL) means
  -- a NULLed-out deleted row never blocks the same email from re-signing up.
  -- kid_first_name stays NOT NULL — the scrub writes the sentinel 'deleted'
  -- so any downstream null-deref doesn't blow up.
  parent_email        VARCHAR(255),
  kid_first_name      VARCHAR(100) NOT NULL,
  kid_age             INT          CHECK (kid_age BETWEEN 10 AND 16),

  -- Optional onboarding questions
  -- invest_experience: 'not_yet' | 'index_funds' | 'individual_stocks' | 'crypto' | 'not_sure'
  invest_experience   VARCHAR(40),
  -- referral_source:   'friend' | 'social' | 'school' | 'news' | 'other'
  referral_source     VARCHAR(40),

  -- Attribution (UTM params captured from landing URL client-side, sent in POST)
  utm_source          VARCHAR(120),
  utm_medium          VARCHAR(120),
  utm_campaign        VARCHAR(120),
  utm_content         VARCHAR(120),
  utm_term            VARCHAR(120),

  -- Request capture (server-side, on signup)
  user_agent          TEXT,
  device_type         VARCHAR(20),  -- 'mobile' | 'tablet' | 'desktop' | 'unknown'
  timezone            VARCHAR(64),  -- IANA timezone, sent from client Intl
  signup_ip           INET,
  signup_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Email verification (ages 13-16) — always required
  email_verified      BOOLEAN      NOT NULL DEFAULT FALSE,
  email_verified_at   TIMESTAMPTZ,

  -- COPPA parental consent (ages 10-12 only)
  consent_required    BOOLEAN      NOT NULL DEFAULT FALSE,
  consent_given       BOOLEAN      NOT NULL DEFAULT FALSE,
  consent_method      VARCHAR(40),       -- 'email-plus'
  consent_timestamp   TIMESTAMPTZ,
  consent_ip          INET,

  -- Account state
  -- is_active becomes TRUE once email verified AND (consent given OR not required)
  is_active           BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Auth (Phase 7 — kid login)
  username            VARCHAR(30),
  password_hash       VARCHAR(255),

  -- Push (Phase 4 PWA support; populated when kid subscribes)
  push_subscription   JSONB,

  -- Soft-delete (parent-initiated deletion request fulfillment)
  deleted_at          TIMESTAMPTZ,
  deletion_reason     VARCHAR(120),

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One active user per parent_email (allow re-signup after deletion).
CREATE UNIQUE INDEX IF NOT EXISTS users_parent_email_active
  ON users (LOWER(parent_email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_active_idx ON users (is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS users_signup_at_idx ON users (signup_at);

-- Phase 7: case-insensitive uniqueness for kid usernames. Partial so
-- pre-Phase-7 rows (NULL username) don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uniq
  ON users (LOWER(username))
  WHERE username IS NOT NULL;

-- ============================================================
-- verification_tokens
-- ============================================================
-- One row per outstanding link (verify-email OR parental-consent).
-- Phase 6 emails the URL containing `token`; clicking it hits the
-- relevant endpoint which marks the user verified / consented.
CREATE TABLE IF NOT EXISTS verification_tokens (
  token         VARCHAR(64)  PRIMARY KEY,        -- 32-byte hex, generated at signup
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Phase 7 added 'password_reset'; older deployments need the migration in
  -- src/migrations/add-auth-columns.sql to expand this CHECK.
  purpose       VARCHAR(20)  NOT NULL CHECK (purpose IN ('email_verify', 'parental_consent', 'password_reset')),
  expires_at    TIMESTAMPTZ  NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS verification_tokens_user_idx ON verification_tokens (user_id);
CREATE INDEX IF NOT EXISTS verification_tokens_expires_idx ON verification_tokens (expires_at) WHERE used_at IS NULL;

-- ============================================================
-- deletion_requests
-- ============================================================
-- Parents can request deletion via /parent/delete-data. We log every
-- request even if no matching user exists (so we have a paper trail
-- for compliance audits).
CREATE TABLE IF NOT EXISTS deletion_requests (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_email    VARCHAR(255) NOT NULL,
  reason          TEXT,
  requested_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  requested_ip    INET,
  user_agent      TEXT,

  -- Fulfillment tracking
  matched_user_id UUID         REFERENCES users(id) ON DELETE SET NULL,
  processed_at    TIMESTAMPTZ,
  processed_method VARCHAR(40)       -- 'automatic' | 'manual'
);

CREATE INDEX IF NOT EXISTS deletion_requests_email_idx ON deletion_requests (LOWER(parent_email));

-- ============================================================
-- Engagement system (Phase 11) — server-side state for ranks, badges,
-- streaks, personal records.
-- ============================================================
-- Replaces the Phase 6.1 `engagement` placeholder (dropped via the boot
-- migration in src/migrations/add-engagement-tables.sql). Phase 11 splits
-- engagement into four purpose-built tables: a single canonical row per
-- user, an append-only event log, and per-badge / per-record progress rows.
--
-- See src/progression.js for the canonical constants (rank thresholds,
-- MC awards, badge tier ladders, record keys, shield config) and
-- src/engagement.js for the read/write logic.

-- user_progress — single row per user, the server-side source of truth.
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
  last_iso_week     VARCHAR(8),  -- 'YYYY-Www' boundary for weeks_active increments
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- engagement_events — append-only audit log. Every recordEvent() call
-- writes here before mutating user_progress, so we have a re-derivation
-- source if anything in the aggregate counters ever drifts.
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

-- user_badges — one row per (user, badge family). tier=0 means the family
-- is unlocked but no tier completed yet. `progress` is the kid's current
-- count toward the next tier (e.g. games_played for the 'games' family).
CREATE TABLE IF NOT EXISTS user_badges (
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key    VARCHAR(50)  NOT NULL,
  current_tier INTEGER      NOT NULL DEFAULT 0,
  progress     INTEGER      NOT NULL DEFAULT 0,
  unlocked_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, badge_key)
);

-- personal_records — kid's own bests. Persist across streak resets.
CREATE TABLE IF NOT EXISTS personal_records (
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_key  VARCHAR(50)  NOT NULL,
  value       INTEGER      NOT NULL DEFAULT 0,
  achieved_at DATE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, record_key)
);

-- ============================================================
-- daily_digests (Phase 6.7 — immutable daily digest)
-- ============================================================
-- One row per calendar day (America/New_York). Generated once by whoever
-- (cron or first container boot) calls generateDigest() that day; locked
-- in via ON CONFLICT DO NOTHING. Every visitor for the rest of that day
-- reads the SAME row → identical content even across container redeploys.
--
-- `content` is the full JSON payload that buildHTML() consumes — scoreboard,
-- stories, didYouKnow, wordOfDay, dailyChallenge, etc. Stored as JSONB so we
-- can query/filter individual fields if a future report needs them.
CREATE TABLE IF NOT EXISTS daily_digests (
  digest_date    DATE         PRIMARY KEY,
  content        JSONB        NOT NULL,
  generated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS daily_digests_generated_at_idx
  ON daily_digests (generated_at DESC);
