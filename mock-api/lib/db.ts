import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { amplify } from '../seed/amplify';
import { northwind } from '../seed/northwind';
import type { TenantData, UserRow } from './records';

/**
 * In-memory "database", one isolated dataset per tenant (row-level isolation: every route reads through `tenantOf`).
 * State lives for the life of the process; `POST /__mock/reset` restores the seed (used by e2e tests).
 */
const seeds: Record<string, () => TenantData> = { amplify, northwind };
let tenants = new Map<string, TenantData>();
export const sessions = new Map<string, { tenant: string; userId: string }>();

export function reset() {
  tenants = new Map(Object.entries(seeds).map(([slug, seed]) => [slug, seed()]));
  sessions.clear();
}
reset();

export const allTenants = () => [...tenants.values()];

/** Custom domains map straight to a tenant; `<slug>.<root>` subdomains resolve by slug. */
const customDomains: Record<string, string> = { 'learn.northwindyoga.test': 'northwind' };

export function resolveHost(host: string, rootDomain: string): TenantData | null {
  const bare = host.toLowerCase().replace(/:\d+$/, '');
  const custom = customDomains[bare];
  if (custom) return tenants.get(custom) ?? null;
  if (bare.endsWith(`.${rootDomain}`)) return tenants.get(bare.slice(0, -rootDomain.length - 1)) ?? null;
  return null;
}

export type Env = { Variables: { t: TenantData; user: UserRow | null } };
export type AppContext = Context<Env>;

/** Every tenant API request names its tenant: `X-Tenant` (server-to-server) or the forwarded host (browser via the proxy). */
export const withTenant: MiddlewareHandler<Env> = async (c, next) => {
  const slug = c.req.header('x-tenant');
  const t = slug ? tenants.get(slug) : undefined;
  if (!t) return c.json({ message: 'Unknown tenant.' }, 404);
  if (t.resolution.status === 'suspended') return c.json({ message: 'This site is unavailable.' }, 503);
  c.set('t', t);
  const token = getCookie(c, 'coursiva_session');
  const session = token ? sessions.get(token) : undefined;
  c.set('user', session && session.tenant === t.site.slug ? (t.users.find((u) => u.id === session.userId) ?? null) : null);
  await next();
};

/** Sanctum's CSRF check: mutating requests must echo the XSRF-TOKEN cookie in the X-XSRF-TOKEN header. */
export const csrf: MiddlewareHandler<Env> = async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) && !c.req.header('authorization')) {
    const cookie = getCookie(c, 'XSRF-TOKEN');
    const header = c.req.header('x-xsrf-token');
    if (!cookie || !header || decodeURIComponent(cookie) !== header)
      return new Response(JSON.stringify({ message: 'CSRF token mismatch.' }), {
        status: 419,
        headers: { 'content-type': 'application/json' },
      });
  }
  await next();
};

export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('user')) return c.json({ message: 'Unauthenticated.' }, 401);
  await next();
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
