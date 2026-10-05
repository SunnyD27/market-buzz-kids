import { SITE_ORIGIN } from './seo.js';
// src/learn-content.js
//
// Content data for the public, indexable /learn pages (SEO + answer-engine
// discoverability). Pure data — NO env reads, NO imports with side effects.
//
// The 11 principle names + one-line taglines match the "What they'll learn"
// grid in public/landing.html, INVESTING_PRINCIPLES in src/ai.js, and the
// PRINCIPLES map in public/games/shared.js. Keep all four in sync.
//
// Block format (rendered + HTML-escaped by src/learn.js):
//   'plain string'                      → <p>
//   { ul: ['item', ...] }               → <ul>
//   { ol: ['item', ...] }               → <ol>
//   { table: { caption, head: [...], rows: [[...], ...] } } → <table>
//   { math: 'line' }                    → highlighted arithmetic line
// Inline `**bold**` is the only markup allowed inside text; everything else
// is escaped. All arithmetic was verified in node (see scripts/test-learn.js,
// which re-checks the key numbers).
//
// Rules for this file: educational only. No individual stock picks, no
// "buy/sell" advice, no real kids' names or usernames. Example kids are
// clearly fictional placeholders.

export const SITE = {
  origin: SITE_ORIGIN,
  name: 'Market Juice',
  ageRange: '10-16',
  ageLabel: 'ages 10–16',
  ogImage: `${SITE_ORIGIN}/icons/logo.png`,
};

// Daily Challenge / digest games, as named in the product UI.
export const GAMES = {
  quiz: { name: 'The Quiz', what: 'the daily quiz at the top of every digest — every answer connects back to one of these principles' },
  compound: { name: 'Compound Machine', what: 'a Daily Challenge game where you drag a slider from 1 to 40 years and watch a starting amount grow' },
  bullBear: { name: 'Bull or Bear?', what: 'a Daily Challenge game where you look at an unlabeled real historical chart and guess whether it went up or down next' },
  match: { name: 'Match the Company', what: 'a Daily Challenge game where you match well-known companies to how they actually make money' },
  priceIsRight: { name: 'Price is Right', what: 'a Daily Challenge game where you guess what one share of a famous company costs — then learn what that share really is' },
  timeMachine: { name: 'Time Machine Trade', what: 'a Daily Challenge game where you pick one of four companies from a past year and see what $1,000 in each would be worth today' },
  mystery: { name: 'Mystery Mover', what: 'the daily guess-the-company puzzle, solved one clue at a time' },
};

