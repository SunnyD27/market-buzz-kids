// scripts/test-multi-kid-emails.js
//
// Batch C+D smoke test for multi-kid: morning teaser dedup, consolidated
// password-reset email, per-kid deletion (recordDeletionRequest userId),
// and the deletion-ack name list. Renderer assertions are pure (no DB);
// the deletion section exercises the real storage path against Neon.
//
// Usage:  node scripts/test-multi-kid-emails.js

import dotenv from 'dotenv';
dotenv.config({ override: true });

import bcrypt from 'bcrypt';
import { query } from '../src/db.js';
import { storage } from '../src/storage.js';
import {
  renderDailyTeaserEmail,
  renderMultiKidPasswordResetEmail,
  renderDeletionAckEmail,
} from '../src/emails.js';

let failures = 0;
const createdIds = [];
function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}
function contains(label, hay, needle) {
  const f = String(hay || '').includes(needle);
  ok(label, f, f ? '' : `missing "${needle}"`);
}
function notContains(label, hay, needle) {
  const f = String(hay || '').includes(needle);
  ok(label, !f, f ? `unexpectedly found "${needle}"` : '');
}

const PARENT = `mkemail-test-${Date.now()}@example.invalid`;

async function insertActiveChild(name, age, username) {
  const hash = await bcrypt.hash('testpass', 10);
  const { rows } = await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, consent_required, consent_given, username, password_hash)
     VALUES ($1,$2,$3,TRUE,TRUE,$4,$5,$6,$7) RETURNING id`,
    [PARENT, name, age, age >= 10 && age <= 12, age >= 10 && age <= 12, username, hash],
  );
  createdIds.push(rows[0].id);
  return rows[0].id;
}

async function main() {
  console.log('\n📨 Multi-kid Batch C+D smoke test\n');

  const content = {
    marketVibe: 'green',
    date: 'Wednesday, May 27, 2026',
    scoreboard: { topMover: { name: 'Reddit', ticker: 'RDDT', change: '+6.65%' } },
    stories: [{ title: 'SpaceX Files for IPO' }],
  };

  // ====================================================================
  // SECTION 1 — teaser renderer names all kids
  // ====================================================================
  console.log('Section 1 — teaser renderer (multi-kid greeting)');
  const one = renderDailyTeaserEmail({ kidNames: ['Riley'] }, content);
  contains('1 kid → "Hey Riley"', one.html, 'Hey Riley');

  const two = renderDailyTeaserEmail({ kidNames: ['Riley', 'Jordan'] }, content);
  contains('2 kids → "Hey Riley and Jordan"', two.html, 'Hey Riley and Jordan');

  const three = renderDailyTeaserEmail({ kidNames: ['Riley', 'Jordan', 'Sam'] }, content);
  contains('3 kids → Oxford comma join', three.html, 'Hey Riley, Jordan, and Sam');

  // Backward compat: single kid_first_name still works.
  const legacy = renderDailyTeaserEmail({ kid_first_name: 'Solo' }, content);
  contains('legacy single kid_first_name', legacy.html, 'Hey Solo');

  // ====================================================================
  // SECTION 2 — consolidated password-reset email
  // ====================================================================
  console.log('\nSection 2 — consolidated reset email');
  const reset = renderMultiKidPasswordResetEmail([
    { kidName: 'Riley', username: 'rwhiz', link: 'https://x/reset?token=aaa' },
    { kidName: 'Jordan', username: 'jkid', link: 'https://x/reset?token=bbb' },
  ]);
  contains('lists Riley', reset.html, 'Riley');
  contains('lists Jordan', reset.html, 'Jordan');
  contains('has Riley reset link', reset.html, 'token=aaa');
  contains('has Jordan reset link', reset.html, 'token=bbb');
  contains('per-kid reset CTA', reset.html, "Reset Riley's password");

  // ====================================================================
  // SECTION 3 — deletion-ack names the deleted kids
  // ====================================================================
  console.log('\nSection 3 — deletion-ack name list');
  // NB: in the HTML body the name is wrapped in <strong>, so "Riley's"
  // isn't a contiguous substring there ("<strong>Riley</strong>'s"). The
  // plain-text variant has the contiguous possessive — assert against that.
  const ack1 = renderDeletionAckEmail({ parent_email: PARENT, kidNames: ['Riley'] });
  contains('1 deleted → "Riley\'s" (text)', ack1.text, "Riley's");
  contains('1 deleted → name in html', ack1.html, '>Riley<');
  contains('singular "has been deleted"', ack1.text, 'has been deleted');

  const ack2 = renderDeletionAckEmail({ parent_email: PARENT, kidNames: ['Riley', 'Jordan'] });
  contains('2 deleted → "Riley and Jordan\'s" (text)', ack2.text, "Riley and Jordan's");
  contains('plural "accounts have been deleted"', ack2.text, 'have been deleted');

  const ack0 = renderDeletionAckEmail({ parent_email: PARENT, kidNames: [] });
  contains('0 deleted → generic no-leak copy', ack0.text, 'If an account existed');
  notContains('0 deleted → no kid name leak', ack0.html, "'s Market Juice account has been deleted");

  // ====================================================================
  // SECTION 4 — per-kid deletion via userId (sibling stays intact)
  // ====================================================================
  console.log('\nSection 4 — per-kid deletion (recordDeletionRequest userId)');
  const rileyId = await insertActiveChild('Riley', 12, `riley_${Date.now().toString(36)}`);
  const jordanId = await insertActiveChild('Jordan', 14, `jordan_${Date.now().toString(36)}`);

  const before = await storage.getActiveChildrenByParentEmail(PARENT);
  ok('2 active children before delete', before.length === 2);

  // Delete only Riley by id.
  const del = await storage.recordDeletionRequest({
    parent_email: PARENT, userId: rileyId, reason: 'smoke', requested_ip: null, user_agent: 'smoke',
  });
  ok('deletion matched Riley', !!del.matched_user_id);
  ok('matchedKidName captured pre-scrub = Riley', del.matchedKidName === 'Riley',
     `got ${JSON.stringify(del.matchedKidName)}`);

  const after = await storage.getActiveChildrenByParentEmail(PARENT);
  ok('1 active child after delete', after.length === 1, `got ${after.length}`);
  ok('surviving child is Jordan', after[0] && after[0].kid_first_name === 'Jordan',
     `got ${after[0] && after[0].kid_first_name}`);

  // Riley's row is scrubbed (kid_first_name = 'deleted', deleted_at set).
  const rileyRow = (await query(`SELECT kid_first_name, deleted_at, is_active FROM users WHERE id = $1`, [rileyId])).rows[0];
  ok('Riley scrubbed (kid_first_name=deleted)', rileyRow.kid_first_name === 'deleted');
  ok('Riley deactivated', rileyRow.is_active === false && rileyRow.deleted_at !== null);

  // Jordan's row untouched.
  const jordanRow = (await query(`SELECT kid_first_name, is_active FROM users WHERE id = $1`, [jordanId])).rows[0];
  ok('Jordan intact (name preserved)', jordanRow.kid_first_name === 'Jordan');
  ok('Jordan still active', jordanRow.is_active === true);

  // ====================================================================
  // SECTION 5 — userId deletion refuses cross-parent targeting
  // ====================================================================
  console.log('\nSection 5 — userId deletion is ownership-scoped');
  const OTHER = `mkemail-other-${Date.now()}@example.invalid`;
  const otherKidId = (await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, username, password_hash)
     VALUES ($1,'Stranger',12,TRUE,TRUE,$2,'h') RETURNING id`,
    [OTHER, `stranger_${Date.now().toString(36)}`],
  )).rows[0].id;
  createdIds.push(otherKidId);

  // Try to delete the stranger's kid while claiming OUR parent email.
  const cross = await storage.recordDeletionRequest({
    parent_email: PARENT, userId: otherKidId, reason: 'attack', requested_ip: null, user_agent: 'smoke',
  });
  ok('cross-parent delete did NOT match', !cross.matched_user_id);
  const strangerRow = (await query(`SELECT is_active, deleted_at FROM users WHERE id = $1`, [otherKidId])).rows[0];
  ok('stranger kid untouched', strangerRow.is_active === true && strangerRow.deleted_at === null);
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
      for (const id of createdIds) {
        await query(`DELETE FROM verification_tokens WHERE user_id = $1`, [id]);
        await query(`DELETE FROM users WHERE id = $1`, [id]);
      }
      await query(`DELETE FROM deletion_requests WHERE parent_email LIKE 'mkemail-%@example.invalid'`);
    } catch (e) { console.error('[cleanup] failed:', e.message); }
  });
