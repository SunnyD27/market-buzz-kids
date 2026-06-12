// scripts/test-mystery.js
//
// Phase 16 smoke test — Mystery Mover.
//
// Pure sections: name-leak guardrail (rejects deliberately leaky clues,
// non-vacuous), server-composed clue 5, reserve pool (all 12 puzzles pass
// the guardrail, deterministic pick honors exclusion), deterministic
// company rotation, guess normalization.
//
// Live-Neon sections (throwaway users, fully cleaned up): content_history
// round-trip + 30-day window, MC by cluesUsed + clamping + dedup, mystery
// extends the streak, Perfect Day across BOTH orderings (mystery-third and
// game-third), and the CLASSIC-path regressions: 3 distinct games with no
// mystery still fire Perfect Day exactly once, and a game (not mystery)
// still extends the streak.
//
// Usage: node scripts/test-mystery.js

import dotenv from 'dotenv';
dotenv.config({ override: true });

import { query } from '../src/db.js';
import {
  pickMysteryCompany,
  buildClue5,
  validateMysteryMover,
  pickReservePuzzle,
  finalizeMysteryMover,
  isCorrectGuess,
  RESERVE_POOL,
} from '../src/mystery.js';
import { getRecent, record } from '../src/content-history.js';
import { lookupCompany } from '../src/companies.js';
import { recordEvent, getProgress, getDailyEngagementSummary } from '../src/engagement.js';

// ---- Helpers ----------------------------------------------------------

let failures = 0;
const testUserIds = [];

function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures += 1; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}

