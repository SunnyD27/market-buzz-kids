// scripts/test-watchlist.js — Phase 21 Watchlist ("Your Companies") smoke test.
//
// Pure: the curated universe (categories/tier), the Layer-1 false-positive
// matcher battery, relative-date labels.
// Live Neon (throwaway users + dated daily_prices fixtures, all cleaned up):
// follow cap-3 + membership, per-company 7-day cooldown + independence,
// since-% + milestone first-crossing + idempotent re-POST + spoof rejection,
// the offer state machine (first-run → skip → re-nudge once → cap; declined
// never re-nudged), the empty/1/2/3 render models, and the COPPA scrub.
//
// Usage: node scripts/test-watchlist.js

import dotenv from 'dotenv';
dotenv.config({ override: true });

import { query } from '../src/db.js';
import {
  CURATED_COMPANIES, WATCHLIST_CATEGORIES, followableByCategory, isFollowable,
} from '../src/companies.js';
import {
  matchInNews, relativeFollowLabel, persistDailyPrices, addWatchlist,
  removeWatchlist, recordMilestone, recordOffer, getWatchlistState, saveWatchlist,
  AMBIGUOUS_TICKERS, MAX_FOLLOWS,
} from '../src/watchlist.js';
import { storage } from '../src/storage.js';

let failures = 0;
const testUserIds = [];
const FIX = '2031-'; // all daily_prices fixtures live in 2031 → trivially cleaned

function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures += 1; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}
function eq(label, a, e) { ok(label, a === e, a === e ? '' : `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

async function createTestUser(tag) {
  const email = `wl-test-${tag}-${Date.now()}@example.invalid`;
  const username = `wltest_${tag}_${Date.now().toString(36)}`;
  const { rows } = await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, username, password_hash)
     VALUES ($1, 'TestKid', 12, TRUE, TRUE, $2, 'not-a-real-hash') RETURNING id`,
    [email, username],
  );
  testUserIds.push(rows[0].id);
  return rows[0].id;
}
async function seedVisits(userId, dates) {
  for (const d of dates) {
    await query(
      `INSERT INTO engagement_events (user_id, event_type, event_data, created_at)
       VALUES ($1, 'daily-visit', $2::jsonb, NOW())`,
      [userId, JSON.stringify({ digestDate: d })],
    );
  }
}
const moverContent = (ticker, principle) => ({ scoreboard: { topMover: { ticker, principle } } });

