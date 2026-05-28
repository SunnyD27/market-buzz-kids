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

// The 11 core investing principles every piece of generated content should
// reinforce. Surfaced to the model so every "Why It Matters", quiz
// explanation, Did You Know, and Word of Day traces back to a real lesson.
const INVESTING_PRINCIPLES = `
1. Pay yourself first — save before you spend.
2. Make your money work for you — compound growth is a superpower.
3. Spend less than you earn — wealth is the gap.
4. Understand what you own — invest in what you know.
5. Don't put all your eggs in one basket — diversify.
6. Be patient — think in years, not days.
7. Control your emotions — don't follow the crowd.
8. Think like an owner, not a gambler — stocks are real businesses.
9. Stay consistent — regular investing beats perfect timing.
10. Know the difference between price and value — expensive isn't always valuable.
11. Make money while you sleep — own assets, not just stuff.
`.trim();

// Guidance for Claude on how to map content to principles. Surfaced in
// every prompt so a day's content lands on 4-6 different principles
// instead of defaulting to the same handful.
const PRINCIPLE_APPLICATION_GUIDE = `
PRINCIPLE APPLICATION GUIDE — When generating content, smartly associate each story, quiz, game, and teaching moment to the most relevant principle:
- Stories about earnings, company performance → Principle 4 (understand what you own) or 8 (think like an owner)
- Stories about market drops, crashes, recovery → Principle 6 (be patient) or 7 (control your emotions)
- Stories about index funds, ETFs, portfolio mix → Principle 5 (diversify)
- Stories about savings rates, frugality, billionaire habits → Principle 1 (pay yourself first) or 3 (spend less than you earn)
- Stories about compound growth, long-term returns, Buffett's wealth → Principle 2 (compound growth)
- Stories about bubbles, meme stocks, hype cycles → Principle 7 (control emotions) or 10 (price vs value)
- Stories about dividends, rental income, passive income → Principle 11 (make money while you sleep)
- Stories about dollar-cost averaging, regular contributions → Principle 9 (stay consistent)
- Stories about IPOs, stock splits, valuations → Principle 10 (price vs value)
- Stories about real estate, business ownership, equity → Principle 8 (think like an owner) or 11 (own assets)
- Quiz/game explanations should explicitly name the principle: "This is Principle 6 in action — patience pays off!"
- "Why It Matters" boxes should end with a one-sentence principle connection: "This teaches us Principle 7: don't follow the crowd just because everyone else is panicking."
- Aim for variety across the day's content — don't assign the same principle to every block. A single digest should ideally touch 4-6 different principles.
`.trim();

/**
 * Build the STANDARD weekday prompt (Tuesday–Saturday, no holiday yesterday).
 *
 * Extracted verbatim from the original generateContent body — the prompt
 * text itself is unchanged from the battle-tested version. Only the
 * surrounding plumbing (function wrapper + parameter list) is new.
 */
