/*
 * session.js — shared Google sign-in for every TB-Tools page.
 *
 * Sign in once and you stay signed in on every page (calculator, lists,
 * devices, subscribe, admin) and on later visits, until you press
 * "Sign out" — the same way the cCc Champions dashboard remembers you.
 *
 * How (2026-09-29): Google's own sign-in token only lasts about an hour, so
 * right after the Google sign-in this swaps it at the Worker's /session route
 * for a TB-Tools session token that lasts 30 days (SESSION_TTL_DAYS on the
 * Worker) and keeps that in localStorage. Pages send it in the same
 * `id_token` field as before; the Worker checks its signature on every
 * request, so access control is unchanged. While it's in use it is quietly
 * renewed once it is a week old, so a regular visitor never sees the button again.
 *
 * If the Worker doesn't hand out session tokens (older Worker still deployed),
 * this falls back to the old behaviour: the Google token is kept until it
 * expires (~1 hour) and Google is asked for a fresh one silently.
 *
 * Usage on a page, after the Google script has loaded (window.onload):
 *   TBSession.start({
 *     clientId: GOOGLE_CLIENT_ID_WEB,
 *     container: document.getElementById("g_id_signin_container"),
 *     buttonWidth: 300,
 *     onSignIn(token, email, info) { ... }   // info.refresh = true for a silent renewal
 *   });
 * When the Worker answers 401, call TBSession.expired() — it forgets the
 * token and shows the Google button again.
 */
(function () {
  const KEY = "tbtools.idToken";
  const EXPIRY_MARGIN_S = 60;     // treat a token as expired 1 minute early
  const RENEW_BEFORE_S = 5 * 60;  // Google token: try a silent renewal 5 minutes before expiry
  const SESSION_REFRESH_S = 7 * 24 * 60 * 60; // session token: renew when it is older than 7 days (as champions)
  const SESSION_PREFIX = "tbs1.";
  const DEFAULT_WORKER_URL = "https://auto-crypt.ccc-hq.com";

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

  function isSession(token) { return token.indexOf(SESSION_PREFIX) === 0; }

  /** Swap a Google token (or an older session token) for a fresh session token; null if unavailable. */
  async function exchange(token) {
    try {
      const res = await fetch((opts.workerUrl || DEFAULT_WORKER_URL) + "/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: token }),
      });
      if (!res.ok) return null;
      const body = await res.json();
      return body && body.session_token ? body.session_token : null;
    } catch (e) {
      return null;
    }
  }

  function scheduleRenew(token, payload) {
    clearTimeout(renewTimer);
    if (isSession(token)) {
      const age = nowS() - (payload.iat || 0);
      renewTimer = setTimeout(async () => {
        const fresh = await exchange(token);
        if (fresh) accept(fresh, false);
      }, Math.max(5, SESSION_REFRESH_S - age) * 1000);
      return;
    }
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
    scheduleRenew(token, p);
    opts.onSignIn(token, p.email, { refresh });
  }

  async function onGoogleCredential(googleToken) {
    const session = await exchange(googleToken);
    accept(session || googleToken, false);
  }

  function showButton() {
    if (!opts.container) return;
    opts.container.style.display = "";
    opts.container.classList.remove("hidden");
    google.accounts.id.renderButton(opts.container, {
      theme: "filled_black", size: "large", width: opts.buttonWidth || 300,
    });
  }

  function signOut() {
    forget();
    clearTimeout(renewTimer);
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    location.reload();
  }

  /** The Worker rejected the token: forget it and ask for a new sign-in. */
  function expired() {
    forget();
    clearTimeout(renewTimer);
    signedIn = false;
    const bar = document.getElementById("tb-session-bar");
    if (bar) bar.remove();
    showButton();
    try { google.accounts.id.prompt(); } catch (e) {}
  }

  function start(options) {
    opts = options;
    google.accounts.id.initialize({
      client_id: opts.clientId,
      callback: (resp) => onGoogleCredential(resp.credential),
      auto_select: true,          // returning visitors are signed in without clicking
      cancel_on_tap_outside: true,
    });

    const s = stored();
    if (s) {
      accept(s.token, true);
      // A Google token left over from before sessions existed: upgrade it quietly.
      if (!isSession(s.token)) exchange(s.token).then((fresh) => { if (fresh) accept(fresh, false); });
      return;
    }
    showButton();
    try { google.accounts.id.prompt(); } catch (e) {}
  }

  /** Current token (or null) — for pages that want it without the callback. */
  function token() {
    const s = stored();
    return s ? s.token : null;
  }

  window.TBSession = { start, signOut, expired, token };
})();
