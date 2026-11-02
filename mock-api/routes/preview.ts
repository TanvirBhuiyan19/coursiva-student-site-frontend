/**
 * Staff preview (course builder v2 O7; docs/api/learning.md → Staff preview). No learner session: the token in the
 * path is the only credential, so these routes sit outside the CSRF middleware (nothing here reads cookies) and never
 * set a cookie. Nothing is recorded — no progress, time, playback, answers or analytics; checks and sorting are graded
 * statelessly. Every answer is `Cache-Control: no-store` + `X-Robots-Tag: noindex`.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { type AppContext, type Env, withTenant } from '../lib/db';
import { gradeCheck, gradeSort } from '../lib/blocks';
import { apiError, body, invalid, notFound, ok } from '../lib/http';
import { findPreviewLesson, PREVIEW_EXPIRED_MESSAGE, previewLesson, previewScope, previewSession, type PreviewScope } from '../lib/preview';
import { lessonDescription, lessonResources } from './learning';

export const previewRoutes = new Hono<Env>();

const headers: MiddlewareHandler<Env> = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex');
};
previewRoutes.use('*', headers, withTenant);

const expired = (c: AppContext) => c.json({ message: PREVIEW_EXPIRED_MESSAGE, code: 'not_found' }, 404);

function scopeOf(c: AppContext): PreviewScope | null {
  return previewScope(c.get('t'), c.req.param('token') ?? '');
}

/** 60 answers a minute per token (check and sort together). */
const LIMIT = 60;
function throttled(c: AppContext, token: string): boolean {
  const t = c.get('t');
  const hits = ((t.previewHits ??= {})[token] ??= []);
  const now = Date.now();
  const recent = hits.filter((at) => now - at < 60_000);
  if (recent.length >= LIMIT) {
    t.previewHits[token] = recent;
    return true;
  }
  recent.push(now);
  t.previewHits[token] = recent;
  return false;
}

previewRoutes.get('/:token', (c: AppContext) => {
  const s = scopeOf(c);
  return s ? ok(c, previewSession(s)) : expired(c);
});

previewRoutes.get('/:token/lessons/:lessonId', (c: AppContext) => {
  const s = scopeOf(c);
  if (!s) return expired(c);
  const entry = findPreviewLesson(s, c.req.param('lessonId') ?? '');
  if (!entry) return notFound(c, 'Lesson');
  return ok(
    c,
    previewLesson(c.get('t'), s, entry, { description: lessonDescription(entry.lesson), resources: lessonResources(entry.lesson) }),
  );
});

previewRoutes.post('/:token/lessons/:lessonId/blocks/:blockId/check', async (c: AppContext) => {
  const s = scopeOf(c);
  if (!s) return expired(c);
  const entry = findPreviewLesson(s, c.req.param('lessonId') ?? '');
  if (!entry) return notFound(c, 'Lesson');
  if (throttled(c, s.token)) return apiError(c, 429, 'Too many requests.', 'too_many_requests');
  const b = await body<{ optionIds: unknown; text: unknown }>(c);
  const out = gradeCheck(c.get('t'), entry.lesson.id, null, c.req.param('blockId') ?? '', b);
  if ('notFound' in out) return notFound(c, 'Block');
  if ('invalid' in out) return invalid(c, out.invalid);
  return ok(c, out.data);
});

previewRoutes.post('/:token/lessons/:lessonId/blocks/:blockId/sort', async (c: AppContext) => {
  const s = scopeOf(c);
  if (!s) return expired(c);
  const entry = findPreviewLesson(s, c.req.param('lessonId') ?? '');
  if (!entry) return notFound(c, 'Lesson');
  if (throttled(c, s.token)) return apiError(c, 429, 'Too many requests.', 'too_many_requests');
  // Raw keys: placements are keyed by item id (data, not field names).
  let placements: unknown = null;
  try {
    const raw: unknown = await c.req.json();
    if (raw !== null && typeof raw === 'object' && 'placements' in raw) placements = raw.placements;
  } catch {
    placements = null;
  }
  const out = gradeSort(c.get('t'), entry.lesson.id, null, c.req.param('blockId') ?? '', placements);
  if ('notFound' in out) return notFound(c, 'Block');
  if ('invalid' in out) return invalid(c, out.invalid);
  return ok(c, out.data);
});

/** Anything else under the preview (e.g. a `continue` gate, which only the browser passes) is unknown. */
previewRoutes.all('*', (c: AppContext) => notFound(c));
