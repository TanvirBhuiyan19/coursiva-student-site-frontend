/**
 * robots.txt from the school's own rules (SEO → robots.txt) — the same rules as Laravel's RobotsRules and Go's
 * seo/robots.go, which refuse such a rule when it is saved; here it is dropped, whatever the API sent:
 *
 * - Every user-agent group the school writes gets the platform's Disallow lines for private paths (account, learning,
 *   checkout, preview, sign-in…), because a crawler obeys only its most specific group: a `User-agent: Googlebot`
 *   group without them would let Googlebot in. A private path closes itself and what is under it (`/account$` and
 *   `/account/`), never a page with a longer name (`/accounting`).
 * - An `Allow` at least as specific as a private path's Disallow (Google applies the longest match) is dropped.
 * - Unknown directives, comments and the school's `Sitemap` lines are dropped; the site's own Sitemap line is added.
 * - A `*` group is always present.
 */

/** `Allow: /account/x` length ≥ `Disallow: /account` → the Allow would win: drop it. */
export function opensPrivate(value: string, privatePaths: readonly string[]): boolean {
  const v = value.replace(/\$+$/, '');
  if (v === '') return false;
  const star = v.indexOf('*');
  const literal = (star < 0 ? v : v.slice(0, star)).replace(/[A-Z]/g, (c) => c.toLowerCase());
  return privatePaths.some((p) => {
    const bare = p.replace(/\/$/, '');
    if (v.length < bare.length) return false;
    const under = literal === bare || literal.startsWith(`${bare}/`);
    return star < 0 ? under : under || bare.startsWith(literal);
  });
}

interface Group {
  agents: string[];
  rules: string[];
}

/** The school's rules as user-agent groups (rules before any User-agent line are dropped). */
function parse(text: string, privatePaths: readonly string[]): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const directive = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim().replace(/[\r\n]/g, '');
    if (directive === 'user-agent') {
      if (!value) continue;
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value);
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (directive === 'allow') {
      if (!opensPrivate(value, privatePaths)) current.rules.push(`Allow: ${value}`);
    } else if (directive === 'disallow') current.rules.push(`Disallow: ${value}`);
    else if (directive === 'crawl-delay' && /^\d{1,3}(\.\d{1,2})?$/.test(value)) current.rules.push(`Crawl-delay: ${value}`);
  }
  return groups;
}

export interface RobotsInput {
  /** Search engines may index the site (SEO noindex off, indexing on, no site lock, not a staging host). */
  indexable: boolean;
  /** The school's own rules (`robots_txt`). */
  rules: string;
  /** Paths always closed to crawlers. */
  privatePaths: readonly string[];
  /** `https://school.example/sitemap.xml`. */
  sitemapUrl: string;
}

export function buildRobots({ indexable, rules, privatePaths, sitemapUrl }: RobotsInput): string {
  if (!indexable) return 'User-agent: *\nDisallow: /\n';
  const closed = privatePaths.flatMap((p) => (p.endsWith('/') ? [`Disallow: ${p}`] : [`Disallow: ${p}$`, `Disallow: ${p}/`]));
  const groups = parse(rules, privatePaths);
  if (!groups.some((g) => g.agents.includes('*'))) groups.push({ agents: ['*'], rules: ['Allow: /'] });
  const blocks = groups.map((g) => {
    const own = g.rules.filter((r) => !closed.includes(r));
    return [...g.agents.map((a) => `User-agent: ${a}`), ...own, ...closed].join('\n');
  });
  return `${blocks.join('\n\n')}\n\nSitemap: ${sitemapUrl}\n`;
}
