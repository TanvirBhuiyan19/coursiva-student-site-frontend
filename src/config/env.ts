import 'server-only';
import { z } from 'zod';
import { parseOrigins } from '@/lib/securityHeaders';

/**
 * Server-only environment, validated once. Never read `process.env` anywhere else. Nothing here reaches the browser:
 * the browser only ever talks to same-origin `/api/*`, which the proxy forwards to `API_URL`.
 */
const schema = z.object({
  API_URL: z.url(),
  API_SERVICE_TOKEN: z.string().min(1),
  PLATFORM_ROOT_DOMAIN: z.string().min(1),
  /** Server-to-server host resolution on API_URL (the Laravel API serves it at `/api/v1/internal/domains/resolve`). */
  API_RESOLVE_PATH: z
    .string()
    .regex(/^\/[\w/-]*$/)
    .default('/api/v1/internal/domains/resolve'),
  REVALIDATE_SECRET: z.string().min(16),
  NOINDEX_HOSTS: z.string().default(''),
  DEV_DEFAULT_TENANT: z.string().default(''),
  /** The API's learner session cookie; its presence gates private pages optimistically (the API is the real gate). */
  SESSION_COOKIE: z
    .string()
    .regex(/^[\w-]+$/)
    .default('coursiva_learner_session'),
  /** Server-side page-view reports to the API (`POST /api/v1/analytics/pageviews`, see src/features/analytics). */
  ANALYTICS_PAGEVIEWS: z.enum(['on', 'off']).default('on'),
  /**
   * The tenant dashboard's origin(s) — the only pages allowed to frame the staff preview (`/preview/*`,
   * `frame-ancestors`). Comma/space separated bare origins. Unset: the local dashboard in development, nobody in
   * production (the preview then opens only in its own tab).
   */
  DASHBOARD_ORIGIN: z
    .string()
    .optional()
    .refine((v) => v === undefined || parseOrigins(v) !== null, 'DASHBOARD_ORIGIN must be origins like https://app.example.com'),
  PORT: z.string().default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
}

/** Where the dashboard runs in local development (tenant-dashboard `npm run dev`). */
const DEV_DASHBOARD_ORIGINS = 'http://app.localhost:5174 http://localhost:5174';

export const env = {
  ...parsed.data,
  isDev: parsed.data.NODE_ENV === 'development',
  dashboardOrigins:
    parseOrigins(parsed.data.DASHBOARD_ORIGIN ?? (parsed.data.NODE_ENV === 'production' ? '' : DEV_DASHBOARD_ORIGINS)) ?? [],
  noindexHosts: parsed.data.NOINDEX_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
};
