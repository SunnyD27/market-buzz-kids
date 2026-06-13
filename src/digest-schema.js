// src/digest-schema.js — Phase 18b: zod validation of the AI digest.
//
// The strict, edition-aware gate that runs BEFORE saveDigest(): the
// emit_digest tool schema (src/ai.js) is deliberately loose and structural;
// this is where the real rules live. On failure the caller re-runs pass 2
// once with these errors appended ("repair retry"), then fails loud into
// the existing Telegram ❌ path.
//
// Codebase-over-spec notes (recorded in the Phase 18 HANDOFF entry):
//  - standard allows 2–3 stories (the house rule since Phase 6: "3 by
//    default, 2 only if the news genuinely doesn't support a third") — the
//    ROADMAP spec's flat "3" would reject legitimate thin-news days.
//  - oneToWatch stays OPTIONAL on week-ahead (omit-on-quiet-week is
//    deliberate design); topMover is absent on week-ahead by design.
//  - the big-picture explainer lives at bigPictureParentExplainer (top
//    level), a Phase 12 field-name quirk.
//  - mysteryMover arrives here already FINALIZED (name-leak gate + reserve
//    fallback in src/mystery.js ran first — puzzle problems are repaired by
//    the cheap deterministic fallback, never by burning the repair retry);
//    this validates the finalized shape as belt-and-suspenders.

import { z } from 'zod';

const Principle = z.number().int().min(1).max(11);

const ParentExplainer = z.object({
  summary: z.string().min(10),
  conversationStarter: z.string().min(10),
}).loose();

const Story = z.object({
  badgeLabel: z.string().min(1),
  title: z.string().min(3),
  body: z.string().min(40),
  whyItMatters: z.string().min(20),
  principle: Principle,
  parentExplainer: ParentExplainer,
}).loose();

const ScoreCard = z.object({
  price: z.union([z.string(), z.number()]),
  change: z.union([z.string(), z.number()]),
  direction: z.enum(['up', 'down']),
}).loose();

// Two real shapes in the prompts (codebase is truth): the standard builder
// asks for `reason` + `principle`; the weekly-wrap builder's mover carries
// its explanation in `vibe` and has NO principle field. Require the core
// identity + at least one explanatory sentence.
const TopMover = z.object({
  name: z.string().min(1),
  ticker: z.string().min(1),
  reason: z.string().min(10).optional(),
  vibe: z.string().min(10).optional(),
  principle: Principle.optional(),
}).loose().refine(m => m.reason || m.vibe, { message: 'needs a reason or vibe sentence' });

const OneToWatch = z.object({
  name: z.string().min(1),
  ticker: z.string().min(1),
  catalyst: z.string().min(5),
  reason: z.string().min(10),
  principle: Principle,
}).loose();

const Quiz = z.object({
  question: z.string().min(10),
  options: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(10),
  principle: Principle,
  parentExplainer: ParentExplainer,
}).loose();

const WordOfDay = z.object({
  word: z.string().min(1),
  type: z.string().min(1),
  context: z.string().min(1),
  definition: z.string().min(20),
  principle: Principle,
  parentExplainer: ParentExplainer,
}).loose();

const DidYouKnow = z.object({
  fact: z.string().min(20),
  category: z.string().min(1),
  principle: Principle,
  parentExplainer: ParentExplainer,
}).loose();

// Finalized by src/mystery.js before validation: 5 clues (clue 5
// server-composed), canonical name + ticker merged into acceptableAnswers.
const MysteryMover = z.object({
  ticker: z.string().min(1),
  name: z.string().min(1),
  clues: z.array(z.string().min(12)).length(5),
  acceptableAnswers: z.array(z.string().min(1)).min(1),
}).loose();

// The four per-type prompt schemas carry principle INSIDE their rounds/
// scenarios (not top-level) — only the type discriminator is universal.
const SundayChallenge = z.object({
  type: z.enum(['trading-floor', 'ceo', 'investathon', 'dilemma']),
}).loose();

const GlossaryNomination = z.object({
  term: z.string().min(1),
  definition: z.string().min(5),
}).loose();

// Fields every edition must carry.
const BaseDigest = z.object({
  date: z.string().min(4),
  editionType: z.enum(['standard', 'weekly-wrap', 'week-ahead']),
  marketVibe: z.enum(['green', 'red', 'mixed']),
  vibeSummary: z.string().min(10),
  bigPicture: z.string().min(40),
  bigPictureParentExplainer: ParentExplainer,
  scoreboard: z.object({
    sp500: ScoreCard,
    nasdaq: ScoreCard,
    dow: ScoreCard,
  }).loose(),
  stories: z.array(Story).min(2).max(3),
  didYouKnow: DidYouKnow,
  quiz: Quiz,
  wordOfDay: WordOfDay,
  mysteryMover: MysteryMover,
  glossaryNominations: z.array(GlossaryNomination).max(5).optional(),
}).loose();

/**
 * Validate the (scrubbed, glossary-filtered, mystery-finalized) digest
 * against the edition's rules. Returns { ok, errors: string[] } — errors
 * are human-readable lines, ready to feed the repair-retry prompt or the
 * Telegram ❌.
 */
export function validateDigest(content, edition = { editionType: 'standard' }) {
  const errors = [];
  const editionType = edition.editionType || 'standard';

  const base = BaseDigest.safeParse(content);
  if (!base.success) {
    for (const issue of base.error.issues) {
      errors.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  }

  // Edition cross-checks (run even when base parsing failed, where possible).
  if (content && typeof content === 'object') {
    if (content.editionType && content.editionType !== editionType) {
      errors.push(`editionType: expected "${editionType}" (calendar), got "${content.editionType}"`);
    }

    const stories = Array.isArray(content.stories) ? content.stories : [];
    if (editionType === 'standard') {
      // House rule: 3 by default, 2 on genuinely thin news days.
      if (stories.length < 2 || stories.length > 3) {
        errors.push(`stories: standard edition needs 2–3 stories, got ${stories.length}`);
      }
    } else if (stories.length !== 2) {
      errors.push(`stories: ${editionType} needs exactly 2 stories, got ${stories.length}`);
    }

    if (editionType === 'weekly-wrap' || editionType === 'standard') {
      const tm = TopMover.safeParse(content.scoreboard?.topMover);
      if (!tm.success) {
        errors.push(`scoreboard.topMover: required on ${editionType} (${tm.error.issues[0]?.message || 'missing'})`);
      }
    }
    if (editionType === 'week-ahead') {
      if (content.scoreboard?.topMover) {
        errors.push('scoreboard.topMover: must be ABSENT on week-ahead (oneToWatch is the forward slot)');
      }
      // oneToWatch is OPTIONAL by design (omit-on-quiet-week) — validate
      // shape only when present.
      if (content.oneToWatch != null) {
        const otw = OneToWatch.safeParse(content.oneToWatch);
        if (!otw.success) {
          errors.push(`oneToWatch: ${otw.error.issues[0]?.path.join('.')}: ${otw.error.issues[0]?.message}`);
        }
      }
    }

    if (editionType === 'weekly-wrap') {
      const sc = SundayChallenge.safeParse(content.sundayChallenge);
      if (!sc.success) {
        errors.push(`sundayChallenge: required on weekly-wrap (${sc.error.issues[0]?.message || 'missing'})`);
      }
    }
    if (editionType !== 'standard' && content.marketClosed !== true) {
      errors.push(`marketClosed: must be true on ${editionType} (weekend/closed-day note above the scoreboard)`);
    }
  }

  return { ok: errors.length === 0, errors };
}