export const PRINCIPLES = [
  {
    num: 1,
    slug: 'pay-yourself-first',
    name: 'Pay Yourself First',
    emoji: '💰',
    tagline: 'Save before you spend. The first dollar of every paycheck has your name on it.',
    title: 'Pay Yourself First: Saving Money for Kids | Market Juice',
    description: 'What "pay yourself first" means, explained for kids and teens with real allowance math, a common mistake, and quick check-yourself questions.',
    h1: 'Pay Yourself First: Save Before You Spend',
    whatItIs: 'Paying yourself first means that whenever money comes in — allowance, a birthday gift, a babysitting job — you set a slice aside for future-you before you spend anything else.',
    intro: [
      'Most people save whatever is left over at the end of the month. The problem? There is almost never anything left over. Money has a sneaky way of disappearing into snacks, game skins, and "just one more" purchases.',
      'Paying yourself first flips the order. Saving is not the leftovers — it is the **first bill you pay**, and the bill is to yourself.',
    ],
    example: {
      heading: 'Example: the $20-a-week chore money',
      blocks: [
        'Imagine a (made-up) kid named Sam who earns $20 a week doing chores. Sam decides that the moment the money arrives, $5 goes into a savings jar. That is 25% — one dollar out of every four. The other $15 is Sam\'s to spend however Sam wants, guilt-free.',
        { table: {
          caption: 'Saving $5 of every $20, week after week',
          head: ['Time', 'Saved', 'Still spent'],
          rows: [
            ['1 week', '$5', '$15'],
            ['1 month (4 weeks)', '$20', '$60'],
            ['1 year (52 weeks)', '$260', '$780'],
          ],
        } },
        'Now compare a "save what\'s left" plan. Sam spends first, planning to save the leftovers. Some weeks there is $2 left, most weeks there is $0. At the end of the year, the jar might hold $30 instead of $260.',
        'Same kid, same $20, same year. The only difference is the **order**.',
      ],
    },
    why: [
      'Paying yourself first turns saving into a habit instead of a decision. You don\'t have to be "good with money" every single day — you only have to make the choice once, when the money arrives.',
      'It also gives you something to invest. Every other principle on this site — compound growth, owning assets, staying consistent — needs a pile of savings to start with. This principle is how the pile gets built.',
    ],
    mistake: {
      heading: 'Common mistake: waiting until you earn "real money"',
      blocks: [
        'Lots of people think saving only matters once they have a big paycheck. But the habit matters more than the amount. Someone who saves $5 out of $20 at age 12 is practicing the exact same move as an adult saving $500 out of $2,000. The habit you build with small numbers is the one you keep when the numbers get bigger.',
      ],
    },
    check: [
      { q: 'Riley gets $40 for a birthday and wants to pay herself first by saving 25%. How much goes into savings?', a: '$10. 25% is one quarter, and $40 ÷ 4 = $10. The other $30 is free to spend.' },
      { q: 'Why does saving first work better than saving what is left over?', a: 'Because spending tends to grow to fill whatever money is available. If you save first, the savings are protected before spending starts.' },
      { q: 'If you save $3 every week for a year, how much will you have saved (before any growth)?', a: '$156, because there are 52 weeks in a year and 52 × $3 = $156.' },
    ],
    tryIt: { game: 'quiz', text: 'Pay Yourself First shows up in the daily quiz reveals — watch for it whenever a question is about saving.' },
    parents: 'Help your kid pick a percentage (10–25% is a common starting point) and move that amount into a separate jar or account the moment allowance or gift money arrives — the automatic part is what makes it stick.',
  },
  {
    num: 2,
    slug: 'compound-growth',
    name: 'Compound Growth',
    emoji: '🚀',
    tagline: 'Make your money work for you. Compound growth is the closest thing to magic in finance.',
    title: 'Compound Interest for Kids, Explained | Market Juice',
    description: 'Compound interest explained for kids and teens: how $100 can grow year by year, why starting early matters, the Rule of 72, and practice questions.',
    h1: 'Compound Growth for Kids: How Money Makes Money',
    whatItIs: 'Compound growth is what happens when your money earns a return, and then that return starts earning a return too — so the pile grows faster and faster over time.',
    intro: [
      'Think of a snowball rolling down a hill. At first it is small and picks up only a little snow. But the bigger it gets, the more snow it grabs with every roll. Money that compounds works the same way.',
    ],
    example: {
      heading: 'Example: $100 growing at 10% a year',
      blocks: [
        'Let\'s use a pretend growth rate of 10% per year, because it makes the math easy. (Real investments do not grow by the same amount every year — some years they go up a lot, some years they go down. 10% is just for practice.)',
        { table: {
          caption: '$100 compounding at 10% per year',
          head: ['After', 'Value', 'Growth that year'],
          rows: [
            ['Start', '$100.00', '—'],
            ['1 year', '$110.00', '$10.00'],
            ['2 years', '$121.00', '$11.00'],
            ['3 years', '$133.10', '$12.10'],
            ['10 years', '$259.37', '—'],
            ['20 years', '$672.75', '—'],
            ['30 years', '$1,744.94', '—'],
          ],
        } },
        'Notice that the growth each year keeps getting bigger: $10, then $11, then $12.10. That is because in year two you earn 10% on $110, not on $100. Your earnings are earning.',
        'Compare that to **simple** growth, where you only ever earn 10% of the original $100. That is $10 a year, every year. After 30 years you would have $100 + (30 × $10) = **$400**. Compounding turned the same $100 into about **$1,745**.',
        { math: 'Formula: final amount = starting amount × (1 + rate) ^ years  →  $100 × 1.10^30 ≈ $1,744.94' },
      ],
    },
    why: [
      'The biggest ingredient in compound growth is not how much money you start with — it is **time**. Look at what happens to the same $100 depending on when you start, using that same pretend 10% rate:',
      { ul: [
        'Invested for 40 years: about $4,525.93',
        'Invested for 50 years: about $11,739.09',
      ] },
      'Those extra 10 years more than doubled the result — without adding a single extra dollar. That is why kids and teens actually have a superpower adults don\'t: decades of time ahead of them.',
      'A handy shortcut is the **Rule of 72**: divide 72 by the yearly growth rate to estimate how many years it takes money to double. At 10%, 72 ÷ 10 = about 7.2 years. At 6%, 72 ÷ 6 = about 12 years.',
    ],
    mistake: {
      heading: 'Common mistake: pulling the money out early',
      blocks: [
        'Compounding is slow at the start and fast at the end. In the table above, the first 10 years added about $159, but years 20 to 30 added over $1,000. People who take their money out after a few years because "it\'s barely growing" quit right before the exciting part. Compounding also works in reverse on debt: if you owe money that charges interest, that interest can compound against you.',
      ],
    },
    check: [
      { q: 'You have $200 that grows 10% in one year. How much do you have after that year?', a: '$220. 10% of $200 is $20, and $200 + $20 = $220.' },
      { q: 'Using the Rule of 72, about how long does it take money to double at 8% a year?', a: 'About 9 years, because 72 ÷ 8 = 9.' },
      { q: 'Why does $100 grow more in year 3 than in year 1 at the same 10% rate?', a: 'Because in year 3 you earn 10% on a bigger amount ($121 instead of $100) — your earlier earnings are now earning too.' },
    ],
    tryIt: { game: 'compound', text: 'Drag the slider to 30 or 40 years and watch the curve bend upward — that bend is compounding.' },
    parents: 'The single most useful thing to show your kid is the "start early" comparison above: same money, same rate, more years — and ask them what they think would happen if they waited ten more years to start.',
  },
  {
    num: 3,
    slug: 'wealth-is-the-gap',
    name: 'Wealth Is the Gap',
    emoji: '🧾',
    tagline: 'Spend less than you earn. The bigger the gap, the faster wealth builds.',
    title: 'Wealth Is the Gap: Earning vs. Spending | Market Juice',
    description: 'Why wealth comes from the gap between what you earn and what you spend — explained for kids with simple math, a common mistake, and practice questions.',
    h1: 'Wealth Is the Gap Between Earning and Spending',
    whatItIs: 'Wealth is not how much money you make — it is the gap between what you earn and what you spend, saved up over time.',
    intro: [
      'It is easy to assume that people who earn a lot are automatically rich. But plenty of people with big paychecks have very little saved, because they spend nearly everything. And some people with ordinary paychecks build real wealth, because they keep a gap between earning and spending.',
    ],
    example: {
      heading: 'Example: two (made-up) kids with different jobs',
      blocks: [
        'Kid A walks dogs and earns $60 a month, but spends $57 of it. Kid B helps a neighbor garden and earns $40 a month, but spends only $30.',
        { table: {
          caption: 'Earning vs. keeping',
          head: ['', 'Earns per month', 'Spends per month', 'Gap per month', 'Gap after 1 year'],
          rows: [
            ['Kid A', '$60', '$57', '$3', '$36'],
            ['Kid B', '$40', '$30', '$10', '$120'],
          ],
        } },
        'Kid A earns 50% more money than Kid B, but Kid B ends the year with more than three times as much saved. The gap — not the paycheck — decides who builds wealth.',
        { math: 'Kid B: ($40 − $30) × 12 months = $120   ·   Kid A: ($60 − $57) × 12 months = $36' },
      ],
    },
    why: [
      'There are only two ways to make the gap bigger: **earn more** or **spend less**. Both work, and the best plans use both. Earning more can mean taking on an extra job, learning a skill, or starting a tiny business. Spending less can mean waiting a week before buying something, or asking "will I still care about this in a month?"',
      'The gap is also the fuel for everything else. Money in the gap is what you can pay yourself first with, what compounds, and what you can use to own assets.',
    ],
    mistake: {
      heading: 'Common mistake: lifestyle creep',
      blocks: [
        'When people start earning more, they often start spending more too — a fancier phone, more takeout, more subscriptions. This is called **lifestyle creep**, and it quietly keeps the gap the same size (or even shrinks it). A good habit: when your income goes up, decide ahead of time that part of the raise goes straight into the gap.',
      ],
    },
    check: [
      { q: 'You earn $50 a month and spend $35. What is your gap, and how much is that in a year?', a: 'The gap is $15 a month. Over 12 months that is $15 × 12 = $180.' },
      { q: 'Name the two ways to make the gap bigger.', a: 'Earn more, or spend less (or both).' },
      { q: 'Someone gets a raise from $1,000 to $1,200 a month, and their spending goes from $900 to $1,100. Did their gap grow?', a: 'No. It was $100 before ($1,000 − $900) and it is still $100 ($1,200 − $1,100). That is lifestyle creep.' },
    ],
    tryIt: { game: 'quiz', text: 'Look for Wealth Is the Gap in the daily quiz reveals — it often comes up when a story is about how companies or people spend.' },
    parents: 'Try a one-month experiment together: have your kid write down every dollar in and every dollar out, then look at the gap at the end of the month — the number is usually a surprise.',
  },
  {
    num: 4,
    slug: 'know-what-you-own',
    name: 'Know What You Own',
    emoji: '🔍',
    tagline: 'Invest in what you understand. Know how a company actually makes money.',
    title: 'Know What You Own: How Companies Make Money | Market Juice',
    description: 'Teach kids to understand an investment before owning it: how businesses make money, revenue vs. profit with simple math, and a quick self-check.',
    h1: 'Know What You Own: How Does a Company Make Money?',
    whatItIs: 'Knowing what you own means you can explain, in plain words, how a business makes money before you ever think about investing in it.',
    intro: [
      'A famous rule among investors goes something like this: if you can\'t explain what a company does to a friend in two sentences, you probably don\'t understand it well enough to own it. A stock ticker is not just a symbol that moves up and down — behind it is a real business with customers, costs, and (hopefully) profits.',
    ],
    example: {
      heading: 'Example: the juice stand',
      blocks: [
        'Let\'s look at the simplest business there is: a juice stand. Each cup sells for $2. The cup, the fruit, and the ice cost about $0.50 per cup.',
        { table: {
          caption: 'A Saturday at the juice stand (40 cups sold)',
          head: ['', 'Per cup', '40 cups'],
          rows: [
            ['Revenue (money coming in)', '$2.00', '$80.00'],
            ['Costs (money going out)', '$0.50', '$20.00'],
            ['Profit (what is left)', '$1.50', '$60.00'],
          ],
        } },
        'That is the whole idea: **revenue minus costs equals profit**. Every company — from a juice stand to a giant tech company — runs on this same math. Some earn money by selling products, some by charging subscriptions, some by showing ads, and some by taking a small fee every time someone pays.',
      ],
    },
    why: [
      'When you understand how a business makes money, the news starts to make sense. If you know a company earns most of its money from subscriptions, a headline like "subscribers dropped this quarter" suddenly matters. If you don\'t know, it is just noise.',
      'Understanding what you own also helps you stay calm. People who don\'t know why they own something tend to sell in a panic the moment the price drops. People who understand the business can ask a better question: did anything actually change about how this company makes money?',
      'Before owning any investment, try answering these questions:',
      { ol: [
        'Who are the customers?',
        'What do they pay for?',
        'What does it cost the company to provide it?',
        'Why would customers keep coming back instead of going to a competitor?',
      ] },
    ],
    mistake: {
      heading: 'Common mistake: owning a name, not a business',
      blocks: [
        'Lots of people want to invest in a company just because they like its products or have heard its name a lot. Liking a product is a fine place to start your research — but it is not the same as understanding the business. A brand everyone loves can still lose money if its costs are higher than its revenue.',
      ],
    },
    check: [
      { q: 'A bake sale sells 30 cookies at $1 each. Ingredients cost $9 total. What is the profit?', a: '$21. Revenue is 30 × $1 = $30, and $30 − $9 = $21.' },
      { q: 'What is the difference between revenue and profit?', a: 'Revenue is all the money coming in from customers. Profit is what is left after paying the costs.' },
      { q: 'Name two different ways a company can make money.', a: 'Any two of: selling products, charging subscriptions, selling ads, charging fees on transactions, renting things out, providing services.' },
    ],
    tryIt: { game: 'match', text: 'Match well-known companies to how they really make money — it is this principle, turned into a game.' },
    parents: 'Next time you pay for something together — a streaming service, a grocery run, a ride — ask your kid "how does this company make money from what we just did?" and let them guess before you answer.',
  },
  {
    num: 5,
    slug: 'diversify',
    name: 'Diversify',
    emoji: '🧺',
    tagline: 'Don\'t put all your eggs in one basket. Spread risk across many things.',
    title: 'Diversification for Kids: Spread Your Eggs | Market Juice',
    description: 'What diversification means, explained for kids and teens with simple math showing how spreading money across many companies reduces risk.',
    h1: 'Diversify: Don\'t Put All Your Eggs in One Basket',
    whatItIs: 'Diversifying means spreading your money across many different investments, so that one bad surprise can\'t wipe you out.',
    intro: [
      'Picture carrying a dozen eggs in one basket. If you trip, every egg breaks. Now picture the eggs split across ten baskets. Trip once, and you lose one basket — the rest are fine. That is diversification.',
    ],
    example: {
      heading: 'Example: $100 in one company vs. $100 across ten',
      blocks: [
        'Imagine you have $100 to invest. In Plan 1, you put all $100 into a single company. In Plan 2, you put $10 into each of ten different companies.',
        'Now something bad happens: one company runs into serious trouble and its shares become worth nothing.',
        { table: {
          caption: 'What happens if one company goes to $0',
          head: ['', 'Plan 1: one company', 'Plan 2: ten companies'],
          rows: [
            ['Money lost', '$100 (if it was your one company)', '$10'],
            ['Money left (others flat)', '$0', '$90'],
            ['Money left (others grow 5%)', '$0', '$94.50'],
          ],
        } },
        { math: 'Plan 2, others grow 5%: 9 companies × $10 × 1.05 = $94.50' },
        'Of course, if your one company had done amazingly well, Plan 1 would have won. That is the trade-off: diversification gives up the chance of a giant win from one lucky pick in exchange for protection against a giant loss. Since nobody can reliably predict which company will soar, most long-term investors choose protection.',
      ],
    },
    why: [
      'Even great companies can stumble. Products go out of style, competitors show up, and surprises happen that nobody saw coming. Diversification means you don\'t have to be right about everything — you just need the whole group to do okay over time.',
      'One common way people diversify is with an **index fund**, which holds small pieces of many companies at once. For example, a fund that tracks the S&P 500 holds roughly 500 large U.S. companies, so one share of the fund spreads your money across all of them.',
      'Real diversification also means spreading across different **kinds** of businesses. Owning ten companies that all sell the same thing is closer to one basket than ten.',
    ],
    mistake: {
      heading: 'Common mistake: "I\'m diversified — I own five tech companies"',
      blocks: [
        'If all your investments are in the same industry, they often rise and fall together. Bad news for that industry hits every basket at once. Spreading across different industries — food, healthcare, energy, technology, and more — is what actually reduces risk.',
      ],
    },
    check: [
      { q: 'You split $50 equally across 5 companies. One goes to $0 and the others stay the same. How much do you have left?', a: '$40. Each company got $10, and you lost one $10 slice, so 4 × $10 = $40.' },
      { q: 'What is the trade-off of diversifying?', a: 'You give up the chance of a huge win from one single pick in exchange for protection from a huge loss.' },
      { q: 'Why is owning five companies in the same industry not very diversified?', a: 'Because companies in the same industry are often hit by the same news, so they tend to go up and down together.' },
    ],
    tryIt: { game: 'timeMachine', text: 'In Time Machine Trade, see how four companies from the same starting year ended up in very different places — a strong case for not betting everything on one.' },
    parents: 'Ask your kid what would happen to a lemonade stand that only sold lemonade if a lemon shortage hit — then ask what a stand that also sold cookies and water would do.',
  },
  {
    num: 6,
    slug: 'be-patient',
    name: 'Be Patient',
    emoji: '⏳',
    tagline: 'Think in years, not days. Markets reward people who can sit still.',
    title: 'Be Patient: Long-Term Investing for Kids | Market Juice',
    description: 'Why patience matters in investing, explained for kids and teens: ups and downs, the math of recovering from a drop, and why time helps.',
    h1: 'Be Patient: Think in Years, Not Days',
    whatItIs: 'Being patient means judging an investment over many years instead of reacting to what it does today, this week, or this month.',
    intro: [
      'Day to day, the stock market can look like a messy scribble — up one day, down the next, often for reasons nobody fully understands. But zoom out to years or decades, and the picture usually looks very different. Patience is the skill of zooming out.',
    ],
    example: {
      heading: 'Example: a bumpy four-year ride',
      blocks: [
        'Here is a made-up investment that starts at $100 and has a bumpy few years:',
        { table: {
          caption: 'A pretend investment, year by year',
          head: ['Year', 'What happened', 'Value at year end'],
          rows: [
            ['Start', '—', '$100.00'],
            ['Year 1', 'Down 10%', '$90.00'],
            ['Year 2', 'Up 20%', '$108.00'],
            ['Year 3', 'Up 15%', '$124.20'],
            ['Year 4', 'Down 5%', '$117.99'],
          ],
        } },
        'Someone who panicked after year 1 and sold would have locked in a loss at $90. Someone who waited ended year 4 at about $118 — even with two down years along the way.',
        'There\'s a sneaky bit of math hiding here too. When something drops, it takes a **bigger** percentage gain to get back to where it started:',
        { ul: [
          'Down 20% ($100 → $80) needs up 25% to recover ($80 × 1.25 = $100).',
          'Down 50% ($100 → $50) needs up 100% to recover ($50 × 2 = $100).',
        ] },
        'That is why patient investors care about having enough time for recoveries to happen.',
      ],
    },
    why: [
      'Short-term moves are mostly noise — reactions to headlines, rumors, and moods. Long-term moves tend to follow something more solid: whether businesses grow their profits over time. Patience lets you ride on the solid part instead of getting thrown around by the noise.',
      'Patience is also what lets compound growth do its job. Compounding needs years. Every time you jump in and out, you interrupt it.',
    ],
    mistake: {
      heading: 'Common mistake: checking the price every day',
      blocks: [
        'Checking an investment\'s price constantly makes the normal ups and downs feel huge and scary, which makes it more tempting to do something rash. Many long-term investors check far less often on purpose. Down days and down years are a normal part of investing, not a sign that something is broken.',
      ],
    },
    check: [
      { q: 'An investment drops from $200 to $150. What percentage did it fall?', a: '25%. It lost $50, and $50 ÷ $200 = 0.25, or 25%.' },
      { q: 'After that drop, what percentage gain does it need to get back to $200?', a: 'About 33.3%. It needs to gain $50 on $150, and $50 ÷ $150 ≈ 0.333.' },
      { q: 'Why does patience help compound growth?', a: 'Because compounding needs many years to build up, and jumping in and out interrupts it.' },
    ],
    tryIt: { game: 'bullBear', text: 'Bull or Bear? shows you real historical chart shapes — notice how often a scary dip was just a bump in a longer trend, and how often it wasn\'t. Nobody can call the short term.' },
    parents: 'If markets have a rough week, that is a great moment to ask your kid what a patient investor would do — and to talk about the difference between a business getting worse and a price just bouncing around.',
  },
  {
    num: 7,
    slug: 'control-your-emotions',
    name: 'Control Your Emotions',
    emoji: '🧘',
    tagline: 'Don\'t follow the crowd. The best decisions feel boring at the time.',
    title: 'Control Your Emotions: FOMO, Fear & Investing for Kids',
    description: 'How fear and FOMO lead to bad money decisions, explained for kids and teens with a simple buy-high, sell-low example and practice questions.',
    h1: 'Control Your Emotions: Don\'t Let FOMO or Fear Decide',
    whatItIs: 'Controlling your emotions means making money decisions with a plan instead of with excitement, fear, or the feeling that everyone else is doing it.',
    intro: [
      'Two feelings cause a huge number of bad investing decisions. The first is **FOMO** — the fear of missing out — when something is soaring and everybody is talking about it. The second is **panic** — when something is falling and it feels like it will never stop. Both feelings push people to do exactly the wrong thing at exactly the wrong time.',
    ],
    example: {
      heading: 'Example: the buy-high, sell-low trap',
      blocks: [
        'Imagine a (made-up) investment that everyone at school is suddenly talking about. Its price has shot up to $50 a share. A kid named Jordan feels the FOMO, uses $200 of savings, and buys 4 shares at $50.',
        { ul: [
          'A few weeks later, the hype fades and the price drops to $35. Jordan\'s 4 shares are now worth 4 × $35 = $140.',
          'Jordan panics and sells — locking in a $60 loss ($200 − $140).',
          'Months later, the price climbs back to $50. If Jordan had held on, the shares would be worth $200 again.',
        ] },
        'Notice that the investment itself ended up right where it started. The loss came entirely from the emotional timing: buying when excitement was highest, and selling when fear was highest. That is **buying high and selling low** — the exact opposite of the goal.',
      ],
    },
    why: [
      'Markets are made of people, and people get excited and scared together. When everyone is excited, prices can run far above what things are worth. When everyone is scared, prices can drop far below. Investors who stay calm are the ones who are not forced into bad trades by the crowd\'s mood.',
      'A few tools that help:',
      { ul: [
        'Have a plan before you invest — what you\'re buying, why, and how long you expect to hold it.',
        'Use a cooling-off rule: wait 48 hours before any money decision you feel excited or scared about.',
        'Ask: "Did something about the business actually change, or just the price and the mood?"',
      ] },
    ],
    mistake: {
      heading: 'Common mistake: thinking "everyone is buying it" means it\'s safe',
      blocks: [
        'Popularity is not the same as value. By the time something is being talked about everywhere, a lot of the excitement is often already baked into the price. The best decisions often feel boring — or even a little uncomfortable — when you make them.',
      ],
    },
    check: [
      { q: 'What does FOMO stand for, and how can it hurt investors?', a: 'Fear Of Missing Out. It pushes people to buy after prices have already jumped, often near a peak.' },
      { q: 'You buy 5 shares at $20 and sell them at $16. How much did you lose?', a: '$20. You paid 5 × $20 = $100 and sold for 5 × $16 = $80, so $100 − $80 = $20.' },
      { q: 'Name one tool for keeping emotions out of money decisions.', a: 'Any of: having a plan before investing, a cooling-off waiting period, or asking whether the business actually changed.' },
    ],
    tryIt: { game: 'bullBear', text: 'In Bull or Bear?, notice your gut reaction to each chart before you guess — then see how often that gut feeling was right.' },
    parents: 'Share a time you bought something in the excitement of the moment and regretted it — kids learn emotional discipline far better from a parent\'s real story than from a rule.',
  },
  {
    num: 8,
    slug: 'think-like-an-owner',
    name: 'Think Like an Owner',
    emoji: '🏛️',
    tagline: 'Stocks are real businesses. Buying a share = owning a slice of a company.',
    title: 'What Is a Stock? Think Like an Owner | Market Juice',
    description: 'What a share of stock really is, explained for kids and teens: owning a slice of a real business, with simple ownership math and practice questions.',
    h1: 'Think Like an Owner: What a Share of Stock Really Is',
    whatItIs: 'Thinking like an owner means remembering that a share of stock is a real piece of ownership in a real business — not just a number that bounces around on a screen.',
    intro: [
      'When you buy a share of a company, you become a part-owner of that company. It is a very small part, but it is real. If the company earns more money over time, the slice you own becomes more valuable. If the business struggles, your slice is worth less.',
    ],
    example: {
      heading: 'Example: your slice of the pizza',
      blocks: [
        'Think of a company as a giant pizza cut into lots of equal slices — those slices are its shares. Imagine a (made-up) company split into 1,000,000 shares. You buy 10 of them.',
        { math: 'Your ownership: 10 ÷ 1,000,000 = 0.00001 = 0.001% of the company' },
        'That sounds tiny — and it is! But it is still real. Now suppose the company makes $2,000,000 in profit this year. Your share of that profit is:',
        { math: '$2,000,000 × (10 ÷ 1,000,000) = $20' },
        'The company might pay some of that profit to owners as a **dividend**, or it might reinvest it to grow the business — building new products, opening new locations, hiring people. Either way, as an owner, that profit belongs partly to you.',
      ],
    },
    why: [
      'People who think like owners ask owner questions: Is this business growing? Do customers love it? Is it making more profit than it did a few years ago? Those questions point you toward long-term value.',
      'People who think like gamblers ask a different question: will the price go up tomorrow? That question is nearly impossible to answer and tends to lead to stress and bad decisions.',
      'Thinking like an owner also connects to the other principles: you will want to know what you own (Principle 4), be patient while the business grows (Principle 6), and pay attention to value, not just price (Principle 10).',
    ],
    mistake: {
      heading: 'Common mistake: treating stocks like lottery tickets',
      blocks: [
        'If you only ever look at a stock\'s price chart, it is easy to forget there is a business behind it. A real owner of a local bakery wouldn\'t sell their share of the shop just because someone offered a slightly lower price one afternoon. They would think about how the bakery is doing. Stock owners can think the same way.',
      ],
    },
    check: [
      { q: 'A company has 500 shares and you own 5. What percentage of the company do you own?', a: '1%. 5 ÷ 500 = 0.01, which is 1%.' },
      { q: 'If that company earns $10,000 in profit, what is your slice?', a: '$100. 1% of $10,000 is $100.' },
      { q: 'What is the difference between an owner question and a gambler question?', a: 'An owner asks how the business is doing over time; a gambler asks whether the price will go up tomorrow.' },
    ],
    tryIt: { game: 'priceIsRight', text: 'Price is Right asks you to guess what one share of a famous company costs — then reminds you that the share is a sliver of a real business.' },
    parents: 'Pick a business your family uses often and ask your kid: "If we owned a tiny slice of this company, what would make our slice worth more in five years?"',
  },
  {
    num: 9,
    slug: 'stay-consistent',
    name: 'Stay Consistent',
    emoji: '📆',
    tagline: 'Regular investing beats perfect timing. Same amount, every month, for years.',
    title: 'Dollar-Cost Averaging for Kids | Market Juice',
    description: 'Why investing the same amount on a regular schedule beats trying to time the market — explained for kids with a dollar-cost averaging example.',
    h1: 'Stay Consistent: Why Regular Investing Beats Perfect Timing',
    whatItIs: 'Staying consistent means investing the same amount on a regular schedule — like every month — no matter what the market is doing.',
    intro: [
      'Lots of people try to invest at the "perfect" moment — right before prices go up. The problem is that nobody knows when that moment is, not even professionals. Consistent investing skips the guessing game entirely.',
    ],
    example: {
      heading: 'Example: $30 a month for three months',
      blocks: [
        'Imagine you invest $30 every month into a (made-up) fund, no matter what. The price per share bounces around:',
        { table: {
          caption: 'Investing the same $30 at different prices',
          head: ['Month', 'Price per share', 'You invest', 'Shares you get'],
          rows: [
            ['Month 1', '$10', '$30', '3'],
            ['Month 2', '$6', '$30', '5'],
            ['Month 3', '$15', '$30', '2'],
            ['Total', '—', '$90', '10'],
          ],
        } },
        { math: 'Your average cost: $90 ÷ 10 shares = $9.00 per share' },
        { math: 'The average price over those months: ($10 + $6 + $15) ÷ 3 ≈ $10.33' },
        'Because the same $30 buys **more** shares when the price is low and **fewer** when it is high, your average cost ended up lower than the average price. This approach has a name: **dollar-cost averaging**. When the price dropped in month 2, it was actually a chance to buy more.',
      ],
    },
    why: [
      'Consistency turns investing into a routine, like brushing your teeth. You don\'t need to watch the news or guess what will happen next. You just keep going.',
      'It also adds up. $25 a month is $300 a year. Over five years, that is $1,500 put to work — and with compound growth on top, the total can grow to be more than what you put in, though it is never guaranteed.',
      'Consistency is also a great defense against the emotional mistakes in Principle 7. If your plan is "same amount, every month," there is nothing to panic about and nothing to chase.',
    ],
    mistake: {
      heading: 'Common mistake: stopping when prices drop',
      blocks: [
        'When prices fall, it feels natural to pause and "wait until things look better." But look back at the example: the month with the lowest price was the month your $30 bought the most shares. People who stop investing during dips miss the cheapest buying they will get.',
      ],
    },
    check: [
      { q: 'You invest $20 when the price is $5 and $20 when the price is $4. How many shares do you own?', a: '9 shares. $20 ÷ $5 = 4 shares, and $20 ÷ $4 = 5 shares, so 4 + 5 = 9.' },
      { q: 'If you invest $15 every month for 2 years, how much have you put in?', a: '$360, because 2 years is 24 months and 24 × $15 = $360.' },
      { q: 'What is dollar-cost averaging?', a: 'Investing the same amount on a regular schedule, so you automatically buy more shares when prices are low and fewer when they are high.' },
    ],
    tryIt: { game: 'compound', text: 'Compound Machine shows what a single amount can grow into over time — now imagine adding to it every single month.' },
    parents: 'If your kid saves regularly, help them pick a fixed amount and a fixed day of the month — the point is the routine, so make it automatic and boring.',
  },
  {
    num: 10,
    slug: 'price-vs-value',
    name: 'Price vs Value',
    emoji: '🏷️',
    tagline: 'Expensive isn\'t always valuable. The price is what you pay; value is what you get.',
    title: 'Price vs. Value: A Lesson for Kids and Teens | Market Juice',
    description: 'Why a high share price doesn\'t mean a company is worth more — price vs. value explained for kids with simple math and practice questions.',
    h1: 'Price vs. Value: What You Pay vs. What You Get',
    whatItIs: 'Price is the number you pay for something; value is what that thing is actually worth to you — and the two are not always the same.',
    intro: [
      'A pair of sneakers can cost $200 and fall apart in six months. Another pair can cost $60 and last two years. The price tag alone doesn\'t tell you which one is the better deal. Investing works the same way.',
    ],
    example: {
      heading: 'Example: the "expensive" share that isn\'t',
      blocks: [
        'Many people think a $400 share must belong to a bigger, more valuable company than a $20 share. Not necessarily! What matters is how many shares the company is split into. Here are two made-up companies:',
        { table: {
          caption: 'Share price vs. total company value',
          head: ['', 'Price per share', 'Number of shares', 'Total value of the company'],
          rows: [
            ['Company A', '$400', '10 million', '$4 billion'],
            ['Company B', '$20', '500 million', '$10 billion'],
          ],
        } },
        { math: 'Company A: $400 × 10,000,000 = $4,000,000,000   ·   Company B: $20 × 500,000,000 = $10,000,000,000' },
        'Company B has the "cheaper" share, but the whole company is worth more than twice as much. A share price is just one slice — you have to know how many slices there are.',
        'Investors also compare price to **what you get for it**. Suppose one share costs $20 and the company earns $1 per share each year. Another share costs $50 and earns $5 per share each year. The first gives you 5¢ of yearly earnings for every $1 you pay ($1 ÷ $20). The second gives you 10¢ for every $1 ($5 ÷ $50). The pricier share is the better value in this example.',
      ],
    },
    why: [
      'Understanding the difference between price and value protects you from two traps: thinking something is a bargain just because the number is small, and thinking something is great just because it is expensive or popular.',
      'It also helps during market drops. If a business is still healthy but its price falls because everyone is scared, the price went down but the value may not have. Thinking about value is how investors stay calm when prices swing.',
    ],
    mistake: {
      heading: 'Common mistake: "It\'s only $2 a share, so it\'s cheap!"',
      blocks: [
        'A low share price does not mean a good deal. A share can cost $2 because the company is struggling, or simply because it is split into a huge number of shares. "Cheap" only means something when you compare the price to what the business actually earns or owns.',
      ],
    },
    check: [
      { q: 'A company has 2 million shares priced at $30 each. What is the whole company worth?', a: '$60 million, because 2,000,000 × $30 = $60,000,000.' },
      { q: 'Does a higher share price always mean a bigger company?', a: 'No. Total value depends on price per share times the number of shares.' },
      { q: 'Share X costs $40 and earns $2 per share a year. Share Y costs $10 and earns $1. Which gives more earnings per dollar paid?', a: 'Share Y. X gives $2 ÷ $40 = 5¢ per dollar; Y gives $1 ÷ $10 = 10¢ per dollar.' },
    ],
    tryIt: { game: 'priceIsRight', text: 'Price is Right is all about share prices — use it to practice remembering that a price tag is not the same as what a business is worth.' },
    parents: 'At the store, compare two similar items and ask your kid which is the better value, not just the cheaper price — then talk about what "value" meant in that choice.',
  },
  {
    num: 11,
    slug: 'own-assets',
    name: 'Own Assets',
    emoji: '🏠',
    tagline: 'Make money while you sleep. Own things that pay you — not just stuff that sits.',
    title: 'Assets vs. Stuff: Own Things That Pay You | Market Juice',
    description: 'The difference between assets and stuff, explained for kids and teens: things that earn money vs. things that lose value, with real examples and math.',
    h1: 'Own Assets: Things That Pay You vs. Stuff That Sits',
    whatItIs: 'An asset is something you own that can earn money or grow in value over time, while "stuff" usually loses value from the moment you buy it.',
    intro: [
      'Most things people buy — clothes, gadgets, games — are worth less the day after you buy them. That\'s fine; life should include fun stuff! But people who build wealth also own **assets**: things that keep earning money for them, sometimes even while they sleep.',
    ],
    example: {
      heading: 'Example: the lawn mower vs. the game console',
      blocks: [
        'Imagine a teen with $150 to spend. Option 1 is a game console. Option 2 is a used lawn mower to start a mowing business, charging $25 per lawn.',
        'The console is fun, but it doesn\'t earn anything, and in a couple of years it will probably sell for much less than $150.',
        'The mower is a tool that earns. Say gas and upkeep cost about $3 per lawn, so each lawn brings in $22 of profit:',
        { table: {
          caption: 'Paying back a $150 mower at $22 profit per lawn',
          head: ['Lawns mowed', 'Profit so far', 'Mower paid off?'],
          rows: [
            ['6', '$132', 'Not yet'],
            ['7', '$154', 'Yes — and $4 extra'],
            ['20', '$440', 'Yes — $290 beyond the mower\'s cost'],
          ],
        } },
        'After about 7 lawns, the mower has paid for itself, and every lawn after that is profit. That is what makes it an asset: it keeps producing money long after you buy it.',
      ],
    },
    why: [
      'Examples of assets adults own include shares of companies (which may pay **dividends** and can grow in value), rental property, a business, or savings that earn interest. Each one can bring money in without you trading more hours of your time for it.',
      'Your skills are an asset too. Learning to code, cook, fix bikes, tutor, or design can keep paying you for years. At your age, investing in skills might be the highest-return asset of all.',
      'Assets also connect to compounding. When an asset pays you and you reinvest that money into more assets, you get the snowball effect from Principle 2.',
    ],
    mistake: {
      heading: 'Common mistake: calling everything you buy an "investment"',
      blocks: [
        'People sometimes justify a purchase by calling it an investment — "these shoes are an investment!" A good test: will this thing put money into my pocket or grow in value over time? If not, it\'s a purchase, which is totally okay — just be honest with yourself about which is which. Also remember that assets have risks: a business can fail and investments can lose value.',
      ],
    },
    check: [
      { q: 'What is the difference between an asset and "stuff"?', a: 'An asset can earn money or grow in value over time; stuff usually loses value after you buy it.' },
      { q: 'A $60 sewing kit lets you fix clothes for $12 each, with $2 of supplies per job. How many jobs to pay it off?', a: '6 jobs. Each job earns $10 of profit ($12 − $2), and $60 ÷ $10 = 6.' },
      { q: 'Name one asset you can build that isn\'t money.', a: 'A skill — like coding, tutoring, cooking, or repairs — that can keep earning you money over time.' },
    ],
    tryIt: { game: 'quiz', text: 'Watch for Own Assets in the daily quiz reveals — especially in stories about how companies earn money from what they own.' },
    parents: 'Go through a few things in your home with your kid and sort them into "pays us" (or grows in value) versus "costs us" — it is a surprisingly eye-opening five-minute game.',
  },
];

