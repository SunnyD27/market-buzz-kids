/**
 * src/calendar.js — Edition type resolver.
 *
 * Determines what KIND of digest to generate based on the current NY-local
 * calendar date. The 5+2 model:
 *
 *   Tuesday–Saturday (normal):       'standard'      — covers previous trading day
 *   Sunday:                          'weekly-wrap'   — recap of the full week
 *   Monday:                          'week-ahead'    — preview of the upcoming week
 *   Day after a market holiday:      'week-ahead'    — preview (post-holiday reason)
 *
 * The day-of-week check uses the America/New_York date (formatted via
 * Intl.DateTimeFormat), not the server's local clock, so this works the
 * same in any container timezone.
 *
 * DATE_OVERRIDE support: setting the DATE_OVERRIDE env var to a YYYY-MM-DD
 * string lets tests pretend "today" is a different day without mocking
 * Date globally. The override is parsed at noon UTC so DST never shifts
 * the day boundary by accident.
 */

// ── NYSE market holidays (full-closure dates only) ────────────────────
// Update annually. Source: https://www.nyse.com/markets/hours-calendars
// Each year is a YYYY-MM-DD array. Half-days (early closes for Christmas
// Eve, day after Thanksgiving) are NOT included — markets still trade
// those days, so they behave like normal weekdays.
export const MARKET_HOLIDAYS = {
  2026: [
    '2026-01-01', // New Year's Day
    '2026-01-19', // MLK Jr. Day
    '2026-02-16', // Washington's Birthday (Presidents' Day)
    '2026-04-03', // Good Friday
    '2026-05-25', // Memorial Day
    '2026-06-19', // Juneteenth
    '2026-07-03', // Independence Day (observed — July 4 is Saturday)
    '2026-09-07', // Labor Day
    '2026-11-26', // Thanksgiving
    '2026-12-25', // Christmas
  ],
  2027: [
    '2027-01-01', // New Year's Day
    '2027-01-18', // MLK Jr. Day
    '2027-02-15', // Washington's Birthday
    '2027-03-26', // Good Friday
    '2027-05-31', // Memorial Day
    '2027-06-18', // Juneteenth (observed — June 19 is Saturday)
    '2027-07-05', // Independence Day (observed — July 4 is Sunday)
    '2027-09-06', // Labor Day
    '2027-11-25', // Thanksgiving
    '2027-12-24', // Christmas (observed — Dec 25 is Saturday)
  ],
};

