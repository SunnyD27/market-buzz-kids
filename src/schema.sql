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
  -- parent_email is NON-unique as of the multi-kid feature — one parent
  -- email can have several active child rows (siblings). The lookup index
  -- `idx_users_parent_email` (deleted_at IS NULL) keeps parent-email queries
  -- fast without enforcing uniqueness.
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
  -- Session invalidation: bumped on password reset so old signed cookies
  -- (which carry the version) stop validating. See src/auth.js.
  session_version     INTEGER      NOT NULL DEFAULT 1,
  -- Last login / digest-view activity, for the 12-month inactivity sweep.
  last_active_at      TIMESTAMPTZ,

  -- Push (Phase 4 PWA support; populated when kid subscribes)
  push_subscription   JSONB,

  -- Soft-delete (parent-initiated deletion request fulfillment)
  deleted_at          TIMESTAMPTZ,
  deletion_reason     VARCHAR(120),

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Parent-email lookup index. NON-unique as of the multi-kid feature — a
-- single parent email can register multiple children (siblings), so we no
-- longer enforce one-active-user-per-email. Case-insensitive, active rows
-- only. (Was a UNIQUE index pre-multi-kid; see
-- src/migrations/add-multi-kid-support.sql for the drop+recreate.)
CREATE INDEX IF NOT EXISTS idx_users_parent_email
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
  purpose       VARCHAR(20)  NOT NULL CHECK (purpose IN ('email_verify', 'parental_consent', 'password_reset', 'add_child_consent', 'delete_data')),
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

-- ============================================================
-- email_events (Phase 13 — Resend webhook deliverability log)
-- ============================================================
-- Append-only log of Resend webhook events (sent/delivered/opened/clicked/
-- bounced/complained). Drives the Email Analytics card on /admin. `email_kind`
-- is the 'kind' tag we attach on send (teaser, evening-recap, verify, …) so
-- deliverability can be sliced by email type. `recipient` is the parent email
-- the message went to — scrubbed by storage.recordDeletionRequest() when the
-- last child under that address is deleted (COPPA).
CREATE TABLE IF NOT EXISTS email_events (
  id            BIGSERIAL    PRIMARY KEY,
  email_id      VARCHAR(255),
  event_type    VARCHAR(50)  NOT NULL,
  recipient     VARCHAR(255),
  email_kind    VARCHAR(50),
  subject       TEXT,
  event_data    JSONB        NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_events_type
  ON email_events (event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_created
  ON email_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_events_kind
  ON email_events (email_kind);

-- ============================================================
-- content_history (Phase 16 — AI content rotation, was a state file)
-- ============================================================
-- Tracks recently-used AI picks so the next generation avoids repeats:
-- 'word' (Word of the Day), 'fact' (Did You Know), 'mystery' (Mystery
-- Mover answer tickers — the 30-day no-repeat rotation). Replaces the
-- ephemeral state/content-history.json (wiped on every Railway restart —
-- the known wart). Pruned to the newest ~100 rows per kind on insert.
--
-- COPPA: AI-content rotation metadata, NOT user PII — intentionally out
-- of scope for the deletion scrub (same reasoning as pending_glossary).
CREATE TABLE IF NOT EXISTS content_history (
  id          BIGSERIAL    PRIMARY KEY,
  kind        TEXT         NOT NULL CHECK (kind IN ('word', 'fact', 'mystery')),
  value       TEXT         NOT NULL,
  used_on     DATE         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_history_kind_date
  ON content_history (kind, used_on DESC);

-- ============================================================
-- push_log (Phase 15 — push notification ledger)
-- ============================================================
-- One row per push notification sent (or reserved) to a kid. Written
-- BEFORE the send so the hourly sweeps are idempotent: the unique index
-- on (user_id, kind, digest_date) is the per-kind daily dedup, and the
-- INSERT in src/push.js#tryLogPush carries a COUNT guard enforcing the
-- hard 2-pushes-per-kid-per-day cap. digest_date is the product's NY day
-- (todayNY()) — sent_at is a UTC timestamp and can't dedup "per day"
-- across timezones on its own. On a transient send failure the reserved
-- row is deleted so the failure doesn't consume the kid's daily slot.
--
-- COPPA: per-user data — deleted in storage.recordDeletionRequest()'s
-- scrub transaction (the soft-delete model means ON DELETE CASCADE never
-- fires; the explicit DELETE there is the real path).
CREATE TABLE IF NOT EXISTS push_log (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT         NOT NULL CHECK (kind IN ('morning', 'streak-risk')),
  digest_date DATE         NOT NULL,
  sent_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_log_user_kind_date_uniq
  ON push_log (user_id, kind, digest_date);

-- ============================================================
-- pending_glossary (Glossary auto-grow — AI nomination gate)
-- ============================================================
-- The digest generator (src/ai.js) proposes financial terms that appear in a
-- day's content but aren't in the static seed glossary (src/glossary.js).
-- Proposals land here as 'pending' and surface on /admin for approve / edit /
-- reject. Nothing reaches kids until an adult approves. Approved rows are
-- merged with the static seed at RENDER time (src/glossary-runtime.js), so the
-- glossary grows live with no redeploy.
--
-- Dedup is on LOWER(term): a re-nominated term bumps times_seen +
-- last_seen_date instead of inserting a duplicate, so recurring terms float to
-- the top of the review queue. Rejected rows are KEPT (status='rejected') so
-- the same term isn't re-nominated into the queue forever.
--
-- COPPA: these are AI-generated market-vocabulary rows, NOT user PII — they are
-- intentionally OUT OF SCOPE for storage.recordDeletionRequest()'s scrub.
-- first_seen_date / last_seen_date are NY date strings (todayNY()); approved_at
-- timestamps approval (drives the "NEW" auto-grow tag in the template).
CREATE TABLE IF NOT EXISTS pending_glossary (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  term            TEXT         NOT NULL,
  definition      TEXT         NOT NULL,
  principle       INT,
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  times_seen      INT          NOT NULL DEFAULT 1,
  first_seen_date TEXT,
  last_seen_date  TEXT,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness so re-nominations dedup via ON CONFLICT
-- (LOWER(term)). term is NOT NULL, so unlike the users.username index this one
-- needs no partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS pending_glossary_term_lower_uniq
  ON pending_glossary (LOWER(term));

-- Review-queue ordering: by status, most-seen first.
CREATE INDEX IF NOT EXISTS pending_glossary_status_idx
  ON pending_glossary (status, times_seen DESC);
