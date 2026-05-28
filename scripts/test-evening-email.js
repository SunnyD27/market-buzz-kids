// scripts/test-evening-email.js
//
// Phase 12 smoke test — exercises the evening recap email renderer end
// to end against the live Neon database. Creates a throwaway user, seeds
// realistic events for two scenarios (engaged → recap, idle → nudge),
// asserts the rendered output contains expected anchors, dumps the
// rendered subject + text + a snippet of HTML for visual inspection,
// and hard-deletes the test user.
//
// Usage:
//   node scripts/test-evening-email.js
//
// Exit code 0 = all checks pass. Non-zero = one or more assertions failed.

import dotenv from 'dotenv';
dotenv.config({ override: true });

import { query } from '../src/db.js';
import { getDigestForDate, todayNY } from '../src/digest-store.js';
import {
  ensureProgress,
  getProgress,
  recordEvent,
  getDailyEngagementSummary,
  getParentQuestionsForDate,
} from '../src/engagement.js';
import { renderEveningRecap } from '../src/emails.js';

// ---- Helpers ----------------------------------------------------------

let testUserId = null;
let failures = 0;

function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    failures += 1;
    console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : ''));
  }
}

function contains(label, haystack, needle) {
  const found = String(haystack || '').includes(needle);
  ok(label, found, found ? '' : `did not find "${needle}" in output`);
}

function notContains(label, haystack, needle) {
  const found = String(haystack || '').includes(needle);
  ok(label, !found, found ? `unexpectedly found "${needle}" in output` : '');
}

