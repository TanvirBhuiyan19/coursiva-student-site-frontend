/**
 * The learner's live schedule and calendar feed (Laravel LearnerScheduleController), and `/me/live/{id}` for the
 * schedule's sessions (the built-in room session falls through to routes/learning.ts). Mounted before learningRoutes,
 * so `/me/live/calendar` is never read as a session id.
 */
import { Hono } from 'hono';
import { type AppContext, type Env, requireUser } from '../lib/db';
import { invalid, noContent, notFound, ok } from '../lib/http';
import {
  feedIcs,
  feedStatus,
  feedUser,
  findLiveSession,
  issueFeed,
  presentLiveSession,
  revokeFeed,
  ROOM_ID,
  schedulePage,
} from '../lib/liveSchedule';

export const liveRoutes = new Hono<Env>();

liveRoutes.get('/me/live', requireUser, (c: AppContext) => {
  const scope = c.req.query('scope') ?? 'upcoming';
  if (!['upcoming', 'going', 'recordings'].includes(scope)) return invalid(c, { scope: 'The selected scope is invalid.' });
  const limit = Number(c.req.query('limit') ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return invalid(c, { limit: 'The limit must be between 1 and 50.' });
  return ok(c, schedulePage(c.get('t'), c.get('user')!, scope, limit, c.req.query('cursor') || null));
});

liveRoutes.get('/me/live/calendar', requireUser, (c: AppContext) => ok(c, feedStatus(c.get('t'), c.get('user')!)));
liveRoutes.post('/me/live/calendar', requireUser, (c: AppContext) => ok(c, issueFeed(c.get('t'), c.get('user')!), 201));
liveRoutes.delete('/me/live/calendar', requireUser, (c: AppContext) => {
  revokeFeed(c.get('t'), c.get('user')!);
  return noContent(c);
});

liveRoutes.get('/live/calendar/:file', (c: AppContext) => {
  const file = c.req.param('file') ?? '';
  const user = file.endsWith('.ics') ? feedUser(c.get('t'), file.slice(0, -4)) : null;
  if (!user) return notFound(c, 'Calendar');
  return c.body(feedIcs(c.get('t'), user), 200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store' });
});

liveRoutes.get('/me/live/:id', requireUser, async (c: AppContext, next) => {
  const id = c.req.param('id') ?? '';
  const s = id === ROOM_ID ? null : findLiveSession(c.get('t'), id);
  if (!s) return next();
  return ok(c, presentLiveSession(c.get('t'), c.get('user')!, s));
});