function buildStandardPrompt(marketData, news, movers, topMover, recentWords, recentFacts, dateStr, tradingDayLabel) {
  const topMoverBlock = topMover
    ? JSON.stringify(topMover, null, 2)
    : 'null  // no curated mover available — pick the most kid-recognizable name from the broader movers list instead and flag that fact in the vibe.';

  return `You are the writer for "Market Juice," a daily stock market digest for kids ages 10-14 and their parents. This is a financial education product disguised as a daily habit — every game, story, and fun fact teaches a real investing principle.

${PROFANITY_RULE}

CORE PHILOSOPHY: Every piece of content you generate must reinforce at least one of these 11 core investing principles. Use them as the lens for every "Why It Matters" box, every quiz explanation, every Did You Know fact, every Word of the Day analogy:

${INVESTING_PRINCIPLES}

${PRINCIPLE_APPLICATION_GUIDE}

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
- The "Why It Matters" sections should genuinely connect dots — show cause and effect chains AND tie back to one of the 11 principles.
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
- Connect that move to one of the 11 principles in the vibe field — usually principle 4 (understand what you own), principle 7 (control your emotions), or principle 8 (think like an owner).

THE BIG PICTURE:
- 3-4 sentences giving a casual overview of what's affecting markets right now. Catching up a friend who missed the news.
- Explicitly connect world events to market impact. Show the cause-and-effect chain. "When oil gets cheaper, shipping costs go down, which means companies spend less, which means they can make more profit, which means stock prices can go up. See how it's all connected?"

DID YOU KNOW (one mind-blowing fact per day):
- One eye-popping money/investing/business fact. Categories to rotate across days: compound interest, famous investors, company origins, market history, global economy, mind-blowing numbers.
- The fact MUST tie back to one of the 11 principles. Pick the most relevant principle and reference it in the connection field.
- DO NOT pick any fact substantially similar to the following — these have been used in the last 30 days. A "near-restatement" of one of these (same anchor company, same number, same lesson, just reworded) also counts as a repeat. Pick something genuinely different:
${recentFacts.length ? recentFacts.map(f => `  - ${f}`).join('\n') : '  (none yet — this is the first generation)'}
- Examples of the variety to aim for:
  - "If you invested $1,000 in Amazon in 1997, it'd be worth ~$2.3 million today" → principle 2 (make your money work for you / compound growth)
  - "The stock market has crashed more than 20% about once every 5-7 years — and recovered every single time" → principle 6 (be patient)
  - "Warren Buffett bought his first stock at age 11 and says he started too late" → principle 9 (stay consistent) or 2 (compound growth)
  - "Nintendo was founded in 1889. They made playing cards for 80 years before video games" → principle 4 (understand what you own)
- Rotate across CATEGORIES too — if recent picks have all been compound-interest math, surprise us with a company-origin or market-history fact today.

QUIZ:
- Classic multiple choice tied to today's news or an investing concept.
- The explanation must teach the concept, not just confirm the answer. End the explanation with a sentence that ties to one of the 11 principles.

WORD OF THE DAY:
- One investing/financial term with a kid-friendly analogy. Tied to today's news when possible.
- Include a "how to use this" sentence connecting the term to real life or a principle.
- DO NOT pick any of the following words — these have been used in the last 30 days. Pick something genuinely different (not a near-synonym, not a singular/plural variant):
${recentWords.length ? recentWords.map(w => `  - ${w}`).join('\n') : '  (none yet — this is the first generation)'}
- Investing has hundreds of teachable terms — dividend, P/E ratio, ticker, bull market, bear market, volatility, ETF, index, market cap, short squeeze, options, futures, yield, basis point, recession, inflation, deflation, hedge, diversification, compounding, principal, capital gains, etc. Use the breadth.

PARENT EXPLAINER RULES (Phase 12):
- Every content section listed in the JSON schema below MUST include a "parentExplainer" object with two string fields:
  - "summary": 1 sentence in plain adult language explaining the concept. No jargon, no kid-speak — this is for the parent. Max 30 words.
  - "conversationStarter": 1 question the parent can ask the kid at dinner to start a real conversation. Frame it as "Ask [kid] ..." (literal placeholder — the email substitutes the kid's first name). Max 25 words.
- CRITICAL: the conversationStarter MUST reference the specific content from TODAY'S digest — the actual company, event, number, or concept covered. It should feel like a follow-up to what the kid just read, not a generic finance question.
  - GOOD: "Ask [kid] why they think Nike's stock dropped when they sold fewer shoes than expected." (references today's specific story)
  - GOOD: "Ask [kid] if they think $3.5 trillion is a lot for one company to be worth." (references today's specific market cap figure)
  - BAD: "Ask [kid] what they think happens when a company misses earnings." (generic, doesn't reference today's content)
  - BAD: "Ask [kid] if they know what market cap means." (yes/no question, doesn't spark discussion)
- The conversationStarter should test understanding or spark curiosity using today's specifics. The parent should be able to say "I saw you learned about Nike today..." and have the question flow naturally.
- The summary should give the parent enough context to actually have the conversation even if they don't know finance well themselves.

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
  "bigPictureParentExplainer": {
    "summary": "1 sentence for the parent describing what today's Big Picture covered. See PARENT EXPLAINER RULES.",
    "conversationStarter": "Ask [kid] ... 1 question referencing the SPECIFIC topic/event from today's Big Picture."
  },
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
      "vibe": "One concrete sentence connecting today's move to a real business reason (use web search to find the cause). End with a tiny nod to one of the 11 principles."
    }
  },
  "stories": [
    {
      "badge": "hot/new/money/world/brain",
      "badgeLabel": "SHORT LABEL",
      "title": "Catchy headline a kid would click on",
      "body": "2-4 sentences explaining the story simply",
      "whyItMatters": "2-3 sentences connecting this to one of the 11 investing principles. Show the cause-and-effect chain.",
      "principle": 1,
      "parentExplainer": {
        "summary": "1 sentence for the parent recapping THIS story's specific company/event/number. See PARENT EXPLAINER RULES.",
        "conversationStarter": "Ask [kid] ... 1 question referencing THIS story's specifics."
      }
    }
  ],
  "didYouKnow": {
    "fact": "One mind-blowing investing/money/business fact, 1-2 sentences.",
    "category": "compound interest | famous investors | company origins | market history | global economy | mind-blowing numbers",
    "connection": "1-2 sentences explicitly tying the fact back to one of the 11 investing principles.",
    "principle": 1,
    "parentExplainer": {
      "summary": "1 sentence for the parent describing today's fun fact. See PARENT EXPLAINER RULES.",
      "conversationStarter": "Ask [kid] ... 1 question referencing today's specific fact."
    }
  },
  "quiz": {
    "question": "A fun question related to today's news or a basic investing concept",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0,
    "explanation": "2-3 sentences explaining the answer, teaching the concept, and ending with a sentence that ties to one of the 11 principles.",
    "principle": 1,
    "parentExplainer": {
      "summary": "1 sentence for the parent describing what today's quiz tested. See PARENT EXPLAINER RULES.",
      "conversationStarter": "Ask [kid] ... 1 question referencing today's specific quiz concept."
    }
  },
  "wordOfDay": {
    "word": "A financial/investing term",
    "type": "noun/verb/etc",
    "context": "what it relates to from today's news",
    "definition": "Fun, clear explanation with an analogy a 10-14 year-old gets. End with one sentence showing how to use this concept — tied to a principle when natural.",
    "principle": 1,
    "parentExplainer": {
      "summary": "1 sentence for the parent defining today's term in plain language. See PARENT EXPLAINER RULES.",
      "conversationStarter": "Ask [kid] ... 1 question referencing today's specific word + today's news context."
    }
  }
}

RULES ON OUTPUT:
- "stories" array length: 3 by default. Only drop to 2 if the news genuinely doesn't support a third. Never 1, never 4+.
- "principle" fields are integers 1-11 matching the numbered list at the top of this prompt.
- Stories should be from the provided news + web search — don't invent them.
- Do NOT include any citation tags, <cite> tags, or source references in your output. Write everything in your own words as clean plain text. The output must be valid JSON with no HTML tags inside the string values.`;
}

/**
 * Build the WEEKLY WRAP prompt (Sunday). Recaps the past week instead of
 * a single trading day; uses different search queries, story badges, and
 * adds a `sundayChallenge` field unique to Sunday editions. The Sunday
 * Challenge is a longer interactive game that rotates between 4 formats
 * on a 4-week cycle (week-of-year % 4). Client-side renderer lives in
 * public/games/sunday-challenge.js — it reads `sundayChallenge.type` and
 * dispatches to the right sub-renderer.
 */