function eq(label, actual, expected) {
  const pass = actual === expected;
  ok(label, pass, pass ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function createTestUser(tag) {
  const email = `mystery-test-${tag}-${Date.now()}@example.invalid`;
  const username = `mtest_${tag}_${Date.now().toString(36)}`;
  const { rows } = await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, username, password_hash)
     VALUES ($1, 'TestKid', 12, TRUE, TRUE, $2, 'not-a-real-hash')
     RETURNING id`,
    [email, username],
  );
  testUserIds.push(rows[0].id);
  return rows[0].id;
}

const HISTORY_MARKER = 'ZZMYSTERYTEST';

// ---- Test cases -------------------------------------------------------

async function main() {
  console.log('\n🕵️ Phase 16 Mystery Mover smoke test\n');

  const ROBLOX = { ticker: 'RBLX', name: 'Roblox' };
  const CLEAN_CLUES = [
    'They make a place where kids do not just play games — they build them.',
    'Founded in the 2000s; headquartered in Northern California.',
    'Their most famous product lets you build entire worlds out of virtual blocks with friends.',
    'Most of the experiences on their platform were created by kids and teenagers.',
  ];

  // -------- Section 1: name-leak guardrail (the hard gate) ---------------
  console.log('Section 1 — guardrail rejects deliberately leaky clues');
  const clean = validateMysteryMover({ clues: CLEAN_CLUES, acceptableAnswers: ['Roblox'] }, ROBLOX);
  ok('clean 4-clue puzzle passes', clean.ok, clean.errors.join(' | '));

  const nameLeak = validateMysteryMover(
    { clues: [CLEAN_CLUES[0], CLEAN_CLUES[1], 'They make the Roblox app for phones.', CLEAN_CLUES[3]], acceptableAnswers: ['Roblox'] },
    ROBLOX,
  );
  ok('company-name leak rejected', !nameLeak.ok && nameLeak.errors.some(e => e.includes('roblox')));

  const possessiveLeak = validateMysteryMover(
    { clues: ['You have probably visited one of Disney\'s theme parks on a family trip.', CLEAN_CLUES[1], CLEAN_CLUES[2], CLEAN_CLUES[3]], acceptableAnswers: ['Disney'] },
    { ticker: 'DIS', name: 'Disney' },
  );
  ok('possessive-form leak rejected', !possessiveLeak.ok && possessiveLeak.errors.some(e => e.includes('disney')));

  const tickerLeak = validateMysteryMover(
    { clues: [CLEAN_CLUES[0], 'Look up the symbol RBLX and you will find them.', CLEAN_CLUES[2], CLEAN_CLUES[3]], acceptableAnswers: ['Roblox'] },
    ROBLOX,
  );
  ok('ticker leak rejected', !tickerLeak.ok && tickerLeak.errors.some(e => e.includes('ticker')));

  const aliasLeak = validateMysteryMover(
    { clues: [CLEAN_CLUES[0], 'The founder Walt sketched their mascot on a train ride.', CLEAN_CLUES[2], CLEAN_CLUES[3]], acceptableAnswers: ['Disney', 'Walt Disney'] },
    { ticker: 'DIS', name: 'Disney' },
  );
  ok('acceptable-answer (brand/alias) word leak rejected', !aliasLeak.ok && aliasLeak.errors.some(e => e.includes('walt')));

  const vague = validateMysteryMover(
    { clues: ['A company.', CLEAN_CLUES[1], CLEAN_CLUES[2], CLEAN_CLUES[3]], acceptableAnswers: ['Roblox'] },
    ROBLOX,
  );
  ok('uselessly-vague clue ("A company.") rejected', !vague.ok);

  const wrongCount = validateMysteryMover({ clues: [...CLEAN_CLUES, 'a fifth clue that should not be here'], acceptableAnswers: ['Roblox'] }, ROBLOX);
  ok('5 clues rejected (clue 5 is server-composed)', !wrongCount.ok);
  ok('missing mysteryMover rejected', !validateMysteryMover(null, ROBLOX).ok);

  // -------- Section 2: server-composed clue 5 -----------------------------
  console.log('\nSection 2 — clue 5 composed server-side');
  eq('Nike clue 5', buildClue5({ ticker: 'NKE', name: 'Nike' }),
    'Their name starts with "N" and their stock ticker is 3 letters long.');
  eq('single-letter ticker clue 5', buildClue5({ ticker: 'V', name: 'Visa' }),
    'Their name starts with "V" and their stock ticker is 1 letter long.');

  // -------- Section 3: reserve pool ---------------------------------------
  console.log('\nSection 3 — reserve pool (12 puzzles, all guardrail-clean)');
  eq('reserve pool has 12 puzzles', RESERVE_POOL.length, 12);
  ok('reserve tickers unique', new Set(RESERVE_POOL.map(p => p.ticker)).size === RESERVE_POOL.length);
  ok('every reserve ticker is in the curated 75', RESERVE_POOL.every(p => lookupCompany(p.ticker)));
  const sectors = new Set(RESERVE_POOL.map(p => lookupCompany(p.ticker)?.sector));
  ok(`reserve spans multiple sectors (${[...sectors].join(', ')})`, sectors.size >= 4);
  for (const p of RESERVE_POOL) {
    const v = validateMysteryMover({ clues: p.clues, acceptableAnswers: p.acceptableAnswers }, p);
    ok(`reserve ${p.name} passes the guardrail`, v.ok, v.errors.join(' | '));
  }
  const r1 = pickReservePuzzle('2031-01-05', []);
  eq('reserve pick is deterministic', pickReservePuzzle('2031-01-05', []).ticker, r1.ticker);
  ok('reserve pick honors exclusion', pickReservePuzzle('2031-01-05', [r1.ticker]).ticker !== r1.ticker);

  // -------- Section 4: company rotation ------------------------------------
  console.log('\nSection 4 — deterministic 30-day rotation pick');
  const c1 = pickMysteryCompany('2031-01-05', []);
  eq('pick is deterministic for a date', pickMysteryCompany('2031-01-05', []).ticker, c1.ticker);
  ok('pick honors the exclusion list', pickMysteryCompany('2031-01-05', [c1.ticker]).ticker !== c1.ticker);
  ok('all-excluded falls back to full list (never throws)',
    !!pickMysteryCompany('2031-01-05', RESERVE_POOL.map(p => p.ticker).concat(['EVERYTHING'])).ticker);

  // -------- Section 5: finalize (validate-or-fallback) ----------------------
  console.log('\nSection 5 — finalizeMysteryMover');
  const good = finalizeMysteryMover({ clues: CLEAN_CLUES, acceptableAnswers: ['Roblox'] }, ROBLOX, '2031-01-05', []);
  eq('clean puzzle keeps the picked company', good.puzzle.ticker, 'RBLX');
  eq('no fallback on a clean puzzle', good.usedFallback, false);
  eq('final puzzle has 5 clues', good.puzzle.clues.length, 5);
  ok('clue 5 is the composed one', good.puzzle.clues[4].startsWith('Their name starts with "R"'));
  ok('acceptableAnswers include canonical name + ticker',
    good.puzzle.acceptableAnswers.includes('Roblox') && good.puzzle.acceptableAnswers.includes('RBLX'));

  const bad = finalizeMysteryMover({ clues: ['They make the Roblox app.', ...CLEAN_CLUES.slice(1)], acceptableAnswers: ['Roblox'] }, ROBLOX, '2031-01-05', []);
  eq('leaky puzzle triggers the reserve fallback', bad.usedFallback, true);
  eq('fallback puzzle has 5 clues', bad.puzzle.clues.length, 5);
  const fb = validateMysteryMover(
    { clues: bad.puzzle.clues.slice(0, 4), acceptableAnswers: bad.puzzle.acceptableAnswers },
    { ticker: bad.puzzle.ticker, name: bad.puzzle.name },
  );
  ok('fallback puzzle itself passes the guardrail', fb.ok, fb.errors.join(' | '));
  const missing = finalizeMysteryMover(undefined, ROBLOX, '2031-01-05', []);
  eq('missing AI field also falls back', missing.usedFallback, true);

  // -------- Section 6: guess normalization ----------------------------------
  console.log('\nSection 6 — free-text guess matching');
  const mcdPuzzle = { ticker: 'MCD', name: "McDonald's", acceptableAnswers: ["McDonald's", 'McDonalds'] };
  ok('exact name matches', isCorrectGuess("McDonald's", mcdPuzzle));
  ok('case + punctuation insensitive', isCorrectGuess('mcdonalds', mcdPuzzle));
  ok('corporate suffix dropped', isCorrectGuess("McDonald's Corp.", mcdPuzzle));
  ok('ticker accepted case-insensitively', isCorrectGuess('mcd', mcdPuzzle));
  ok('whitespace tolerated', isCorrectGuess('  McDonalds  ', mcdPuzzle));
  ok('wrong guess rejected', !isCorrectGuess('Burger King', mcdPuzzle));
  ok('empty guess rejected', !isCorrectGuess('   ', mcdPuzzle));

  // -------- Section 7: content_history (Postgres) ----------------------------
  console.log('\nSection 7 — content_history round-trip + 30-day window (live Neon)');
  const today = new Date().toISOString().slice(0, 10);
  const old = new Date(Date.now() - 40 * 86400_000).toISOString().slice(0, 10);
  await record('mystery', `${HISTORY_MARKER}-RECENT`, today);
  await record('mystery', `${HISTORY_MARKER}-OLD`, old);
  const recent = await getRecent('mystery', 30);
  ok('recent value returned', recent.includes(`${HISTORY_MARKER}-RECENT`));
  ok('41-day-old value excluded from the 30-day window', !recent.includes(`${HISTORY_MARKER}-OLD`));
  const wide = await getRecent('mystery', 60);
  ok('wider window includes the old value', wide.includes(`${HISTORY_MARKER}-OLD`));
  let kindThrew = false;
  try { await getRecent('nope'); } catch { kindThrew = true; }
  ok('unknown kind throws', kindThrew);

  // -------- Section 8: engagement — MC, streak, dedup (live Neon) -------------
  console.log('\nSection 8 — mystery engagement: MC by clues, streak, dedup, clamping');
  const D1 = '2031-02-02';
  const u1 = await createTestUser('u1');
  const m1 = await recordEvent(u1, 'mystery-mover-played', { digestDate: D1, solved: true, cluesUsed: 3 });
  eq('solved on clue 3 → 15 MC + first-play streak bonus (2)', m1.mcAwarded, 17);
  eq('mystery extends the streak', m1.streakUpdate.current, 1);
  const m1dup = await recordEvent(u1, 'mystery-mover-played', { digestDate: D1, solved: true, cluesUsed: 1 });
  eq('same-day replay is a duplicate', m1dup.duplicate, true);
  eq('replay awards 0 MC (no better-score retry)', m1dup.mcAwarded, 0);
  const m1clamp = await recordEvent(u1, 'mystery-mover-played', { digestDate: '2031-02-03', solved: true, cluesUsed: 99 });
  eq('cluesUsed=99 clamped to 5 → 5 MC (streak bonus already paid today)', m1clamp.mcAwarded, 5);
  const p1 = await getProgress(u1);
  eq('mystery bumps games_played', p1.progress.gamesPlayed, 2);
  eq('correct_answers untouched by mystery', p1.progress.correctAnswers, 0);
  const sum1 = await getDailyEngagementSummary(u1, D1);
  eq('mystery play counts as engaged (recap/nudge + push gates)', sum1.engaged, true);

  const u5 = await createTestUser('u5');
  const m5 = await recordEvent(u5, 'mystery-mover-played', { digestDate: D1, solved: false, cluesUsed: 5 });
  eq('unsolved → 0 MC for the puzzle, streak bonus only', m5.mcAwarded, 2);
  eq('unsolved still extends the streak (participation)', m5.streakUpdate.current, 1);

  // -------- Section 9: Perfect Day — REGRESSION: classic path ----------------
  console.log('\nSection 9 — REGRESSION: classic path (3 games, no mystery) unchanged');
  const u2 = await createTestUser('u2');
  const g1 = await recordEvent(u2, 'game-completed', { game: 'quiz', correct: true, digestDate: D1 });
  eq('classic: first game = 25 (correct) + 2 streak bonus', g1.mcAwarded, 27);
  eq('classic: a game (not mystery) still extends the streak', g1.streakUpdate.current, 1);
  const g2 = await recordEvent(u2, 'game-completed', { game: 'match', correct: false, digestDate: D1 });
  eq('classic: second game = 15, no Perfect Day yet', g2.mcAwarded, 15);
  const g3 = await recordEvent(u2, 'game-completed', { game: 'compound', correct: false, digestDate: D1 });
  eq('classic: 3rd distinct game fires Perfect Day (15 + 25)', g3.mcAwarded, 40);
  const g4 = await recordEvent(u2, 'game-completed', { game: 'time-machine', correct: false, digestDate: D1 });
  eq('classic: 4th distinct game does NOT re-fire Perfect Day', g4.mcAwarded, 15);
  const p2 = await getProgress(u2);
  eq('classic: perfect_days incremented exactly once', p2.progress.perfectDays, 1);

  // -------- Section 10: Perfect Day — mystery-third ordering -------------------
  console.log('\nSection 10 — Perfect Day ordering: 2 games then mystery (mystery-third)');
  const u3 = await createTestUser('u3');
  await recordEvent(u3, 'game-completed', { game: 'quiz', correct: true, digestDate: D1 });
  await recordEvent(u3, 'game-completed', { game: 'match', correct: false, digestDate: D1 });
  const m3 = await recordEvent(u3, 'mystery-mover-played', { digestDate: D1, solved: true, cluesUsed: 1 });
  eq('mystery as 3rd unique play fires Perfect Day (25 + 25, streak already paid)', m3.mcAwarded, 50);
  const p3 = await getProgress(u3);
  eq('perfect_days = 1', p3.progress.perfectDays, 1);
  eq('streak not double-extended by mystery', p3.progress.currentStreak, 1);

  // -------- Section 11: Perfect Day — game-third ordering ----------------------
  console.log('\nSection 11 — Perfect Day ordering: mystery first, game lands it (game-third)');
  const u4 = await createTestUser('u4');
  const m4 = await recordEvent(u4, 'mystery-mover-played', { digestDate: D1, solved: true, cluesUsed: 5 });
  eq('mystery first play = 5 MC + 2 streak bonus', m4.mcAwarded, 7);
  await recordEvent(u4, 'game-completed', { game: 'quiz', correct: false, digestDate: D1 });
  const g4b = await recordEvent(u4, 'game-completed', { game: 'match', correct: false, digestDate: D1 });
  eq('game as 3rd unique play fires Perfect Day (15 + 25)', g4b.mcAwarded, 40);
  const p4 = await getProgress(u4);
  eq('perfect_days = 1', p4.progress.perfectDays, 1);

  // -------- Summary --------------------------------------------------------
  console.log('');
  if (failures === 0) console.log('🎉 All Mystery Mover smoke-test assertions passed.\n');
  else console.error(`💥 ${failures} assertion(s) FAILED.\n`);
}

main()
  .catch((err) => {
    failures += 1;
    console.error('\n💥 Test run threw:', err);
  })
  .finally(async () => {
    try {
      await query(`DELETE FROM content_history WHERE value LIKE '${HISTORY_MARKER}%'`);
      for (const id of testUserIds) {
        await query(`DELETE FROM engagement_events WHERE user_id = $1`, [id]);
        await query(`DELETE FROM user_badges       WHERE user_id = $1`, [id]);
        await query(`DELETE FROM personal_records  WHERE user_id = $1`, [id]);
        await query(`DELETE FROM user_progress     WHERE user_id = $1`, [id]);
        await query(`DELETE FROM users             WHERE id = $1`, [id]);
      }
      console.log(`[cleanup] removed ${testUserIds.length} test user(s) + content_history markers`);
    } catch (e) {
      console.error('[cleanup] failed — manual cleanup may be needed:', e.message);
    }
    process.exit(failures === 0 ? 0 : 1);
  });
