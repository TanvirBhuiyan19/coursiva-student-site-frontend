import 'server-only';
import { z } from 'zod';

/**
 * Server-only environment, validated once. Never read `process.env` anywhere else. Nothing here reaches the browser:
 * the browser only ever talks to same-origin `/api/*`, which the proxy forwards to `API_URL`.
 */
const schema = z.object({
  API_URL: z.url(),
  API_SERVICE_TOKEN: z.string().min(1),
  PLATFORM_ROOT_DOMAIN: z.string().min(1),
  REVALIDATE_SECRET: z.string().min(16),
  NOINDEX_HOSTS: z.string().default(''),
  DEV_DEFAULT_TENANT: z.string().default(''),
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
}

export const env = {
  ...parsed.data,
  isDev: parsed.data.NODE_ENV === 'development',
  noindexHosts: parsed.data.NOINDEX_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
};