function buildWeeklyWrapPrompt(marketData, topMover, recentWords, recentFacts, edition, dateStr) {
  const topMoverBlock = topMover
    ? JSON.stringify(topMover, null, 2)
    : 'null  // no curated mover available — use web_search to identify the week\'s biggest mover from a kid-recognizable name.';

  // ── Sunday Challenge rotation ────────────────────────────────────────
  // 4-week cycle. We derive the week number from edition.dateStr (NOT
  // new Date()) so DATE_OVERRIDE testing stays deterministic. Simple
  // ordinal-week formula: days-since-Jan-1 + Jan-1's day-of-week, divided
  // by 7, ceiling. Good enough for a stable 0-3 cycle across the year.
  const challengeTypes = ['trading-floor', 'ceo', 'investathon', 'dilemma'];
  const editionDate = new Date((edition.dateStr || dateStr.slice(0, 10)) + 'T12:00:00Z');
  const startOfYear = new Date(editionDate.getUTCFullYear() + '-01-01T12:00:00Z');
  const dayOfYear = Math.floor((editionDate - startOfYear) / 86400000);
  const weekNum = Math.ceil((dayOfYear + startOfYear.getUTCDay() + 1) / 7);
  const sundayChallengeType = challengeTypes[weekNum % 4];

  // Inline only the JSON schema that matches this week's challenge type
  // into the "Return ONLY a JSON object…" example below. The full set of
  // schemas + content rules for all 4 types is in SUNDAY_CHALLENGE_RULES
  // (Claude sees the rules block + only this week's schema in the JSON
  // example).
  const sundayChallengeSchemaSnippet = {
    'trading-floor': `"sundayChallenge": {
    "type": "trading-floor",
    "rounds": [
      {
        "year": "Month YYYY",
        "headline": "2-4 sentence kid-friendly scene-setter, present tense.",
        "stocks": [
          { "ticker": "TICKER", "name": "Company", "price": 12.36, "endPrice": 182.01, "period": "YYYY-YYYY" }
        ],
        "sp500Return": "+312%",
        "principle": 1,
        "lessonText": "1-2 sentences with the investing lesson from this round."
      }
    ]
  }`,
    'ceo': `"sundayChallenge": {
    "type": "ceo",
    "rounds": [
      {
        "company": "Company Name",
        "year": "YYYY",
        "scenario": "3-5 sentences in second person ('You are running…') with real numbers.",
        "options": ["Option A", "Option B", "Option C"],
        "correctIndex": 1,
        "actualOutcome": "3-5 sentences with what actually happened + specific numbers.",
        "lesson": "1-2 sentences extracting the general principle.",
        "principle": 1
      }
    ]
  }`,
    'investathon': `"sundayChallenge": {
    "type": "investathon",
    "questions": [
      {
        "question": "Question text",
        "options": ["A", "B"],
        "correctIndex": 0,
        "explain": "2-3 sentences with surprising fact / math.",
        "principle": 1
      }
    ]
  }`,
    'dilemma': `"sundayChallenge": {
    "type": "dilemma",
    "rounds": [
      {
        "scenario": "3-5 sentences describing a realistic financial decision a teenager faces.",
        "options": ["Option A — description", "Option B — description"],
        "analysis": [
          {
            "title": "Short title for Option A's analysis",
            "metrics": [
              { "label": "Your investment", "value": "$500" },
              { "label": "Annual return", "value": "4.5%" },
              { "label": "After 10 years", "value": "$776" }
            ],
            "takeaway": "3-5 sentences with REAL MATH explaining pros/cons, ending with the key tradeoff."
          },
          {
            "title": "Short title for Option B's analysis",
            "metrics": [ { "label": "metric", "value": "value" } ],
            "takeaway": "Same depth as Option A — both sides get equal treatment."
          }
        ],
        "bottomLine": "2-3 sentences summarizing the tradeoff and naming the principle this teaches. Do NOT declare a winner.",
        "principle": 1
      }
    ]
  }`,
  }[sundayChallengeType];

  return `You are the writer for "Market Juice," and today is Sunday — THE WEEKLY WRAP. This is a RECAP of the past week's biggest market stories for kids 10-14 and their parents. NOT a daily report.

${PROFANITY_RULE}

CORE PHILOSOPHY: Every piece of content you generate must reinforce at least one of these 11 core investing principles. Use them as the lens for every "Why It Matters" box, every quiz explanation, every Did You Know fact, every Word of the Day analogy:

${INVESTING_PRINCIPLES}

${PRINCIPLE_APPLICATION_GUIDE}

STEP 1: Before writing anything, use web_search to RECAP THE WEEK. Search for:
- 'stock market weekly recap'
- 'biggest stock market movers this week'
- 'biggest business news this week'
The web search results should be your PRIMARY source. The raw FMP data below shows Friday's close, but you are recapping the FULL WEEK arc.

VOICE & TONE RULES:
- Write like a cool older sibling explaining the markets — casual, fun, never boring.
- Use simple language. If you must use a financial term, explain it right there in parentheses.
- Use analogies a 10-14 year-old gets (video games, sports, pizza, school, allowance, YouTube).
- Short sentences. Punchy. Not textbook-y.
- Sprinkle in emojis naturally but don't overdo it.
- NEVER include anything inappropriate, scary, or overly complex.
- Skip any news about violence, war casualties, or disturbing events. Focus on business/tech/market stories.
- If there's geopolitical news that affects markets, keep it very high-level (e.g. "tensions eased" not graphic details).

WEEKLY WRAP STORY RULES (CRITICAL — different from a daily digest):
- Return EXACTLY 2 stories. Not 3, not 4. This is a focused weekly wrap.
- Each story is a WEEK-DEFINING theme, not a single news item: the biggest earnings of the week, the biggest macro move, the biggest IPO buzz.
- First story badge label MUST be "WEEK'S BIGGEST" — the single most important market story of the past 5 trading days.
- Second story badge label MUST be "ALSO THIS WEEK" — a secondary theme worth noting.
- Stories should reference the week's arc (e.g. "Nvidia kicked off the week at $135 and ended at $148 — here's why...") — not a single day in isolation.
- Every "Why It Matters" connects the week's theme to one of the 11 principles.

TODAY'S MOVER (weekly edition):
- Identify the WEEK'S BIGGEST mover from the curated kid-recognizable list using web search. The FMP data below shows Friday's single-day winner — that MAY or may not match the week's biggest mover. Use the week's winner.
- Write a one-liner connecting the WEEK'S move to WHY it happened. End with a tiny nod to one of the 11 principles.
- "change" should describe weekly change ("+8.4% on the week"), not Friday's single-day change.

THE BIG PICTURE — WEEKLY EDITION:
- 3-4 sentences recapping the week's biggest themes: how did markets do overall? What drove the move? What's the takeaway for next week?
- Show cause-and-effect chains spanning the full 5 trading days — earnings → expectations → price action → narrative.

DID YOU KNOW (one mind-blowing fact per day):
- One eye-popping money/investing/business fact. Categories to rotate across days: compound interest, famous investors, company origins, market history, global economy, mind-blowing numbers.
- The fact MUST tie back to one of the 11 principles.
- DO NOT pick any fact substantially similar to the following — these have been used in the last 30 days. A "near-restatement" (same anchor company, same number, same lesson, reworded) counts as a repeat:
${recentFacts.length ? recentFacts.map(f => `  - ${f}`).join('\n') : '  (none yet — this is the first generation)'}
- Sunday is a good day for a slightly deeper / more memorable fact.

QUIZ — WEEKLY REVIEW:
- A multiple-choice question that draws on something from THIS WEEK's headlines. Example: "On Tuesday, [Company] reported earnings that crushed expectations. What does it mean when a stock is 'priced in'?"
- The explanation teaches the concept and ends with a tie to one of the 11 principles.

WORD OF THE DAY — WEEKLY EDITION:
- Pick a slightly more advanced investing term than a typical weekday — examples: "yield curve", "P/E ratio", "guidance", "free cash flow", "moat", "market cap", "consensus estimate".
- DO NOT pick any of the following words — used in the last 30 days. Pick something genuinely different (not a near-synonym, not a singular/plural variant):
${recentWords.length ? recentWords.map(w => `  - ${w}`).join('\n') : '  (none yet — this is the first generation)'}
- Use a kid-friendly analogy. End with a sentence showing how to use the concept, tied to a principle when natural.

PARENT EXPLAINER RULES (Phase 12):
- Every content section listed in the JSON schema below MUST include a "parentExplainer" object with two string fields:
  - "summary": 1 sentence in plain adult language explaining the concept. No jargon, no kid-speak — this is for the parent. Max 30 words.
  - "conversationStarter": 1 question the parent can ask the kid at dinner. Frame it as "Ask [kid] ..." (literal placeholder — the email substitutes the kid's first name). Max 25 words.
- CRITICAL: the conversationStarter MUST reference the specific content from THIS WEEK's recap — actual companies, events, numbers covered. It should feel like a follow-up to what the kid just read, not a generic finance question.
  - GOOD: "Ask [kid] why they think Nike's stock dropped 8% this week after the earnings miss."
  - BAD: "Ask [kid] what they think about stock market drops." (generic)
- The summary should give the parent enough context to actually have the conversation even if they don't know finance well themselves.

SUNDAY CHALLENGE — THE WEEKLY GAME

This week's game type: ${sundayChallengeType}

Every Sunday, kids play a longer, more engaging game as part of the Weekly Wrap. The game type rotates on a 4-week cycle so the format never repeats two weeks in a row. You are generating the CONTENT for this week's game — the client-side interactive components are already built and will render your JSON output.

Your job is to generate FRESH, SURPRISING, NON-OBVIOUS content every single week. The quality bar is high. Follow the specific rules for this week's type below.

=== GAME TYPE: "trading-floor" ===
(Generate this ONLY when this week's type is "trading-floor")

The kid gets $10,000 and plays through 3 rounds. Each round is a real moment in stock market history where they allocate money across 4 stocks, then see what actually happened.

JSON schema:
"sundayChallenge": {
  "type": "trading-floor",
  "rounds": [
    {
      "year": "Month YYYY",
      "headline": "2-4 sentence kid-friendly description of what was happening in the economy/markets at this moment. Set the scene vividly. Use present tense as if the kid is there.",
      "stocks": [
        {
          "ticker": "AAPL",
          "name": "Apple",
          "price": 12.36,
          "endPrice": 182.01,
          "period": "2007-2024"
        }
      ],
      "sp500Return": "+312%",
      "principle": 1-11,
      "lessonText": "1-2 sentences explaining the investing lesson from this round"
    }
  ]
}

TRADING FLOOR CONTENT RULES:
1. PICK OBSCURE MOMENTS. Do NOT use: the 2008 financial crisis, COVID crash (March 2020), dot-com bubble (1999-2000), or any event that a typical adult would immediately know the outcome of. Instead, use moments like:
   - A random week in 2013 when Tesla was $8 and RadioShack was $3
   - January 2005 when Google had just IPO'd at $85 and Blockbuster was still at $9
   - March 2016 when Netflix was $97 and GoPro was $11
   - July 1999 when Yahoo was $170 and Amazon was $55
   - A week in 2011 when LinkedIn just IPO'd and Groupon was the hottest company alive
2. Each round MUST include at least one stock that performed OPPOSITE of what seemed obvious at the time. The "sure bet" should sometimes lose. The "boring" pick should sometimes win big.
3. Use REAL historical stock prices. Web-search to verify prices if unsure. Do NOT fabricate numbers.
4. All 3 rounds should be from DIFFERENT decades or eras. Do not cluster them.
5. Include at least one company that no longer exists or is irrelevant today (e.g., BlackBerry, Sears, Groupon, MySpace parent company, Nokia, Yahoo, AOL).
6. Headlines should be written as if the kid is living in that moment — they do NOT know the future. "Everyone thinks BlackBerry is unbeatable" not "BlackBerry is about to collapse."
7. The 4 stocks in each round should represent genuinely different investment theses: one "obvious winner," one "safe boring pick," one "risky underdog," one "fading giant."
8. NEVER repeat a ticker across rounds in the same game.
9. Each round ties to a DIFFERENT principle from the 11.
10. The S&P 500 return for the same period must be included so kids can compare.

=== GAME TYPE: "ceo" ===
(Generate this ONLY when this week's type is "ceo")

The kid takes over a real company at a critical decision point. They get 3 options — each is a genuinely defensible strategic choice. After choosing, they see what actually happened.

JSON schema:
"sundayChallenge": {
  "type": "ceo",
  "rounds": [
    {
      "company": "Company Name",
      "year": "YYYY",
      "scenario": "3-5 sentences setting up the decision. Include real dollar amounts, employee counts, or market data to make it concrete. Write in second person: 'You are running...'",
      "options": [
        "Option A — a genuinely reasonable choice",
        "Option B — a genuinely reasonable choice",
        "Option C — a genuinely reasonable choice"
      ],
      "correctIndex": 1,
      "actualOutcome": "3-5 sentences explaining what the company actually did and what happened as a result. Include specific numbers — revenue, stock price, market cap, users — to make the outcome tangible.",
      "lesson": "1-2 sentences extracting the general investing/business principle",
      "principle": 1-11
    }
  ]
}

CEO CONTENT RULES:
1. DO NOT USE companies where the outcome is common knowledge. BANNED: Netflix switching to streaming, Apple bringing back Steve Jobs, Blockbuster rejecting Netflix, Kodak ignoring digital cameras, Nokia ignoring smartphones. These are all too well-known — kids or their parents will know the answer immediately.
2. Instead, pick from scenarios like:
   - Lego nearly going bankrupt in 2003 and the decision to cut 80% of their product line
   - Marvel selling its movie rights to Sony/Fox in the 1990s for cash when it was broke
   - Nintendo choosing NOT to partner with Sony (which led Sony to create PlayStation)
   - Slack turning down a $10B Microsoft acquisition offer, then Microsoft building Teams
   - Shopify choosing to compete with Amazon instead of partnering with them
   - Domino's Pizza admitting their pizza was terrible in 2009 and completely reformulating
   - LEGO licensing Star Wars in 1999 when toy executives said "movie toys don't sell"
   - Under Armour choosing to challenge Nike head-on in basketball
   - Snapchat rejecting Facebook's $3 billion acquisition offer
   - Instagram having 13 employees when Facebook bought them for $1 billion
   - Dyson spending 15 years and 5,127 prototypes before making a single sale
   - Airbnb selling cereal boxes during the 2008 recession to stay alive
   - Red Bull spending years giving away free cans before becoming profitable
3. ALL THREE OPTIONS must be genuinely defensible. A kid should be torn about which to pick. If one option is obviously stupid, the question is bad — rewrite it.
4. The "wrong" answers should have been reasonable choices at the time. Include a brief note in actualOutcome about why the other options COULD have worked or what would have happened.
5. Each round should be a DIFFERENT type of decision: one about product strategy, one about money/acquisition, one about competitive positioning.
6. Include SPECIFIC NUMBERS in the scenario (revenue, employees, market share) so the decision feels real, not abstract.
7. Each round ties to a DIFFERENT principle from the 11.
8. NEVER frame the scenario in a way that reveals the answer. "Your company is about to fail unless you..." gives away that the bold option is correct.
9. Use companies and industries that kids 10-14 actually know or can relate to: gaming, food/restaurants, social media, sports, toys, entertainment, phones, sneakers.

=== GAME TYPE: "investathon" ===
(Generate this ONLY when this week's type is "investathon")

10 rapid-fire questions. Mix of formats: true/false, multiple choice (3 options), and "which is more/higher/first" comparisons. Each answer reveals a surprising fact.

JSON schema:
"sundayChallenge": {
  "type": "investathon",
  "questions": [
    {
      "question": "The question text",
      "options": ["Option A", "Option B"] or ["Option A", "Option B", "Option C"],
      "correctIndex": 0,
      "explain": "2-3 sentences explaining the answer with a surprising fact or real number that makes kids say 'no way!' Include the math or data that proves it.",
      "principle": 1-11
    }
  ]
}

INVEST-A-THON CONTENT RULES:
1. EVERY answer should be surprising. If a kid can guess the answer without knowing anything about investing, the question is too easy. The "no way!" reaction on the reveal is the whole point.
2. Mix these question categories (aim for at least 6 of the 8 in each game):
   a) COMPOUND MATH SHOCKERS: "If you invested $1 per day starting at age 15..." / "How many years would it take $1,000 to become $1 million at 10%?"
   b) SIZE COMPARISONS: "Which is worth more: all the Bitcoin in the world or just Apple?" / "Which country has a bigger stock market: Japan or the UK?"
   c) HISTORICAL SURPRISES: "Which came first: the stock market or the United States?" / "What was Amazon's stock price at its IPO?"
   d) COMPANY SECRETS: "How many years did it take Amazon to make a profit?" / "What percentage of Google's revenue comes from ads?"
   e) SPEED & TIME: "What's the fastest a stock has ever doubled?" / "How long has the average S&P 500 company existed?"
   f) PSYCHOLOGY & BEHAVIOR: "What percentage of day traders lose money?" / "What's the #1 reason people sell stocks?"
   g) REAL-WORLD CONNECTIONS: "How many iPhones does Apple sell per MINUTE?" / "If you bought one share of Disney at its IPO, how many shares would you have today?"
   h) MONEY SCALE: "How long would it take to count to one billion if you counted one number per second?"
3. VERIFY ALL FACTS. Use web search if needed. Do NOT fabricate statistics. If you're unsure of a number, search for it.
4. Do NOT ask the same type of question twice in a row. Alternate between categories.
5. Do NOT include questions whose answers can be deduced purely from the question wording (e.g., "True or false: compound interest earns interest on interest" — the answer is in the name).
6. Include at least 2 questions that connect to things kids already know: Roblox, YouTube, Nike, McDonald's, Disney, Fortnite, iPhone, TikTok, Minecraft.
7. Spread across at least 6 different principles from the 11.
8. Questions should NOT be googleable in 2 seconds. "What is the stock market?" is bad. "If the entire stock market crashed 50% tomorrow, how many times has that actually happened in the last 100 years?" is good.
9. For true/false questions, the answer should be FALSE at least half the time — kids default to "true."
10. For multiple choice, the wrong answers should be plausible, not absurd. Don't include joke answers.

=== GAME TYPE: "dilemma" ===
(Generate this ONLY when this week's type is "dilemma")

3 investing scenarios with no objectively correct answer. The kid picks an option, then sees a detailed mathematical and factual breakdown of BOTH sides.

JSON schema:
"sundayChallenge": {
  "type": "dilemma",
  "rounds": [
    {
      "scenario": "3-5 sentences describing a realistic financial decision a teenager or young person might face. Use specific dollar amounts, timeframes, and real-world context. Make the kid feel like this could actually happen to them.",
      "options": [
        "Option A — clear, concise description of this choice",
        "Option B — clear, concise description of this choice"
      ],
      "analysis": [
        {
          "title": "Short title for Option A's analysis",
          "metrics": [
            { "label": "Your investment", "value": "$500" },
            { "label": "Annual return", "value": "4.5%" },
            { "label": "After 10 years", "value": "$776" }
          ],
          "takeaway": "3-5 sentences with REAL MATH explaining this option's pros and cons. Include specific dollar amounts showing what happens over time. Reference real historical data where possible (e.g., 'The S&P 500 has returned 10% annually on average since 1926'). End with the key tradeoff."
        },
        {
          "title": "Short title for Option B's analysis",
          "metrics": [
            { "label": "metric", "value": "value" }
          ],
          "takeaway": "Same depth as Option A's analysis. Both sides get equal treatment."
        }
      ],
      "bottomLine": "2-3 sentences summarizing the core tradeoff and explicitly naming which principle this dilemma teaches. Do NOT declare one option the winner — explain what each choice prioritizes.",
      "principle": 1-11
    }
  ]
}

DILEMMA CONTENT RULES:
1. BOTH OPTIONS MUST BE GENUINELY DEFENSIBLE. If one option is obviously better, the dilemma is broken. A financial advisor should be able to argue for either side.
2. The analysis for EACH option must include:
   - At least 3 specific metrics with real numbers
   - Real math (compound growth calculations, percentage comparisons, dollar amounts over time)
   - Historical precedent or data where applicable
   - A clear explanation of what you GAIN and what you GIVE UP
3. Use scenarios that 10-14 year olds can relate to:
   - Birthday money decisions ($500-$2,000 range)
   - Summer job earnings allocation
   - Saving for something expensive (car, college, gaming PC) vs investing
   - Choosing between a guaranteed small return vs a risky bigger one
   - Lump sum vs spreading investments over time (dollar-cost averaging)
   - Individual stocks vs index funds with their own money
   - Spending on an experience vs investing the same amount
   - Keeping money in a savings account vs the stock market when scared
4. NEVER frame one option as the "smart" choice and the other as the "dumb" choice through tone or word choice. Both analyses should be written with equal respect.
5. Each round should teach a DIFFERENT principle from the 11.
6. The metrics should be DIFFERENT between the two options — don't just show the same 3 rows with different numbers. Each option has different relevant data points.
7. Include at least one dilemma where the "boring" option is actually mathematically competitive with the "exciting" option — kids need to see that safe choices aren't always inferior.
8. ALL MATH MUST BE CORRECT. Double-check compound interest calculations. If $500 at 10% for 30 years = X, verify X is right. Wrong math destroys credibility.
9. Use real product/experience prices kids would know: PlayStation ($499), concert tickets ($150), used car ($5,000), MacBook ($1,299).
10. Do NOT use fake polling data ("48% of kids chose Option A"). We have no polling data. The analysis stands on math and facts alone.

=== END OF GAME TYPE INSTRUCTIONS ===

UNIVERSAL SUNDAY CHALLENGE RULES (apply to ALL game types):
- Generate ONLY the game type specified for this week: "${sundayChallengeType}"
- NEVER generate content that reveals well-known outcomes where the answer is obvious in hindsight
- Use web_search to verify any historical stock prices, company facts, or financial statistics you're unsure about
- Every round/question must tie to one of the 11 investing principles
- Spread principle coverage — don't assign the same principle to every round
- Content must be appropriate for ages 10-14: no references to alcohol, drugs, gambling, adult themes
- Use companies and examples kids actually encounter: fast food, gaming, social media, streaming, sports, sneakers, phones
- SURPRISE is the #1 quality metric. If the content doesn't make a kid say "whoa, really?" or "I had no idea," it's not good enough

TODAY'S DATE: ${dateStr}
PREVIOUS TRADING DAY: ${edition.previousTradingDay} (${edition.previousTradingDayName})

RAW MARKET DATA (Friday's close — use for scoreboard prices; the recap is the WEEK):
${JSON.stringify(marketData, null, 2)}

TODAY'S FMP MOVER (Friday's curated winner — MAY differ from the week's biggest mover; use web search to confirm):
${topMoverBlock}

Return ONLY a JSON object with this exact structure (no markdown, no backticks, no explanation):

{
  "date": "${dateStr}",
  "editionType": "weekly-wrap",
  "editionLabel": "The Weekly Wrap 📋",
  "marketClosed": true,
  "tradingDay": "this week",
  "marketVibe": "green" or "red" or "mixed",
  "vibeEmoji": "appropriate emoji",
  "vibeSummary": "One fun sentence summarizing how the WEEK went and the headline reason (Fed, earnings, oil, jobs, etc.).",
  "bigPicture": "3-4 sentences recapping the week's biggest themes with cause-and-effect.",
  "bigPictureParentExplainer": {
    "summary": "1 sentence for the parent describing what this week's Big Picture covered. See PARENT EXPLAINER RULES.",
    "conversationStarter": "Ask [kid] ... 1 question referencing THIS WEEK's specific Big Picture themes."
  },
  "scoreboard": {
    "sp500":  { "price": "Friday's close", "change": "+X.XX% on the week", "direction": "up/down", "vibe": "week-narrative comment" },
    "nasdaq": { "price": "Friday's close", "change": "+X.XX% on the week", "direction": "up/down", "vibe": "week-narrative comment" },
    "dow":    { "price": "Friday's close", "change": "+X.XX% on the week", "direction": "up/down", "vibe": "week-narrative comment" },
    "topMover": {
      "ticker": "TICKER",
      "name": "The WEEK's biggest mover (display name)",
      "price": "Friday close $XX.XX",
      "change": "+X.XX% on the week",
      "direction": "up/down",
      "vibe": "One concrete sentence on why this was the week's biggest mover. End with a nod to a principle."
    }
  },
  "stories": [
    {
      "badge": "hot/new/money/world/brain",
      "badgeLabel": "WEEK'S BIGGEST",
      "title": "Catchy headline summarizing the #1 story of the past week",
      "body": "2-4 sentences explaining the week's arc, not a single moment",
      "whyItMatters": "2-3 sentences connecting the theme to one of the 11 principles. Show cause-and-effect.",
      "principle": 1,
      "parentExplainer": {
        "summary": "1 sentence for the parent recapping THIS story's specifics. See PARENT EXPLAINER RULES.",
        "conversationStarter": "Ask [kid] ... 1 question referencing THIS story's specifics."
      }
    },
    {
      "badge": "hot/new/money/world/brain",
      "badgeLabel": "ALSO THIS WEEK",
      "title": "Secondary headline",
      "body": "2-4 sentences",
      "whyItMatters": "2-3 sentences tied to a principle",
      "principle": 2,
      "parentExplainer": {
        "summary": "1 sentence for the parent recapping THIS story's specifics. See PARENT EXPLAINER RULES.",
        "conversationStarter": "Ask [kid] ... 1 question referencing THIS story's specifics."
      }
    }
  ],
  "didYouKnow": {
    "fact": "One mind-blowing investing/money/business fact, 1-2 sentences.",
    "category": "compound interest | famous investors | company origins | market history | global economy | mind-blowing numbers",
    "connection": "1-2 sentences tying the fact back to a principle.",
    "principle": 1,
    "parentExplainer": {
      "summary": "1 sentence for the parent describing this week's fun fact. See PARENT EXPLAINER RULES.",
      "conversationStarter": "Ask [kid] ... 1 question referencing today's specific fact."
    }
  },
  "quiz": {
    "question": "A weekly review question referencing something from THIS WEEK's news",
    "options": ["A", "B", "C", "D"],
    "correctIndex": 0,
    "explanation": "2-3 sentences teaching the concept, ending with a tie to a principle.",
    "principle": 1,
    "parentExplainer": {
      "summary": "1 sentence for the parent describing what this week's quiz tested. See PARENT EXPLAINER RULES.",
      "conversationStarter": "Ask [kid] ... 1 question referencing this week's specific quiz concept."
    }
  },
  "wordOfDay": {
    "word": "A slightly more advanced financial term",
    "type": "noun/verb/etc",
    "context": "what this term relates to from THIS WEEK",
    "definition": "Fun kid-friendly explanation with an analogy. End with how to use it, tied to a principle when natural.",
    "principle": 1,
    "parentExplainer": {
      "summary": "1 sentence for the parent defining this week's term in plain language. See PARENT EXPLAINER RULES.",
      "conversationStarter": "Ask [kid] ... 1 question referencing this week's specific word + recent news context."
    }
  },
  ${sundayChallengeSchemaSnippet}
}

RULES ON OUTPUT:
- "stories" array length: EXACTLY 2. Never 3, never 4.
- editionType MUST be exactly "weekly-wrap"; editionLabel MUST be exactly "The Weekly Wrap 📋".
- "principle" fields are integers 1-11.
- Stories should reference the WEEK's arc, not a single day.
- "sundayChallenge.type" MUST be exactly "${sundayChallengeType}" for this week.
- Match the JSON schema for "${sundayChallengeType}" exactly as documented in the SUNDAY CHALLENGE section above (correct field names, correct array structure).
- Do NOT include a "weeklyChallenge" field — that field is deprecated, only sundayChallenge is used now.
- Do NOT include any citation tags, <cite> tags, or source references. Plain text only inside JSON string values.`;
}