// Display names for holidays, used in post-holiday vibeSummary copy.
const HOLIDAY_NAMES = {
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'MLK Jr. Day',
  '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving',
  '2026-12-25': 'Christmas',
  '2027-01-01': "New Year's Day",
  '2027-01-18': 'MLK Jr. Day',
  '2027-02-15': "Presidents' Day",
  '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth',
  '2027-07-05': 'Independence Day',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving',
  '2027-12-24': 'Christmas',
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Date helpers ──────────────────────────────────────────────────────

/**
 * Get a Date object honoring DATE_OVERRIDE (for testing). Parses at noon
 * UTC so DST shifts can never flip the day.
 */
function now() {
  if (process.env.DATE_OVERRIDE) {
    return new Date(process.env.DATE_OVERRIDE + 'T12:00:00Z');
  }
  return new Date();
}

/**
 * Format a Date as YYYY-MM-DD in America/New_York. Stable, sortable, and
 * matches the digest-store's daily_digests.digest_date primary key.
 */
function toNYDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/**
 * Day-of-week (0 = Sunday … 6 = Saturday) for the given Date interpreted
 * in America/New_York. Works by parsing the NY-date back as a noon-UTC
 * timestamp so the day index never crosses a boundary.
 */
function dayOfWeekNY(date) {
  const dateStr = toNYDateString(date);
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

/**
 * The current edition date as a YYYY-MM-DD string in America/New_York.
 * Use this everywhere instead of digest-store's todayNY() when you want
 * DATE_OVERRIDE support — generate.js needs it for the DB primary key
 * during tests so the override row goes to the right date.
 */
export function getEditionDate() {
  return toNYDateString(now());
}

/**
 * Returns true if the given YYYY-MM-DD string is a full-closure NYSE
 * market holiday.
 */
export function isMarketHoliday(dateStr) {
  const year = dateStr.slice(0, 4);
  const list = MARKET_HOLIDAYS[year];
  return !!list && list.includes(dateStr);
}

/**
 * Display name for a holiday date string ('Memorial Day', 'Thanksgiving').
 * Returns null if the date isn't in our holiday map.
 */
export function getHolidayName(dateStr) {
  return HOLIDAY_NAMES[dateStr] || null;
}

/**
 * Walks backward from `date` until it finds a weekday that's NOT a market
 * holiday. Returns the YYYY-MM-DD string of that day. Used to set the
 * `previousTradingDay` field — Friday's numbers are still valid for the
 * scoreboard on Sunday/Monday.
 *
 * Walks at most 14 days to guard against bugs; in practice the answer is
 * always within 3-4 days (longest US market gap is Christmas Eve + Christmas
 * over a weekend = 4-day stretch).
 */
export function getLastTradingDay(date = now()) {
  let cursor = new Date(toNYDateString(date) + 'T12:00:00Z');
  for (let i = 0; i < 14; i++) {
    cursor = new Date(cursor.getTime() - 86400_000);
    const cursorStr = cursor.toISOString().slice(0, 10);
    const day = cursor.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    if (!isWeekend && !isMarketHoliday(cursorStr)) {
      return cursorStr;
    }
  }
  return null;
}

/**
 * Phase 17 — getLastTradingDay inverted: the NEXT trading day, INCLUSIVE
 * of the given date. Inclusive because the 7 AM digest ships before the
 * open — Friday's digest asks about Friday's own close. Saturday's and
 * Sunday's digests target Monday; a holiday Monday pushes to Tuesday.
 *
 * Drives Tomorrow's Call targeting (src/picks.js): a pick made on
 * digest_date D resolves against getNextTradingDay(D)'s actual close.
 * Accepts a Date OR a 'YYYY-MM-DD' string (picks.js passes date strings).
 * Same 14-day walk guard as getLastTradingDay.
 */
export function getNextTradingDay(date = now()) {
  const startStr = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : toNYDateString(date);
  let cursor = new Date(startStr + 'T12:00:00Z');
  for (let i = 0; i < 14; i++) {
    const cursorStr = cursor.toISOString().slice(0, 10);
    const day = cursor.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    if (!isWeekend && !isMarketHoliday(cursorStr)) {
      return cursorStr;
    }
    cursor = new Date(cursor.getTime() + 86400_000);
  }
  return null;
}

// NYSE regular-session open, in minutes after midnight ET (9:30 AM).
const MARKET_OPEN_MINUTES_ET = 9 * 60 + 30;

/** Minutes after midnight in America/New_York for the given instant. */
function nyMinutesOfDay(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find(p => p.type === t)?.value || 0);
  return (get('hour') % 24) * 60 + get('minute');
}

/**
 * Phase 17 — the BLIND-PICK target: the next trading day whose 9:30 AM ET
 * market open is still in the FUTURE at `nowDate` (a real instant, NOT a
 * digest date — this is a wall-clock rule). A pick made after Tuesday's
 * open targets Wednesday, not Tuesday: otherwise an evening player bets on
 * a close they can look up, and a midday player on a half-formed result.
 *
 *   Tue 7:00 AM ET → Tuesday      Tue 9:29 AM ET → Tuesday
 *   Tue 9:31 AM ET → Wednesday    Tue 8:00 PM ET → Wednesday
 *   Sat / Sun any time → Monday   (holiday Monday → Tuesday)
 *
 * Tomorrow's Call's target_date (src/picks.js) — and the UNIQUE
 * (user_id, kind, target_date) constraint means one bet per market close,
 * which also closes the Sat+Sun double-bet on Monday.
 */
export function getNextTradingOpen(nowDate = new Date()) {
  const nyToday = toNYDateString(nowDate);
  let candidate = getNextTradingDay(nyToday);
  if (candidate === nyToday && nyMinutesOfDay(nowDate) >= MARKET_OPEN_MINUTES_ET) {
    // Today's open already happened — walk to the next trading day.
    const tomorrow = new Date(new Date(nyToday + 'T12:00:00Z').getTime() + 86400_000)
      .toISOString().slice(0, 10);
    candidate = getNextTradingDay(tomorrow);
  }
  return candidate;
}

// ── The main export ───────────────────────────────────────────────────

/**
 * Resolve the edition type for the given date (defaults to "now," honors
 * DATE_OVERRIDE).
 *
 * @returns {{
 *   editionType: 'standard' | 'weekly-wrap' | 'week-ahead',
 *   label: string,                      // Display label for the digest header
 *   previousTradingDay: string,         // YYYY-MM-DD, most recent actual trading day
 *   previousTradingDayName: string,     // 'Friday' / 'Thursday' / etc.
 *   reason: string,                     // 'weekday' | 'sunday' | 'monday' | 'post-holiday'
 *   holidayName: string | null,         // Set only when reason='post-holiday'
 *   dateStr: string,                    // The edition's own YYYY-MM-DD
 *   dayName: string                     // The edition's own day name ('Wednesday')
 * }}
 */
export function getEditionType(date = now()) {
  const dateStr = toNYDateString(date);
  const day = dayOfWeekNY(date);
  const dayName = DAY_NAMES[day];
  const previousTradingDay = getLastTradingDay(date);
  const previousTradingDayName = previousTradingDay
    ? DAY_NAMES[new Date(previousTradingDay + 'T12:00:00Z').getUTCDay()]
    : null;

  // Yesterday's NY date (for the post-holiday check). Uses the same
  // noon-UTC anchor as the rest of the math so DST is irrelevant.
  const yesterday = new Date(new Date(dateStr + 'T12:00:00Z').getTime() - 86400_000);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const yesterdayDayOfWeek = yesterday.getUTCDay();

  // Sunday → Weekly Wrap
  if (day === 0) {
    return {
      editionType: 'weekly-wrap',
      label: 'The Weekly Wrap',
      previousTradingDay,
      previousTradingDayName,
      reason: 'sunday',
      holidayName: null,
      dateStr,
      dayName,
    };
  }

  // Monday → Week Ahead (regardless of whether Monday itself is a holiday)
  if (day === 1) {
    return {
      editionType: 'week-ahead',
      label: 'The Week Ahead',
      previousTradingDay,
      previousTradingDayName,
      reason: 'monday',
      holidayName: null,
      dateStr,
      dayName,
    };
  }

  // Tuesday–Saturday: was yesterday a market holiday? → Week Ahead.
  //
  // CRITICAL: skip this when yesterday was a Monday holiday. Monday
  // already produced a Week Ahead (the `day === 1` branch above), so
  // Tuesday after a Monday holiday should be a STANDARD edition — not
  // a second back-to-back Week Ahead with the same stale Friday data.
  // The post-holiday treatment is for Tue-Fri holidays where the
  // previous trading day wasn't already covered by a Week Ahead.
  if (isMarketHoliday(yesterdayStr) && yesterdayDayOfWeek !== 1) {
    return {
      editionType: 'week-ahead',
      label: 'The Week Ahead',
      previousTradingDay,
      previousTradingDayName,
      reason: 'post-holiday',
      holidayName: getHolidayName(yesterdayStr),
      dateStr,
      dayName,
    };
  }

  // Normal Tue–Sat → Standard
  return {
    editionType: 'standard',
    label: `${dayName}'s Digest`,
    previousTradingDay,
    previousTradingDayName,
    reason: 'weekday',
    holidayName: null,
    dateStr,
    dayName,
  };
}
