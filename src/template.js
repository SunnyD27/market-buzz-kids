// src/template.js — Builds the final HTML page from generated content

export function buildHTML(content) {
  const {
    date, tradingDay, marketVibe, vibeEmoji, vibeSummary, vooNote, bigPicture,
    scoreboard, stories, comingUp, quiz, wordOfDay,
  } = content;

  const vibeColor = marketVibe === 'green' ? '#3fb950' : marketVibe === 'red' ? '#f85149' : '#f0c040';
  const vibeCircle = marketVibe === 'green' ? '🟢' : marketVibe === 'red' ? '🔴' : '🟡';

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
    </div>
  `).join('');

  const comingUpHTML = comingUp.map((item, i) => `
    <div class="upcoming-item" style="animation-delay: ${0.1 + i * 0.1}s">
      <div class="date-badge"><div class="day">${escapeHTML(item.day)}</div></div>
      <div class="upcoming-text">
        <h4>${escapeHTML(item.title)}</h4>
        <p>${escapeHTML(item.description)}</p>
      </div>
      <div class="upcoming-emoji">${item.emoji || '📅'}</div>
    </div>
  `).join('');

  const quizOptionsHTML = quiz.options.map((opt, i) => `
    <button class="quiz-btn" onclick="checkAnswer(this, ${i === quiz.correctIndex})">${escapeHTML(opt)}</button>
  `).join('');

  function scoreCard(key, label, isVoo = false) {
    const s = scoreboard[key];
    if (!s) return '';
    const dir = s.direction === 'up' ? 'up' : 'down';
    const arrow = s.direction === 'up' ? 'arrow-up' : 'arrow-down';
    const yourClass = isVoo ? ' yours' : '';
    const yourBadge = isVoo ? '<div class="your-badge">YOUR FUND</div>' : '';
    return `
      <div class="score-card ${dir}${yourClass}">
        ${yourBadge}
        <div class="name">${escapeHTML(label)}</div>
        <div class="price">${escapeHTML(s.price)}</div>
        <div class="change"><span class="${arrow}"></span> ${escapeHTML(s.change)}</div>
        <div class="vibe">${escapeHTML(s.vibe)}</div>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Market Buzz">
<link rel="apple-touch-icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📈</text></svg>">
<title>Market Buzz Daily</title>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
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
  .logo { font-size: 42px; font-weight: 700; background: linear-gradient(135deg, var(--blue), var(--purple), var(--yellow)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; letter-spacing: -1px; }
  .logo-emoji { font-size: 36px; -webkit-text-fill-color: initial; }
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
  .score-card.yours { background: linear-gradient(135deg, rgba(240,192,64,0.08), rgba(240,136,62,0.08)); border-color: rgba(240,192,64,0.4); box-shadow: 0 4px 24px rgba(240,192,64,0.15), inset 0 0 30px rgba(240,192,64,0.03); position: relative; }
  .score-card.yours:hover { box-shadow: 0 6px 28px rgba(240,192,64,0.25), inset 0 0 30px rgba(240,192,64,0.05); }
  .your-badge { font-family: 'Space Mono', monospace; font-size: 9px; letter-spacing: 2px; background: linear-gradient(135deg, var(--yellow), var(--orange)); color: #0d1117; padding: 3px 8px; border-radius: 6px; font-weight: 700; margin-bottom: 6px; display: inline-block; }
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
  .upcoming-list { display: flex; flex-direction: column; gap: 10px; animation: fadeIn 0.5s ease-out both; }
  .upcoming-item { background: var(--card); border: 1px solid var(--card-border); border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; transition: transform 0.2s; }
  .upcoming-item:hover { transform: translateX(4px); }
  .upcoming-item .date-badge { background: rgba(88,166,255,0.1); border: 1px solid rgba(88,166,255,0.2); border-radius: 10px; padding: 6px 10px; text-align: center; min-width: 52px; }
  .upcoming-item .date-badge .day { font-family: 'Space Mono', monospace; font-size: 11px; color: var(--blue); font-weight: 700; text-transform: uppercase; }
  .upcoming-item .upcoming-text { flex: 1; }
  .upcoming-item .upcoming-text h4 { font-size: 15px; font-weight: 600; color: var(--text-bright); margin-bottom: 2px; }
  .upcoming-item .upcoming-text p { font-size: 13px; color: var(--text-dim); line-height: 1.4; }
  .upcoming-item .upcoming-emoji { font-size: 24px; }
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

  <div class="header">
    <div class="logo"><span class="logo-emoji">📈</span> Market Buzz</div>
    <div class="date-line">${escapeHTML(date.toUpperCase())}</div>
    <div class="tagline">Your daily cheat code for the stock market</div>
  </div>

  <div class="section-header">
    <span class="emoji">🏆</span>
    <h2>Market Scoreboard</h2>
    <div class="line"></div>
  </div>

  <div class="scoreboard">
    ${scoreCard('sp500', 'S&P 500')}
    ${scoreCard('nasdaq', 'NASDAQ')}
    ${scoreCard('dow', 'DOW')}
    ${scoreCard('voo', 'VOO', true)}
  </div>

  <div class="vibe-bar">
    <p style="font-size: 16px; font-weight: 500; color: var(--text-bright);">
      ${vibeCircle} <strong>${marketVibe === 'green' ? 'Green day!' : marketVibe === 'red' ? 'Red day.' : 'Mixed day.'}</strong> ${escapeHTML(vibeSummary)}
    </p>
    <p style="font-size: 13px; color: var(--text-dim); margin-top: 10px;">
      ⭐ <strong style="color: var(--yellow);">VOO Watch:</strong> ${escapeHTML(vooNote)}
    </p>
  </div>

  <div class="big-picture">
    <div class="bp-header">
      <span class="emoji">🌎</span>
      <h3>The Big Picture</h3>
    </div>
    <p>${escapeHTML(bigPicture)}</p>
  </div>

  <div class="section-header">
    <span class="emoji">🔥</span>
    <h2>Today's Big Stories</h2>
    <div class="line"></div>
  </div>

  ${storiesHTML}

  <div class="section-header">
    <span class="emoji">📅</span>
    <h2>Coming Up</h2>
    <div class="line"></div>
  </div>

  <div class="upcoming-list">
    ${comingUpHTML}
  </div>

  <div class="section-header">
    <span class="emoji">🧠</span>
    <h2>Pop Quiz</h2>
    <div class="line"></div>
  </div>

  <div class="quiz-card">
    <div class="quiz-label">⚡ TEST YOUR KNOWLEDGE</div>
    <div class="quiz-question">${escapeHTML(quiz.question)}</div>
    <div class="quiz-options">
      ${quizOptionsHTML}
    </div>
    <div class="quiz-answer" id="quizAnswer">
      <strong>✅ ${escapeHTML(quiz.options[quiz.correctIndex])}!</strong> ${escapeHTML(quiz.explanation)}
    </div>
  </div>

  <div class="section-header">
    <span class="emoji">📖</span>
    <h2>Word of the Day</h2>
    <div class="line"></div>
  </div>

  <div class="word-card">
    <div class="word-label">🔤 INVESTING VOCABULARY</div>
    <div class="the-word">${escapeHTML(wordOfDay.word)}</div>
    <div class="word-type">${escapeHTML(wordOfDay.type)} · ${escapeHTML(wordOfDay.context)}</div>
    <div class="word-def">${escapeHTML(wordOfDay.definition)}</div>
  </div>

  <div class="footer">
    <div class="rocket">🚀</div>
    <p style="margin-top: 6px;">Market Buzz Daily — Built for future investors</p>
    <p style="margin-top: 4px; font-size: 11px; color: #484f58;">Not financial advice. Just getting smarter every day.</p>
  </div>

</div>

<script>
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

  const correctIdx = ${quiz.correctIndex};
  function checkAnswer(btn, isCorrect) {
    const buttons = document.querySelectorAll('.quiz-btn');
    buttons.forEach(b => { b.disabled = true; b.style.cursor = 'default'; });
    if (isCorrect) {
      btn.classList.add('correct');
    } else {
      btn.classList.add('wrong');
      buttons[correctIdx].classList.add('correct');
    }
    document.getElementById('quizAnswer').classList.add('visible');
  }
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
