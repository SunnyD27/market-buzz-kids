-- src/schema.sql — Market Buzz Kids · Neon PostgreSQL schema
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
  parent_email        VARCHAR(255) NOT NULL,
  kid_first_name      VARCHAR(100) NOT NULL,
  kid_age             INT          NOT NULL CHECK (kid_age BETWEEN 10 AND 16),

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

-- ============================================================
-- verification_tokens
-- ============================================================
-- One row per outstanding link (verify-email OR parental-consent).
-- Phase 6 emails the URL containing `token`; clicking it hits the
-- relevant endpoint which marks the user verified / consented.
CREATE TABLE IF NOT EXISTS verification_tokens (
  token         VARCHAR(64)  PRIMARY KEY,        -- 32-byte hex, generated at signup
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose       VARCHAR(20)  NOT NULL CHECK (purpose IN ('email_verify', 'parental_consent')),
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
-- engagement (already designed in CONTEXT.md; included for reference,
-- wired in Phase 6 when we move XP/streak server-side for parent dashboard)
-- ============================================================
-- Phase 5 keeps engagement client-side in localStorage (see public/engagement.js).
-- This table is a future-proofing placeholder.
CREATE TABLE IF NOT EXISTS engagement (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         REFERENCES users(id) ON DELETE CASCADE,
  day           DATE         NOT NULL,
  email_opened  BOOLEAN      NOT NULL DEFAULT FALSE,
  page_viewed   BOOLEAN      NOT NULL DEFAULT FALSE,
  games_played  INT          NOT NULL DEFAULT 0,  -- 0-3
  games_correct INT          NOT NULL DEFAULT 0,
  perfect_day   BOOLEAN      NOT NULL DEFAULT FALSE,
  xp_earned     INT          NOT NULL DEFAULT 0,
  streak_count  INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, day)
);

CREATE INDEX IF NOT EXISTS engagement_day_idx ON engagement (day);

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
