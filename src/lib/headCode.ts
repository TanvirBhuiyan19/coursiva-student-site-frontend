/**
 * The school's custom `<head>` code (`GET /site` → `head_code`: its own analytics, verification tags… on its own
 * site). React can't inject a raw HTML string into <head>, so the code is split into its top-level head elements
 * (`meta`, `link`, `base`, `script`, `style`, `noscript`) and each is rendered as itself, attributes and content kept
 * verbatim. Comments and anything that isn't a head element are dropped.
 */

export interface HeadElement {
  tag: 'meta' | 'link' | 'script' | 'style' | 'noscript';
  /** HTML attribute names, as written (lower-cased). Boolean attributes have the value `''`. */
  attrs: Record<string, string>;
  /** Inner text of script / style / noscript. */
  content: string;
}

const VOID = new Set(['meta', 'link']);
const RAW = new Set(['script', 'style', 'noscript']);

export function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of source.matchAll(re)) {
    const name = m[1]!.toLowerCase();
    // Event handler attributes would never run from React-rendered markup anyway; drop them instead of warning.
    if (name.startsWith('on')) continue;
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

export function parseHeadCode(html: string): HeadElement[] {
  const out: HeadElement[] = [];
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(meta|link|base|script|style|noscript)\b([^>]*?)\/?>|<\/(?:[a-z]+)\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (!m[1]) continue;
    const tag = m[1].toLowerCase();
    const attrs = parseAttributes(m[2] ?? '');
    if (tag === 'base') continue; // A <base> would retarget every link on the storefront.
    if (VOID.has(tag)) {
      out.push({ tag: tag as HeadElement['tag'], attrs, content: '' });
      continue;
    }
    if (RAW.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = source.slice(re.lastIndex);
      const end = rest.search(close);
      const content = end === -1 ? rest : rest.slice(0, end);
      re.lastIndex += end === -1 ? rest.length : end + (close.exec(rest)?.[0].length ?? 0);
      out.push({ tag: tag as HeadElement['tag'], attrs, content });
    }
  }
  return out;
}

/** Consent category of a gated element: its `data-consent` attribute (`analytics` | `marketing`), else marketing. */
export type HeadConsent = 'analytics' | 'marketing';
export interface GatedHeadElement extends HeadElement {
  consent: HeadConsent;
}

/** `<link rel>` values that never fetch anything (a link to a profile, the author, the licence). */
const INERT_LINK_RELS = new Set(['me', 'author', 'license', 'help']);

/** CSS that can fetch something: `url(`, `image-set(` (and `-webkit-image-set(`), `@import`, `@font-face`, `src:`. */
const LOADING_CSS = /url\s*\(|image-set\s*\(|@import|@font-face|\bsrc\s*:/i;

/** A `<meta>` that only describes the page: `name` or `property`, never `http-equiv` (refresh, set-cookie) or `charset`. */
const passiveMeta = (attrs: Record<string, string>) =>
  ('name' in attrs || 'property' in attrs) && !('http-equiv' in attrs) && !('charset' in attrs);

/**
 * Splits the school's head code for cookie consent (docs/consent.md):
 * - `passive`: rendered on the server on every page — `<meta name|property>` (no `http-equiv`: it can refresh to
 *   another site or set a cookie), inert `<link>`s and inline `<style>` that loads nothing (no `url(`, `image-set(`,
 *   `@import`, `@font-face` or `src:`). None of them can run code, set a cookie or contact another server.
 * - `gated`: everything else (`<script>`, other `<link>`s, styles that load resources) waits in the browser until the
 *   visitor allows the element's category. A school marks a tag `data-consent="analytics"` when it is analytics;
 *   anything unmarked is treated as marketing (the strictest).
 * `<noscript>` is dropped: it can't wait for consent (it only renders when scripts are off) and is mostly pixels.
 */
export function partitionHeadCode(html: string): { passive: HeadElement[]; gated: GatedHeadElement[] } {
  const passive: HeadElement[] = [];
  const gated: GatedHeadElement[] = [];
  for (const el of parseHeadCode(html)) {
    if (el.tag === 'noscript') continue;
    const inert =
      (el.tag === 'meta' && passiveMeta(el.attrs)) ||
      (el.tag === 'link' && (el.attrs.rel ?? '').split(/\s+/).every((r) => INERT_LINK_RELS.has(r.toLowerCase()))) ||
      (el.tag === 'style' && !LOADING_CSS.test(el.content));
    if (inert) passive.push(el);
    else gated.push({ ...el, consent: el.attrs['data-consent'] === 'analytics' ? 'analytics' : 'marketing' });
  }
  return { passive, gated };
}

const REACT_NAMES: Record<string, string> = {
  class: 'className',
  charset: 'charSet',
  'http-equiv': 'httpEquiv',
  crossorigin: 'crossOrigin',
  referrerpolicy: 'referrerPolicy',
  nomodule: 'noModule',
  fetchpriority: 'fetchPriority',
  hreflang: 'hrefLang',
  imagesizes: 'imageSizes',
  imagesrcset: 'imageSrcSet',
};
const BOOLEAN = new Set(['async', 'defer', 'nomodule']);

/** HTML attributes → React props (`class` → `className`, boolean attributes → `true`). */
export function reactProps(attrs: Record<string, string>): Record<string, string | boolean> {
  return Object.fromEntries(
    Object.entries(attrs).map(([k, v]) => [REACT_NAMES[k] ?? k, BOOLEAN.has(k) ? true : v] as [string, string | boolean]),
  );
}
