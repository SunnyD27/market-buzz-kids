/**
 * src/storage.js — Postgres-backed storage (Phase 6.1).
 *
 * Same public surface as the Phase 5 in-memory store, but every helper now
 * round-trips to Neon via src/db.js. All helpers are async — callers must
 * `await` them.
 *
 * Tables (see src/schema.sql):
 *   users                  — one row per signup, soft-deleted via deleted_at
 *   verification_tokens    — one row per outstanding verify/consent link
 *   deletion_requests      — audit log of parent-initiated deletions
 *
 * Two operations span multiple rows and use transactions:
 *   createUserFromSignup — INSERT user + INSERT token
 *   consumeToken         — UPDATE token + UPDATE user (+ flip is_active)
 *   recordDeletionRequest — UPDATE user (soft-delete) + INSERT deletion_request
 */

import { randomBytes } from 'crypto';
import { query, getClient } from './db.js';

// ---- Helpers -------------------------------------------------------------

function newToken() { return randomBytes(32).toString('hex'); }

function tokenExpiry(days) {
  return new Date(Date.now() + days * 86400_000);
}

function emailKey(email) { return String(email || '').trim().toLowerCase(); }

// ---- Lookups -------------------------------------------------------------

/** Find an active (non-deleted) user by parent email. Case-insensitive. */
async function findActiveUserByEmail(email) {
  const { rows } = await query(
    `SELECT * FROM users
      WHERE LOWER(parent_email) = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [emailKey(email)]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
}

// ---- Multi-kid helpers ---------------------------------------------------

/**
 * All active, non-deleted children registered under a parent email.
 * Case-insensitive match (stored emails preserve original case; the index
 * is on LOWER()). Ordered oldest-first so UI lists are stable.
 */
async function getActiveChildrenByParentEmail(parentEmail) {
  const { rows } = await query(
    `SELECT id, kid_first_name, username, kid_age, created_at
       FROM users
      WHERE LOWER(parent_email) = $1
        AND is_active = TRUE
        AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [emailKey(parentEmail)]
  );
  return rows;
}

/**
 * Is this a "known parent"? — i.e. do they already have at least one
 * active, email-verified, non-deleted child? If so, the signup flow takes
 * the abbreviated path (skip re-verifying the email; still email-gate the
 * per-child consent).
 *
 * NB: intentionally does NOT require consent_given. COPPA consent is only
 * collected for ages 10-12; a parent whose only existing child is 13-16
 * has consent_given=false but is just as proven. email_verified is the
 * real "we know this parent" signal.
 */
async function isKnownConsentedParent(parentEmail) {
  const { rows } = await query(
    `SELECT 1
       FROM users
      WHERE LOWER(parent_email) = $1
        AND is_active = TRUE
        AND deleted_at IS NULL
        AND email_verified = TRUE
      LIMIT 1`,
    [emailKey(parentEmail)]
  );
  return rows.length > 0;
}

// ---- User lifecycle ------------------------------------------------------

/**
 * Create a fresh user + its verify/consent token in one transaction.
 * Returns { user, tokenRow } — same shape Phase 5 returned.
 *
 * Multi-kid: when `input.knownParent` is true (the parent already has an
 * active, email-verified child under this email), we take the abbreviated
 * path — the row is created with `email_verified = true` (the email is
 * already proven, so we skip re-verification) and the token uses purpose
 * 'add_child_consent'. The parent still clicks an emailed consent link to
 * activate the child (consent stays email-gated — same proof level as the
 * first child), but they don't have to re-verify their address first.
 */
