import Anthropic from '@anthropic-ai/sdk';

// Lazy client init. Constructing at module load runs before dotenv
// finishes overriding stale env (real gotcha on macOS where launchd can
// inject ANTHROPIC_API_KEY=""). Reading the key at call time is safe and
// has no measurable cost.
let _client = null;
function client() {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ── Kid-safe language scrub ────────────────────────────────────────────
// Models writing in a "punchy older sibling" voice naturally reach for
// phrases like "production hell," "what the hell," "sucks," etc. Those are
// fine for adults but inappropriate in a 10-14 product. We do two things:
//   1. Tell the model NOT to use them (prompt rule, see PROFANITY_RULE).
//   2. Scrub the model's output anyway as a safety net (this map).
// Whole-word matches only — never substring — so we don't mangle e.g. "class"
// while replacing "ass," or "Shelly" while replacing "hell."
const PROFANITY_REPLACEMENTS = [
  [/\bhell\b/gi,     'heck'],
  [/\bdamn\b/gi,     'darn'],
  [/\bdamned\b/gi,   'doomed'],
  [/\bcrap\b/gi,     'junk'],
  [/\bcrappy\b/gi,   'bad'],
  [/\bsucks\b/gi,    'is rough'],
  [/\bsucked\b/gi,   'was rough'],
  [/\bscrewed\b/gi,  'in trouble'],
  [/\bpissed\b/gi,   'angry'],
  // Whole-word ass / asses, but NOT "class," "embarrass," "passed," etc.
  [/\bass\b/gi,      'rear'],
  [/\basses\b/gi,    'rears'],
  // 'WTF' literal
  [/\bWTF\b/gi,      'whoa'],
];

/**
 * Recursively scrub kid-inappropriate language out of any string field in
 * the given value. Mutates strings in place via re-assignment; arrays and
 * plain objects are walked. Other types are returned as-is.
 */
export function scrubProfanity(v) {
  if (typeof v === 'string') {
    let out = v;
    for (const [re, repl] of PROFANITY_REPLACEMENTS) out = out.replace(re, repl);
    return out;
  }
  if (Array.isArray(v)) return v.map(scrubProfanity);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = scrubProfanity(v[k]);
    return out;
  }
  return v;
}

const PROFANITY_RULE = `LANGUAGE RULES (NON-NEGOTIABLE):
- This is a product for kids 10-14. NEVER use mild profanity or coarse language. That includes "hell" (no "production hell," no "what the hell," no "hell of a"), "damn," "crap," "sucks," "screwed," "pissed," or any stronger word. Use kid-friendly alternatives: "rough patch," "tough stretch," "an incredible," "really," "junk," "is bad," "in trouble," "frustrated."
- No slang for body parts, no innuendo, no insults aimed at people or groups.
- If you're tempted to use a stronger word for emphasis, rewrite the sentence instead.`;

// The 8 core investing principles every piece of generated content should
// reinforce. Surfaced to the model so every "Why It Matters", quiz
// explanation, Did You Know, and Word of Day traces back to a real lesson.
const INVESTING_PRINCIPLES = `
1. Start early, let time work for you — compound interest, long-term thinking.
2. Diversification protects you — don't put all eggs in one basket, index funds vs single stocks.
3. Markets go up and down, but mostly up — volatility is normal, don't panic sell.
4. Understand what you own — know how a company makes money before investing in it.
5. Risk and reward are connected — higher potential returns mean higher risk.
6. The news moves markets — events in the real world affect stock prices.
7. Think like an owner, not a gambler — buying stock = owning a piece of a business.
8. Fees and costs matter — small percentages compound into big differences over time.
`.trim();

