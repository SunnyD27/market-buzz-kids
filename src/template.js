// src/template.js — Builds the final HTML page from generated content.
// Phase 1: Market Juice — VOO removed, Today's Mover added, Did You Know
// replaces Coming Up. Engagement systems (XP, ranks, streaks, games) come in
// later phases.

/**
 * Build the daily digest HTML.
 *
 * @param {object} content  The full digest JSON payload (from the DB row or
 *                          the sample-digest fallback). Same shape generateContent()
 *                          produces.
 * @param {object} [opts]   Per-request rendering hints. Currently:
 *                            kidName — kid's first name to greet in the header.
 *                                       Omitted on /sample (which has no logged-in user).
 *                                       Drives the "Hey, X! 👋" pill + Log out link.
 *                          The opts argument is the only path through which the
 *                          template learns *who* is viewing. Everything else
 *                          (stories, scoreboard, games) is identical across kids.
 */
export function buildHTML(content, opts = {}) {
  const {
    date, marketVibe, vibeSummary, bigPicture,
    scoreboard, stories, didYouKnow, wordOfDay,
    dailyChallenge, isSample,
    // Phase 6.8 (5+2 editions): the AI now stamps each digest with its
    // edition type. `editionLabel` renders as a subtitle under the date.
    // `sundayChallenge` is Sunday-only — a longer interactive game that
    // rotates between 4 formats on a 4-week cycle (trading-floor, ceo,
    // investathon, dilemma). Renderer in public/games/sunday-challenge.js.
    // `weeklyChallenge` is the deprecated predecessor — kept here so older
    // cached DB rows from before the Sunday Challenge launch still render
    // a card instead of an empty hole.
    // `marketClosed` is a static flag from the prompt schema — always true
    // on weekly-wrap + week-ahead, absent on standard. Used to render a
    // muted "markets closed" note above the scoreboard so kids understand
    // why the numbers haven't changed since Friday.
    editionType, editionLabel, sundayChallenge, weeklyChallenge, marketClosed,
  } = content;

  const vibeCircle = marketVibe === 'green' ? '🟢' : marketVibe === 'red' ? '🔴' : '🟡';

  // Phase 12 — "Ask my parent" buttons. One-tap flag per section (no
  // free-text from kids — COPPA). Hidden on /sample since unauthenticated
  // visitors have no parent email to deliver to. `section` is the dedup
  // key consumed by the evening recap email; `topic` is the display label
  // for the email body.
  function askParentBtn(section, topic) {
    if (opts.isSample) return '';
    return `<button type="button" class="mj-ask-parent-btn"
              data-section="${escapeHTML(section)}"
              data-topic="${escapeHTML(topic)}"
              onclick="MarketJuice.askParent(this)">💬 Ask my parent about this</button>`;
  }

  // Story-section heading varies by edition. Weekly Wrap recaps the past
  // 5 trading days; Week Ahead previews upcoming events; standard editions
  // cover the previous trading day.
  const storiesHeading = editionType === 'weekly-wrap'
    ? "This Week's Big Stories"
    : editionType === 'week-ahead'
      ? 'What to Watch This Week'
      : "Today's Big Stories";

  const badgeClasses = { hot: 'hot', new: 'new', money: 'money', world: 'world', brain: 'brain' };
  const badgeEmojis = { hot: '🔥', new: '🆕', money: '💰', world: '🌍', brain: '🧠' };

  const storiesHTML = stories.map((story, i) => `
    <div class="story-card" style="animation-delay: ${0.15 + i * 0.1}s">
      <span class="badge ${badgeClasses[story.badge] || 'new'}">${badgeEmojis[story.badge] || '📰'} ${escapeHTML(story.badgeLabel)}</span>
      <h3>${escapeHTML(story.title)}</h3>
      <p>${escapeHTML(story.body)}</p>
      <div class="why-it-matters">
        <strong>💡 Why it matters:</strong> ${escapeHTML(story.whyItMatters)}
      </div>
      ${askParentBtn(`story-${i}`, story.title)}
    </div>
  `).join('');

  // Edition label — subtitle under the date for Weekly Wrap (Sunday) and
  // Week Ahead (Monday/post-holiday) editions. Standard weekday digests
  // omit this line entirely so the header looks identical to before.
  const editionLabelHTML = editionLabel
    ? `<div class="edition-label">${escapeHTML(editionLabel)}</div>`
    : '';

  // Phase 7 — personalized greeting + logout. Only rendered when a kid
  // name was passed in (i.e. an authenticated /digest request). /sample
  // never has a kidName and falls through to the un-greeted header.
  const kidName = opts.kidName;
  const greetingHTML = kidName
    ? `<div class="kid-greeting">
         <span class="kid-greeting-name">Hey, ${escapeHTML(kidName)}! 👋</span>
         <a href="#" class="logout-link" id="logout-link">Log out</a>
       </div>`
    : '';

  // "Markets closed" note — muted single line right above the scoreboard.
  // Only renders for weekend/holiday editions where the scoreboard is
  // showing Friday's frozen numbers, so kids understand why the values
  // aren't moving. Copy varies by edition: a recap framing for Sunday,
  // a forward-looking framing for Monday/post-holiday.
  const marketClosedNote = marketClosed
    ? (editionType === 'weekly-wrap'
        ? "📊 Markets were closed this weekend — here's how the week went"
        : "📊 Markets were closed yesterday — here's where things stand heading into the week")
    : null;
  const marketClosedHTML = marketClosedNote
    ? `<div style="text-align: center; font-size: 12px; color: rgba(255,255,255,0.45); font-style: italic; margin: 0 16px 10px; padding: 8px 0;">${escapeHTML(marketClosedNote)}</div>`
    : '';

  // Sunday Challenge — Sunday-only interactive game (4 rotating types).
  // The AI generates the content; public/games/sunday-challenge.js does
  // the rendering. Section header + container div; the inline script at
  // the bottom of the page calls window.MJGames.sundayChallenge.render.
  //
  // Backward compat: if a digest row is from before the Sunday Challenge
  // launch it'll have `weeklyChallenge` instead — render the old card so
  // we don't leave a hole on those days.
  const SUNDAY_CHALLENGE_META = {
    'trading-floor': { icon: '📈', name: 'The Trading Floor',     subtitle: 'Invest $10,000 across 3 eras of stock market history' },
    'ceo':           { icon: '💼', name: 'CEO for a Day',         subtitle: '3 real business decisions — what would you do?' },
    'investathon':   { icon: '⚡', name: 'Invest-a-Thon',         subtitle: '10 rapid-fire questions — 8 seconds each' },
    'dilemma':       { icon: '⚖️', name: "The Investor's Dilemma", subtitle: 'Real math, real tradeoffs, no easy answers' },
  };
  const hasSundayChallenge = !!(sundayChallenge && sundayChallenge.type && SUNDAY_CHALLENGE_META[sundayChallenge.type]);
  const sundayChallengeHTML = hasSundayChallenge
    ? (() => {
        const meta = SUNDAY_CHALLENGE_META[sundayChallenge.type];
        return `
  <div class="section-header">
    <span class="emoji">${meta.icon}</span>
    <h2>Sunday Challenge: ${escapeHTML(meta.name)}</h2>
    <div class="line"></div>
  </div>
  <div class="sc-subtitle">${escapeHTML(meta.subtitle)}</div>
  <div id="sunday-challenge-host"></div>`;
      })()
    : (weeklyChallenge?.headline && weeklyChallenge?.body
        ? `
  <div class="section-header">
    <span class="emoji">🎯</span>
    <h2>Weekly Challenge</h2>
    <div class="line"></div>
  </div>
  <div class="wc-card">
    <div class="wc-label">⭐ ONE FUN TASK FOR THE WEEK</div>
    <div class="wc-headline">${escapeHTML(weeklyChallenge.headline)}</div>
    <div class="wc-body">${escapeHTML(weeklyChallenge.body)}</div>
  </div>`
        : '');

  // Phase 6.4: the bare quiz section was replaced by the Daily Challenge
  // picker. The picker decides today's 3 games (rotation in
  // public/games/daily-challenge.js) and renders them as expandable cards.
  // Today's hydrated game payloads come from src/games.js via
  // content.dailyChallenge. If for some reason dailyChallenge isn't
  // present, we omit the section entirely rather than fall back to a
  // partial bare quiz.
  const hasDailyChallenge = !!(dailyChallenge && Array.isArray(dailyChallenge.games) && dailyChallenge.games.length);
  const dailyChallengeSectionHTML = hasDailyChallenge ? `
  <div class="section-header">
    <span class="emoji">🚀</span>
    <h2>Today's Daily Challenge</h2>
    <div class="line"></div>
  </div>
  <div id="daily-challenge-host"></div>
  ` : '';

  function scoreCard(key, label) {
    const s = scoreboard[key];
    if (!s) return '';
    const dir = s.direction === 'up' ? 'up' : 'down';
    const arrow = s.direction === 'up' ? 'arrow-up' : 'arrow-down';
    return `
      <div class="score-card ${dir}">
        <div class="name">${escapeHTML(label)}</div>
        <div class="price">${escapeHTML(s.price)}</div>
        <div class="change"><span class="${arrow}"></span> ${escapeHTML(s.change)}</div>
        <div class="vibe">${escapeHTML(s.vibe)}</div>
      </div>
    `;
  }

  function topMoverCard() {
    const s = scoreboard.topMover;
    if (!s) return '';
    const dir = s.direction === 'up' ? 'up' : 'down';
    const arrow = s.direction === 'up' ? 'arrow-up' : 'arrow-down';
    return `
      <div class="score-card ${dir} mover">
        <div class="mover-badge">TODAY'S MOVER</div>
        <div class="mover-name">${escapeHTML(s.name)}</div>
        <div class="mover-ticker">${escapeHTML(s.ticker)}</div>
        <div class="price">${escapeHTML(s.price)}</div>
        <div class="change"><span class="${arrow}"></span> ${escapeHTML(s.change)}</div>
      </div>
    `;
  }

  // Sample chip + banner — only when content.isSample is true. Extracted
  // up here as constants so we don't have to nest single-quoted CSS inside
  // the main backtick-template (the escaping turns into a mess fast).
  const sampleChipHTML = isSample ? `<span style="font-family:'Space Mono',monospace; font-size:11px; color:var(--yellow); -webkit-text-fill-color:var(--yellow); letter-spacing:2px; vertical-align:middle; padding:3px 8px; border:1px solid var(--yellow); border-radius:6px; margin-left:10px;">SAMPLE</span>` : '';

  const sampleBannerHTML = isSample ? `
  <div class="sample-banner" role="region" aria-label="Sample digest banner">
    <div class="sample-copy">
      ✨ <strong>This is a sample digest.</strong> The real one — with today's actual market moves and fresh stories — drops every weekday at&nbsp;7&nbsp;AM EST.
    </div>
    <a class="sample-cta" href="/#signup">Sign up your kid →</a>
  </div>` : '';

  // Today's Mover one-liner gets its own callout row under the scoreboard so
  // the "WHY it moved" explanation has room to breathe — the vibe text is too
  // long to fit inside the gold card cleanly.
  const topMoverWhyHTML = scoreboard.topMover?.vibe
    ? `
      <p style="font-size: 13px; color: var(--text-dim); margin-top: 10px;">
        ⭐ <strong style="color: var(--yellow);">Why ${escapeHTML(scoreboard.topMover.name)} moved:</strong> ${escapeHTML(scoreboard.topMover.vibe)}
      </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Market Juice">
<meta name="theme-color" content="#0d1117">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/icon.svg">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<title>Market Juice</title>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/engagement.css">
<link rel="stylesheet" href="/games/styles.css">
<script>
  // Phase 11 — server-injected per-request hints consumed by engagement.js.
  // __digestDate is the NY calendar date the digest is for (event tracking
  // uses this for the daily-visit + game-completed event_data).
  // __isSample tells engagement.js to render the teaser profile bar
  // ("Sign up to start earning!") instead of fetching real state.
  window.__digestDate = '${escapeHTML(opts.digestDate || '')}';
  window.__isSample = ${opts.isSample ? 'true' : 'false'};
</script>
<script src="/progression-config.js"></script>
<script src="/engagement.js" defer></script>
<script src="/engagement-popups.js" defer></script>
<script src="/pwa.js" defer></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0d1117; --card: #161b22; --card-border: #21262d;
    --green: #3fb950; --green-glow: rgba(63,185,80,0.15);
    --red: #f85149; --red-glow: rgba(248,81,73,0.15);
    --blue: #58a6ff; --blue-glow: rgba(88,166,255,0.12);
    --purple: #bc8cff; --yellow: #f0c040; --yellow-glow: rgba(240,192,64,0.12);
    --text: #e6edf3; --text-dim: #8b949e; --text-bright: #ffffff;
    --orange: #f0883e;
  }
  body { background: var(--bg); color: var(--text); font-family: 'Fredoka', sans-serif; min-height: 100vh; overflow-x: hidden; -webkit-font-smoothing: antialiased; }
  .stars { position: fixed; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: 0; }
  .star { position: absolute; width: 2px; height: 2px; background: white; border-radius: 50%; animation: twinkle 3s ease-in-out infinite alternate; }
  @keyframes twinkle { 0% { opacity: 0.2; } 100% { opacity: 0.8; } }
  .container { max-width: 680px; margin: 0 auto; padding: 24px 16px 60px; position: relative; z-index: 1; }
  .header { text-align: center; margin-bottom: 32px; animation: slideDown 0.6s ease-out; }
  @keyframes slideDown { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
  /* Brand lockup: PNG mark + wordmark in one flex container, matching the
     landing-page hero treatment (Phase 9). The wordmark keeps the
     gradient-on-Market / solid-gold-on-Juice treatment digest readers are
     used to. */
  .logo {
    display: inline-flex; align-items: center;
    gap: clamp(0.2rem, 0.6vw, 0.45rem);
    font-size: 42px; font-weight: 700;
    background: linear-gradient(135deg, var(--blue), var(--purple), var(--yellow));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -1px;
    line-height: 1;
  }
  .logo-mark {
    width: clamp(5rem, 14vw, 8rem);
    height: auto;
    display: inline-block;
    flex-shrink: 0;
    filter: drop-shadow(0 6px 18px rgba(188,140,255,0.22));
    -webkit-text-fill-color: initial;
  }
  /* "Juice" accent — solid gold to mirror the landing-page logo treatment. */
  .logo em { font-style: normal; color: var(--yellow); -webkit-text-fill-color: var(--yellow); }
  .date-line { font-family: 'Space Mono', monospace; font-size: 13px; color: var(--text-dim); margin-top: 6px; letter-spacing: 1px; }
  .tagline { font-size: 15px; color: var(--text-dim); margin-top: 4px; }
  .section-header { display: flex; align-items: center; gap: 10px; margin: 32px 0 16px; animation: fadeIn 0.5s ease-out both; }
  .section-header .emoji { font-size: 28px; line-height: 1; }
  .section-header h2 { font-size: 22px; font-weight: 700; color: var(--text-bright); }
  .section-header .line { flex: 1; height: 2px; background: linear-gradient(90deg, var(--card-border), transparent); border-radius: 1px; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .scoreboard { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; animation: fadeIn 0.5s ease-out 0.1s both; }
  .score-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 16px; padding: 16px 14px; text-align: center; transition: transform 0.2s, box-shadow 0.2s; cursor: default; }
  .score-card:hover { transform: translateY(-4px); }
  .score-card.up { box-shadow: 0 4px 20px var(--green-glow); border-color: rgba(63,185,80,0.3); }
  .score-card.down { box-shadow: 0 4px 20px var(--red-glow); border-color: rgba(248,81,73,0.3); }
  .score-card .name { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--text-dim); letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 6px; }
  .score-card .price { font-size: 20px; font-weight: 700; color: var(--text-bright); margin-bottom: 4px; }
  .score-card .change { font-family: 'Space Mono', monospace; font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 4px; }
  .score-card.up .change { color: var(--green); }
  .score-card.down .change { color: var(--red); }
  .arrow-up::before { content: "▲"; font-size: 12px; }
  .arrow-down::before { content: "▼"; font-size: 12px; }
  .score-card .vibe { font-size: 12px; color: var(--text-dim); margin-top: 6px; font-style: italic; }
  .score-card.mover { background: linear-gradient(135deg, rgba(240,192,64,0.10), rgba(240,136,62,0.08)); border-color: rgba(240,192,64,0.4); box-shadow: 0 4px 24px rgba(240,192,64,0.18), inset 0 0 30px rgba(240,192,64,0.03); position: relative; }
  .score-card.mover:hover { box-shadow: 0 6px 28px rgba(240,192,64,0.28), inset 0 0 30px rgba(240,192,64,0.05); }
  .mover-badge { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: 2px; background: linear-gradient(135deg, var(--yellow), var(--orange)); color: #0d1117; padding: 3px 8px; border-radius: 6px; font-weight: 700; margin-bottom: 6px; display: inline-block; }
  .mover-name { font-size: 14px; font-weight: 700; color: var(--yellow); margin-bottom: 2px; line-height: 1.2; }
  .mover-ticker { font-family: 'Space Mono', monospace; font-size: 10px; color: var(--text-dim); letter-spacing: 1.5px; margin-bottom: 6px; }
  .story-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 16px; padding: 20px; margin-bottom: 14px; animation: fadeIn 0.5s ease-out both; transition: transform 0.2s; }
  .story-card:hover { transform: translateY(-2px); }
  .story-card .badge { display: inline-block; font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; padding: 4px 10px; border-radius: 20px; margin-bottom: 10px; font-weight: 700; }
  .badge.hot { background: var(--red-glow); color: var(--red); border: 1px solid rgba(248,81,73,0.3); }
  .badge.new { background: var(--blue-glow); color: var(--blue); border: 1px solid rgba(88,166,255,0.3); }
  .badge.money { background: var(--green-glow); color: var(--green); border: 1px solid rgba(63,185,80,0.3); }
  .badge.world { background: var(--yellow-glow); color: var(--yellow); border: 1px solid rgba(240,192,64,0.3); }
  .badge.brain { background: rgba(188,140,255,0.12); color: var(--purple); border: 1px solid rgba(188,140,255,0.3); }
  .story-card h3 { font-size: 18px; font-weight: 600; color: var(--text-bright); margin-bottom: 8px; line-height: 1.3; }
  .story-card p { font-size: 15px; line-height: 1.65; color: var(--text); }
  .story-card .why-it-matters { margin-top: 12px; padding: 12px 14px; background: rgba(88,166,255,0.06); border-left: 3px solid var(--blue); border-radius: 0 10px 10px 0; font-size: 14px; color: var(--text); line-height: 1.55; }
  .story-card .why-it-matters strong { color: var(--blue); font-weight: 600; }
  .dyk-card { background: linear-gradient(135deg, rgba(188,140,255,0.10), rgba(88,166,255,0.06)); border: 1px solid rgba(188,140,255,0.3); border-radius: 16px; padding: 20px 22px; animation: fadeIn 0.5s ease-out both; }
  .dyk-card .dyk-label { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--purple); margin-bottom: 10px; }
  .dyk-card .dyk-fact { font-size: 17px; font-weight: 500; color: var(--text-bright); line-height: 1.5; margin-bottom: 12px; }
  .dyk-card .dyk-connection { font-size: 14px; color: var(--text); line-height: 1.55; padding: 12px 14px; background: rgba(188,140,255,0.08); border-left: 3px solid var(--purple); border-radius: 0 10px 10px 0; }
  .dyk-card .dyk-connection strong { color: var(--purple); font-weight: 600; }
  .quiz-card { background: linear-gradient(135deg, rgba(188,140,255,0.08), rgba(88,166,255,0.08)); border: 1px solid rgba(188,140,255,0.25); border-radius: 16px; padding: 24px; text-align: center; animation: fadeIn 0.5s ease-out both; }
  .quiz-card .quiz-label { font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--purple); margin-bottom: 12px; }
  .quiz-card .quiz-question { font-size: 18px; font-weight: 600; color: var(--text-bright); margin-bottom: 20px; line-height: 1.4; }
  .quiz-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
  .quiz-btn { background: var(--card); border: 2px solid var(--card-border); border-radius: 12px; padding: 12px; color: var(--text); font-family: 'Fredoka', sans-serif; font-size: 15px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
  .quiz-btn:hover { border-color: var(--purple); background: rgba(188,140,255,0.08); transform: scale(1.03); }
  .quiz-btn.correct { border-color: var(--green); background: var(--green-glow); color: var(--green); }
  .quiz-btn.wrong { border-color: var(--red); background: var(--red-glow); color: var(--red); opacity: 0.6; }
  .quiz-answer { display: none; font-size: 14px; color: var(--text); line-height: 1.5; padding: 14px; background: rgba(63,185,80,0.06); border-radius: 12px; border: 1px solid rgba(63,185,80,0.2); }
  .quiz-answer.visible { display: block; }
  .word-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 16px; padding: 20px; animation: fadeIn 0.5s ease-out both; text-align: center; }
  .word-card .word-label { font-family: 'Space Mono', monospace; font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--yellow); margin-bottom: 8px; }
  .word-card .the-word { font-size: 28px; font-weight: 700; color: var(--yellow); margin-bottom: 4px; }
  .word-card .word-type { font-size: 12px; color: var(--text-dim); font-style: italic; margin-bottom: 10px; }
  .word-card .word-def { font-size: 15px; color: var(--text); line-height: 1.55; max-width: 500px; margin: 0 auto; }
  .vibe-bar { margin-top: 16px; text-align: center; background: linear-gradient(135deg, rgba(63,185,80,0.06), rgba(88,166,255,0.06)); border: 1px solid var(--card-border); border-radius: 16px; padding: 18px 20px; animation: fadeIn 0.5s ease-out both; }
  .big-picture { margin-top: 16px; background: linear-gradient(135deg, rgba(88,166,255,0.12), rgba(88,166,255,0.03)); border: 1px solid rgba(88,166,255,0.25); border-radius: 16px; padding: 20px 22px; animation: fadeIn 0.5s ease-out both; }
  .big-picture .bp-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .big-picture .bp-header .emoji { font-size: 24px; line-height: 1; }
  .big-picture .bp-header h3 { font-size: 18px; font-weight: 700; color: var(--text-bright); }
  .big-picture p { font-size: 15px; line-height: 1.65; color: var(--text); }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--card-border); font-size: 13px; color: var(--text-dim); animation: fadeIn 0.5s ease-out both; }
  .footer .rocket { font-size: 20px; }
  /* Edition label — renders under .date-line for Weekly Wrap and Week Ahead. */
  .edition-label {
    font-family: 'Fredoka', sans-serif;
    font-size: 15px; font-weight: 600;
    margin-top: 4px;
    background: linear-gradient(135deg, var(--blue), var(--purple));
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    letter-spacing: 0.2px;
  }
  /* Phase 7 — small greeting + logout link in the header. Subtle by
     design: this is for shared-device hygiene, not a daily-visible CTA. */
  .kid-greeting {
    margin-top: 10px;
    display: inline-flex; align-items: center; gap: 12px;
    padding: 5px 12px;
    background: rgba(88,166,255,0.08);
    border: 1px solid rgba(88,166,255,0.25);
    border-radius: 999px;
    font-size: 13px;
  }
  .kid-greeting-name { color: var(--text-bright); font-weight: 600; }
  .kid-greeting .logout-link {
    color: var(--text-dim);
    text-decoration: none;
    font-size: 12px;
    border-left: 1px solid rgba(255,255,255,0.15);
    padding-left: 12px;
  }
  .kid-greeting .logout-link:hover { color: var(--text-bright); }
  /* Weekly Challenge card — Sunday-only. Distinct blue/purple gradient
     so it doesn't visually compete with the purple dyk-card next to it. */
  .wc-card {
    background: linear-gradient(135deg, rgba(88,166,255,0.14), rgba(188,140,255,0.08));
    border: 1px solid rgba(88,166,255,0.30);
    border-radius: 16px;
    padding: 20px 22px;
    animation: fadeIn 0.5s ease-out both;
  }
  .wc-card .wc-label {
    font-family: 'Space Mono', monospace;
    font-size: 10px; letter-spacing: 2px;
    text-transform: uppercase; color: var(--blue);
    margin-bottom: 10px;
  }
  .wc-card .wc-headline {
    font-size: 19px; font-weight: 600;
    color: var(--text-bright); line-height: 1.4;
    margin-bottom: 10px;
  }
  .wc-card .wc-body {
    font-size: 15px; color: var(--text);
    line-height: 1.6;
  }
  /* ── Sunday Challenge ────────────────────────────────────────────────
     A longer interactive game on Sundays. All 4 game types (trading-floor,
     ceo, investathon, dilemma) share these .sc-* classes — the renderer
     in public/games/sunday-challenge.js picks which structural pieces to
     compose. Distinct gold/blue gradient border so it reads as "special"
     vs the regular daily cards. */
  .sc-subtitle {
    font-size: 13px;
    color: var(--text-dim);
    text-align: center;
    margin: -6px 16px 14px;
    font-style: italic;
  }
  .sc-card {
    background: linear-gradient(135deg, rgba(240,192,64,0.10), rgba(88,166,255,0.10));
    border: 1px solid rgba(240,192,64,0.35);
    border-radius: 16px;
    padding: 20px 22px;
    animation: fadeIn 0.5s ease-out both;
  }
  .sc-round-meta {
    font-family: 'Space Mono', monospace;
    font-size: 11px; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--yellow);
    margin-bottom: 12px;
  }
  .sc-headline {
    background: rgba(13,17,23,0.55);
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  .sc-headline p {
    font-size: 15px;
    color: var(--text-bright);
    line-height: 1.55;
    margin: 0;
  }
  .sc-year {
    font-family: 'Space Mono', monospace;
    font-size: 12px; letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--yellow);
    margin-bottom: 8px;
  }
  .sc-allocation {
    font-size: 13px;
    color: var(--text-dim);
    margin-bottom: 10px;
  }
  .sc-stocks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 12px;
  }
  .sc-stock {
    background: rgba(26,34,53,0.85);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 12px;
    padding: 12px;
    text-align: left;
    cursor: pointer;
    color: var(--text);
    font-family: inherit;
    transition: transform 0.1s, border-color 0.15s, background 0.15s;
  }
  .sc-stock:hover:not(:disabled) { transform: translateY(-1px); border-color: rgba(240,192,64,0.4); }
  .sc-stock:disabled { opacity: 0.7; cursor: default; }
  .sc-stock.sc-selected { border-color: var(--yellow); background: rgba(240,192,64,0.10); }
  .sc-stock-ticker { font-weight: 700; font-size: 14px; color: var(--text-bright); }
  .sc-stock-name { font-size: 12px; color: var(--text-dim); margin-bottom: 6px; }
  .sc-stock-price { font-family: 'Space Mono', monospace; font-size: 13px; color: var(--text); }
  .sc-stock-alloc {
    margin-top: 6px;
    font-family: 'Space Mono', monospace;
    font-size: 12px;
    color: var(--yellow);
    font-weight: 700;
  }
  .sc-total-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px; font-size: 14px; color: var(--text);
  }
  .sc-total { color: var(--yellow); }
  .sc-options {
    display: flex; flex-direction: column; gap: 10px;
    margin-bottom: 12px;
  }
  .sc-option {
    background: rgba(26,34,53,0.85);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 12px;
    padding: 12px 14px;
    text-align: left;
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.4;
    display: flex; align-items: flex-start; gap: 12px;
    transition: transform 0.1s, border-color 0.15s, background 0.15s;
  }
  .sc-option:hover:not(:disabled) { transform: translateY(-1px); border-color: rgba(88,166,255,0.45); }
  .sc-option:disabled { cursor: default; }
  .sc-option-letter {
    flex-shrink: 0;
    width: 24px; height: 24px; border-radius: 50%;
    background: rgba(88,166,255,0.18);
    color: var(--blue);
    font-family: 'Space Mono', monospace; font-size: 12px;
    display: inline-flex; align-items: center; justify-content: center;
    font-weight: 700;
  }
  .sc-option-text { flex: 1; }
  .sc-option.sc-correct { border-color: rgba(72,187,120,0.7); background: rgba(72,187,120,0.10); }
  .sc-option.sc-wrong   { border-color: rgba(245,101,101,0.7); background: rgba(245,101,101,0.10); }
  .sc-option.sc-selected { border-color: var(--blue); background: rgba(88,166,255,0.10); }
  .sc-result-area { margin-top: 14px; }
  .sc-result-head {
    font-family: 'Space Mono', monospace;
    font-size: 11px; letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 10px;
    color: var(--yellow);
  }
  .sc-result-head.win  { color: #6bd687; }
  .sc-result-head.miss { color: #f0808a; }
  .sc-result-body, .sc-result-lesson, .sc-bottom-line {
    font-size: 14px; line-height: 1.6;
    color: var(--text); margin-bottom: 10px;
  }
  .sc-result-summary {
    background: rgba(13,17,23,0.55);
    border-radius: 10px;
    padding: 10px 12px;
    margin: 10px 0;
    font-size: 14px;
    display: grid; gap: 4px;
  }
  .sc-result-bars { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .sc-result-bar-row {
    display: grid;
    grid-template-columns: 90px 1fr 60px;
    align-items: center; gap: 8px;
    font-family: 'Space Mono', monospace;
    font-size: 12px;
  }
  .sc-result-bar-label { color: var(--text-dim); }
  .sc-result-bar {
    background: rgba(255,255,255,0.06);
    height: 8px; border-radius: 4px;
    overflow: hidden;
  }
  .sc-result-bar-fill {
    height: 100%; border-radius: 4px;
    transition: width 0.4s ease-out;
  }
  .sc-result-bar-fill.up   { background: linear-gradient(90deg, #4ade80, #6bd687); }
  .sc-result-bar-fill.down { background: linear-gradient(90deg, #f56565, #fc8181); }
  .sc-result-bar-pct.up   { color: #6bd687; text-align: right; }
  .sc-result-bar-pct.down { color: #f0808a; text-align: right; }
  .sc-next-btn, .sc-reveal-btn {
    background: linear-gradient(135deg, var(--yellow), #b08a4a);
    border: none; border-radius: 10px;
    padding: 10px 16px; font-family: inherit;
    font-size: 14px; font-weight: 600; color: #0d1117;
    cursor: pointer; margin-top: 8px;
    transition: transform 0.1s, opacity 0.15s;
  }
  .sc-next-btn:hover, .sc-reveal-btn:hover { transform: translateY(-1px); }
  .sc-reveal-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .sc-dots { display: flex; gap: 6px; margin-bottom: 10px; }
  .sc-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: rgba(255,255,255,0.15);
  }
  .sc-dot.active { background: var(--yellow); }
  .sc-dot.done   { background: rgba(88,166,255,0.55); }
  .sc-timer-row {
    display: flex; flex-direction: column; gap: 6px;
    margin-bottom: 14px;
  }
  .sc-q-counter {
    font-family: 'Space Mono', monospace;
    font-size: 11px; letter-spacing: 1.5px;
    color: var(--text-dim);
  }
  .sc-timer-bar {
    height: 6px; background: rgba(255,255,255,0.06);
    border-radius: 3px; overflow: hidden;
  }
  .sc-timer-fill {
    height: 100%; width: 100%;
    background: linear-gradient(90deg, var(--yellow), #f56565);
    border-radius: 3px;
  }
  .sc-vs-grid {
    display: grid; gap: 10px;
    grid-template-columns: 1fr;
    margin: 10px 0;
  }
  @media (min-width: 600px) {
    .sc-vs-grid { grid-template-columns: 1fr 1fr; }
  }
  .sc-analysis-card {
    background: rgba(13,17,23,0.55);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 14px;
  }
  .sc-analysis-card.sc-your-choice {
    border-color: rgba(88,166,255,0.55);
    background: rgba(88,166,255,0.06);
  }
  .sc-analysis-tag {
    font-family: 'Space Mono', monospace;
    font-size: 10px; letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--blue);
    margin-bottom: 6px;
  }
  .sc-analysis-card:not(.sc-your-choice) .sc-analysis-tag { color: var(--text-dim); }
  .sc-analysis-title {
    font-size: 15px; font-weight: 700;
    color: var(--text-bright); margin-bottom: 8px;
  }
  .sc-metrics {
    background: rgba(255,255,255,0.03);
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 10px;
  }
  .sc-metric-row {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 13px;
    padding: 4px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .sc-metric-row:last-child { border-bottom: none; }
  .sc-metric-label { color: var(--text-dim); }
  .sc-metric-value {
    font-family: 'Space Mono', monospace;
    color: var(--text-bright); font-weight: 600;
  }
  .sc-analysis-takeaway { font-size: 13px; line-height: 1.55; color: var(--text); }
  .sc-principle-tag {
    font-family: 'Space Mono', monospace;
    font-size: 11px; letter-spacing: 1px;
    color: var(--yellow);
    background: rgba(240,192,64,0.10);
    border: 1px solid rgba(240,192,64,0.25);
    border-radius: 999px;
    padding: 5px 12px;
    display: inline-block;
    margin: 10px 0;
  }
  .sc-xp-badge {
    margin-top: 14px;
    background: linear-gradient(135deg, rgba(240,192,64,0.18), rgba(88,166,255,0.10));
    border: 1px solid rgba(240,192,64,0.45);
    border-radius: 12px;
    padding: 12px 14px;
    display: flex; align-items: center; gap: 12px;
  }
  .sc-xp-amount {
    font-family: 'Space Mono', monospace;
    font-size: 18px; font-weight: 700;
    color: var(--yellow);
  }
  .sc-xp-label { font-size: 13px; color: var(--text); }
  .sc-final {
    text-align: center;
    padding: 12px 6px 4px;
  }
  .sc-final-headline {
    font-size: 20px; font-weight: 700;
    color: var(--text-bright); margin-bottom: 12px;
  }
  .sc-final-grid {
    display: grid; gap: 12px;
    grid-template-columns: 1fr;
    margin-bottom: 14px;
  }
  @media (min-width: 480px) {
    .sc-final-grid:has(> :nth-child(2)) { grid-template-columns: 1fr 1fr; }
  }
  .sc-final-label {
    font-family: 'Space Mono', monospace;
    font-size: 10px; letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 4px;
  }
  .sc-final-value {
    font-size: 22px; font-weight: 700;
    color: var(--text-bright);
  }
  .sc-final-pct { font-family: 'Space Mono', monospace; font-size: 13px; color: var(--yellow); }
  .sc-final-lesson { font-size: 14px; line-height: 1.55; color: var(--text); }
  .sc-done {
    text-align: center;
    padding: 18px 14px;
  }
  .sc-done-headline { font-size: 16px; font-weight: 700; color: var(--text-bright); margin-bottom: 6px; }
  .sc-done-body { font-size: 13px; color: var(--text-dim); margin-bottom: 10px; }
  /* Sample banner — only renders when content.isSample is true. Goal is to
     LOOK like a real digest while making it clear the content is generic
     and the real version arrives by email. */
  .sample-banner {
    background: linear-gradient(135deg, rgba(240,192,64,0.16), rgba(188,140,255,0.10));
    border: 1px solid rgba(240,192,64,0.40);
    border-radius: 16px;
    padding: 14px 18px;
    margin: 0 0 22px;
    display: flex; flex-wrap: wrap;
    align-items: center; gap: 14px; justify-content: center;
    text-align: center;
    animation: fadeIn 0.5s ease-out both;
  }
  .sample-banner .sample-copy {
    font-size: 14px; color: var(--text-bright); flex: 1; min-width: 240px;
    line-height: 1.5;
  }
  .sample-banner .sample-cta {
    background: linear-gradient(135deg, var(--yellow), var(--orange));
    color: #0d1117;
    padding: 10px 18px;
    border-radius: 999px;
    font-weight: 700; text-decoration: none; font-size: 14px;
    white-space: nowrap;
    transition: transform 0.15s;
  }
  .sample-banner .sample-cta:hover { transform: translateY(-1px); }
  @media (max-width: 600px) {
    .scoreboard { grid-template-columns: 1fr 1fr; }
    .score-card { padding: 12px 14px; }
    .quiz-options { grid-template-columns: 1fr; }
    .logo { font-size: 32px; }
    .container { padding: 16px 12px 40px; }
  }
</style>
</head>
<body>

<div class="stars" id="stars"></div>

<div class="container">

  ${sampleBannerHTML}

  <div class="header">
    <div class="logo"><img src="/icons/logo.png" alt="" class="logo-mark" width="160" height="160"/>Market&nbsp;<em>Juice</em>${sampleChipHTML}</div>
    <div class="date-line">${escapeHTML(date.toUpperCase())}</div>
    ${editionLabelHTML}
    <div class="tagline">Your daily squeeze of market smarts</div>
    ${greetingHTML}
  </div>

  <!-- Investor Profile Bar — rendered by /engagement.js from localStorage -->
  <div id="investor-profile" class="investor-profile" aria-live="polite"></div>

  ${marketClosedHTML}

  <div class="section-header">
    <span class="emoji">🏆</span>
    <h2>Market Scoreboard</h2>
    <div class="line"></div>
  </div>

  <div class="scoreboard">
    ${scoreCard('sp500', 'S&P 500')}
    ${scoreCard('nasdaq', 'NASDAQ')}
    ${scoreCard('dow', 'DOW')}
    ${topMoverCard()}
  </div>

  <div class="vibe-bar">
    <p style="font-size: 16px; font-weight: 500; color: var(--text-bright);">
      ${vibeCircle} <strong>${marketVibe === 'green' ? 'Green day!' : marketVibe === 'red' ? 'Red day.' : 'Mixed day.'}</strong> ${escapeHTML(vibeSummary)}
    </p>
    ${topMoverWhyHTML}
  </div>

  <div class="big-picture">
    <div class="bp-header">
      <span class="emoji">🌎</span>
      <h3>The Big Picture</h3>
    </div>
    <p>${escapeHTML(bigPicture)}</p>
    ${askParentBtn('big-picture', "Today's Big Picture")}
  </div>

  <div class="section-header">
    <span class="emoji">🔥</span>
    <h2>${storiesHeading}</h2>
    <div class="line"></div>
  </div>

  ${!opts.isSample ? `
  <div class="mj-ask-parent-intro" id="askParentIntro">
    <p><strong>Got a question?</strong> If something in today's digest is confusing or interesting, tap <span class="mj-ask-parent-btn-inline">💬 Ask my parent about this</span> and your parent will get a note about it tonight with a way to talk about it with you.</p>
    <button class="mj-ask-parent-intro-dismiss" onclick="this.parentElement.classList.add('mj-ask-parent-intro--out');try{localStorage.setItem('mj-ask-parent-intro-seen','true')}catch(e){}setTimeout(function(){var el=document.getElementById('askParentIntro');if(el)el.remove();},300)">Got it</button>
  </div>` : ''}

  ${storiesHTML}

  <div class="section-header">
    <span class="emoji">🤯</span>
    <h2>Did You Know?</h2>
    <div class="line"></div>
  </div>

  <div class="dyk-card">
    <div class="dyk-label">🧠 ${escapeHTML(didYouKnow?.category || 'mind-blowing numbers')}</div>
    <div class="dyk-fact">${escapeHTML(didYouKnow?.fact || '')}</div>
    ${didYouKnow?.connection ? `<div class="dyk-connection"><strong>The lesson:</strong> ${escapeHTML(didYouKnow.connection)}</div>` : ''}
    ${askParentBtn('did-you-know', `Did You Know: ${didYouKnow?.category || 'today’s fact'}`)}
  </div>

  ${sundayChallengeHTML}

  ${dailyChallengeSectionHTML}

  <div class="section-header">
    <span class="emoji">📖</span>
    <h2>Word of the Day</h2>
    <div class="line"></div>
  </div>

  <div class="word-card" id="word-card">
    <div class="word-label">🔤 INVESTING VOCABULARY</div>
    <div class="the-word">${escapeHTML(wordOfDay.word)}</div>
    <div class="word-type">${escapeHTML(wordOfDay.type)} · ${escapeHTML(wordOfDay.context)}</div>
    <button type="button" class="word-reveal-btn" id="wordRevealBtn" onclick="revealWord()">Tap to reveal definition</button>
    <div class="word-def word-def-hidden" id="wordDef">${escapeHTML(wordOfDay.definition)}</div>
    ${askParentBtn('word-of-day', `Word of the Day: ${wordOfDay.word}`)}
  </div>

  <div class="footer">
    <div class="rocket">🚀</div>
    <p style="margin-top: 6px;">Market Juice — Built for future investors</p>
    <p style="margin-top: 4px; font-size: 11px; color: #484f58;">Not financial advice. Just getting smarter every day.</p>
  </div>

</div>

<!-- Phase 6.4: game modules. Loaded synchronously and in order before the
     inline render call below so window.MJGames is fully populated.
     shared.js is required by BOTH the Daily Challenge picker and the
     Sunday Challenge (it provides MJGames.shared.PRINCIPLES used for
     reveal-panel principle tags). We load it once when either is present. -->
${(hasDailyChallenge || hasSundayChallenge) ? `<script src="/games/shared.js"></script>` : ''}
${hasDailyChallenge ? `
<script src="/games/daily-challenge.js"></script>
<script src="/games/compound.js"></script>
<script src="/games/match.js"></script>
<script src="/games/time-machine.js"></script>
<script src="/games/bull-bear.js"></script>
<script src="/games/price-is-right.js"></script>
` : ''}
${hasSundayChallenge ? `<script src="/games/sunday-challenge.js"></script>` : ''}

<script>
  // ---- Twinkling starfield ----
  const starsEl = document.getElementById('stars');
  for (let i = 0; i < 80; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDelay = Math.random() * 3 + 's';
    star.style.width = star.style.height = (Math.random() * 2 + 1) + 'px';
    starsEl.appendChild(star);
  }

  // ---- Word of Day tap-to-reveal — fires word-learned event ----
  function revealWord() {
    document.getElementById('word-card').classList.add('word-revealed');
    if (window.MarketJuice && window.MarketJuice.recordEvent) {
      window.MarketJuice.recordEvent('word-learned', {
        digestDate: window.__digestDate || null,
      });
    }
  }

  // ---- Phase 7: logout link ----
  // Tiny click handler instead of inline onclick="…" so the CSP-friendly
  // pattern matches the rest of the file. Hits /api/logout (POST → clears
  // the cookie) and bounces to /login.
  (function () {
    var el = document.getElementById('logout-link');
    if (!el) return;
    el.addEventListener('click', function (e) {
      e.preventDefault();
      fetch('/api/logout', { method: 'POST' })
        .catch(function () { /* ignore — cookie expiry will handle it */ })
        .finally(function () { location.href = '/login'; });
    });
  })();

  ${hasDailyChallenge ? `
  // ---- Daily Challenge (Phase 6.4) -------------------------------------
  // Inline quiz renderer — the quiz module isn't a standalone file (its
  // original implementation lived inline in this template). Registering on
  // window.MJGames.quiz so the picker can render quiz cards just like any
  // other game type. Mirrors public/games-preview.html's inline renderer.
  window.MJGames = window.MJGames || {};
  if (!window.MJGames.quiz) {
    window.MJGames.quiz = { render: function (host, data, opts) {
      var answered = false;
      host.innerHTML =
        '<div class="mj-card" id="qz-card">' +
          '<div class="mj-label">🧠 Daily Challenge · The Quiz</div>' +
          '<div class="mj-title">' + esc(data.question) + '</div>' +
          '<div id="qz-options" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;"></div>' +
          '<div class="mj-reveal" id="qz-reveal"></div>' +
        '</div>';
      var optHost = host.querySelector('#qz-options');
      data.options.forEach(function (opt, i) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'mj-btn'; b.textContent = opt;
        b.addEventListener('click', function () {
          if (answered) return;
          answered = true;
          var correct = i === data.correctIndex;
          Array.from(optHost.children).forEach(function (bb, j) {
            bb.disabled = true;
            if (j === data.correctIndex) bb.classList.add('mj-btn-correct');
            else if (j === i && !correct) bb.classList.add('mj-btn-wrong');
          });
          window.MJGames.shared.renderReveal(host.querySelector('#qz-card'), {
            resultKind: correct ? 'correct' : 'wrong',
            resultLabel: correct ? '🎯 Correct!' : '🤔 Not quite',
            headline: 'The lesson',
            body: '<p>' + esc(data.explanation || '') + '</p>',
            principle: data.principle || 7,
          });
          // Phase 12: inject the 💬 ask-parent button into the reveal panel
          // after answering. Skip on /sample (no parent email to deliver to).
          if (!window.__isSample) {
            var rev = host.querySelector('#qz-card .mj-reveal');
            if (rev) {
              var ap = document.createElement('button');
              ap.type = 'button';
              ap.className = 'mj-ask-parent-btn';
              ap.dataset.section = 'quiz';
              // dataset assigns raw strings; the browser handles attribute
              // serialization, so no HTML-escape needed here.
              ap.dataset.topic = "Today's quiz question";
              ap.textContent = '💬 Ask my parent about this';
              ap.onclick = function () { window.MarketJuice && window.MarketJuice.askParent(ap); };
              rev.appendChild(ap);
            }
          }
          if (opts && opts.onComplete) opts.onComplete({ correct: correct });
        });
        optHost.appendChild(b);
      });
      function esc(s){return String(s||'').replace(/[&<>"\\']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"\\'":'&#039;'}[c]);});}
    }};
  }

  // Today's hydrated bundle, baked in at generation time. The .replace below
  // escapes every '<' in the (AI-generated) data to \\u003c so a stray
  // close-script sequence can't break out of this inline script block.
  // NOTE: keep this comment free of literal script-tag sequences — the HTML
  // parser ends the element at the first close-script token even inside a JS
  // comment, which is exactly the bug this guards against.
  var __DC_BUNDLE = ${JSON.stringify({ games: dailyChallenge.games.map(g => ({ type: g.type, data: g.data })) }).replace(/</g, '\\u003c')};
  (function () {
    var host = document.getElementById('daily-challenge-host');
    if (!host || !window.MJGames || !window.MJGames.dailyChallenge) return;
    window.MJGames.dailyChallenge.render(host, __DC_BUNDLE, {});
  })();
  ` : ''}

  ${hasSundayChallenge ? `
  // ---- Sunday Challenge ----------------------------------------------
  // Same pattern as Daily Challenge: data baked in at render time, the
  // game module dispatches based on .type to the right sub-renderer.
  var __SC_DATA = ${JSON.stringify(sundayChallenge).replace(/</g, '\\u003c')};
  (function () {
    var host = document.getElementById('sunday-challenge-host');
    if (!host || !window.MJGames || !window.MJGames.sundayChallenge) return;
    window.MJGames.sundayChallenge.render(host, __SC_DATA, {});
  })();
  ` : ''}
</script>

</body>
</html>`;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