async function createUserFromSignup(input) {
  const consentRequired = input.kid_age >= 10 && input.kid_age <= 12;
  const knownParent = input.knownParent === true;
  // Known parent → abbreviated consent token; otherwise the normal
  // age-based purpose (consent for 10-12, verify for 13-16).
  const purpose = knownParent
    ? 'add_child_consent'
    : (consentRequired ? 'parental_consent' : 'email_verify');
  const token = newToken();
  const expiresAt = tokenExpiry(7);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const userInsert = await client.query(
      `INSERT INTO users (
        parent_email, kid_first_name, kid_age,
        invest_experience, referral_source,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        user_agent, device_type, timezone, signup_ip,
        consent_required, email_verified,
        username, password_hash
      ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16,
        $17, $18
      )
      RETURNING *`,
      [
        input.parent_email.trim(),
        input.kid_first_name.trim(),
        input.kid_age,
        input.invest_experience || null,
        input.referral_source || null,
        input.utm_source || null,
        input.utm_medium || null,
        input.utm_campaign || null,
        input.utm_content || null,
        input.utm_term || null,
        input.user_agent || null,
        input.device_type || 'unknown',
        input.timezone || null,
        input.signup_ip || null,
        consentRequired,
        // Known parent: email already proven via the first child, so the
        // row goes in pre-verified. New parent: stays false until they
        // click the verify/consent link.
        knownParent,
        // Phase 7 — both nullable. createUserFromSignup callers that
        // pre-date kid-auth (none in this codebase, but defensive) just
        // omit these and the row goes in with NULL/NULL. POST /api/signup
        // requires them and validates upstream.
        input.username ? input.username.trim() : null,
        input.password_hash || null,
      ]
    );
    const user = userInsert.rows[0];

    const tokenInsert = await client.query(
      `INSERT INTO verification_tokens (token, user_id, purpose, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [token, user.id, purpose, expiresAt]
    );
    const tokenRow = tokenInsert.rows[0];

    await client.query('COMMIT');

    console.log(`[storage] created user ${user.id} (${user.parent_email}, age ${user.kid_age}, consent_required=${consentRequired}, knownParent=${knownParent}, purpose=${purpose}, token=${token.slice(0, 8)}...)`);

    return { user, tokenRow };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Validate + consume a token. Returns:
 *   { ok: true, user, token, action: 'email_verified' | 'consent_granted' }
 *   { ok: false, reason: 'not_found' | 'expired' | 'already_used' | 'user_missing' }
 *
 * On success, marks the token used and applies the matching state change to
 * the user (and flips is_active if all gates are satisfied). All in one tx.
 */
async function consumeToken(rawToken, opts = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const tokRes = await client.query(
      `SELECT * FROM verification_tokens WHERE token = $1 FOR UPDATE`,
      [rawToken]
    );
    const t = tokRes.rows[0];
    if (!t) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }
    if (t.used_at) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'already_used' };
    }
    if (new Date(t.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'expired' };
    }

    const userRes = await client.query(
      `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
      [t.user_id]
    );
    const userRow = userRes.rows[0];
    if (!userRow || userRow.deleted_at) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'user_missing' };
    }

    // Mark token used.
    const tokUpd = await client.query(
      `UPDATE verification_tokens SET used_at = NOW() WHERE token = $1 RETURNING *`,
      [rawToken]
    );

    let action;
    let updatedUser;
    if (t.purpose === 'email_verify') {
      const r = await client.query(
        `UPDATE users
            SET email_verified = TRUE,
                email_verified_at = NOW(),
                is_active = (TRUE AND (NOT consent_required OR consent_given)),
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [userRow.id]
      );
      updatedUser = r.rows[0];
      action = 'email_verified';
    } else if (t.purpose === 'parental_consent') {
      // Consent click also implies the parent confirmed their email.
      const r = await client.query(
        `UPDATE users
            SET consent_given = TRUE,
                consent_method = 'email-plus',
                consent_timestamp = NOW(),
                consent_ip = $2,
                email_verified = TRUE,
                email_verified_at = NOW(),
                is_active = TRUE,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [userRow.id, opts.ip || null]
      );
      updatedUser = r.rows[0];
      action = 'consent_granted';
    } else if (t.purpose === 'add_child_consent') {
      // Multi-kid abbreviated flow. The row was created pre-verified
      // (email already proven via a sibling), so we just record consent
      // and activate. consent_given is only meaningful for ages 10-12
      // (consent_required) — for 13-16 it stays FALSE but the account
      // still activates because consent isn't required. consent_method
      // marks this as the known-parent path for audit purposes.
      const r = await client.query(
        `UPDATE users
            SET consent_given = (CASE WHEN consent_required THEN TRUE ELSE consent_given END),
                consent_method = 'known_parent_click',
                consent_timestamp = NOW(),
                consent_ip = $2,
                email_verified = TRUE,
                email_verified_at = COALESCE(email_verified_at, NOW()),
                is_active = TRUE,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [userRow.id, opts.ip || null]
      );
      updatedUser = r.rows[0];
      action = 'child_added';
    } else {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }

    await client.query('COMMIT');

    if (updatedUser.is_active && !userRow.is_active) {
      console.log(`[storage] activated user ${updatedUser.id} (${updatedUser.parent_email})`);
    }

    return { ok: true, user: updatedUser, token: tokUpd.rows[0], action };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Atomically consume a password_reset token and apply the new password.
 *
 * The token is validated AND consumed in a single UPDATE ... RETURNING so two
 * concurrent reset clicks can't both pass (only one row flips used_at). The
 * password write and the session_version bump ride in the SAME transaction:
 * bumping session_version invalidates every cookie issued before the reset
 * (see requireAuth in auth.js), which is the whole point of a reset — lock out
 * a session the parent believes was stolen or shared.
 *
 * `passwordHash` must be pre-computed (bcrypt is slow; don't hold a tx open
 * across it).
 *
 * Returns { ok: true, userId } on success, or
 *         { ok: false, reason: 'invalid' } if the token was missing, expired,
 *         already used, or not a password_reset token.
 */
async function resetPasswordWithToken(rawToken, passwordHash) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const tokRes = await client.query(
      `UPDATE verification_tokens
          SET used_at = NOW()
        WHERE token = $1
          AND purpose = 'password_reset'
          AND used_at IS NULL
          AND expires_at > NOW()
        RETURNING user_id`,
      [rawToken]
    );
    const consumed = tokRes.rows[0];
    if (!consumed) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'invalid' };
    }

    const userRes = await client.query(
      `UPDATE users
          SET password_hash = $1,
              session_version = session_version + 1,
              updated_at = NOW()
        WHERE id = $2
          AND deleted_at IS NULL
        RETURNING id`,
      [passwordHash, consumed.user_id]
    );
    if (userRes.rows.length === 0) {
      // Token pointed at a scrubbed/deleted user — don't leave a half-applied
      // reset. Roll the token consumption back too.
      await client.query('ROLLBACK');
      return { ok: false, reason: 'invalid' };
    }

    await client.query('COMMIT');
    console.log(`[storage] password reset applied for user ${consumed.user_id} (session_version bumped)`);
    return { ok: true, userId: consumed.user_id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---- Deletion ------------------------------------------------------------

/**
 * Record a parent-initiated deletion request. If an active user matches the
 * parent_email, soft-delete them in the same transaction.
 *
 * Multi-kid: pass `input.userId` to target a SPECIFIC child (the deletion
 * still verifies that child belongs to `parent_email`, so a parent can't
 * delete some other family's kid by guessing an id). Without `userId` we
 * fall back to the original "match one active user by email" behavior
 * (single-kid backward compat).
 *
 * Returns the deletion_requests audit row, plus `matchedKidName` (captured
 * BEFORE the scrub overwrites kid_first_name) so callers can build a
 * per-kid acknowledgment email.
 */
async function recordDeletionRequest(input) {
  const parentEmail = input.parent_email.trim();
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Match against an active user. With userId, target that specific
    // child but STILL require it to belong to this parent email — defends
    // against a forged id deleting someone else's account.
    const matchRes = input.userId
      ? await client.query(
          `SELECT id, parent_email, kid_first_name FROM users
            WHERE id = $1
              AND LOWER(parent_email) = $2
              AND deleted_at IS NULL
            FOR UPDATE
            LIMIT 1`,
          [input.userId, emailKey(parentEmail)]
        )
      : await client.query(
          `SELECT id, parent_email, kid_first_name FROM users
            WHERE LOWER(parent_email) = $1 AND deleted_at IS NULL
            FOR UPDATE
            LIMIT 1`,
          [emailKey(parentEmail)]
        );
    const matched = matchRes.rows[0] || null;
    const matchedKidName = matched ? matched.kid_first_name : null;

    let matchedUserId = null;
    let processedAt = null;
    let processedMethod = null;

    if (matched) {
      // COPPA deletion: scrub PII in the same transaction as the
      // soft-delete. The row itself stays as an operational tombstone
      // (id + deleted_at + is_active + created_at + email_verified /
      // consent_* metadata for compliance audits), but every identifying
      // field is overwritten so the row can't be reconstructed back into
      // a person.
      //
      // kid_first_name gets the sentinel 'deleted' rather than NULL —
      // the column is NOT NULL and a few code paths read it without a
      // null guard; this keeps them from crashing if they ever fire
      // against a tombstone row (in practice they shouldn't, since all
      // active-user queries filter on deleted_at IS NULL).
      //
      // username + parent_email NULL out cleanly because the unique
      // indexes on those columns are partial (username IS NOT NULL /
      // deleted_at IS NULL respectively) — see src/schema.sql. So the
      // same email or username can be re-used by a fresh signup.
      //
      // Fingerprintable signup-time metadata is scrubbed in the same pass
      // as the core identity fields: IPs (signup + consent), user agent,
      // device type, timezone, and the three UTM fields a signup URL most
      // commonly carries (source/medium/campaign). All eight columns were
      // already nullable in the schema — no migration needed for this set.
      //
      // Two utm_* columns (utm_content, utm_term) and the survey columns
      // (invest_experience, referral_source) stay populated. They're not
      // PII on their own, they're useful for product analytics on
      // aggregate signups, and they don't reconstruct back to a person
      // once the identity fields above are gone.
      await client.query(
        `UPDATE users
            SET deleted_at = NOW(),
                deletion_reason = $2,
                is_active = FALSE,
                kid_first_name = 'deleted',
                kid_age = NULL,
                parent_email = NULL,
                username = NULL,
                password_hash = NULL,
                push_subscription = NULL,
                signup_ip = NULL,
                consent_ip = NULL,
                user_agent = NULL,
                device_type = NULL,
                timezone = NULL,
                utm_source = NULL,
                utm_medium = NULL,
                utm_campaign = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [matched.id, input.reason || null]
      );

      // Phase 11: scrub engagement tables in the same transaction.
      // ON DELETE CASCADE on user_id would also handle this if we ever
      // hard-deleted the user row, but the deletion model here is
      // soft-delete + PII scrub, so the cascade never fires — we have to
      // DELETE explicitly. Order doesn't matter (all keyed on user_id).
      await client.query(`DELETE FROM engagement_events WHERE user_id = $1`, [matched.id]);
      await client.query(`DELETE FROM user_badges       WHERE user_id = $1`, [matched.id]);
      await client.query(`DELETE FROM personal_records  WHERE user_id = $1`, [matched.id]);
      await client.query(`DELETE FROM user_progress     WHERE user_id = $1`, [matched.id]);

      // Remove any outstanding verification/consent/reset tokens for this
      // user — they're useless once the row is scrubbed and would otherwise
      // linger forever (ON DELETE CASCADE never fires under soft-delete).
      await client.query(`DELETE FROM verification_tokens WHERE user_id = $1`, [matched.id]);

      matchedUserId = matched.id;
      processedAt = new Date();
      // Caller may override the audit method (e.g. the abandoned-consent
      // cleanup cron records 'automatic-consent-expired'). Defaults to
      // 'automatic' for the parent-initiated flow.
      processedMethod = input.processed_method || 'automatic';
    }

    const reqRes = await client.query(
      `INSERT INTO deletion_requests (
         parent_email, reason, requested_ip, user_agent,
         matched_user_id, processed_at, processed_method
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        parentEmail,
        input.reason || null,
        input.requested_ip || null,
        input.user_agent || null,
        matchedUserId,
        processedAt,
        processedMethod,
      ]
    );

    await client.query('COMMIT');

    if (matched) {
      console.log(`[storage] processed deletion for user ${matched.id} (${matched.parent_email})`);
    } else {
      console.log(`[storage] deletion request logged for unmatched email: ${parentEmail}`);
    }

    // matchedKidName captured before the scrub — callers use it to build a
    // per-kid acknowledgment email.
    return { ...reqRes.rows[0], matchedKidName };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---- Token-gated deletion (Fix 5) ----------------------------------------

/**
 * Create a single-use 'delete_data' token for a parent email, so the parent
 * must prove control of the inbox before seeing/deleting any child data.
 *
 * The token is anchored to one active child row (we only use it to recover
 * the parent_email later — every child under that email is in scope). Returns
 * { token, childCount } when at least one active child exists, or null when
 * none do (caller then sends no email but still returns a generic response,
 * preserving the no-account-existence-leak property).
 */
async function createDeleteDataToken(parentEmail) {
  const children = await getActiveChildrenByParentEmail(parentEmail);
  if (!children.length) return null;
  const anchor = children[0];
  const token = newToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await query(
    `INSERT INTO verification_tokens (token, user_id, purpose, expires_at)
     VALUES ($1, $2, 'delete_data', $3)`,
    [token, anchor.id, expiresAt]
  );
  return { token, childCount: children.length };
}

/**
 * Validate a 'delete_data' token. Returns { parentEmail } when valid (not
 * used, not expired, anchor row still present), else null.
 *
 * opts.consume === true marks the token used in the same transaction — used
 * on the actual delete step. The child-list step passes consume=false so the
 * parent can review the list and confirm within the 1-hour window before the
 * token is burned.
 */
async function validateDeleteDataToken(rawToken, opts = {}) {
  const consume = opts.consume === true;
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT t.token, t.used_at, t.expires_at, u.parent_email
         FROM verification_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token = $1 AND t.purpose = 'delete_data'
        FOR UPDATE OF t`,
      [rawToken]
    );
    const t = rows[0];
    if (!t || t.used_at || new Date(t.expires_at).getTime() < Date.now() || !t.parent_email) {
      await client.query('ROLLBACK');
      return null;
    }
    if (consume) {
      await client.query(`UPDATE verification_tokens SET used_at = NOW() WHERE token = $1`, [rawToken]);
    }
    await client.query('COMMIT');
    return { parentEmail: t.parent_email };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---- Retention cleanup ---------------------------------------------------

