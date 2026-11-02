import type { RedirectRule } from './types';

/**
 * The school's redirect rules as pure functions — the same rules as Laravel's RedirectRules, Go's seo/redirects.go and
 * the dashboard's features/seo/rules.ts (their tests share the cases).
 *
 * - Matching ignores case, a trailing slash, repeated slashes and the query string. An exact rule wins over a prefix
 *   rule; among prefix rules the longest wins.
 * - A `from` ending in `/*` matches its base path and everything under it; a `to` ending in `*` carries the rest of the
 *   path over (`/old/*` → `/new/*`: `/old/a/b` → `/new/a/b`).
 * - Chains are followed so the visitor gets one hop; a chain that revisits a path or runs past MAX_HOPS is no redirect.
 * - The proxy indexes the table once (`indexRedirects`): exact rules by key, prefix rules by base, found by walking up
 *   the path's own segments — a lookup costs the path's depth, not the number of rules.
 */

export const MAX_HOPS = 10;

type Rule = Pick<RedirectRule, 'from' | 'to'> & Partial<Pick<RedirectRule, 'status' | 'keepQuery' | 'id'>>;

const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

function clean(path: string): string {
  const p = (path.trim().split(/[?#]/, 1)[0] ?? '').replace(/\/{2,}/g, '/');
  if (p === '') return '/';
  return p.length > 1 ? p.replace(/\/+$/, '') || '/' : p;
}

/** The lookup key of a path: ASCII lower-case, repeated slashes collapsed, no trailing slash, query or fragment. */
export const pathKey = (path: string) => asciiLower(clean(path));
const isPrefix = (from: string) => from.trim().endsWith('/*');
const base = (from: string) => pathKey(from.trim().slice(0, -2));

function target(rule: Rule, path: string): string {
  const to = rule.to.trim();
  if (!isPrefix(rule.from) || !to.endsWith('*')) return to;
  const p = clean(path);
  const b = base(rule.from);
  const rest = p.length > b.length ? p.slice(b.length).replace(/^\/+/, '') : '';
  const head = to.slice(0, -1);
  if (rest === '') return head.length > 1 ? head.replace(/\/+$/, '') : head;
  return (head.endsWith('/') ? head : `${head}/`) + rest;
}

/** The rules indexed for matching (the first rule for a key wins, as in a scan). */
export interface RedirectIndex<R extends Rule> {
  readonly rules: readonly R[];
  readonly exact: ReadonlyMap<string, R>;
  readonly prefix: ReadonlyMap<string, R>;
}

export function indexRedirects<R extends Rule>(rules: readonly R[]): RedirectIndex<R> {
  const exact = new Map<string, R>();
  const prefix = new Map<string, R>();
  for (const r of rules) {
    const [map, key] = isPrefix(r.from) ? [prefix, base(r.from)] : [exact, pathKey(r.from)];
    if (!map.has(key)) map.set(key, r);
  }
  return { rules, exact, prefix };
}

const asIndex = <R extends Rule>(rules: readonly R[] | RedirectIndex<R>): RedirectIndex<R> =>
  'exact' in rules ? rules : indexRedirects(rules);

/** The rule that applies to a path and where it sends it, or null. */
export function matchRedirect<R extends Rule>(rules: readonly R[] | RedirectIndex<R>, path: string): { rule: R; to: string } | null {
  const table = asIndex(rules);
  const key = pathKey(path);
  const exact = table.exact.get(key);
  if (exact) return { rule: exact, to: exact.to.trim() };
  for (let k = key; ;) {
    const rule = table.prefix.get(k);
    if (rule) return { rule, to: target(rule, path) };
    const cut = k.lastIndexOf('/');
    if (cut < 0 || k === '/') return null;
    k = cut === 0 ? '/' : k.slice(0, cut);
  }
}

export interface Resolved<R extends Rule> {
  /** The first rule that matched (its hit is counted). */
  rule: R;
  /** The final destination (a path, possibly with its own query, or an absolute URL). */
  to: string;
  /** 302 when any hop is temporary. */
  status: 301 | 302;
  /** The visitor's query string is kept (the first rule's setting). */
  keepQuery: boolean;
}

/** Follows the rules from a path to its final destination; null without a redirect, or when the chain loops. */
export function resolveRedirect<R extends Rule>(rules: readonly R[] | RedirectIndex<R>, path: string): Resolved<R> | null {
  const table = asIndex(rules);
  const seen = new Set([pathKey(path)]);
  let first: R | null = null;
  let status: 301 | 302 = 301;
  let current = path;
  for (let i = 0; i <= MAX_HOPS; i++) {
    const m = matchRedirect(table, current);
    if (!m) break;
    if (i === MAX_HOPS) return null;
    // A hop's own query string carries on through the chain (each later destination's own parameters win).
    const carried = i === 0 ? '' : (/\?[^#]*/.exec(current)?.[0] ?? '');
    const to = carried ? redirectLocation(m.to, carried, true) : m.to;
    first ??= m.rule;
    if (m.rule.status === 302) status = 302;
    if (!to.startsWith('/')) return { rule: first, to, status, keepQuery: first.keepQuery !== false };
    const key = pathKey(to);
    if (seen.has(key)) return null;
    seen.add(key);
    current = to;
  }
  return first ? { rule: first, to: current, status, keepQuery: first.keepQuery !== false } : null;
}

/**
 * The redirect's Location: the destination plus the visitor's query parameters when kept (a parameter the destination
 * sets itself wins). Relative destinations stay relative to the site.
 */
export function redirectLocation(to: string, search: string, keepQuery: boolean): string {
  const incoming = new URLSearchParams(search);
  incoming.delete('_rsc');
  if (!keepQuery || [...incoming.keys()].length === 0) return to;
  const hashAt = to.indexOf('#');
  const hash = hashAt >= 0 ? to.slice(hashAt) : '';
  const bare = hashAt >= 0 ? to.slice(0, hashAt) : to;
  const qAt = bare.indexOf('?');
  const path = qAt >= 0 ? bare.slice(0, qAt) : bare;
  const own = new URLSearchParams(qAt >= 0 ? bare.slice(qAt + 1) : '');
  for (const [k, v] of incoming) if (!own.has(k)) own.append(k, v);
  const query = own.toString();
  return `${path}${query ? `?${query}` : ''}${hash}`;
}