/**
 * Build the WEEK AHEAD prompt (Monday + post-holiday Tuesday-Saturday).
 * Forward-looking preview instead of a recap; stories highlight upcoming
 * earnings/events; word-of-day picks a forward-looking term.
 */
function buildWeekAheadPrompt(marketData, topMover, recentWords, recentFacts, edition, dateStr) {
  const topMoverBlock = topMover
    ? JSON.stringify(topMover, null, 2)
    : 'null  // no curated mover from Friday — use the broader movers list or web search to pick a kid-recognizable name.';

  const postHolidayLine = edition.reason === 'post-holiday' && edition.holidayName
    ? `\nPOST-HOLIDAY NOTE: Yesterday was ${edition.holidayName} (a market holiday). Open vibeSummary with: "Hope you had a great ${edition.holidayName}!" then transition into the week-ahead preview.\n`
    : '';

  const prevDayName = edition.previousTradingDayName || 'Friday';

  return `You are the writer for "Market Juice," and today is THE WEEK AHEAD — a forward-looking preview of what's coming this week in markets. For kids 10-14 and their parents.

${PROFANITY_RULE}

CORE PHILOSOPHY: Every piece of content you generate must reinforce at least one of these 11 core investing principles:

${INVESTING_PRINCIPLES}

${PRINCIPLE_APPLICATION_GUIDE}

STEP 1: Before writing anything, use web_search to PREVIEW THE WEEK AHEAD. Search for:
- 'stock market week ahead preview'
- 'earnings reports this week'
- 'economic calendar this week'
The web search results are your PRIMARY source — the raw FMP data below is ${prevDayName}'s close, included for the scoreboard only.

VOICE & TONE RULES:
- Write like a cool older sibling explaining the markets — casual, fun, never boring.
- Use simple language. If you must use a financial term, explain it right there in parentheses.
- Use analogies a 10-14 year-old gets.
- Short sentences. Punchy.
- Sprinkle in emojis naturally but don't overdo it.
- NEVER include anything inappropriate, scary, or overly complex. Skip violence, war casualties, disturbing events.
${postHolidayLine}
WEEK-AHEAD STORY RULES (CRITICAL — different from a daily digest):
- Return EXACTLY 2 stories. Not 3, not 4.
- Both stories are FORWARD-LOOKING. What's COMING this week.
- Reference specific upcoming days when you can: "Nvidia reports earnings Wednesday" or "the Fed decision drops Thursday".
- First story badge label MUST be "WATCH THIS WEEK" — the single biggest event / earnings report / economic-data release.
- Second story badge label MUST be "ALSO COMING UP" — a secondary watch-item.
- Every "Why It Matters" explains how the upcoming event could move markets and ties to a principle.

TODAY'S MOVER (week-ahead edition):
- Use the curated FMP mover (${prevDayName}'s biggest curated mover) — it gives the scoreboard's gold card something concrete.
- "change" is ${prevDayName}'s single-day change. "vibe" should reference "where we left off" — what to watch into the new week.

THE BIG PICTURE — WEEK AHEAD EDITION:
- 3-4 sentences previewing the week's biggest themes: which earnings reports matter, what economic data is dropping, any Fed meetings, IPO calendar.
- ${edition.reason === 'post-holiday' ? `Open by acknowledging ${edition.holidayName} briefly, then pivot to "here's what's ahead." ` : ''}Cause-and-effect connections welcome.

DID YOU KNOW:
- One mind-blowing money/investing/business fact, 1-2 sentences. Categories to rotate: compound interest, famous investors, company origins, market history, global economy, mind-blowing numbers.
- MUST tie back to one of the 11 principles.
- DO NOT pick any fact substantially similar to the following — used in the last 30 days:
${recentFacts.length ? recentFacts.map(f => `  - ${f}`).join('\n') : '  (none yet — this is the first generation)'}

QUIZ:
- Test general investing knowledge OR reference something from last week. Multiple choice, four options.
- The explanation teaches the concept, ends with a tie to a principle.

WORD OF THE DAY — FORWARD-LOOKING:
- Pick a forward-looking investing/business term. Strong fits: "earnings report", "forecast", "guidance", "consensus estimate", "economic indicator", "interest rate", "Fed", "FOMC", "yield", "outlook".
- DO NOT pick any of the following words — used in the last 30 days. Pick something genuinely different (not a near-synonym, not a singular/plural variant):
${recentWords.length ? recentWords.map(w => `  - ${w}`).join('\n') : '  (none yet — this is the first generation)'}
- Definition uses a kid-friendly analogy. The "context" field should reference the week ahead.

PARENT EXPLAINER RULES (Phase 12):
- Every content section listed in the JSON schema below MUST include a "parentExplainer" object with two string fields:
  - "summary": 1 sentence in plain adult language. No jargon, no kid-speak — for the parent. Max 30 words.
  - "conversationStarter": 1 question framed as "Ask [kid] ..." (literal placeholder — email substitutes the kid's first name). Max 25 words.
- CRITICAL: the conversationStarter MUST reference the specific content from TODAY's preview — actual companies, upcoming events, specific days mentioned. It should feel like a follow-up to what the kid just read, not a generic finance question.
  - GOOD: "Ask [kid] what they predict will happen if Nvidia beats their earnings on Wednesday."
  - BAD: "Ask [kid] what they think about earnings reports." (generic)
- The summary should give the parent enough context to have the conversation even if they don't know finance well themselves.

(NO sundayChallenge field — that's Sunday-only.)

TODAY'S DATE: ${dateStr}
PREVIOUS TRADING DAY: ${edition.previousTradingDay} (${prevDayName})${edition.reason === 'post-holiday' ? `\nYESTERDAY: ${edition.holidayName} (market holiday)` : ''}

RAW MARKET DATA (${prevDayName}'s close — for the scoreboard):
${JSON.stringify(marketData, null, 2)}

TODAY'S MOVER (${prevDayName}'s curated mover):
${topMoverBlock}

Return ONLY a JSON object with this exact structure (no markdown, no backticks, no explanation):

{
  "date": "${dateStr}",
  "editionType": "week-ahead",
  "editionLabel": "The Week Ahead 🔮",
  "marketClosed": true,
  "tradingDay": "last ${prevDayName}",
  "marketVibe": "green" or "red" or "mixed" (based on ${prevDayName}'s close),
  "vibeEmoji": "appropriate emoji",
  "vibeSummary": "${edition.reason === 'post-holiday' ? `Open with "Hope you had a great ${edition.holidayName}!" then ` : ''}One fun sentence setting the mood for the week ahead.",
  "bigPicture": "3-4 sentences previewing the week's biggest themes (earnings, Fed, data, IPOs).",
  "bigPictureParentExplainer": {
    "summary": "1 sentence for the parent previewing what's coming this week. See PARENT EXPLAINER RULES.",
    "conversationStarter": "Ask [kid] ... 1 question referencing THIS WEEK's specific upcoming events."
  },
  "scoreboard": {
    "sp500":  { "price": "${prevDayName}'s close", "change": "${prevDayName}'s single-day +X.XX%", "direction": "up/down", "vibe": "where-we-left-off comment" },
    "nasdaq": { "price": "${prevDayName}'s close", "change": "${prevDayName}'s single-day +X.XX%", "direction": "up/down", "vibe": "where-we-left-off comment" },
    "dow":    { "price": "${prevDayName}'s close", "change": "${prevDayName}'s single-day +X.XX%", "direction": "up/down", "vibe": "where-we-left-off comment" },
    "topMover": {
      "ticker": "TICKER",
      "name": "Company Name (from the curated entry)",
      "price": "$XX.XX",
      "change": "+X.XX%",
      "direction": "up/down",
      "vibe": "One sentence on ${prevDayName}'s move + how to watch it next week. Tie to a principle."
    }
  },
  "stories": [
    {
      "badge": "hot/new/money/world/brain",
      "badgeLabel": "WATCH THIS WEEK",
      "title": "Forward-looking headline — what's coming",
      "body": "2-4 sentences on the upcoming event/earnings/data, including the day it drops",
      "whyItMatters": "2-3 sentences on potential market impact, tied to a principle",
      "principle": 1,
      "parentExplainer": {
        "summary": "1 sentence for the parent recapping THIS upcoming event. See PARENT EXPLAINER RULES.",
        "conversationStarter": "Ask [kid] ... 1 question referencing THIS story's specific upcoming event."
      }
    },
    {
      "badge": "hot/new/money/world/brain",
      "badgeLabel": "ALSO COMING UP",
      "title": "Secondary watch-item headline",
      "body": "2-4 sentences",
      "whyItMatters": "2-3 sentences tied to a principle",
      "principle": 2,
      "parentExplainer": {
        "summary": "1 sentence for the parent recapping THIS upcoming event. See PARENT EXPLAINER RULES.",
        "conversationStarter": "Ask [kid] ... 1 question referencing THIS story's specific upcoming event."
      }
    }
  ],
  "didYouKnow": {
    "fact": "One mind-blowing investing/money/business fact, 1-2 sentences.",
    "category": "compound interest | famous investors | company origins | market history | global economy | mind-blowing numbers",
    "connection": "1-2 sentences tying the fact back to a principle.",
    "principle": 1,
    "parentExplainer": {
      "summary": "1 sentence for the parent describing today's fun fact. See PARENT EXPLAINER RULES.",
      "conversationStarter": "Ask [kid] ... 1 question referencing today's specific fact."
    }
  },
  "quiz": {
    "question": "A general investing question or a callback to last week",
    "options": ["A", "B", "C", "D"],
    "correctIndex": 0,
    "explanation": "2-3 sentences teaching the concept, ending with a tie to a principle.",
    "principle": 1,
    "parentExplainer": {
      "summary": "1 sentence for the parent describing what today's quiz tested. See PARENT EXPLAINER RULES.",
      "conversationStarter": "Ask [kid] ... 1 question referencing today's specific quiz concept."
    }
  },
  "wordOfDay": {
    "word": "A forward-looking financial term",
    "type": "noun/verb/etc",
    "context": "what this term relates to from the week ahead",
    "definition": "Fun kid-friendly explanation with an analogy. End with how to use it, tied to a principle when natural.",
    "principle": 1,
    "parentExplainer": {
      "summary": "1 sentence for the parent defining today's term in plain language. See PARENT EXPLAINER RULES.",
      "conversationStarter": "Ask [kid] ... 1 question referencing today's specific word + week-ahead context."
    }
  }
}

RULES ON OUTPUT:
- "stories" array length: EXACTLY 2 forward-looking entries. Never 3, never 4.
- editionType MUST be exactly "week-ahead"; editionLabel MUST be exactly "The Week Ahead 🔮".
- DO NOT include a "sundayChallenge" field — that's Sunday-only.
- "principle" fields are integers 1-11.
- Stories must look FORWARD, not backward.
- Do NOT include any citation tags, <cite> tags, or source references. Plain text only inside JSON string values.`;
}

