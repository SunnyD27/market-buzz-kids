/* public/landing.js — Market Juice landing page client logic.
 *
 * Responsibilities:
 *   - Read UTM params from current URL.
 *   - Detect client timezone via Intl (server can't reliably guess).
 *   - Client-side form validation (email format, required fields).
 *   - POST signup payload to /api/signup.
 *   - Show contextual COPPA note when kid_age dropdown is 10-12.
 *   - Replace form with success state on 200; show inline error on 4xx.
 */
(function () {
  'use strict';

  // ---- UTM capture from current URL --------------------------------------
  const params = new URLSearchParams(location.search);
  const utm = {
    utm_source:   params.get('utm_source')   || null,
    utm_medium:   params.get('utm_medium')   || null,
    utm_campaign: params.get('utm_campaign') || null,
    utm_content:  params.get('utm_content')  || null,
    utm_term:     params.get('utm_term')     || null,
  };

  function getTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
    catch { return null; }
  }

  // ---- Form refs --------------------------------------------------------
  const form     = document.getElementById('signup-form');
  const success  = document.getElementById('signup-success');
  const btn      = document.getElementById('submit-btn');
  const ageEl    = document.getElementById('kid_age');
  const coppaNote = document.getElementById('note-coppa');
  const usernameEl     = document.getElementById('username');
  const usernameStatus = document.getElementById('username-status');

  // ---- COPPA hint: show note when age 10-12 is selected ----------------
  ageEl.addEventListener('change', () => {
    const a = parseInt(ageEl.value, 10);
    coppaNote.hidden = !(a >= 10 && a <= 12);
  });

  // ---- Username availability check (debounced) -------------------------
  // Fires 350ms after the kid stops typing. Hits GET /api/check-username
  // and paints a pill in #username-status. Cheap — same shape as the
  // server enforces, so we don't over-promise (a server-side race could
  // still steal a username between this check and submit; the server
  // returns 409 in that case and we surface the message).
  const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
  let usernameDebounce = null;
  let lastChecked = '';
  function setUsernameStatus(kind, text) {
    if (!usernameStatus) return;
    usernameStatus.className = 'username-status ' + (kind || '');
    usernameStatus.textContent = text || '';
  }
  function checkUsername(raw) {
    const v = String(raw || '').trim();
    if (!v) { setUsernameStatus('', ''); return; }
    if (v.length < 3) { setUsernameStatus('invalid', 'too short'); return; }
    if (v.length > 20) { setUsernameStatus('invalid', 'too long'); return; }
    if (!USERNAME_RE.test(v)) { setUsernameStatus('invalid', 'letters / numbers / _ only'); return; }
    if (v.toLowerCase() === lastChecked.toLowerCase()) return; // already checked
    setUsernameStatus('checking', 'checking…');
    fetch('/api/check-username?username=' + encodeURIComponent(v))
      .then(r => r.json()).catch(() => ({ available: false }))
      .then(j => {
        // Ignore stale responses if the field changed during the request.
        if (usernameEl.value.trim() !== v) return;
        lastChecked = v;
        if (j.available) setUsernameStatus('available', '✓ available');
        else             setUsernameStatus('taken',     '✗ taken');
      });
  }
  if (usernameEl) {
    usernameEl.addEventListener('input', () => {
      clearTimeout(usernameDebounce);
      usernameDebounce = setTimeout(() => checkUsername(usernameEl.value), 350);
    });
  }

  // ---- Field validation -------------------------------------------------
  function setError(name, msg) {
    const el = document.getElementById('err-' + name);
    if (el) el.textContent = msg || '';
  }
  function clearAllErrors() {
    ['parent_email', 'kid_first_name', 'kid_age', 'username', 'password'].forEach(n => setError(n, ''));
  }
  function isValidEmail(s) {
    // Lightweight check — server does the authoritative validation.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  }
  function validate(values) {
    let ok = true;
    if (!values.parent_email || !isValidEmail(values.parent_email)) {
      setError('parent_email', 'Please enter a valid email address.'); ok = false;
    }
    if (!values.kid_first_name || values.kid_first_name.length < 1) {
      setError('kid_first_name', "Kid's first name is required."); ok = false;
    } else if (values.kid_first_name.length > 50) {
      setError('kid_first_name', 'Name is too long (max 50 chars).'); ok = false;
    }
    if (!values.kid_age || values.kid_age < 10 || values.kid_age > 16) {
      setError('kid_age', 'Please choose an age from the dropdown.'); ok = false;
    }
    if (!values.username || values.username.length < 3) {
      setError('username', 'Username must be at least 3 characters.'); ok = false;
    } else if (values.username.length > 20) {
      setError('username', 'Username is too long (max 20 chars).'); ok = false;
    } else if (!USERNAME_RE.test(values.username)) {
      setError('username', 'Username can only contain letters, numbers, and underscores.'); ok = false;
    }
    if (!values.password || values.password.length < 6) {
      setError('password', 'Password must be at least 6 characters.'); ok = false;
    }
    return ok;
  }

  // ---- Submit -----------------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors();

    const values = {
      parent_email:      form.parent_email.value.trim(),
      kid_first_name:    form.kid_first_name.value.trim(),
      kid_age:           parseInt(form.kid_age.value, 10),
      username:          form.username.value.trim(),
      password:          form.password.value,
      invest_experience: form.invest_experience.value || null,
      referral_source:   form.referral_source.value || null,
      ...utm,
      timezone:          getTimezone(),
    };

    if (!validate(values)) return;

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Signing up…';

    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok) {
        showSuccess(body, values);
      } else if (res.status === 409) {
        setError('parent_email', body.message || 'That email is already signed up.');
        btn.disabled = false; btn.textContent = original;
      } else {
        // Field-specific errors from server
        if (body.errors && typeof body.errors === 'object') {
          for (const [k, v] of Object.entries(body.errors)) setError(k, v);
        } else if (body.message) {
          // Non-field message (e.g. the 5-child cap) — show it inline on
          // the email field rather than a jarring alert.
          setError('parent_email', body.message);
        } else {
          alert('Something went wrong. Please try again.');
        }
        btn.disabled = false; btn.textContent = original;
      }
    } catch (err) {
      console.error('[signup] network error:', err);
      alert('Network error. Please check your connection and try again.');
      btn.disabled = false; btn.textContent = original;
    }
  });

  function showSuccess(body, values) {
    const headline = document.getElementById('success-headline');
    const bodyEl   = document.getElementById('success-body');
    const consentRequired = values.kid_age >= 10 && values.kid_age <= 12;
    const kid = escape(values.kid_first_name);
    const email = escape(values.parent_email);

    if (body && body.knownParent) {
      // Multi-kid abbreviated flow — known parent adding a sibling. One
      // email (consent link), no separate verification step.
      headline.textContent = `Almost done — confirm by email`;
      bodyEl.innerHTML = `
        We sent a <strong>confirmation link</strong> to <strong>${email}</strong> to add ${kid}.
        Click it and ${kid}'s account will be ready. (No need to verify your email again —
        you've already done that.)
      `;
    } else if (consentRequired) {
      headline.textContent = "Almost done — one more step";
      bodyEl.innerHTML = `
        We just sent a <strong>parental consent email</strong> to <strong>${email}</strong>.
        Click the consent link in that email and ${kid}'s
        account will be activated. We'll start sending the daily digest the morning after.
      `;
    } else {
      headline.textContent = "You're in!";
      bodyEl.innerHTML = `
        We just sent a <strong>verification email</strong> to <strong>${email}</strong>.
        Click the link to confirm, and ${kid} will get
        their first digest tomorrow at 7&nbsp;AM&nbsp;EST.
      `;
    }

    // Multi-kid: offer to add another sibling under the same email. Pre-fills
    // the parent email so the known-parent abbreviated flow kicks in.
    bodyEl.innerHTML += `
      <p style="margin-top:16px;font-size:14px;">
        Got another kid? <a href="#" id="add-another-child" style="font-weight:600;">Add another child →</a> (same email)
      </p>`;
    const addLink = document.getElementById('add-another-child');
    if (addLink) {
      addLink.addEventListener('click', (e) => {
        e.preventDefault();
        const keepEmail = values.parent_email;
        form.reset();
        if (coppaNote) coppaNote.hidden = true;
        success.hidden = true;
        form.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Sign up →';
        form.parent_email.value = keepEmail;   // pre-fill so it's recognized as a known parent
        form.kid_first_name.focus();
      });
    }

    form.hidden = true;
    success.hidden = false;
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // "Try a different email" — un-hide the form, clear, refocus.
  document.getElementById('signup-retry').addEventListener('click', (e) => {
    e.preventDefault();
    form.reset();
    coppaNote.hidden = true;
    success.hidden = true;
    form.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Sign up →';
    form.parent_email.focus();
  });

  function escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }
})();
