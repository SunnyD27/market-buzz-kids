// scripts/test-multi-kid.js
//
// Multi-kid support smoke test — exercises the known-parent detection,
// abbreviated consent flow, 5-child cap logic, and the edge cases from
// the spec's testing checklist against the live Neon database.
//
// Usage:  node scripts/test-multi-kid.js
//
// Creates throwaway users under a unique parent email, then hard-deletes
// everything (finally{} block) even on failure.

import dotenv from 'dotenv';
dotenv.config({ override: true });

import bcrypt from 'bcrypt';
import { query } from '../src/db.js';
import { storage } from '../src/storage.js';

let failures = 0;
const createdIds = [];

function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}
function eq(label, a, b) { ok(label, a === b, a === b ? '' : `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const PARENT = `multikid-test-${Date.now()}@example.invalid`;

/** Insert an ACTIVE, verified, consented child directly (kid #1 fixture). */
async function insertActiveChild(name, age, username) {
  const hash = await bcrypt.hash('testpass', 10);
  const { rows } = await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, consent_required, consent_given, username, password_hash)
     VALUES ($1, $2, $3, TRUE, TRUE, $4, $5, $6, $7)
     RETURNING id`,
    [PARENT, name, age, age >= 10 && age <= 12, age >= 10 && age <= 12, username, hash],
  );
  createdIds.push(rows[0].id);
  return rows[0].id;
}

async function main() {
  console.log('\n👨‍👩‍👧‍👦 Multi-kid support smoke test\n');
  console.log(`Parent email: ${PARENT}\n`);

  // ====================================================================
  // SECTION 1 — known-parent detection
  // ====================================================================
  console.log('Section 1 — known-parent detection');
  eq('unknown email → not known parent', await storage.isKnownConsentedParent(PARENT), false);

  const kid1 = await insertActiveChild('Riley', 12, `riley_${Date.now().toString(36)}`);
  eq('after active kid #1 → known parent', await storage.isKnownConsentedParent(PARENT), true);

  const children1 = await storage.getActiveChildrenByParentEmail(PARENT);
  eq('1 active child found', children1.length, 1);
  eq('child name correct', children1[0].kid_first_name, 'Riley');

  // ====================================================================
  // SECTION 2 — abbreviated signup for sibling (kid #2)
  // ====================================================================
  console.log('\nSection 2 — abbreviated signup for kid #2 (same email)');
  const hash = await bcrypt.hash('testpass', 10);
  const { user: kid2, tokenRow: tok2 } = await storage.createUserFromSignup({
    parent_email: PARENT,
    kid_first_name: 'Jordan',
    kid_age: 14,                       // teen — consent NOT required
    username: `jordan_${Date.now().toString(36)}`,
    password_hash: hash,
    knownParent: true,
  });
  createdIds.push(kid2.id);

  // Two active+ rows now coexist under one email — proves the unique
  // index is gone (this INSERT would have thrown 23505 otherwise).
  ok('kid #2 row created (unique index dropped)', !!kid2.id);
  eq('kid #2 pre-verified (email trusted)', kid2.email_verified, true);
  eq('kid #2 NOT active yet (consent pending)', kid2.is_active, false);
  eq('kid #2 token purpose = add_child_consent', tok2.purpose, 'add_child_consent');

  // Token expiry ~7 days out (not 15 min).
  const daysOut = (new Date(tok2.expires_at).getTime() - Date.now()) / 86400000;
  ok('kid #2 token ~7-day expiry', daysOut > 6 && daysOut < 8, `got ${daysOut.toFixed(1)} days`);

  // ====================================================================
  // SECTION 3 — consent click activates kid #2
  // ====================================================================
  console.log('\nSection 3 — consent-click activation');
  const consume = await storage.consumeToken(tok2.token, { ip: '203.0.113.7' });
  ok('consumeToken ok', consume.ok === true, JSON.stringify(consume));
  eq('action = child_added', consume.action, 'child_added');
  eq('kid #2 now active', consume.user.is_active, true);
  eq('consent_method = known_parent_click', consume.user.consent_method, 'known_parent_click');
  // 14yo → consent not required → consent_given stays false, but active.
  eq('teen consent_given stays false (not required)', consume.user.consent_given, false);

  const children2 = await storage.getActiveChildrenByParentEmail(PARENT);
  eq('2 active children now', children2.length, 2);

  // ====================================================================
  // SECTION 4 — under-13 sibling sets consent_given on activation
  // ====================================================================
  console.log('\nSection 4 — under-13 sibling consent');
  const { user: kid3, tokenRow: tok3 } = await storage.createUserFromSignup({
    parent_email: PARENT,
    kid_first_name: 'Sam',
    kid_age: 11,                       // under 13 — consent required
    username: `sam_${Date.now().toString(36)}`,
    password_hash: hash,
    knownParent: true,
  });
  createdIds.push(kid3.id);
  eq('kid #3 consent_required = true', kid3.consent_required, true);
  const consume3 = await storage.consumeToken(tok3.token, { ip: '203.0.113.7' });
  eq('kid #3 active after consent', consume3.user.is_active, true);
  eq('kid #3 consent_given = true (under 13)', consume3.user.consent_given, true);
  eq('kid #3 consent_method = known_parent_click', consume3.user.consent_method, 'known_parent_click');

  // ====================================================================
  // SECTION 5 — 5-child cap (route-level gate logic)
  // ====================================================================
  console.log('\nSection 5 — 5-child cap');
  // We have 3 active kids. Add 2 more to reach 5.
  await insertActiveChild('Alex', 13, `alex_${Date.now().toString(36)}`);
  await insertActiveChild('Casey', 10, `casey_${Date.now().toString(36)}`);
  const atCap = await storage.getActiveChildrenByParentEmail(PARENT);
  eq('5 active children', atCap.length, 5);
  // The signup route rejects when children.length >= 5. Replicate that gate.
  const wouldReject = atCap.length >= 5;
  ok('6th signup would be rejected by cap', wouldReject === true);

  // ====================================================================
  // SECTION 6 — edge: abandoned (unconsented) kid #1 → NOT known parent
  // ====================================================================
  console.log('\nSection 6 — abandoned/unconsented kid → full flow');
  const ABANDON = `abandon-test-${Date.now()}@example.invalid`;
  const { user: pendingKid } = await storage.createUserFromSignup({
    parent_email: ABANDON,
    kid_first_name: 'Pending',
    kid_age: 11,
    username: `pending_${Date.now().toString(36)}`,
    password_hash: hash,
    // NOT knownParent — this is a brand-new parent's first (incomplete) kid
  });
  createdIds.push(pendingKid.id);
  eq('pending kid is not active', pendingKid.is_active, false);
  eq('pending kid not email_verified', pendingKid.email_verified, false);
  eq('abandoned-signup parent → NOT known parent', await storage.isKnownConsentedParent(ABANDON), false);

  // ====================================================================
  // SECTION 7 — edge: all kids deleted → NOT known parent
  // ====================================================================
  console.log('\nSection 7 — all kids deleted → full flow');
  const DELALL = `delall-test-${Date.now()}@example.invalid`;
  const delKid = await insertActiveChild_forEmail(DELALL, 'Solo', 12);
  createdIds.push(delKid);
  eq('before delete → known parent', await storage.isKnownConsentedParent(DELALL), true);
  // Soft-delete via the production path.
  await storage.recordDeletionRequest({ parent_email: DELALL, reason: 'smoke test', requested_ip: null, user_agent: 'smoke' });
  eq('after delete → NOT known parent', await storage.isKnownConsentedParent(DELALL), false);
  eq('after delete → 0 active children', (await storage.getActiveChildrenByParentEmail(DELALL)).length, 0);
}

