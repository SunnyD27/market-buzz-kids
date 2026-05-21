/**
 * src/storage.js — In-memory store for Phase 5.
 *
 * Mirrors src/schema.sql exactly. Every helper returns plain objects
 * with the same shape Neon will return in Phase 6, so swapping the
 * backend is a search-and-replace of these helpers.
 *
 * State is process-local: lost on server restart. That's fine for
 * Phase 5 — the goal is end-to-end UX validation (signup → verify
 * URL → activate flips), not durability.
 *
 * Logs every state change to console so you can watch signups stream
 * in during local testing.
 */

import { randomUUID, randomBytes } from 'crypto';

// ---- State buckets (private to this module) ------------------------------

/** Map<userId, userRow> */
const users = new Map();
/** Map<token, tokenRow> */
const tokens = new Map();
/** Array<deletionRequestRow> */
const deletionRequests = [];

// ---- Helpers -------------------------------------------------------------

function nowIso() { return new Date().toISOString(); }
function newToken() { return randomBytes(32).toString('hex'); }
function tokenTtlIso(days) {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

function emailKey(email) { return String(email || '').trim().toLowerCase(); }

/** Find an active (non-deleted) user by parent email. */
function findActiveUserByEmail(email) {
  const key = emailKey(email);
  for (const u of users.values()) {
    if (u.deleted_at === null && emailKey(u.parent_email) === key) return u;
  }
  return null;
}

function findUserById(id) {
  return users.get(id) || null;
}

// ---- User lifecycle ------------------------------------------------------

/**
 * Create a fresh user from validated signup input.
 * Returns the user row (which Phase 6 will be a Postgres returning row).
 *
 * Side effects: also creates the appropriate token row (email_verify OR
 * parental_consent) and returns it alongside.
 */
function createUserFromSignup(input) {
  // input is already validated by the route — we don't re-validate here.
  // Caller responsibility: ensure parent_email/kid_first_name/kid_age set.
  const consentRequired = input.kid_age >= 10 && input.kid_age <= 12;
  const user = {
    id: randomUUID(),

    parent_email: input.parent_email.trim(),
    kid_first_name: input.kid_first_name.trim(),
    kid_age: input.kid_age,

    invest_experience: input.invest_experience || null,
    referral_source: input.referral_source || null,

    utm_source: input.utm_source || null,
    utm_medium: input.utm_medium || null,
    utm_campaign: input.utm_campaign || null,
    utm_content: input.utm_content || null,
    utm_term: input.utm_term || null,

    user_agent: input.user_agent || null,
    device_type: input.device_type || 'unknown',
    timezone: input.timezone || null,
    signup_ip: input.signup_ip || null,
    signup_at: nowIso(),

    email_verified: false,
    email_verified_at: null,

    consent_required: consentRequired,
    consent_given: false,
    consent_method: null,
    consent_timestamp: null,
    consent_ip: null,

    is_active: false,

    push_subscription: null,

    deleted_at: null,
    deletion_reason: null,

    created_at: nowIso(),
    updated_at: nowIso(),
  };
  users.set(user.id, user);

  // Create the appropriate token. Ages 10-12 get a 'parental_consent'
  // token; ages 13-16 get an 'email_verify' token. Both expire in 7 days.
  const purpose = consentRequired ? 'parental_consent' : 'email_verify';
  const tokenRow = {
    token: newToken(),
    user_id: user.id,
    purpose,
    expires_at: tokenTtlIso(7),
    used_at: null,
    created_at: nowIso(),
  };
  tokens.set(tokenRow.token, tokenRow);

  console.log(`[storage] created user ${user.id} (${user.parent_email}, age ${user.kid_age}, consent_required=${consentRequired}, token=${tokenRow.token.slice(0,8)}...)`);

  return { user, tokenRow };
}

/**
 * Validate + consume a token. Returns:
 *   { ok: true, user, token, action: 'email_verified' | 'consent_granted' }
 *   { ok: false, reason: 'not_found' | 'expired' | 'already_used' | 'user_missing' }
 *
 * On success, mutates the user row to reflect the new state and marks the
 * token as used. Also flips is_active if both verification and (any required)
 * consent are satisfied.
 */
function consumeToken(rawToken, opts = {}) {
  const t = tokens.get(rawToken);
  if (!t) return { ok: false, reason: 'not_found' };
  if (t.used_at) return { ok: false, reason: 'already_used' };
  if (new Date(t.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  const user = users.get(t.user_id);
  if (!user || user.deleted_at) return { ok: false, reason: 'user_missing' };

  t.used_at = nowIso();
  user.updated_at = nowIso();

  let action;
  if (t.purpose === 'email_verify') {
    user.email_verified = true;
    user.email_verified_at = nowIso();
    action = 'email_verified';
  } else if (t.purpose === 'parental_consent') {
    user.consent_given = true;
    user.consent_method = 'email-plus';
    user.consent_timestamp = nowIso();
    user.consent_ip = opts.ip || null;
    // For ages 10-12, the consent click ALSO implies parent confirmed email.
    user.email_verified = true;
    user.email_verified_at = nowIso();
    action = 'consent_granted';
  }

  // Activate the account if everything required is satisfied.
  const consentSatisfied = !user.consent_required || user.consent_given;
  if (user.email_verified && consentSatisfied && !user.is_active) {
    user.is_active = true;
    console.log(`[storage] activated user ${user.id} (${user.parent_email})`);
  }

  return { ok: true, user, token: t, action };
}

// ---- Deletion ------------------------------------------------------------

function recordDeletionRequest(input) {
  const req = {
    id: randomUUID(),
    parent_email: input.parent_email.trim(),
    reason: input.reason || null,
    requested_at: nowIso(),
    requested_ip: input.requested_ip || null,
    user_agent: input.user_agent || null,
    matched_user_id: null,
    processed_at: null,
    processed_method: null,
  };

  // Match against an active user. If found, soft-delete immediately
  // (process_method: 'automatic'). Phase 6 might add manual review for
  // tricky cases.
  const matched = findActiveUserByEmail(input.parent_email);
  if (matched) {
    matched.deleted_at = nowIso();
    matched.deletion_reason = input.reason || null;
    matched.is_active = false;
    matched.updated_at = nowIso();
    req.matched_user_id = matched.id;
    req.processed_at = nowIso();
    req.processed_method = 'automatic';
    console.log(`[storage] processed deletion for user ${matched.id} (${matched.parent_email})`);
  } else {
    console.log(`[storage] deletion request logged for unmatched email: ${input.parent_email}`);
  }

  deletionRequests.push(req);
  return req;
}

// ---- Stats (for /health or admin) ---------------------------------------

function counts() {
  let active = 0, pending = 0, deleted = 0;
  for (const u of users.values()) {
    if (u.deleted_at) deleted++;
    else if (u.is_active) active++;
    else pending++;
  }
  return { total: users.size, active, pending, deleted, deletion_requests: deletionRequests.length };
}

// ---- Module surface ------------------------------------------------------

export const storage = {
  createUserFromSignup,
  consumeToken,
  recordDeletionRequest,
  findActiveUserByEmail,
  findUserById,
  counts,
};
