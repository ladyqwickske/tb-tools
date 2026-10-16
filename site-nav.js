/*
 * site-nav.js — the shared menu at the top of every TB-Tools page (2026-10-16).
 *
 * The links are plain HTML in each page's <header class="site-header"> (so the
 * menu works without JavaScript); this script
 *   - marks the page you're on,
 *   - shows the "Admin" link when the signed-in Google account is an admin
 *     (asked once at the Worker's /account/status, then remembered for a few
 *     hours; the admin pages themselves still check every request),
 *   - folds the menu behind a "Menu" button on phones.
 * session.js tells it about sign-in / sign-out with the "tbsession:change" event.
 */
(function () {
  const WORKER_URL = "https://auto-crypt.ccc-hq.com";
  const TOKEN_KEY = "tbtools.idToken";   // same key as session.js
  const CACHE_KEY = "tbtools.navAdmin";
  const CACHE_S = 6 * 60 * 60;
  const nowS = () => Math.floor(Date.now() / 1000);

  document.documentElement.classList.add("js-site-nav");

  function signedInEmail() {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return null;
      const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const p = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (!p || !p.email || !p.exp || p.exp <= nowS()) return null;
      return { token, email: String(p.email).toLowerCase() };
    } catch (e) {
      return null;
    }
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) { return null; }
  }
  function writeCache(v) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch (e) {}
  }

  function setup() {
    const header = document.querySelector("header.site-header");
    if (!header) return;
    const nav = header.querySelector(".site-nav");
    const adminItem = header.querySelector(".site-admin");

    // Current page.
    const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const page = header.dataset.page || here.replace(/\.html$/, "");
    header.querySelectorAll(".site-nav a[data-page]").forEach((a) => {
      if (a.dataset.page.split(" ").includes(page)) a.setAttribute("aria-current", "page");
      // On the home page itself, jump within the page instead of reloading it.
      if (page === "index" && a.hash && a.getAttribute("href").indexOf("index.html#") === 0) a.setAttribute("href", a.hash);
    });

    // Phones: a Menu button.
    const toggle = header.querySelector(".site-menu-toggle");
    if (toggle && nav) {
      toggle.addEventListener("click", () => {
        const open = header.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(open));
      });
      nav.addEventListener("click", (e) => {
        if (e.target.closest("a")) { header.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
      });
    }

    // Admin link.
    function show(on) { if (adminItem) adminItem.hidden = !on; }
    async function refresh(force) {
      if (page === "admin") { show(true); return; }   // on an admin page already
      const me = signedInEmail();
      if (!me) { show(false); return; }
      const cached = readCache();
      if (cached && cached.email === me.email) {
        show(!!cached.admin);
        if (!force && nowS() - (cached.at || 0) < CACHE_S) return;
      } else {
        show(false);
      }
      try {
        const res = await fetch(WORKER_URL + "/account/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_token: me.token }),
        });
        if (!res.ok) return;
        const body = await res.json();
        const admin = !!(body && body.is_admin);
        writeCache({ email: me.email, admin, at: nowS() });
        show(admin);
      } catch (e) { /* offline: keep what we showed */ }
    }
    refresh(false);
    window.addEventListener("tbsession:change", () => refresh(true));
    window.addEventListener("storage", (e) => { if (e.key === TOKEN_KEY) refresh(true); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();