// Hub page copy.
export const HUB = {
  path: '/learn',
  title: 'Investing Basics for Kids: 11 Principles | Market Juice',
  description: 'Free investing lessons for kids and teens ages 10–16: compound growth, diversification, saving, and 8 more principles with real math and practice.',
  h1: 'Investing Basics for Kids: 11 Principles',
  intro: [
    'Investing can sound like something only adults in suits do. It isn\'t. The ideas that build wealth over a lifetime are simple enough to learn at 10 — and the earlier you learn them, the more time they have to work for you.',
    'These 11 principles are the backbone of Market Juice. Every game, every quiz reveal, and every story in the daily digest connects back to one of them. Each lesson below explains one idea in plain language, works through a real example with real numbers, and ends with a few questions so you can check yourself.',
  ],
};

// Parents page copy is structured enough that it lives in learn.js as
// markup-light blocks; the facts it states are sourced from public/privacy.html,
// public/landing.html and CONTEXT.md (Phase 12 evening recap, 5+2 editions).
export const PARENTS = {
  path: '/parents',
  title: 'Teaching Kids About Money & Investing: Parent\'s Guide',
  description: 'A parent\'s guide to Market Juice: a free 3-minute daily investing lesson for kids 10–16, what they learn, how privacy works, and conversation starters.',
  h1: 'Teaching Kids About Money and Investing — a Parent\'s Guide to Market Juice',
};