export async function generateContent(marketData, news, movers, topMover, opts = {}) {
  // Anti-repeat lists loaded by generate.js from state/content-history.json
  // so the prompt can tell Claude what to avoid today.
  //   opts.recentWords (string[]) — Word of the Day picks from last N days
  //   opts.recentFacts (string[]) — Did You Know facts from last N days
  const recentWords = Array.isArray(opts.recentWords) ? opts.recentWords : [];
  const recentFacts = Array.isArray(opts.recentFacts) ? opts.recentFacts : [];
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  });

  const dayOfWeek = today.getDay();
  let tradingDayLabel = "yesterday";
  if (dayOfWeek === 0) tradingDayLabel = "Friday";
  if (dayOfWeek === 1) tradingDayLabel = "Friday";
  if (dayOfWeek === 6) tradingDayLabel = "Friday";

  const topMoverBlock = topMover
    ? JSON.stringify(topMover, null, 2)
    : 'null  // no curated mover available — pick the most kid-recognizable name from the broader movers list instead and flag that fact in the vibe.';

  const prompt = `You are the writer for "Market Buzz Kids," a daily stock market digest for kids ages 10-14 and their parents. This is a financial education product disguised as a daily habit — every game, story, and fun fact teaches a real investing principle.

${PROFANITY_RULE}

CORE PHILOSOPHY: Every piece of content you generate must reinforce at least one of these 8 core investing principles. Use them as the lens for every "Why It Matters" box, every quiz explanation, every Did You Know fact, every Word of the Day analogy:

${INVESTING_PRINCIPLES}

STEP 1: Before writing anything, use web_search to search for today's top stock market and business news headlines. Search for:
- 'stock market news today'
- 'biggest business news today'
- any major earnings, IPOs, or economic events happening today
Use what you find PLUS the raw data below to write the digest. The web search results should be your PRIMARY source for story selection — the raw FMP data below is mainly for the market scoreboard numbers and Today's Mover.

VOICE & TONE RULES:
- Write like a cool older sibling explaining the markets — casual, fun, never boring.
- Use simple language. If you must use a financial term, explain it right there in parentheses.
- Use analogies a 10-14 year-old gets (video games, sports, pizza, school, allowance, YouTube).
- Short sentences. Punchy. Not textbook-y.
- Sprinkle in emojis naturally but don't overdo it.
- The "Why It Matters" sections should genuinely connect dots — show cause and effect chains AND tie back to one of the 8 principles.
- NEVER include anything inappropriate, scary, or overly complex.
- Skip any news about violence, war casualties, or disturbing events. Focus on business/tech/market stories.
- If there's geopolitical news that affects markets, keep it very high-level (e.g. "tensions eased" not graphic details).

STORY SELECTION RULES (CRITICAL):
- Return EXACTLY 3 stories by default. Only drop to 2 if the news feed is genuinely weak that day and there is no plausible third story — never pad to hit a number.
- Prioritize in this order: (1) major earnings from huge companies like Nvidia, Apple, Google, Amazon, Tesla (2) huge business events like IPOs, mergers, major product launches (3) macro events that move the whole market like oil prices, Fed decisions, inflation data, jobs reports (4) cool tech/science/business stories a kid would find interesting.
- NEVER write a story that just says "stocks went up" or "stocks went down" — that's what the scoreboard is for.
- NEVER write a story about random small-cap stocks, penny stocks, or unknown companies.
- Each story should be about a SPECIFIC event, company, or development — not a general market recap.
- Every "Why It Matters" box must explicitly teach an investing concept through the lens of the story. Examples: Nvidia earnings → what does "priced in" mean? SpaceX IPO → what's an IPO and why do companies do it? Oil crash → how commodity prices flow through the entire economy.
- If the news feed is genuinely thin on a given day, 2 strong stories beats 3 padded ones — but the bar to drop below 3 is high.

TODAY'S MOVER RULES:
- The TOP MOVER below is the biggest absolute-% mover today from a curated list of kid-recognizable companies. Use IT — do not substitute a different stock.
- Write a one-liner connecting the move to WHY it happened (search the news if needed). "Nike dropped 4% because they said fewer people are buying running shoes this quarter" — concrete, business-driven, never random.
- Connect that move to one of the 8 principles in the vibe field — usually principle 6 (news moves markets) or principle 4 (understand what you own).

THE BIG PICTURE:
- 3-4 sentences giving a casual overview of what's affecting markets right now. Catching up a friend who missed the news.
- Explicitly connect world events to market impact. Show the cause-and-effect chain. "When oil gets cheaper, shipping costs go down, which means companies spend less, which means they can make more profit, which means stock prices can go up. See how it's all connected?"

DID YOU KNOW (one mind-blowing fact per day):
- One eye-popping money/investing/business fact. Categories to rotate across days: compound interest, famous investors, company origins, market history, global economy, mind-blowing numbers.
- The fact MUST tie back to one of the 8 principles. Pick the most relevant principle and reference it in the connection field.
- DO NOT pick any fact substantially similar to the following — these have been used in the last 30 days. A "near-restatement" of one of these (same anchor company, same number, same lesson, just reworded) also counts as a repeat. Pick something genuinely different:
${recentFacts.length ? recentFacts.map(f => `  - ${f}`).join('\n') : '  (none yet — this is the first generation)'}
- Examples of the variety to aim for:
  - "If you invested $1,000 in Amazon in 1997, it'd be worth ~$2.3 million today" → principle 1 (start early)
  - "The stock market has crashed more than 20% about once every 5-7 years — and recovered every single time" → principle 3 (volatility is normal)
  - "Warren Buffett bought his first stock at age 11 and says he started too late" → principle 1
  - "Nintendo was founded in 1889. They made playing cards for 80 years before video games" → principle 4 (companies evolve)
- Rotate across CATEGORIES too — if recent picks have all been compound-interest math, surprise us with a company-origin or market-history fact today.

QUIZ:
- Classic multiple choice tied to today's news or an investing concept.
- The explanation must teach the concept, not just confirm the answer. End the explanation with a sentence that ties to one of the 8 principles.

WORD OF THE DAY:
- One investing/financial term with a kid-friendly analogy. Tied to today's news when possible.
- Include a "how to use this" sentence connecting the term to real life or a principle.
- DO NOT pick any of the following words — these have been used in the last 30 days. Pick something genuinely different (not a near-synonym, not a singular/plural variant):
${recentWords.length ? recentWords.map(w => `  - ${w}`).join('\n') : '  (none yet — this is the first generation)'}
- Investing has hundreds of teachable terms — dividend, P/E ratio, ticker, bull market, bear market, volatility, ETF, index, market cap, short squeeze, options, futures, yield, basis point, recession, inflation, deflation, hedge, diversification, compounding, principal, capital gains, etc. Use the breadth.

TODAY'S DATE: ${dateStr}
TRADING DAY: Data is from ${tradingDayLabel}'s market close.

RAW MARKET DATA (indices only — S&P, Nasdaq, Dow):
${JSON.stringify(marketData, null, 2)}

TODAY'S MOVER (from curated kid-recognizable list — use THIS one):
${topMoverBlock}

NEWS HEADLINES:
${JSON.stringify(news, null, 2)}

BROADER TOP MOVERS (context only — do NOT substitute for the curated mover above):
${JSON.stringify(movers, null, 2)}

Return ONLY a JSON object with this exact structure (no markdown, no backticks, no explanation):

{
  "date": "${dateStr}",
  "tradingDay": "${tradingDayLabel}",
  "marketVibe": "green" or "red" or "mixed",
  "vibeEmoji": "appropriate emoji",
  "vibeSummary": "One fun sentence summarizing the overall market day AND a plain-English why-it-moved hint (Fed, earnings, oil, jobs, etc.).",
  "bigPicture": "3-4 sentences casually catching the reader up on what's going on in the world that's affecting markets, with explicit cause-and-effect connections. See the BIG PICTURE rules above.",
  "scoreboard": {
    "sp500":  { "price": "formatted price", "change": "+X.XX%", "direction": "up/down", "vibe": "short fun comment" },
    "nasdaq": { "price": "formatted price", "change": "+X.XX%", "direction": "up/down", "vibe": "short fun comment" },
    "dow":    { "price": "formatted price", "change": "+X.XX%", "direction": "up/down", "vibe": "short fun comment" },
    "topMover": {
      "ticker": "TICKER",
      "name": "Company Name (display name from the curated entry)",
      "price": "$XX.XX",
      "change": "+X.XX%",
      "direction": "up/down",
      "vibe": "One concrete sentence connecting today's move to a real business reason (use web search to find the cause). End with a tiny nod to one of the 8 principles."
    }
  },
  "stories": [
    {
      "badge": "hot/new/money/world/brain",
      "badgeLabel": "SHORT LABEL",
      "title": "Catchy headline a kid would click on",
      "body": "2-4 sentences explaining the story simply",
      "whyItMatters": "2-3 sentences connecting this to one of the 8 investing principles. Show the cause-and-effect chain.",
      "principle": 1
    }
  ],
  "didYouKnow": {
    "fact": "One mind-blowing investing/money/business fact, 1-2 sentences.",
    "category": "compound interest | famous investors | company origins | market history | global economy | mind-blowing numbers",
    "connection": "1-2 sentences explicitly tying the fact back to one of the 8 investing principles.",
    "principle": 1
  },
  "quiz": {
    "question": "A fun question related to today's news or a basic investing concept",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0,
    "explanation": "2-3 sentences explaining the answer, teaching the concept, and ending with a sentence that ties to one of the 8 principles.",
    "principle": 1
  },
  "wordOfDay": {
    "word": "A financial/investing term",
    "type": "noun/verb/etc",
    "context": "what it relates to from today's news",
    "definition": "Fun, clear explanation with an analogy a 10-14 year-old gets. End with one sentence showing how to use this concept — tied to a principle when natural.",
    "principle": 1
  }
}

RULES ON OUTPUT:
- "stories" array length: 3 by default. Only drop to 2 if the news genuinely doesn't support a third. Never 1, never 4+.
- "principle" fields are integers 1-8 matching the numbered list at the top of this prompt.
- Stories should be from the provided news + web search — don't invent them.
- Do NOT include any citation tags, <cite> tags, or source references in your output. Write everything in your own words as clean plain text. The output must be valid JSON with no HTML tags inside the string values.`;

  const response = await client().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
      },
    ],
    messages: [{ role: 'user', content: prompt }],
  });

  // Web search is a server-side tool — Anthropic executes the search and
  // returns search results inline alongside text blocks in the same response,
  // so no client-side tool_use loop is needed. We log the search activity for
  // visibility, then pull just the final text content.
  const searchUses = response.content.filter(b => b.type === 'server_tool_use');
  const searchResults = response.content.filter(b => b.type === 'web_search_tool_result');
  if (searchUses.length || searchResults.length) {
    const queries = searchUses
      .map(b => b.input?.query)
      .filter(Boolean);
    console.log(`[AI] web_search ran — ${searchUses.length} queries, ${searchResults.length} result blocks. Queries: ${JSON.stringify(queries)}`);
  } else {
    console.log('[AI] web_search did NOT run (no server_tool_use blocks in response)');
  }
  console.log(`[AI] stop_reason: ${response.stop_reason}, content blocks: ${response.content.map(b => b.type).join(', ')}`);

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return parseAndScrubDigestJSON(text);
}

