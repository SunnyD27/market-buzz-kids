/**
 * src/auth.js — Kid-facing session auth (Phase 7).
 *
 * Auth is intentionally lightweight: a signed httpOnly cookie holds the
 * user's UUID. No JWT, no Redis-backed sessions — just a stable identifier
 * that the server can trust as long as the cookie-parser signature checks
 * out. The cookie value itself is the user id; lookups go straight to
 * Postgres on every request.
 *
 * Why not localStorage? It's JS-readable, vulnerable to XSS. httpOnly
 * cookies aren't. For a product where 10-14 year olds will share devices
 * with siblings, "remember me for 30 days but kick me out if I log out"
 * is the right ergonomic.
 *
 * sameSite=lax balances CSRF defense against normal email-link clicks
 * (teaser emails → /digest must carry the cookie). The /api/login route
 * is POST-only, so a third party can't trick a logged-in kid's browser
 * into mutating state with just a GET.
 *
 *   requireAuth   — middleware; gates /digest behind a valid session
 *   setSession    — write the cookie after successful login
 *   clearSession  — remove the cookie (logout)
 */

import { query } from './db.js';

const COOKIE_NAME = 'mj_session';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Express middleware. If the session cookie is valid and the user is
 * still active + not soft-deleted, attaches `req.user` and continues.
 * Otherwise redirects to /login. Use it on any route that should be
 * kid-only.
 *
 * Note: `req.signedCookies` is populated by cookie-parser. If the cookie
 * was tampered with, cookie-parser drops it from signedCookies entirely
 * (it'll show up in req.cookies instead with the literal `s:` prefix).
 * Reading from signedCookies is therefore sufficient for tamper checking.
 */
export async function requireAuth(req, res, next) {
  // How to refuse an unauthenticated request. Page routes (/digest, /progress)
  // redirect to the login screen so a kid clicking the morning-email link in a
  // fresh tab lands somewhere useful. API routes (/api/*) instead return a
  // 401 JSON so fetch callers get a clean, parseable error rather than an HTML
  // login page (a 302→HTML would break JSON parsing on the client).
  const reject = () =>
    req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Authentication required.' })
      : res.redirect('/login');

  const raw = req.signedCookies?.[COOKIE_NAME];
  if (!raw) {
    return reject();
  }

  // Cookie format is `${userId}:${session_version}`. Legacy cookies (pre
  // session-versioning) are just the bare UUID with no ':' — force those
  // users to re-login so they get a versioned cookie. This is a one-time
  // event after the session-versioning rollout.
  const sep = raw.indexOf(':');
  if (sep === -1) {
    clearSession(res);
    return reject();
  }
  const userId = raw.slice(0, sep);
  const cookieVersion = raw.slice(sep + 1);

  try {
    const { rows } = await query(
      `SELECT id, username, kid_first_name, kid_age, is_active,
              session_version, last_active_at
         FROM users
        WHERE id = $1
          AND is_active = TRUE
          AND deleted_at IS NULL
        LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) {
      // Cookie was valid but the account is gone / deactivated / soft-
      // deleted. Clear the dead cookie so the browser stops sending it.
      clearSession(res);
      return reject();
    }
    const user = rows[0];

    // Session invalidation: the cookie's version must match the DB. A
    // password reset bumps session_version, so old cookies stop working.
    if (String(user.session_version) !== cookieVersion) {
      clearSession(res);
      return reject();
    }

    req.user = user;

    // Activity tracking for the 12-month inactivity sweep. Debounced to at
    // most once/day per user so we don't write on every page load. Fire-and-
    // forget — never block the response on this bookkeeping write.
    const lastActive = user.last_active_at ? new Date(user.last_active_at).getTime() : 0;
    if (Date.now() - lastActive > 86400000) {
      query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [user.id])
        .catch(err => console.error('[auth] last_active_at update failed:', err.message));
    }

    next();
  } catch (err) {
    console.error('[auth] session lookup failed:', err.message);
    // DB outage: fail closed. Better to send the kid to /login (or 401 an API
    // call) than accidentally serve content without knowing who they are.
    return reject();
  }
}

/**
 * Write the 30-day signed httpOnly session cookie. Called after a
 * successful POST /api/login (or any other path that grants a session).
 *
 *   secure=true in production so the cookie only travels over HTTPS.
 *   sameSite=lax so email-link clicks (cross-site GETs) still carry it.
 */
export function setSession(res, userId, sessionVersion = 1) {
  // Cookie value carries both the user id and their session_version so
  // requireAuth can reject cookies issued before a password reset.
  res.cookie(COOKIE_NAME, `${userId}:${sessionVersion}`, {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: THIRTY_DAYS_MS,
    path: '/',
  });
}

/**
 * Remove the session cookie. Used by POST /api/logout and by
 * requireAuth when the cookie's user no longer exists.
 */
export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}