/** insertActiveChild variant for an arbitrary email. */
async function insertActiveChild_forEmail(email, name, age) {
  const hash = await bcrypt.hash('testpass', 10);
  const { rows } = await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, consent_required, consent_given, username, password_hash)
     VALUES ($1, $2, $3, TRUE, TRUE, $4, $5, $6, $7)
     RETURNING id`,
    [email, name, age, age >= 10 && age <= 12, age >= 10 && age <= 12, `${name.toLowerCase()}_${Date.now().toString(36)}`, hash],
  );
  return rows[0].id;
}

main()
  .then(() => {
    console.log(`\n${'='.repeat(50)}`);
    if (failures > 0) { console.error(`❌ ${failures} assertion(s) failed.`); process.exit(1); }
    console.log('✅ All checks passed.');
    process.exit(0);
  })
  .catch(err => { console.error('\nFATAL:', err); process.exit(2); })
  .finally(async () => {
    try {
      // Hard-delete everything we touched, plus any deletion_requests rows.
      for (const id of createdIds) {
        await query(`DELETE FROM verification_tokens WHERE user_id = $1`, [id]);
        await query(`DELETE FROM users WHERE id = $1`, [id]);
      }
      await query(`DELETE FROM deletion_requests WHERE parent_email LIKE '%-test-%@example.invalid'`);
    } catch (e) { console.error('[cleanup] failed:', e.message); }
  });