async function main() {
  console.log('\n📋 Phase 21 Watchlist smoke test\n');

  // -------- Section 1: curated universe (pure) -----------------------------
  console.log('Section 1 — curated universe + categories');
  const catKeys = new Set(WATCHLIST_CATEGORIES.map(c => c.key));
  ok('every company has ticker+name+category', CURATED_COMPANIES.every(c => c.ticker && c.name && c.category));
  ok('every category is a known picker bucket', CURATED_COMPANIES.every(c => catKeys.has(c.category)));
  ok('size is the ~85-100 core', CURATED_COMPANIES.length >= 80 && CURATED_COMPANIES.length <= 110);
  ok('new kid names present (MAT/HAS/HSY/CROX/PLTR/SPCX)',
    ['MAT', 'HAS', 'HSY', 'CROX', 'PLTR', 'SPCX'].every(t => isFollowable(t)));
  ok('off-list ticker not followable', !isFollowable('ZZZZ'));
  const grouped = followableByCategory();
  ok('picker groups are non-empty + alphabetized',
    grouped.length > 0 && grouped.every(g => g.companies.length > 0 &&
      g.companies.every((c, i, a) => i === 0 || a[i - 1].name.localeCompare(c.name) <= 0)));

  // -------- Section 2: Layer-1 matcher battery (pure) ----------------------
  console.log('\nSection 2 — Layer 1 matcher (false positives are worse than misses)');
  // Exact mover-ticker fires.
  eq('mover ticker fires', matchInNews('NKE', moverContent('NKE'))?.kind, 'mover');
  eq('mover precedence over bigPicture',
    matchInNews('NKE', { ...moverContent('NKE'), bigPicture: 'Nike had a big day.' })?.kind, 'mover');
  // Distinctive names DO match in free text.
  eq('distinctive name in bigPicture matches (Roblox)',
    matchInNews('RBLX', { bigPicture: 'Roblox added new worlds this week.' })?.kind, 'bigPicture');
  eq('hyphenated name matches (Coca-Cola)',
    matchInNews('KO', { bigPicture: 'Coca-Cola raised its dividend.' })?.kind, 'bigPicture');
  eq('name in a story matches + carries index',
    matchInNews('NVDA', { stories: [{ title: 'Chips', body: 'Nvidia shipped more GPUs.' }] })?.storyIndex, 0);
  // FALSE-POSITIVE GUARDS — ambiguous common-word names must NOT match free text.
  ok('Block does NOT match "around the block"', !matchInNews('SQ', { bigPicture: 'They walked around the block.' }));
  ok('Snap does NOT match "snap a photo"', !matchInNews('SNAP', { bigPicture: 'Snap a photo of the chart.' }));
  ok('Unity does NOT match "team unity"', !matchInNews('U', { bigPicture: 'The team showed great unity.' }));
  ok('Reddit denylisted from free text', !matchInNews('RDDT', { bigPicture: 'A Reddit thread went viral.' }));
  ok('Target does NOT match "hit the target"', !matchInNews('TGT', { stories: [{ title: 'Goals', body: 'They hit the target.' }] }));
  ok('Visa does NOT match "travel visa"', !matchInNews('V', { bigPicture: 'She got her travel visa approved.' }));
  // Ticker symbol alone never matches (we scan NAME, never the symbol).
  ok('bare ticker "U" never matches Unity', !matchInNews('U', { bigPicture: 'Meet me at the U building.' }));
  ok('bare ticker "SQ" never matches Block', !matchInNews('SQ', { bigPicture: 'The room is 200 SQ feet.' }));
  // Word-boundary: substring inside another word must NOT match.
  ok('"Targeted" does not trip Target', !matchInNews('TGT', { bigPicture: 'The ad was highly targeted.' }));
  ok('a name NOT in content → no match', !matchInNews('AAPL', { bigPicture: 'Bananas are cheap today.' }));

  // -------- Section 3: relative date labels (pure) -------------------------
  console.log('\nSection 3 — relativeFollowLabel');
  eq('same day → today', relativeFollowLabel('2031-06-10', '2031-06-10'), 'today');
  eq('1 day → yesterday', relativeFollowLabel('2031-06-09', '2031-06-10'), 'yesterday');
  eq('5 days → N days ago', relativeFollowLabel('2031-06-05', '2031-06-10'), '5 days ago');
  eq('21 days → 3 weeks ago', relativeFollowLabel('2031-05-20', '2031-06-10'), '3 weeks ago');

  // -------- Section 4: follow mechanics (live) -----------------------------
  console.log('\nSection 4 — follow: cap-3, membership, baseline');
  await persistDailyPrices(
    [{ symbol: 'NKE', price: 100 }, { symbol: 'RBLX', price: 50 }, { symbol: 'DIS', price: 90 },
     { symbol: 'SPCX', price: 200 }], `${FIX}06-01`);
  const u1 = await createTestUser('u1');
  const add1 = await addWatchlist(u1, 'NKE', `${FIX}06-02`);
  ok('add to empty slot is free + instant', add1.ok && add1.priceAtFollow === 100);
  ok('off-list ticker rejected', (await addWatchlist(u1, 'ZZZZ', `${FIX}06-02`)).code === 'not-followable');
  ok('duplicate follow rejected', (await addWatchlist(u1, 'NKE', `${FIX}06-02`)).code === 'already-following');
  await addWatchlist(u1, 'RBLX', `${FIX}06-02`);
  await addWatchlist(u1, 'DIS', `${FIX}06-02`);
  eq('cap-3 enforced', (await addWatchlist(u1, 'SPCX', `${FIX}06-02`)).code, 'cap-reached');

  // -------- Section 5: cooldown (live) -------------------------------------
  console.log('\nSection 5 — per-company 7-day cooldown');
  const rmEarly = await removeWatchlist(u1, 'NKE', `${FIX}06-05`); // 3 days held
  ok('remove blocked within 7 days → 409-style + daysRemaining',
    rmEarly.ok === false && rmEarly.code === 'cooldown' && rmEarly.daysRemaining === 4);
  const rmLate = await removeWatchlist(u1, 'NKE', `${FIX}06-10`); // 8 days held
  ok('remove allowed at ≥7 days', rmLate.ok === true);
  // Independence: NKE removed, but RBLX (same followed_since) still in cooldown,
  // and a freshly re-added NKE starts its OWN cooldown — others unaffected.
  const reAdd = await addWatchlist(u1, 'NKE', `${FIX}06-10`);
  ok('replace into freed slot is free', reAdd.ok === true);
  const rbCool = await removeWatchlist(u1, 'RBLX', `${FIX}06-10`); // RBLX followed 06-02 → 8 days → allowed
  ok('swapping NKE never froze RBLX (independent cooldowns)', rbCool.ok === true);

  // -------- Section 6: since-% + milestones (live) -------------------------
  console.log('\nSection 6 — since-following % + milestone first-crossing');
  const u2 = await createTestUser('u2');
  await persistDailyPrices([{ symbol: 'NVDA', price: 100 }], `${FIX}07-01`);
  await addWatchlist(u2, 'NVDA', `${FIX}07-02`);                       // baseline 100
  await persistDailyPrices([{ symbol: 'NVDA', price: 130, changesPercentage: 2.1 }], `${FIX}07-20`); // +30%
  const st = await getWatchlistState(u2, `${FIX}07-20`, {});
  const nv = st.held.find(h => h.ticker === 'NVDA');
  ok('since-% computed from baseline', Math.round(nv.sinceFollowPct) === 30);
  eq('today move shown secondary', Math.round(nv.todayPct), 2);
  eq('crossed milestone = 25 (not 50)', nv.milestone?.level, 25);
  ok('milestone isNew before record', nv.milestone?.isNew === true);
  const mOk = await recordMilestone(u2, 'NVDA', 25, `${FIX}07-20`);
  ok('record 25 advances milestone_hit', mOk.ok && mOk.milestoneHit === 25);
  ok('re-record 25 is idempotent no-op', (await recordMilestone(u2, 'NVDA', 25, `${FIX}07-20`)).noop === true);
  eq('spoof a not-yet-crossed 50 is rejected', (await recordMilestone(u2, 'NVDA', 50, `${FIX}07-20`)).code, 'not-crossed');
  eq('bad milestone level rejected', (await recordMilestone(u2, 'NVDA', 33, `${FIX}07-20`)).code, 'bad-level');
  const st2 = await getWatchlistState(u2, `${FIX}07-20`, {});
  ok('milestone no longer isNew after record', st2.held[0].milestone?.isNew === false);

  // -------- Section 7: Layer 3 principle (live, cap 1) ---------------------
  console.log('\nSection 7 — Layer 3 personalized principle (cap 1, mover preferred)');
  const u3 = await createTestUser('u3');
  await addWatchlist(u3, 'NVDA', `${FIX}07-02`);
  const stP = await getWatchlistState(u3, `${FIX}07-20`, moverContent('NVDA', 4));
  ok('mover principle tie-in surfaces for held mover', stP.principleTieIn?.principle === 4 && stP.principleTieIn?.name === 'Nvidia');

  // -------- Section 8: offer state machine (live) --------------------------
  console.log('\nSection 8 — offer state machine (first-run → skip → re-nudge → cap)');
  const u4 = await createTestUser('u4');
  const o0 = await getWatchlistState(u4, `${FIX}08-01`, {});
  ok('empty kid: first-run offer + 3 ghost slots', o0.offer?.kind === 'first-run' && o0.ghostSlots === MAX_FOLLOWS);
  await recordOffer(u4, 'shown', 'first-run');
  await seedVisits(u4, [`${FIX}08-01`]); // first_offer_active_day ≈ 1 (set at shown via its own count)
  await recordOffer(u4, 'skipped');
  const o1 = await getWatchlistState(u4, `${FIX}08-02`, {});
  ok('after first-run shown+skip (not enough active days) → no offer yet', o1.offer === null);
  await seedVisits(u4, [`${FIX}08-02`, `${FIX}08-03`, `${FIX}08-04`, `${FIX}08-05`]); // ≥3 more active days
  const o2 = await getWatchlistState(u4, `${FIX}08-06`, {});
  ok('after ~3+ active days → one re-nudge', o2.offer?.kind === 're-nudge');
  await recordOffer(u4, 'shown', 're-nudge');
  const o3 = await getWatchlistState(u4, `${FIX}08-07`, {});
  ok('hard cap: no auto-prompt after 2 offers', o3.offer === null);

  // Declined is never re-nudged.
  const u5 = await createTestUser('u5');
  await recordOffer(u5, 'shown', 'first-run');
  await recordOffer(u5, 'declined');
  await seedVisits(u5, [`${FIX}08-01`, `${FIX}08-02`, `${FIX}08-03`, `${FIX}08-04`, `${FIX}08-05`]);
  ok('explicitly declined kid is never re-nudged', (await getWatchlistState(u5, `${FIX}08-09`, {})).offer === null);

  // -------- Section 9: render models (live) --------------------------------
  console.log('\nSection 9 — empty/1/2/3 render models');
  const u6 = await createTestUser('u6');
  await persistDailyPrices([{ symbol: 'NKE', price: 100 }, { symbol: 'RBLX', price: 50 }], `${FIX}09-01`);
  eq('0 held → 3 ghost slots', (await getWatchlistState(u6, `${FIX}09-02`, {})).ghostSlots, 3);
  await addWatchlist(u6, 'NKE', `${FIX}09-02`);
  const m1 = await getWatchlistState(u6, `${FIX}09-02`, {});
  ok('1 held → 1 card + 2 ghost slots, no offer', m1.held.length === 1 && m1.ghostSlots === 2 && m1.offer === null);
  await addWatchlist(u6, 'RBLX', `${FIX}09-02`);
  await addWatchlist(u6, 'DIS', `${FIX}09-02`); // DIS price from Section 4 fixture (06-01) as latest ≤ 09-02
  const m3 = await getWatchlistState(u6, `${FIX}09-02`, {});
  ok('3 held → 0 ghost slots', m3.held.length === 3 && m3.ghostSlots === 0);

  // -------- Section 11: draft→Save diff (live, PR #48 fix) -----------------
  console.log('\nSection 11 — Save diff: add/drop batching + cooldown-on-drop');
  await persistDailyPrices(
    [{ symbol: 'NKE', price: 100 }, { symbol: 'RBLX', price: 50 }, { symbol: 'DIS', price: 90 },
     { symbol: 'SPCX', price: 200 }], `${FIX}11-01`);
  // (a) add-only Save; followed_since stamped at SAVE time (not before).
  const s1 = await createTestUser('s1');
  const r1 = await saveWatchlist(s1, ['NKE', 'RBLX'], [], `${FIX}11-02`);
  ok('add-only Save follows both', r1.added.length === 2 && r1.blocked.length === 0 && r1.dropped.length === 0);
  const fs = (await query(`SELECT followed_since::text AS d FROM user_watchlist WHERE user_id=$1 AND ticker='NKE'`, [s1])).rows[0]?.d;
  eq('followed_since set at Save time', fs, `${FIX}11-02`);
  // (b) add + drop where the drop is PAST cooldown → both apply.
  const s2 = await createTestUser('s2');
  await addWatchlist(s2, 'NKE', `${FIX}11-01`);                       // followed 11-01
  const r2 = await saveWatchlist(s2, ['DIS'], ['NKE'], `${FIX}11-10`); // 9 days later
  ok('past-cooldown drop + add both apply', r2.dropped.includes('NKE') && r2.added.includes('DIS') && r2.blocked.length === 0);
  // (c) drop WITHIN cooldown → that ticker blocked w/ daysRemaining, the add still applies, blocked stays committed.
  const s3 = await createTestUser('s3');
  await addWatchlist(s3, 'NKE', `${FIX}11-10`);                        // followed 11-10
  const r3 = await saveWatchlist(s3, ['DIS'], ['NKE'], `${FIX}11-12`); // 2 days later
  ok('cooling drop blocked w/ daysRemaining', r3.blocked.length === 1 && r3.blocked[0].ticker === 'NKE' && r3.blocked[0].daysRemaining === 5);
  ok('blocked drop carries display name', r3.blocked[0].name === 'Nike');
  ok('the allowed add still applied', r3.added.includes('DIS'));
  const heldS3 = (await query(`SELECT ticker FROM user_watchlist WHERE user_id=$1 ORDER BY ticker`, [s3])).rows.map(r => r.ticker);
  ok('blocked company stays committed (NKE + DIS held)', heldS3.join(',') === 'DIS,NKE');
  // (d) cap-3 re-enforced server-side even via Save.
  const s4 = await createTestUser('s4');
  const r4 = await saveWatchlist(s4, ['NKE', 'RBLX', 'DIS', 'SPCX'], [], `${FIX}11-02`);
  ok('cap-3 enforced on Save (3 added, 4th rejected)',
    r4.added.length === 3 && r4.errors.some(e => e.code === 'cap-reached'));

  // -------- Section 10: COPPA scrub (live) ---------------------------------
  console.log('\nSection 10 — deletion scrub covers user_watchlist + prefs');
  const beforeW = (await query(`SELECT COUNT(*)::int n FROM user_watchlist WHERE user_id=$1`, [u6])).rows[0].n;
  const beforeP = (await query(`SELECT COUNT(*)::int n FROM user_watchlist_prefs WHERE user_id=$1`, [u6])).rows[0].n;
  ok('rows exist before scrub', beforeW > 0 && beforeP > 0);
  const email = (await query(`SELECT parent_email FROM users WHERE id=$1`, [u6])).rows[0]?.parent_email;
  await storage.recordDeletionRequest({ parent_email: email, reason: 'phase 21 smoke', userId: u6 });
  const afterW = (await query(`SELECT COUNT(*)::int n FROM user_watchlist WHERE user_id=$1`, [u6])).rows[0].n;
  const afterP = (await query(`SELECT COUNT(*)::int n FROM user_watchlist_prefs WHERE user_id=$1`, [u6])).rows[0].n;
  eq('user_watchlist emptied by scrub', afterW, 0);
  eq('user_watchlist_prefs emptied by scrub', afterP, 0);

  console.log('');
  if (failures === 0) console.log('🎉 All Watchlist smoke-test assertions passed.\n');
  else console.error(`💥 ${failures} assertion(s) FAILED.\n`);
}

main()
  .catch((err) => { failures += 1; console.error('\n💥 Test run threw:', err); })
  .finally(async () => {
    try {
      await query(`DELETE FROM daily_prices WHERE price_date >= '2031-01-01'`);
      for (const id of testUserIds) {
        await query(`DELETE FROM user_watchlist       WHERE user_id = $1`, [id]);
        await query(`DELETE FROM user_watchlist_prefs WHERE user_id = $1`, [id]);
        await query(`DELETE FROM engagement_events    WHERE user_id = $1`, [id]);
        await query(`DELETE FROM user_progress        WHERE user_id = $1`, [id]);
        await query(`DELETE FROM deletion_requests    WHERE matched_user_id = $1`, [id]);
        await query(`DELETE FROM users                WHERE id = $1`, [id]);
      }
      console.log(`[cleanup] removed ${testUserIds.length} test user(s) + 2031 price fixtures`);
    } catch (e) { console.error('[cleanup] failed:', e.message); }
    process.exit(failures === 0 ? 0 : 1);
  });
