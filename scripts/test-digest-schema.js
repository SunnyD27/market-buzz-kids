// scripts/test-digest-schema.js
//
// Phase 18 smoke test — generation pipeline hardening. Pure/offline: NO
// API calls, NO database.
//
//  - 18b: zod validation (valid fixtures per edition, deliberately broken
//    shapes fail with the right messages)
//  - 18a: the pass-1 sanity gate, and the repair-retry loop driven through
//    generateContent's injectable test seams (fake research + write)
//  - 18c: the retry ladder (runMorningPipeline with fake collaborators —
//    fail/fail/succeed → ✅ notes attempt 3; all-fail → one ❌ listing
//    every attempt; fan-out failure → immediate ❌, no retry)
//  - 18d: SENSITIVE NEWS rule present in all three builders + the research
//    prompt (source assertions)
//
// Usage: node scripts/test-digest-schema.js

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateDigest } from '../src/digest-schema.js';
import { generateContent, assertBriefUsable, MIN_BRIEF_CHARS } from '../src/ai.js';
import { runMorningPipeline, RETRY_DELAYS_MS } from '../src/morning-run.js';
import { buildSuccessPing, buildFailureAlert } from '../src/notify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures += 1; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}
function eq(label, actual, expected) {
  const pass = actual === expected;
  ok(label, pass, pass ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---- Fixtures -----------------------------------------------------------

const explainer = () => ({
  summary: 'A plain-language summary for the parent, long enough to count.',
  conversationStarter: 'Ask your kid what they think about this specific thing today.',
});

const story = (label) => ({
  badgeLabel: label,
  title: 'A big company did a big thing',
  body: 'The company reported numbers that surprised everyone watching the market today. ' +
        'Analysts expected less, and the stock moved a lot on the news this morning.',
  whyItMatters: 'This teaches why expectations matter more than raw results.',
  principle: 10,
  parentExplainer: explainer(),
});

const scoreCard = () => ({ price: '6,001.23', change: '+0.5%', direction: 'up', vibe: 'calm climb' });

function makeValidDigest(editionType) {
  const d = {
    date: 'Tuesday, June 23, 2026',
    tradingDay: 'yesterday',
    editionType,
    marketVibe: 'green',
    vibeEmoji: '🚀',
    vibeSummary: 'Markets climbed on solid earnings news.',
    bigPicture: 'Markets had a steady day as several large companies reported earnings that beat expectations and investors stayed calm about interest rates.',
    bigPictureParentExplainer: explainer(),
    scoreboard: {
      sp500: scoreCard(), nasdaq: scoreCard(), dow: scoreCard(),
      topMover: { name: 'Nike', ticker: 'NKE', price: '99.10', change: '+4.2%', direction: 'up', vibe: 'sneaker surge', reason: 'A strong earnings report beat what analysts expected.', principle: 8 },
    },
    stories: [story('BIG NEWS'), story('ALSO TODAY'), story('ONE MORE')],
    didYouKnow: { fact: 'The New York Stock Exchange opening bell has been rung since the 1800s every trading day.', category: 'market history', principle: 6, parentExplainer: explainer() },
    quiz: { question: 'What does it mean when a stock is "priced in"?', options: ['A', 'B', 'C', 'D'], correctIndex: 2, explanation: 'Expectations are already reflected in the price before the news lands.', principle: 10, parentExplainer: explainer() },
    wordOfDay: { word: 'Earnings', type: 'noun', context: 'money talk', definition: 'The profit a company makes after paying all of its costs — like your allowance after expenses.', principle: 8, parentExplainer: explainer() },
    mysteryMover: { ticker: 'RBLX', name: 'Roblox', clues: ['c'.repeat(20), 'c'.repeat(20), 'c'.repeat(20), 'c'.repeat(20), 'Their name starts with "R" and their stock ticker is 4 letters long.'], acceptableAnswers: ['Roblox', 'RBLX'] },
    glossaryNominations: [],
  };
  if (editionType === 'weekly-wrap') {
    d.stories = [story("WEEK'S BIGGEST"), story('ALSO THIS WEEK')];
    d.sundayChallenge = { type: 'dilemma', principle: 7, scenario: 'pick one' };
    d.marketClosed = true;
  }
  if (editionType === 'week-ahead') {
    d.stories = [story('WATCH THIS WEEK'), story('ALSO COMING UP')];
    delete d.scoreboard.topMover;
    d.marketClosed = true;
  }
  return d;
}

const editionOf = (t) => ({ editionType: t });

async function main() {
  console.log('\n🛡️ Phase 18 pipeline-hardening smoke test\n');

  // -------- Section 1: zod — valid fixtures pass --------------------------
  console.log('Section 1 — validateDigest accepts valid digests (all 3 editions)');
  for (const t of ['standard', 'weekly-wrap', 'week-ahead']) {
    const r = validateDigest(makeValidDigest(t), editionOf(t));
    ok(`${t} fixture passes`, r.ok, r.errors.join(' | '));
  }
  const twoStory = makeValidDigest('standard');
  twoStory.stories = twoStory.stories.slice(0, 2);
  ok('standard with 2 stories passes (house rule, not the spec\'s flat 3)', validateDigest(twoStory, editionOf('standard')).ok);
  const wrapMover = makeValidDigest('weekly-wrap');
  delete wrapMover.scoreboard.topMover.reason;
  delete wrapMover.scoreboard.topMover.principle;
  wrapMover.scoreboard.topMover.vibe = 'Up 8% on the week after a blowout earnings report.';
  ok('wrap-shaped topMover (vibe, no reason/principle) passes — the wrap prompt\'s real shape',
    validateDigest(wrapMover, editionOf('weekly-wrap')).ok);
  const moverNoExplain = makeValidDigest('standard');
  delete moverNoExplain.scoreboard.topMover.reason;
  moverNoExplain.scoreboard.topMover.vibe = 'short';
  ok('topMover with NO explanatory sentence rejected', !validateDigest(moverNoExplain, editionOf('standard')).ok);
  const quietWeek = makeValidDigest('week-ahead'); // no oneToWatch at all
  ok('week-ahead WITHOUT oneToWatch passes (omit-on-quiet-week design)', validateDigest(quietWeek, editionOf('week-ahead')).ok);

  // -------- Section 2: zod — broken shapes fail correctly ------------------
  console.log('\nSection 2 — validateDigest rejects broken digests');
  const cases = [
    ['bad marketVibe enum', d => { d.marketVibe = 'purple'; }, 'marketVibe'],
    ['4 stories on standard', d => { d.stories.push(story('EXTRA')); }, 'stories'],
    ['missing story parentExplainer', d => { delete d.stories[0].parentExplainer; }, 'parentExplainer'],
    ['principle out of range', d => { d.quiz.principle = 12; }, 'principle'],
    ['quiz correctIndex out of range', d => { d.quiz.correctIndex = 4; }, 'correctIndex'],
    ['quiz with 3 options', d => { d.quiz.options = ['A', 'B', 'C']; }, 'options'],
    ['missing bigPictureParentExplainer', d => { delete d.bigPictureParentExplainer; }, 'bigPictureParentExplainer'],
    ['missing topMover on standard', d => { delete d.scoreboard.topMover; }, 'topMover'],
    ['mysteryMover with 4 clues', d => { d.mysteryMover.clues = d.mysteryMover.clues.slice(0, 4); }, 'clues'],
    ['missing mysteryMover entirely', d => { delete d.mysteryMover; }, 'mysteryMover'],
  ];
  for (const [label, mutate, needle] of cases) {
    const d = makeValidDigest('standard');
    mutate(d);
    const r = validateDigest(d, editionOf('standard'));
    ok(label + ' rejected', !r.ok && r.errors.some(e => e.includes(needle)),
      r.ok ? 'unexpectedly passed' : `errors lack "${needle}": ${r.errors.join(' | ')}`);
  }
  const wrapNoSunday = makeValidDigest('weekly-wrap');
  delete wrapNoSunday.sundayChallenge;
  ok('weekly-wrap without sundayChallenge rejected',
    !validateDigest(wrapNoSunday, editionOf('weekly-wrap')).ok);
  const wrapOneStory = makeValidDigest('weekly-wrap');
  wrapOneStory.stories = wrapOneStory.stories.slice(0, 1);
  ok('weekly-wrap with 1 story rejected', !validateDigest(wrapOneStory, editionOf('weekly-wrap')).ok);
  const aheadWithMover = makeValidDigest('week-ahead');
  aheadWithMover.scoreboard.topMover = makeValidDigest('standard').scoreboard.topMover;
  ok('week-ahead WITH topMover rejected (forward edition)', !validateDigest(aheadWithMover, editionOf('week-ahead')).ok);
  const wrapOpen = makeValidDigest('weekly-wrap');
  wrapOpen.marketClosed = false;
  ok('weekly-wrap without marketClosed rejected', !validateDigest(wrapOpen, editionOf('weekly-wrap')).ok);
  const wrongEdition = makeValidDigest('standard');
  wrongEdition.editionType = 'weekly-wrap';
  ok('editionType mismatch vs calendar rejected', !validateDigest(wrongEdition, editionOf('standard')).ok);

  // -------- Section 3: pass-1 sanity gate ----------------------------------
  console.log('\nSection 3 — research-brief sanity gate (hollow brief = pass-1 failure)');
  ok(`usable brief (>= ${MIN_BRIEF_CHARS} chars) passes`, assertBriefUsable('x'.repeat(MIN_BRIEF_CHARS)) === true);
  for (const [label, brief] of [['empty brief', ''], ['whitespace brief', '   \n  '], ['short brief', 'markets were fine today'], ['null brief', null]]) {
    let threw = false;
    try { assertBriefUsable(brief); } catch (e) { threw = /unusable/.test(e.message); }
    ok(`${label} throws`, threw);
  }

  // -------- Section 4: two-pass orchestration + repair retry (offline) -----
  console.log('\nSection 4 — generateContent: repair retry via injected passes');
  const fatBrief = 'RESEARCH BRIEF\n' + 'Solid verifiable material with sources. '.repeat(30);
  const edition = { editionType: 'standard', reason: 'weekday', dateStr: '2026-06-23', dayName: 'Tuesday' };

  // 4a: invalid first write → repaired second write → success.
  const writeCalls = [];
  const invalid = makeValidDigest('standard');
  invalid.marketVibe = 'purple';
  const valid = makeValidDigest('standard');
  let toggle = 0;
  const content = await generateContent({}, [], { topGainers: [], topLosers: [] }, null, {
    edition,
    _test: {
      research: async () => fatBrief,
      write: async (prompt) => { writeCalls.push(prompt); return structuredClone(toggle++ === 0 ? invalid : valid); },
    },
  });
  eq('write pass called twice (one repair retry)', writeCalls.length, 2);
  ok('repair prompt names the failed check', writeCalls[1].includes('REPAIR PASS') && writeCalls[1].includes('marketVibe'));
  ok('repaired digest returned valid', validateDigest(content, edition).ok);
  ok('write prompt embeds the research brief', writeCalls[0].includes('RESEARCH BRIEF'));
  ok('write prompt carries the use-only-brief-figures hard rule', writeCalls[0].includes('USE ONLY FIGURES PRESENT IN THE RESEARCH BRIEF'));

  // 4b: still invalid after the repair → throws with validationErrors.
  let thrown = null;
  try {
    await generateContent({}, [], { topGainers: [], topLosers: [] }, null, {
      edition,
      _test: { research: async () => fatBrief, write: async () => structuredClone(invalid) },
    });
  } catch (e) { thrown = e; }
  ok('second validation failure throws', !!thrown);
  ok('…with the validationErrors list attached (→ Telegram ❌)', Array.isArray(thrown?.validationErrors) && thrown.validationErrors.some(e => e.includes('marketVibe')));

  // 4c: hollow research brief never reaches pass 2.
  let pass2Ran = false;
  let gateErr = null;
  try {
    await generateContent({}, [], { topGainers: [], topLosers: [] }, null, {
      edition,
      _test: { research: async () => 'too short', write: async () => { pass2Ran = true; return structuredClone(valid); } },
    });
  } catch (e) { gateErr = e; }
  ok('hollow brief throws (feeds the retry ladder)', /unusable/.test(gateErr?.message || ''));
  eq('pass 2 never ran on a hollow brief', pass2Ran, false);

  // -------- Section 5: retry ladder (offline) -------------------------------
  console.log('\nSection 5 — 7:00/7:10/7:25 retry ladder');
  eq('ladder delays are 10 min + 15 min', JSON.stringify(RETRY_DELAYS_MS), JSON.stringify([600000, 900000]));

  // 5a: fail, fail, succeed → fan-out once, ✅ notes attempt 3.
  let attempts = 0;
  const sleeps = [];
  const alerts = [];
  let fanOuts = 0;
  const r1 = await runMorningPipeline({
    date: '2026-06-23', edition: 'standard',
    generate: async () => { attempts++; if (attempts < 3) throw new Error(`boom ${attempts}`); },
    fanOut: async () => { fanOuts++; return { ok: true, sent: 3, failed: 0, total: 3, kids: 5 }; },
    alert: async (msg) => { alerts.push(msg); },
    sleep: async (ms) => { sleeps.push(ms); },
    successPing: true,
  });
  eq('succeeded on attempt 3', r1.attempts, 3);
  eq('slept 10 min then 15 min', JSON.stringify(sleeps), JSON.stringify([600000, 900000]));
  eq('fan-out ran exactly once', fanOuts, 1);
  eq('exactly one alert (the ✅)', alerts.length, 1);
  ok('✅ notes which attempt succeeded', alerts[0].startsWith('✅') && alerts[0].includes('needed attempt 3/3'));

  // 5b: all three fail → one ❌ listing every attempt, fan-out never runs.
  const alerts2 = [];
  let fanOuts2 = 0;
  const r2 = await runMorningPipeline({
    date: '2026-06-23', edition: 'standard',
    generate: async () => { const e = new Error('still broken'); e.validationErrors = ['stories: too few']; throw e; },
    fanOut: async () => { fanOuts2++; return { ok: true }; },
    alert: async (msg) => { alerts2.push(msg); },
    sleep: async () => {},
  });
  eq('not generated after 3 attempts', r2.generated, false);
  eq('fan-out never ran', fanOuts2, 0);
  eq('exactly one alert (the ❌)', alerts2.length, 1);
  ok('❌ lists each attempt + the stage', alerts2[0].startsWith('❌') && alerts2[0].includes('attempt 1:') && alerts2[0].includes('all 3 attempts failed'));
  ok('❌ carries the validation errors', alerts2[0].includes('Validation errors:') && alerts2[0].includes('stories: too few'));

  // 5c: clean first try → quiet ✅ (no attempt note).
  const alerts3 = [];
  await runMorningPipeline({
    date: '2026-06-23', edition: 'standard',
    generate: async () => {},
    fanOut: async () => ({ ok: true, sent: 3, failed: 0, total: 3, kids: 5 }),
    alert: async (msg) => { alerts3.push(msg); },
    sleep: async () => {},
    successPing: true,
  });
  ok('first-try ✅ has no attempt note', alerts3[0].startsWith('✅') && !alerts3[0].includes('needed attempt'));

  // 5d: generation ok, fan-out fails → immediate ❌, no generation retry.
  const alerts4 = [];
  let gens4 = 0;
  await runMorningPipeline({
    date: '2026-06-23', edition: 'standard',
    generate: async () => { gens4++; },
    fanOut: async () => ({ ok: false, status: 'db_error', error: 'no recipients table' }),
    alert: async (msg) => { alerts4.push(msg); },
    sleep: async () => {},
  });
  eq('generation ran once', gens4, 1);
  ok('fan-out failure alerts immediately (stage: teaser fan-out)', alerts4.length === 1 && alerts4[0].includes('teaser fan-out'));

  // -------- Section 6: 18d — sensitive-news rule presence -------------------
  console.log('\nSection 6 — SENSITIVE NEWS rule in all prompts (source assertions)');
  const aiSrc = readFileSync(path.join(__dirname, '..', 'src', 'ai.js'), 'utf8');
  ok('rule constant defined with the spec wording', aiSrc.includes('SENSITIVE NEWS RULES (NON-NEGOTIABLE)') && aiSrc.includes('never dwell on casualties or suffering') && aiSrc.includes("end such sections on what's known, not what's feared"));
  eq('injected in all 3 edition builders + the research prompt', (aiSrc.match(/\$\{SENSITIVE_NEWS_RULE\}/g) || []).length, 4);
  ok('builders no longer instruct a web search (two-pass split)', !aiSrc.includes('STEP 1: Before writing anything, use web_search'));
  ok('write pass forces the emit_digest tool', aiSrc.includes("tool_choice: { type: 'tool', name: 'emit_digest' }"));

  // Phase 17 interplay: resolution must run before the cache check so every
  // retry/replay attempt resolves picks (idempotency itself is covered by
  // scripts/test-picks.js Section 4's re-run assertion).
  const genSrc = readFileSync(path.join(__dirname, '..', 'src', 'generate.js'), 'utf8');
  ok('resolveTomorrowCalls runs before the cache check (every retry resolves)',
    genSrc.indexOf('resolveTomorrowCalls(today)') < genSrc.indexOf('Cache check'));

  console.log('');
  if (failures === 0) console.log('🎉 All pipeline-hardening smoke-test assertions passed.\n');
  else console.error(`💥 ${failures} assertion(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n💥 Test run threw:', err);
  process.exit(1);
});
