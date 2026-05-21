/* public/landing.js — Market Buzz Kids landing page client logic.
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

  // ---- COPPA hint: show note when age 10-12 is selected ----------------
  ageEl.addEventListener('change', () => {
    const a = parseInt(ageEl.value, 10);
    coppaNote.hidden = !(a >= 10 && a <= 12);
  });

  // ---- Field validation -------------------------------------------------
  function setError(name, msg) {
    const el = document.getElementById('err-' + name);
    if (el) el.textContent = msg || '';
  }
  function clearAllErrors() {
    ['parent_email', 'kid_first_name', 'kid_age'].forEach(n => setError(n, ''));
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
        } else {
          alert(body.message || 'Something went wrong. Please try again.');
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

    headline.textContent = consentRequired
      ? "Almost done — one more step"
      : "You're in!";

    if (consentRequired) {
      bodyEl.innerHTML = `
        We just sent a <strong>parental consent email</strong> to <strong>${escape(values.parent_email)}</strong>.
        Click the consent link in that email and ${escape(values.kid_first_name)}'s
        account will be activated. We'll start sending the daily digest the morning after.
      `;
    } else {
      bodyEl.innerHTML = `
        We just sent a <strong>verification email</strong> to <strong>${escape(values.parent_email)}</strong>.
        Click the link to confirm, and ${escape(values.kid_first_name)} will get
        their first digest tomorrow at 7&nbsp;AM&nbsp;EST.
      `;
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