export async function generateContent(marketData, news, movers, topMover, opts = {}) {
  // Anti-repeat lists loaded by generate.js from state/content-history.json
  // so the prompt can tell Claude what to avoid today.
  //   opts.recentWords (string[]) — Word of the Day picks from last N days
  //   opts.recentFacts (string[]) — Did You Know facts from last N days
  //   opts.edition     — { editionType, label, previousTradingDay, reason, ... }
  //                      from src/calendar.js; defaults to 'standard'.
  const recentWords = Array.isArray(opts.recentWords) ? opts.recentWords : [];
  const recentFacts = Array.isArray(opts.recentFacts) ? opts.recentFacts : [];
  const edition = opts.edition || { editionType: 'standard', reason: 'weekday' };

  // The dateStr is generated from real-now for production, or from the
  // edition's dateStr (which honors DATE_OVERRIDE) so tests show the
  // right date in the rendered output.
  const todayDate = edition.dateStr
    ? new Date(edition.dateStr + 'T12:00:00Z')
    : new Date();
  const dateStr = todayDate.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  });

  // tradingDayLabel for the STANDARD prompt only. Weekly Wrap and Week
  // Ahead prompts use edition.previousTradingDayName directly.
  // We derive tradingDayLabel from the edition's day-of-week so it stays
  // correct under DATE_OVERRIDE.
  const editionDay = edition.dayName || '';
  let tradingDayLabel = 'yesterday';
  if (editionDay === 'Sunday' || editionDay === 'Monday' || editionDay === 'Saturday') {
    tradingDayLabel = 'Friday';
  }

  // Pick the right prompt for today's edition.
  let prompt;
  switch (edition.editionType) {
    case 'weekly-wrap':
      prompt = buildWeeklyWrapPrompt(marketData, topMover, recentWords, recentFacts, edition, dateStr);
      break;
    case 'week-ahead':
      prompt = buildWeekAheadPrompt(marketData, topMover, recentWords, recentFacts, edition, dateStr);
      break;
    default:
      prompt = buildStandardPrompt(marketData, news, movers, topMover, recentWords, recentFacts, dateStr, tradingDayLabel);
  }

  console.log(`[AI] Building ${edition.editionType} prompt (reason=${edition.reason})`);

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
  const system = `You are the writer for "Market Juice," a daily stock market digest for kids ages 10-14. Voice: casual, fun, like a cool older sibling. Short punchy sentences. Use analogies kids get.

${PROFANITY_RULE}

The 11 core investing principles you reinforce:

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
  const system = `You are the writer for "Market Juice," a daily stock market digest for kids ages 10-14. Voice: casual, fun, like a cool older sibling. Short punchy sentences. Use analogies kids get.

${PROFANITY_RULE}

The 11 core investing principles you reinforce:

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
