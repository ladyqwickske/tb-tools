/*
 * session.js — shared Google sign-in for every TB-Tools page (2026-09-23).
 *
 * Signing in once now carries over to lists.html, devices.html,
 * subscribe.html and admin.html (and to other tabs of the site) instead of
 * asking again on every page.
 *
 * How: the Google ID token from the sign-in is kept in localStorage until it
 * expires (Google issues them for about 1 hour). A page that finds a valid
 * token skips the button and uses it straight away. Shortly before it
 * expires, Google is asked for a fresh one silently (auto sign-in); if that
 * isn't possible the normal button shows again on the next page.
 *
 * The Worker still verifies every token on every request exactly as before,
 * so nothing about access control changes here — this only remembers the
 * token in this browser. "Sign out" (top right of every page) forgets it.
 *
 * Usage on a page, after the Google script has loaded (window.onload):
 *   TBSession.start({
 *     clientId: GOOGLE_CLIENT_ID_WEB,
 *     container: document.getElementById("g_id_signin_container"),
 *     buttonWidth: 300,
 *     onSignIn(token, email, info) { ... }   // info.refresh = true for a silent renewal
 *   });
 */
(function () {
  const KEY = "tbtools.idToken";
  const EXPIRY_MARGIN_S = 60;     // treat a token as expired 1 minute early
  const RENEW_BEFORE_S = 5 * 60;  // try a silent renewal 5 minutes before expiry

  let opts = null;
  let renewTimer = null;
  let signedIn = false;

  function decode(token) {
    try {
      const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch (e) {
      return null;
    }
  }

  function nowS() { return Math.floor(Date.now() / 1000); }

  function stored() {
    let token = null;
    try { token = localStorage.getItem(KEY); } catch (e) { return null; }
    if (!token) return null;
    const p = decode(token);
    if (!p || !p.exp || p.exp - EXPIRY_MARGIN_S <= nowS()) {
      forget();
      return null;
    }
    return { token, payload: p };
  }

  function remember(token) {
    try { localStorage.setItem(KEY, token); } catch (e) { /* private mode: page still works, just no carry-over */ }
  }

  function forget() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function showBar(email) {
    let bar = document.getElementById("tb-session-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "tb-session-bar";
      bar.style.cssText =
        "font-family:'Oswald',sans-serif;font-size:0.7rem;letter-spacing:0.06em;color:#a8a692;" +
        "display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;";
      const header = document.querySelector("header");
      if (header) header.appendChild(bar);
      else document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.innerHTML =
      `<span style="max-width:34vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(email)}">${esc(email)}</span>` +
      `<button type="button" id="tb-signout" style="background:none;border:none;padding:0;cursor:pointer;` +
      `color:#f2d68f;font:inherit;letter-spacing:inherit;text-transform:uppercase;text-decoration:underline;">Sign out</button>`;
    document.getElementById("tb-signout").addEventListener("click", signOut);
  }

  function scheduleRenew(payload) {
    clearTimeout(renewTimer);
    const inS = payload.exp - RENEW_BEFORE_S - nowS();
    renewTimer = setTimeout(() => {
      try { google.accounts.id.prompt(); } catch (e) {}
    }, Math.max(5, inS) * 1000);
  }

  function accept(token, fromStorage) {
    const p = decode(token);
    if (!p) return;
    if (!fromStorage) remember(token);
    const refresh = signedIn;
    signedIn = true;
    if (opts.container) opts.container.style.display = "none";
    showBar(p.email);
    scheduleRenew(p);
    opts.onSignIn(token, p.email, { refresh });
  }

  function signOut() {
    forget();
    clearTimeout(renewTimer);
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    location.reload();
  }

  function start(options) {
    opts = options;
    google.accounts.id.initialize({
      client_id: opts.clientId,
      callback: (resp) => accept(resp.credential, false),
      auto_select: true,          // returning visitors are signed in without clicking
      cancel_on_tap_outside: true,
    });

    const s = stored();
    if (s) {
      accept(s.token, true);
      return;
    }
    if (opts.container) {
      google.accounts.id.renderButton(opts.container, {
        theme: "filled_black", size: "large", width: opts.buttonWidth || 300,
      });
    }
    try { google.accounts.id.prompt(); } catch (e) {}
  }

  /** Current token (or null) — for pages that want it without the callback. */
  function token() {
    const s = stored();
    return s ? s.token : null;
  }

  window.TBSession = { start, signOut, token };
})();