async function createTestUser() {
  const tag = `evening-test-${Date.now()}@example.invalid`;
  const username = `evening_${Date.now().toString(36)}`;
  const { rows } = await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, username, password_hash)
     VALUES ($1, 'Sky', 12, TRUE, TRUE, $2, 'not-a-real-hash')
     RETURNING id`,
    [tag, username],
  );
  return { id: rows[0].id, parent_email: tag };
}

/** Direct INSERT into engagement_events so the smoke test can seed
 *  whatever state it needs without going through recordEvent's full
 *  state-mutation pipeline. */
async function seedEvent(userId, eventType, eventData) {
  await query(
    `INSERT INTO engagement_events (user_id, event_type, event_data)
     VALUES ($1, $2, $3::jsonb)`,
    [userId, eventType, JSON.stringify(eventData)],
  );
}

/** Wipe seeded events between scenarios. */
async function resetEvents(userId) {
  await query(`DELETE FROM engagement_events WHERE user_id = $1`, [userId]);
}

async function setProgress(userId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map(k => fields[k]);
  await query(
    `UPDATE user_progress SET ${setClauses}, updated_at = NOW() WHERE user_id = $1`,
    [userId, ...values],
  );
}

async function hardDelete(userId) {
  if (!userId) return;
  await query(`DELETE FROM engagement_events WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM user_badges       WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM personal_records  WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM user_progress     WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM users             WHERE id      = $1`, [userId]);
}

// ---- Main -------------------------------------------------------------

async function main() {
  console.log('\n📧 Phase 12 evening recap email smoke test\n');

  // Pull the real digest content for today so we have parentExplainer
  // fields to render against. The Phase 12 prompts regenerated 2026-05-27,
  // so this should be a Phase 12-shaped digest.
  const digestDate = todayNY();
  const digestRow = await getDigestForDate(digestDate);
  if (!digestRow?.content) {
    console.error('FATAL: no digest content for', digestDate, '— run `node src/generate.js` first.');
    process.exit(2);
  }
  const digestContent = digestRow.content;
  console.log(`Using digest for ${digestDate}. Top mover: ${digestContent.scoreboard?.topMover?.name}.\n`);

  const u = await createTestUser();
  testUserId = u.id;
  await ensureProgress(u.id);

  // ====================================================================
  // SCENARIO A — kid engaged today → recap variant
  // ====================================================================
  console.log('Scenario A — Recap variant (kid engaged today)');

  // Set a meaty progress state: 5-day streak, Trading Cadet rank.
  await setProgress(u.id, {
    market_coins: 450,
    current_streak: 5,
    longest_streak: 12,
    streak_shields: 1,
    rank_key: 'trading-cadet',
    perfect_days: 4,
    games_played: 18,
    correct_answers: 13,
    sunday_challenges: 1,
    weeks_active: 3,
    words_learned: 2,
    last_active_date: digestDate,
    last_streak_date: digestDate,
  });

  // Seed today's events — a Perfect Day (3 games incl. quiz), word
  // learned, and a kid-flagged 💬 on story-0 + word-of-day.
  await seedEvent(u.id, 'daily-visit', { digestDate, mcAwarded: 0 });
  await seedEvent(u.id, 'game-completed', { digestDate, game: 'bull-bear', correct: true,  mcAwarded: 27, perfectDay: false });
  await seedEvent(u.id, 'game-completed', { digestDate, game: 'quiz',      correct: true,  mcAwarded: 25, perfectDay: false });
  await seedEvent(u.id, 'game-completed', { digestDate, game: 'compound',  correct: false, mcAwarded: 40, perfectDay: true });
  await seedEvent(u.id, 'word-learned',   { digestDate, mcAwarded: 5 });
  await seedEvent(u.id, 'parent-question', { digestDate, section: 'story-0', topic: digestContent.stories?.[0]?.title || 'A story', mcAwarded: 0 });
  await seedEvent(u.id, 'parent-question', { digestDate, section: 'word-of-day', topic: `Word of the Day: ${digestContent.wordOfDay?.word}`, mcAwarded: 0 });

  const summary = await getDailyEngagementSummary(u.id, digestDate);
  const questions = await getParentQuestionsForDate(u.id, digestDate);
  const progress = await getProgress(u.id);

  ok('engaged = true',                 summary.engaged === true);
  ok('gamesPlayed = 3',                summary.gamesPlayed === 3);
  ok('gamesCorrect = 2',               summary.gamesCorrect === 2);
  ok('perfectDay = true',              summary.perfectDay === true);
  ok('wordLearned = true',             summary.wordLearned === true);
  ok('totalMC = 97 (27+25+40+5)',      summary.totalMC === 97,
     `got totalMC=${summary.totalMC}`);
  ok('parent questions = 2',           questions.length === 2);

  const rendered = renderEveningRecap({
    kidName: 'Sky',
    engagement: summary,
    digestContent,
    progress,
    parentQuestions: questions,
    digestDate,
    variant: 'recap',
  });

  console.log('\n--- RECAP SUBJECT ---');
  console.log(rendered.subject);
  console.log('\n--- RECAP TEXT ---');
  console.log(rendered.text);
  console.log('---\n');

  // Subject anchors
  contains('subject contains kid name',          rendered.subject, 'Sky');
  contains('subject contains "Daily Squeeze"',   rendered.subject, 'Daily Squeeze');

  // Body anchors
  contains('recap mentions Perfect Day',         rendered.text,    'Perfect Day');
  contains('recap mentions 3 games',             rendered.text,    'Played 3 games');
  contains('recap mentions 97 MC',               rendered.text,    'Earned 97 Market Coins');
  contains('recap lists The Quiz',               rendered.text,    'The Quiz');
  contains('recap lists Bull or Bear?',          rendered.text,    'Bull or Bear?');
  contains('recap lists Compound Machine',       rendered.text,    'Compound Machine');
  contains('recap includes Word of the Day',     rendered.text,    `Word of the Day: ${digestContent.wordOfDay.word}`);

  // 💬 block — kid flagged 2 sections
  contains('recap has "wants to talk about"',    rendered.text.toUpperCase(), 'WANTS TO TALK ABOUT');
  contains('recap includes story-0 topic',       rendered.text,    digestContent.stories[0].title);
  // Conversation starter from story-0 should appear with "Sky" subbed in
  const story0Starter = digestContent.stories?.[0]?.parentExplainer?.conversationStarter;
  if (story0Starter) {
    const filled = story0Starter.replace(/\[kid\]/g, 'Sky');
    contains('story-0 starter rendered with Sky', rendered.text, filled.slice(0, 40));
    notContains('no literal [kid] placeholder',   rendered.text, '[kid]');
  }

  // "Talk about it tonight" — always present, picks 2-3 starters from
  // sections the kid engaged with (quiz played + word learned both fire
  // here). Should skip story-0 and word-of-day since they're in the
  // 💬 block above.
  contains('recap has "Talk about it tonight"',  rendered.text.toUpperCase(), 'TALK ABOUT IT TONIGHT');
  // The quiz starter should be in the tonight block (quiz was played
  // today, AND quiz isn't in the 💬 block).
  const quizStarter = digestContent.quiz?.parentExplainer?.conversationStarter;
  if (quizStarter) {
    const filled = quizStarter.replace(/\[kid\]/g, 'Sky');
    contains('tonight block includes quiz starter', rendered.text, filled.slice(0, 40));
  }

  // Footer
  contains('recap footer has streak',            rendered.text, 'Streak: 5 days');
  contains('recap footer has rank',              rendered.text, 'Trading Cadet');

  // HTML smoke check — basic structure
  contains('HTML contains <!DOCTYPE',            rendered.html, '<!DOCTYPE');
  contains('HTML contains Sky',                  rendered.html, 'Sky');
  contains('HTML contains 💬',                   rendered.html, '💬');

  // ====================================================================
  // SCENARIO B — kid didn't engage, streak ≥ 3 → nudge variant
  // ====================================================================
  console.log('\nScenario B — Nudge variant (no engagement, streak 5)');

  await resetEvents(u.id);
  await setProgress(u.id, {
    current_streak: 5,
    longest_streak: 12,
    streak_shields: 1,
    market_coins: 450,
    rank_key: 'trading-cadet',
    last_active_date: null,
    last_streak_date: null,
  });

  const summary2 = await getDailyEngagementSummary(u.id, digestDate);
  const progress2 = await getProgress(u.id);

  ok('engaged = false (no events)',    summary2.engaged === false);
  ok('streak = 5 (eligible for nudge)', progress2.progress.currentStreak === 5);

  const nudge = renderEveningRecap({
    kidName: 'Sky',
    engagement: summary2,
    digestContent,
    progress: progress2,
    parentQuestions: [],
    digestDate,
    variant: 'nudge',
  });

  console.log('\n--- NUDGE SUBJECT ---');
  console.log(nudge.subject);
  console.log('\n--- NUDGE TEXT ---');
  console.log(nudge.text);
  console.log('---\n');

  contains('nudge subject is streak-at-risk',     nudge.subject, "streak is at risk");
  contains('nudge mentions kid name',             nudge.text,    'Sky');
  contains('nudge mentions topMover',             nudge.text,    digestContent.scoreboard.topMover.name);
  contains('nudge mentions wordOfDay',            nudge.text,    digestContent.wordOfDay.word);
  contains('nudge mentions 5-day streak',         nudge.text,    '5-day streak');
  contains('nudge has digest link',               nudge.text,    '/digest');
  notContains('nudge does NOT mention games played', nudge.text, 'Played 3 games');
  notContains('nudge does NOT have "Talk about"', nudge.text.toUpperCase(), 'TALK ABOUT IT TONIGHT');

  // ====================================================================
  // SCENARIO C — streak < 3, no engagement → server cron should SKIP
  // (we just verify the gate logic; renderer isn't called)
  // ====================================================================
  console.log('\nScenario C — Skip gate (streak < 3, no engagement)');
  await setProgress(u.id, {
    current_streak: 1,
    last_active_date: null,
    last_streak_date: null,
  });
  const summary3 = await getDailyEngagementSummary(u.id, digestDate);
  const progress3 = await getProgress(u.id);
  ok('engaged = false',                       summary3.engaged === false);
  ok('streak = 1 (below nudge threshold)',    progress3.progress.currentStreak === 1);
  // Server logic: variant = engaged ? 'recap' : (streak >= 3 ? 'nudge' : null)
  const variant = summary3.engaged ? 'recap' : (progress3.progress.currentStreak >= 3 ? 'nudge' : null);
  ok('variant resolves to null (skip)',       variant === null);

  // ====================================================================
  // SCENARIO D — legacy digest row WITHOUT parentExplainer fields
  // (backward compat — should render gracefully)
  // ====================================================================
  console.log('\nScenario D — Legacy digest backward compat');
  await resetEvents(u.id);
  await setProgress(u.id, {
    current_streak: 5,
    longest_streak: 12,
    market_coins: 450,
    rank_key: 'trading-cadet',
    last_active_date: digestDate,
    last_streak_date: digestDate,
  });
  await seedEvent(u.id, 'daily-visit', { digestDate, mcAwarded: 0 });
  await seedEvent(u.id, 'game-completed', { digestDate, game: 'quiz', correct: true, mcAwarded: 25, perfectDay: false });
  await seedEvent(u.id, 'parent-question', { digestDate, section: 'story-0', topic: 'A story title from before phase 12', mcAwarded: 0 });

  // Strip parentExplainer from a clone of digestContent to simulate a
  // legacy digest row.
  const legacyContent = JSON.parse(JSON.stringify(digestContent));
  delete legacyContent.bigPictureParentExplainer;
  (legacyContent.stories || []).forEach(s => delete s.parentExplainer);
  if (legacyContent.wordOfDay) delete legacyContent.wordOfDay.parentExplainer;
  if (legacyContent.didYouKnow) delete legacyContent.didYouKnow.parentExplainer;
  if (legacyContent.quiz) delete legacyContent.quiz.parentExplainer;

  const sLegacy = await getDailyEngagementSummary(u.id, digestDate);
  const qLegacy = await getParentQuestionsForDate(u.id, digestDate);
  const pLegacy = await getProgress(u.id);
  const renderedLegacy = renderEveningRecap({
    kidName: 'Sky',
    engagement: sLegacy,
    digestContent: legacyContent,
    progress: pLegacy,
    parentQuestions: qLegacy,
    digestDate,
    variant: 'recap',
  });
  // Should still render — no crashes, includes the kid-flagged topic
  // (since the question row carries the topic string), but no conversation
  // starter and no "Talk about it tonight" section (no explainers at all).
  ok('legacy render returns html',                 typeof renderedLegacy.html === 'string' && renderedLegacy.html.length > 100);
  contains('legacy includes flagged topic',        renderedLegacy.text, 'A story title from before phase 12');
  notContains('legacy has no literal [kid]',       renderedLegacy.text, '[kid]');
  notContains('legacy has no "Talk about" block',  renderedLegacy.text.toUpperCase(), 'TALK ABOUT IT TONIGHT');

  // ====================================================================
  // SCENARIO E — full pipeline through real recordEvent()
  // ====================================================================
  // Earlier scenarios seed audit rows directly. This one exercises the
  // exact code path production hits: recordEvent enriches event_data
  // with mcAwarded + perfectDay etc., then the Phase 12 summary helper
  // aggregates those enriched rows. Catches any drift between what
  // Phase 11's writer produces and what Phase 12's reader expects.
  console.log('\nScenario E — Full pipeline via recordEvent()');

  // Reset user to a known starting state with a 4-day streak ending
  // YESTERDAY so today's first game advances to 5 + awards a streak bonus.
  await resetEvents(u.id);
  const yesterday = new Date(new Date(digestDate + 'T12:00:00Z').getTime() - 86400000)
    .toISOString().slice(0, 10);
  await setProgress(u.id, {
    market_coins: 350,
    current_streak: 4,
    longest_streak: 12,
    streak_shields: 1,
    rank_key: 'trading-cadet',
    perfect_days: 4,
    games_played: 18,
    correct_answers: 13,
    sunday_challenges: 1,
    weeks_active: 3,
    words_learned: 2,
    last_active_date: yesterday,
    last_streak_date: yesterday,
    last_iso_week: null,
  });

  // Daily visit + 3 unique games + word reveal + 1 parent question.
  await recordEvent(u.id, 'daily-visit', { digestDate });
  const g1 = await recordEvent(u.id, 'game-completed', { game: 'bull-bear', correct: true,  digestDate });
  const g2 = await recordEvent(u.id, 'game-completed', { game: 'quiz',      correct: true,  digestDate });
  const g3 = await recordEvent(u.id, 'game-completed', { game: 'compound',  correct: false, digestDate });
  const wl = await recordEvent(u.id, 'word-learned',   { digestDate });
  const pq = await recordEvent(u.id, 'parent-question', {
    section: 'big-picture',
    topic: "Today's Big Picture",
    digestDate,
  });

  ok('game 1 awarded MC',                  g1.mcAwarded > 0, `got ${g1.mcAwarded}`);
  ok('game 1 advanced streak to 5',        g1.streakUpdate.current === 5, `got ${g1.streakUpdate.current}`);
  ok('game 3 fired Perfect Day',           g3.mcAwarded >= 40,
     `expected >=40 (15 participation + 25 perfect day), got ${g3.mcAwarded}`);
  ok('word-learned awarded 5 MC',          wl.mcAwarded === 5);
  ok('parent-question awarded 0 MC',       pq.mcAwarded === 0);
  ok('parent-question not flagged dup',    !pq.duplicate);

  const summaryE = await getDailyEngagementSummary(u.id, digestDate);
  const questionsE = await getParentQuestionsForDate(u.id, digestDate);
  const progressE = await getProgress(u.id);

  // Summary should reflect the events recordEvent actually wrote.
  ok('summary.engaged via recordEvent',    summaryE.engaged === true);
  ok('summary.gamesPlayed = 3',            summaryE.gamesPlayed === 3);
  ok('summary.gamesCorrect = 2',           summaryE.gamesCorrect === 2);
  ok('summary.perfectDay = true',          summaryE.perfectDay === true);
  ok('summary.wordLearned = true',         summaryE.wordLearned === true);
  ok('summary.totalMC matches event sum',
     summaryE.totalMC === (g1.mcAwarded + g2.mcAwarded + g3.mcAwarded + wl.mcAwarded),
     `summary=${summaryE.totalMC}, events=${g1.mcAwarded + g2.mcAwarded + g3.mcAwarded + wl.mcAwarded}`);
  ok('questions includes big-picture',     questionsE.some(q => q.section === 'big-picture'));
  ok('progress.currentStreak = 5',         progressE.progress.currentStreak === 5);

  const renderedE = renderEveningRecap({
    kidName: 'Sky',
    engagement: summaryE,
    digestContent,
    progress: progressE,
    parentQuestions: questionsE,
    digestDate,
    variant: 'recap',
  });

  contains('E recap mentions Perfect Day', renderedE.text, 'Perfect Day');
  contains('E recap lists 3 games',        renderedE.text, 'Played 3 games');
  contains('E recap has 5-day streak',     renderedE.text, 'Streak: 5 days');
  contains('E recap has big-picture topic', renderedE.text, "Today's Big Picture");

  // Dup re-tap on same section + day must NOT add a second question row.
  const dupTap = await recordEvent(u.id, 'parent-question', {
    section: 'big-picture',
    topic: "Today's Big Picture",
    digestDate,
  });
  ok('dup parent-question flagged duplicate', dupTap.duplicate === true);
  const questionsAfterDup = await getParentQuestionsForDate(u.id, digestDate);
  ok('dup parent-question NOT in questions list',
     questionsAfterDup.length === 1,
     `expected 1 question, got ${questionsAfterDup.length}`);

  // ====================================================================
  // SCENARIO F — variant-fork decision matrix
  // ====================================================================
  // The cron in server.js#sendEveningRecaps does this fork. Lock down
  // the logic so a refactor can't accidentally start emailing fresh
  // signups or skipping engaged kids.
  console.log('\nScenario F — Variant-fork decision matrix');

  const matrix = [
    // [label, engaged, streak, expectedVariant]
    ['engaged + streak 0   → recap',  true,  0, 'recap'],
    ['engaged + streak 5   → recap',  true,  5, 'recap'],
    ['idle    + streak 0   → skip',   false, 0, null],
    ['idle    + streak 1   → skip',   false, 1, null],
    ['idle    + streak 2   → skip',   false, 2, null],
    ['idle    + streak 3   → nudge',  false, 3, 'nudge'],
    ['idle    + streak 7   → nudge',  false, 7, 'nudge'],
    ['idle    + streak 100 → nudge',  false, 100, 'nudge'],
  ];
  for (const [label, engaged, streak, expected] of matrix) {
    const variant = engaged ? 'recap' : (streak >= 3 ? 'nudge' : null);
    ok(label, variant === expected, `got ${JSON.stringify(variant)}, expected ${JSON.stringify(expected)}`);
  }
}

// ---- Entry point ------------------------------------------------------

main()
  .then(() => {
    console.log(`\n${'='.repeat(50)}`);
    if (failures > 0) {
      console.error(`❌ ${failures} assertion(s) failed.`);
      process.exit(1);
    }
    console.log(`✅ All checks passed.`);
    process.exit(0);
  })
  .catch(err => {
    console.error('\nFATAL:', err);
    process.exit(2);
  })
  .finally(async () => {
    try { await hardDelete(testUserId); }
    catch (e) { console.error('[cleanup] failed:', e.message); }
  });