// ============================================================
// Phase 6.5 — per-game reframers
// ============================================================
// These are small, focused Claude calls that rewrite ONLY the narrative
// fields of a verified game scenario. They never touch prices, splits,
// outcomes, or any other "fact" field — those come from the static JSON.
// On any failure (parse error, API error, validation miss) the caller falls
// back to the canned text already in the scenario, so the digest always
// ships.
//
// Both reframers share the same envelope: pass in the full scenario, get
// back ONLY the fields that should be rewritten today.

const REFRAMER_MODEL = 'claude-sonnet-4-6';

async function callReframer({ system, user, expectedKeys, label }) {
  try {
    const response = await client().messages.create({
      model: REFRAMER_MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    // Strict JSON parse — these prompts are simple, no web search, no citations.
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first === -1 || last <= first) throw new Error('no JSON in response');
    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    for (const k of expectedKeys) {
      if (typeof parsed[k] !== 'string' || !parsed[k].trim()) {
        throw new Error(`missing or empty field "${k}"`);
      }
    }
    // Belt-and-suspenders: scrub any leftover mild profanity that slipped
    // past the prompt rule. Whole-word substitutions only.
    return scrubProfanity(parsed);
  } catch (err) {
    console.error(`[AI/${label}] failed: ${err.message} — falling back to canned text.`);
    return null;
  }
}

/**
 * Reframe a Bull-or-Bear scenario for today's digest. Rewrites the
 * `story`, `lessonHeadline`, and `lessonBody` fields ONLY. Verified facts
 * (charts, outcomes, ticker, principle) are unchanged.
 *
 * Returns `{ story, lessonHeadline, lessonBody }` on success, or `null`
 * on any failure (callers fall back to scenario's canned values).
 */
export async function reframeBullBear(scenario) {
  const principleHint = INVESTING_PRINCIPLES;
  const system = `You are the writer for "Market Buzz Kids," a daily stock market digest for kids ages 10-14. Voice: casual, fun, like a cool older sibling. Short punchy sentences. Use analogies kids get.

${PROFANITY_RULE}

The 8 core investing principles you reinforce:

${principleHint}

You are reframing a verified historical scenario for today's "Bull or Bear?" game. The facts (chart shapes, outcome, ticker, principle) are LOCKED — you are only rewriting the NARRATIVE so the same scenario can feel fresh on different days.`;

  const user = `Here is a verified scenario. The FACTS are locked — your job is only to rewrite the three narrative fields.

SCENARIO (read-only facts):
- Company: ${scenario.company} (${scenario.ticker})
- Era: ${scenario.era}
- Decision point: ${scenario.decisionPoint}
- What actually happened next: ${scenario.actualDirection.toUpperCase()} ${scenario.actualReturnPct}%
- Principle to reinforce: #${scenario.principle}

The PREVIOUS framing (for your reference — don't copy it, write something different):
- previous story: ${scenario.story}
- previous lesson headline: ${scenario.lessonHeadline}
- previous lesson body: ${scenario.lessonBody}

Write a fresh take. Return ONLY this JSON, no markdown:

{
  "story": "2-4 sentences setting up what was happening before the outcome. State the facts (decision point, real numbers) but with a fresh angle from the previous version.",
  "lessonHeadline": "One short, punchy sentence that teases principle #${scenario.principle}.",
  "lessonBody": "3-5 short HTML paragraphs (<p>...</p>) explaining what happened and why, ending by tying explicitly to principle #${scenario.principle}. Use <strong> sparingly for emphasis. No other HTML tags."
}`;

  return callReframer({
    system,
    user,
    expectedKeys: ['story', 'lessonHeadline', 'lessonBody'],
    label: 'reframeBullBear',
  });
}

/**
 * Reframe a Time Machine scenario for today's digest. Rewrites the
 * `framing` and `lessonBody` fields ONLY. Verified facts (year, choices,
 * prices, splits, outcomes, principle) are unchanged.
 *
 * Returns `{ framing, lessonBody }` on success, or `null` on failure.
 */
export async function reframeTimeMachine(scenario) {
  const principleHint = INVESTING_PRINCIPLES;
  const system = `You are the writer for "Market Buzz Kids," a daily stock market digest for kids ages 10-14. Voice: casual, fun, like a cool older sibling. Short punchy sentences. Use analogies kids get.

${PROFANITY_RULE}

The 8 core investing principles you reinforce:

${principleHint}

You are reframing a verified historical scenario for today's "Time Machine Trade" game. The year, the four stock choices, their prices, the outcomes — all LOCKED. You are only rewriting the NARRATIVE so the same scenario can feel fresh on different days.`;

  const choiceSummary = scenario.choices.map(c =>
    `${c.name} (${c.ticker}): then $${c.priceThen}, status=${c.status}${c.eventNote ? ` — ${c.eventNote}` : ''}`
  ).join('\n');

  const user = `Here is a verified scenario. The FACTS are locked — your job is only to rewrite the two narrative fields.

SCENARIO (read-only facts):
- Anchor: ${scenario.anchor}
- Year: ${scenario.year}
- Four choices the kid will see:
${choiceSummary}
- Principle to reinforce: #${scenario.principle}

PREVIOUS framing (for reference — don't copy):
- previous framing: ${scenario.framing}
- previous lesson body: ${scenario.lessonBody}

Write a fresh take. Return ONLY this JSON, no markdown:

{
  "framing": "2-3 sentences setting the scene of the year. Mention the world, what felt 'safe' vs 'risky' at the time. Make a kid curious which stock to pick. Don't reveal which one won.",
  "lessonBody": "3-5 short HTML paragraphs (<p>...</p>) that the kid sees AFTER they pick. Reference the actual outcomes (which stock won, which lost) and tie explicitly to principle #${scenario.principle}. Use <strong> sparingly for emphasis. No other HTML tags."
}`;

  return callReframer({
    system,
    user,
    expectedKeys: ['framing', 'lessonBody'],
    label: 'reframeTimeMachine',
  });
}

// Wrap the main digest parser so its output also gets scrubbed. We define
// this here as the entrypoint that generateContent calls, then re-export the
// scrubbed value down below.
function parseAndScrubDigestJSON(text) {
  return scrubProfanity(parseDigestJSON(text));
}

function parseDigestJSON(text) {
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  // Strip citation tags that come from web search. Claude sometimes wraps
  // referenced phrases in <cite index="...">...</cite> or the namespaced
  // <cite ...>...</cite> variant — both forms leak into our JSON
  // string values if not removed, breaking parsing (or, worse, rendering as
  // literal text in the final HTML).
  cleaned = cleaned.replace(/<\/?cite[^>]*>/g, '');
  cleaned = cleaned.replace(/<\/?antml:cite[^>]*>/g, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: with web search enabled, Claude may prepend a short
    // citation/synthesis paragraph before the JSON. Extract the largest
    // {...} span and try that.
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch (innerErr) {
        console.error('[AI] Failed to parse extracted JSON:', cleaned.slice(first, first + 300));
        throw new Error(`Failed to parse AI response as JSON: ${innerErr.message}`);
      }
    }
    console.error('[AI] No JSON object found in response. First 400 chars:', cleaned.substring(0, 400));
    throw new Error('Failed to parse AI response as JSON');
  }
}