/**
 * COPPA retention: delete signups where a parent never completed consent.
 *
 * The privacy policy promises that data collected at signup for an under-13
 * child is removed if the parent doesn't consent within 7 days. The consent
 * token already expires at 7 days, so these rows are permanently stuck
 * inactive — scrub them.
 *
 * Reuses recordDeletionRequest (the same PII-scrub + audit path the
 * parent-initiated deletion uses), tagging the audit row with
 * processed_method='automatic-consent-expired'. Per-user failures are logged
 * and skipped so one bad row doesn't abort the whole sweep.
 *
 * Returns { found, cleaned }.
 */
async function cleanupAbandonedSignups() {
  const { rows: abandoned } = await query(
    `SELECT id, parent_email, kid_first_name
       FROM users
      WHERE consent_required = TRUE
        AND consent_given = FALSE
        AND created_at < NOW() - INTERVAL '7 days'
        AND deleted_at IS NULL`
  );

  let cleaned = 0;
  for (const user of abandoned) {
    try {
      await recordDeletionRequest({
        parent_email: user.parent_email,
        userId: user.id,
        reason: 'consent not completed within 7 days',
        processed_method: 'automatic-consent-expired',
        user_agent: 'system-cron',
      });
      cleaned++;
      console.log(`[cleanup] scrubbed abandoned signup: user ${user.id}`);
    } catch (err) {
      console.error(`[cleanup] failed to scrub user ${user.id}:`, err.message);
    }
  }

  return { found: abandoned.length, cleaned };
}

