/**
 * `/embed/forms.js` — the snippet schools paste into any website (docs/api/forms.md → "Embedding"):
 *
 *   <script src="https://{school host}/embed/forms.js" data-form="frm_…" async></script>
 *
 * Plain ES5-level JavaScript (it runs on pages we don't control), served by app/[tenant]/embed/forms.js/route.ts.
 * For each `script[data-form]` that loads this file it adds a sandboxed iframe of `/embed/forms/{id}` on the
 * script's own origin (after the script, or inside `#{data-target}`), forwarding the page's origin, URL, referrer and
 * campaign parameters. Messages from a frame are trusted only when they come from that iframe's window, with
 * `source: 'coursiva-form'` and that form id, and from the origin of that frame's first such message (the school's
 * current host: a frame of an old host is redirected to the school's new domain, so it can't be the script's origin):
 *  - `resize {height}` → the iframe's height (clamped to 50–10000 px)
 *  - `submitted {submission}` → a `coursiva:form-submitted` CustomEvent (bubbles) on the script element
 *  - `redirect {url}` → `location.assign(url)`, http(s) only
 * Safe to include several times (one or many forms, one or many schools): each script element is set up once and
 * one message listener serves every frame.
 */
export const EMBED_SCRIPT = String.raw`/* Coursiva lead forms embed v1 */
(function () {
  'use strict';
  var w = window;
  var d = document;
  var reg = w.__coursivaForms;
  if (!reg || typeof reg !== 'object' || !reg.frames) {
    reg = { frames: [], listening: false };
    try {
      Object.defineProperty(w, '__coursivaForms', { value: reg, configurable: false, enumerable: false, writable: false });
    } catch (e) {
      w.__coursivaForms = reg;
    }
  }
  var FORWARD = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'];
  var ID = /^[A-Za-z0-9_-]{1,64}$/;

  function scriptOrigin(s) {
    try {
      var u = new URL(s.src, d.baseURI);
      if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !/\/embed\/forms\.js$/.test(u.pathname)) return null;
      return u.origin;
    } catch (e) {
      return null;
    }
  }

  function frameSrc(origin, id) {
    var q = new URLSearchParams();
    q.set('origin', w.location.origin);
    q.set('page', String(w.location.href).slice(0, 2000));
    if (d.referrer) q.set('referrer', String(d.referrer).slice(0, 2000));
    var own = new URLSearchParams(w.location.search);
    for (var i = 0; i < FORWARD.length; i++) {
      var v = own.get(FORWARD[i]);
      if (v) q.set(FORWARD[i], v.slice(0, 200));
    }
    return origin + '/embed/forms/' + encodeURIComponent(id) + '?' + q.toString();
  }

  function setup(s) {
    if (s.__coursivaForm) return;
    var id = s.getAttribute('data-form') || '';
    var origin = scriptOrigin(s);
    if (!origin || !ID.test(id)) return;
    s.__coursivaForm = true;
    var f = d.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    f.setAttribute('title', s.getAttribute('data-title') || 'Form');
    f.setAttribute('loading', 'lazy');
    f.setAttribute('style', 'width:100%;border:0;display:block;height:420px;');
    f.src = frameSrc(origin, id);
    var targetId = s.getAttribute('data-target');
    var target = targetId ? d.getElementById(targetId) : null;
    if (target) target.appendChild(f);
    else if (s.parentNode) s.parentNode.insertBefore(f, s.nextSibling);
    else return;
    reg.frames.push({ iframe: f, script: s, id: id, pinned: null });
  }

  function onMessage(ev) {
    var data = ev.data;
    if (!data || typeof data !== 'object' || data.source !== 'coursiva-form') return;
    for (var i = 0; i < reg.frames.length; i++) {
      var e = reg.frames[i];
      if (!e.iframe.contentWindow || ev.source !== e.iframe.contentWindow) continue;
      if (data.form !== e.id) return;
      // The frame's first message (its resize on load) pins its origin; a frame navigated elsewhere since is ignored.
      if (e.pinned === null) e.pinned = ev.origin;
      if (ev.origin !== e.pinned) return;
      if (data.type === 'resize') {
        var h = Number(data.height);
        if (!isFinite(h)) return;
        e.iframe.style.height = Math.round(Math.min(10000, Math.max(50, h))) + 'px';
      } else if (data.type === 'submitted') {
        var detail = { form: e.id, submission: typeof data.submission === 'string' ? data.submission : null };
        e.script.dispatchEvent(new CustomEvent('coursiva:form-submitted', { bubbles: true, detail: detail }));
      } else if (data.type === 'redirect' && typeof data.url === 'string') {
        var u;
        try {
          u = new URL(data.url);
        } catch (err) {
          return;
        }
        if (u.protocol === 'https:' || u.protocol === 'http:') w.location.assign(u.href);
      }
      return;
    }
  }

  if (!reg.listening) {
    reg.listening = true;
    w.addEventListener('message', onMessage);
  }

  function scan() {
    if (d.currentScript && d.currentScript.hasAttribute('data-form')) setup(d.currentScript);
    var all = d.querySelectorAll('script[data-form]');
    for (var i = 0; i < all.length; i++) setup(all[i]);
  }
  scan();
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', scan);
})();
`;
