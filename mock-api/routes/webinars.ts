/**
 * Public webinars (Track F; Laravel Live\Http\WebinarController + Tickets\Webinars): the page, name-and-email
 * registration (honeypot, form token; Turnstile is off in the mock) and the personal join link.
 *
 * The join link `wjt_demo_guest` stands for a guest account's link: it signs the demo learner (jordan.tate@gmail.com)
 * in and opens "Email copy clinic". Links made by a mock registration answer like an account with a password
 * (`401 sign_in_required`), or the signed-in owner's / someone else's link (`403 join_link_not_yours`).
 */
import { Hono } from 'hono';
import { type AppContext, type Env } from '../lib/db';
import { body, invalid, isEmail, notFound, ok, str } from '../lib/http';
import { findWebinar, presentWebinar, registerWebinar, webinarByToken } from '../lib/liveSchedule';
import { startSession } from './auth';

export const webinarRoutes = new Hono<Env>();

export const DEMO_JOIN_TOKEN = 'wjt_demo_guest';

webinarRoutes.post('/webinars/join', async (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user');
  const token = str((await body<{ t?: string }>(c)).t);
  if (!token || token.length > 64) return invalid(c, { t: 'This join link is invalid.' });
  if (token === DEMO_JOIN_TOKEN) {
    const demo = t.users.find((u) => u.email === 'jordan.tate@gmail.com') ?? t.users[0]!;
    if (user && user.id !== demo.id)
      return c.json({ message: 'This join link belongs to another student.', code: 'forbidden', reason: 'join_link_not_yours' }, 403);
    if (!user) startSession(c, t, demo, false);
    return ok(c, { sessionId: 'evt_tomorrow', signedIn: !user });
  }
  const reg = webinarByToken(t, token);
  if (!reg) return c.json({ message: 'This join link is invalid or the session was cancelled.', code: 'invalid_token' }, 410);
  if (user && user.email === reg.email) return ok(c, { sessionId: reg.sessionId, signedIn: false });
  if (user) return c.json({ message: 'This join link belongs to another student.', code: 'forbidden', reason: 'join_link_not_yours' }, 403);
  return c.json(
    { message: 'Sign in to join this session.', code: 'unauthenticated', reason: 'sign_in_required', session_id: reg.sessionId },
    401,
  );
});

webinarRoutes.get('/webinars/:slug', (c: AppContext) => {
  const s = findWebinar(c.get('t'), c.req.param('slug') ?? '');
  return s ? ok(c, presentWebinar(c.get('t'), s)) : notFound(c, 'Webinar');
});

webinarRoutes.post('/webinars/:slug/registrations', async (c: AppContext) => {
  const t = c.get('t');
  const s = findWebinar(t, c.req.param('slug') ?? '');
  if (!s) return notFound(c, 'Webinar');
  const b = await body<{ name?: string; email?: string; token?: string; website?: string }>(c);
  const errors: Record<string, string> = {};
  const name = str(b.name);
  const email = str(b.email).toLowerCase();
  if (name.length < 2 || name.length > 120) errors.name = 'Enter your name.';
  if (!isEmail(email)) errors.email = 'Enter a valid email address.';
  if (Object.keys(errors).length) return invalid(c, errors);
  if (str(b.website)) return ok(c, { next: 'check_email', status: 'registered' });
  const token = str(b.token);
  if (!token.startsWith(`wbt.${s.id}.`)) return invalid(c, { token: 'This form has expired. Reload the page and try again.' });
  if (s.endedAt) return c.json({ message: 'Registration is closed for this webinar.', code: 'conflict' }, 409);
  const access = s.access ?? 'free';
  if (access === 'paid') return ok(c, { next: 'checkout', status: null, checkoutUrlPath: `/checkout?live=${s.id}` });
  if (access === 'members') return ok(c, { next: 'membership', status: null, membershipUrlPath: '/membership' });
  const reg = registerWebinar(t, s, email);
  return ok(c, { next: 'check_email', status: reg.status });
});