/**
 * Retention: delete accounts inactive for 12+ months.
 *
 * The privacy policy promises inactive accounts are auto-deleted after a year.
 * "Inactive" = no login / digest view in 12 months (users.last_active_at);
 * accounts that never recorded activity fall back to created_at so legacy rows
 * without last_active_at still age out.
 *
 * Reuses recordDeletionRequest (same PII-scrub + audit path), audit method
 * 'automatic-inactivity'. Per-user failures are logged and skipped.
 *
 * Returns { found, cleaned }.
 */
async function cleanupInactiveAccounts() {
  const { rows: inactive } = await query(
    `SELECT id, parent_email, kid_first_name, last_active_at
       FROM users
      WHERE is_active = TRUE
        AND deleted_at IS NULL
        AND (
          (last_active_at IS NOT NULL AND last_active_at < NOW() - INTERVAL '12 months')
          OR
          (last_active_at IS NULL AND created_at < NOW() - INTERVAL '12 months')
        )`
  );

  let cleaned = 0;
  for (const user of inactive) {
    try {
      await recordDeletionRequest({
        parent_email: user.parent_email,
        userId: user.id,
        reason: 'inactive 12+ months',
        processed_method: 'automatic-inactivity',
        user_agent: 'system-cron',
      });
      cleaned++;
      console.log(`[cleanup] scrubbed inactive account: user ${user.id} (last active: ${user.last_active_at || 'never'})`);
    } catch (err) {
      console.error(`[cleanup] failed to scrub inactive user ${user.id}:`, err.message);
    }
  }

  return { found: inactive.length, cleaned };
}

// ---- Stats ---------------------------------------------------------------

async function counts() {
  const { rows } = await query(
    `SELECT
       COUNT(*)::int                                                       AS total,
       COUNT(*) FILTER (WHERE is_active = TRUE AND deleted_at IS NULL)::int AS active,
       COUNT(*) FILTER (WHERE is_active = FALSE AND deleted_at IS NULL)::int AS pending,
       COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int                  AS deleted
     FROM users`
  );
  const reqRes = await query(`SELECT COUNT(*)::int AS n FROM deletion_requests`);
  return {
    total: rows[0].total,
    active: rows[0].active,
    pending: rows[0].pending,
    deleted: rows[0].deleted,
    deletion_requests: reqRes.rows[0].n,
  };
}

// ---- Module surface ------------------------------------------------------

export const storage = {
  createUserFromSignup,
  consumeToken,
  resetPasswordWithToken,
  recordDeletionRequest,
  createDeleteDataToken,
  validateDeleteDataToken,
  cleanupAbandonedSignups,
  cleanupInactiveAccounts,
  findActiveUserByEmail,
  findUserById,
  getActiveChildrenByParentEmail,
  isKnownConsentedParent,
  counts,
};
