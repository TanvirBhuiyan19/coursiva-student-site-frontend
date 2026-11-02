/** Sanctum-style session auth. Cookies are set without a Domain, so they bind to the tenant host the browser used. */
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { LoginInput, RegisterInput, User } from '@/features/auth/types';
import { type AppContext, type Env, initials, sessions } from '../lib/db';
import { body, id, invalid, isEmail, noContent, ok, str, unauthorized } from '../lib/http';
import type { TenantData, UserRow } from '../lib/records';

export const authRoutes = new Hono<Env>();

const SESSION = 'coursiva_session';
const CART = 'cart_token';
const token = () => randomBytes(24).toString('base64url');
const secure = process.env.NODE_ENV === 'production';

export function presentUser(t: TenantData, u: UserRow): User {
  const cart = t.carts.find((x) => x.owner === u.id);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    initials: initials(u.name),
    avatarUrl: null,
    color: u.color,
    bio: u.bio,
    timezone: u.timezone,
    website: u.website,
    membershipPlanId: u.membershipPlanId,
    streakDays: t.site.features.streaks ? u.streakDays : 0,
    cartCount: cart?.courseIds.length ?? 0,
    wishlistCount: t.wishlist.filter((w) => w.userId === u.id).length,
    unreadNotifications: t.notifications.filter((n) => n.userId === u.id && !n.readAt).length,
  };
}

/** Guest cart (cart_token cookie) merges into the account cart on sign-in — nothing a guest added is lost. */
function mergeGuestCart(c: AppContext, t: TenantData, userId: string) {
  const guestToken = getCookie(c, CART);
  if (!guestToken) return;
  const guest = t.carts.find((x) => x.owner === `guest:${guestToken}`);
  if (guest) {
    let mine = t.carts.find((x) => x.owner === userId);
    if (!mine) t.carts.push((mine = { owner: userId, courseIds: [] }));
    const owned = new Set(t.enrollments.filter((e) => e.userId === userId).map((e) => e.courseId));
    for (const cid of guest.courseIds) if (!mine.courseIds.includes(cid) && !owned.has(cid)) mine.courseIds.push(cid);
    t.carts = t.carts.filter((x) => x !== guest);
  }
  deleteCookie(c, CART, { path: '/' });
}

export function startSession(c: AppContext, t: TenantData, user: UserRow, remember: boolean, saml = false) {
  const tk = token();
  sessions.set(tk, { tenant: t.site.slug, userId: user.id, ...(saml ? { saml: true } : {}) });
  setCookie(c, SESSION, tk, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });
  mergeGuestCart(c, t, user.id);
}

authRoutes.get('/sanctum/csrf-cookie', (c) => {
  setCookie(c, 'XSRF-TOKEN', token(), { sameSite: 'Lax', secure, path: '/' });
  return noContent(c);
});

authRoutes.get('/api/v1/me', (c: AppContext) => {
  const user = c.get('user');
  return user ? ok(c, presentUser(c.get('t'), user)) : unauthorized(c);
});

authRoutes.post('/api/v1/auth/login', async (c: AppContext) => {
  const b = await body<LoginInput>(c);
  const t = c.get('t');
  const email = str(b.email).toLowerCase();
  if (!isEmail(email)) return invalid(c, { email: 'Enter a valid email address.' });
  if (str(b.password).length < 8) return invalid(c, { password: 'Passwords need at least 8 characters.' });
  const user = t.users.find((u) => u.email === email && u.password === b.password);
  if (!user) return invalid(c, { email: 'That email and password don’t match an account.' });
  startSession(c, t, user, b.remember === true);
  return ok(c, presentUser(t, user));
});

authRoutes.post('/api/v1/auth/register', async (c: AppContext) => {
  const b = await body<RegisterInput>(c);
  const t = c.get('t');
  const name = str(b.name);
  const email = str(b.email).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  // Group invite link (`/join/{group}`): Laravel claims a seat; the mock knows one full group.
  if (b.group === 'full-team') return invalid(c, { group: 'This invite link is full or no longer valid. Ask your manager for a seat.' });
  if (!name) return invalid(c, { name: 'Enter your name.' });
  if (!isEmail(email)) return invalid(c, { email: 'Enter a valid email address.' });
  if (password.length < 8) return invalid(c, { password: 'Passwords need at least 8 characters.' });
  if (t.users.some((u) => u.email === email)) return invalid(c, { email: 'An account with this email already exists — sign in instead.' });
  const user: UserRow = {
    id: id('usr'),
    name,
    email,
    password,
    color: 'oklch(0.52 0.13 240)',
    bio: '',
    timezone: 'America/New_York',
    website: '',
    createdAt: new Date().toISOString(),
    preferences: { newLessons: true, communityReplies: true, liveReminders: true },
    card: null,
    weeklyGoal: 3,
    streakDays: 0,
    weekActivity: [0, 0, 0, 0, 0, 0, 0],
    membershipPlanId: null,
    membershipRenewsAt: null,
  };
  t.users.push(user);
  startSession(c, t, user, false);
  return ok(c, presentUser(t, user), 201);
});

/**
 * Ends the session: `204`. A SAML session (Laravel: when the school's IdP has a single logout endpoint) answers
 * `200 { redirect_url }` — the IdP URL carrying a signed LogoutRequest. The mock's "IdP" is its own
 * `/api/v1/auth/saml/slo`, which ends the round trip on `/sign-in` as Laravel does after the IdP's LogoutResponse.
 */
authRoutes.post('/api/v1/auth/logout', (c: AppContext) => {
  const tk = getCookie(c, SESSION);
  const saml = tk ? sessions.get(tk)?.saml === true : false;
  if (tk) sessions.delete(tk);
  deleteCookie(c, SESSION, { path: '/' });
  if (saml) return ok(c, { redirectUrl: `${new URL(c.req.url).origin}/api/v1/auth/saml/slo?SAMLRequest=mock` });
  return noContent(c);
});

/**
 * SAML single logout (Laravel: docs/sso.md → Single logout). Laravel validates the IdP's signed LogoutRequest or
 * LogoutResponse and redirects to `/sign-in` (or `/sign-in?sso_error=logout_incomplete` for a refused response); the
 * mock skips the IdP and lands on `/sign-in`, or `?mock_error=` simulates a refusal.
 */
authRoutes.get('/api/v1/auth/saml/slo', (c: AppContext) => {
  if (!c.get('t').site.ssoEnabled) return c.json({ message: 'Not found.' }, 404);
  const simulated = c.req.query('mock_error');
  return c.redirect(simulated ? `/sign-in?sso_error=${encodeURIComponent(simulated)}` : '/sign-in', 302);
});

/** Laravel's same-origin `next` rule for social/SAML sign-in: a path, no `//`, `\`, control characters or `/sign-*`. */
const safeNext = (next: string | undefined) =>
  next &&
  next.startsWith('/') &&
  !next.startsWith('//') &&
  !next.includes('\\') &&
  !Array.from({ length: next.length }, (_, i) => next.charCodeAt(i)).some((code) => code < 32) &&
  !next.startsWith('/sign-')
    ? next
    : '/learning';

/**
 * Social sign-in. Laravel redirects to the provider and back through its callback, then to `next`; failures land on
 * `/sign-in?error=oauth&reason=…&next=…` (not_configured, denied, expired, email_unverified, exchange_failed,
 * signup_closed, signup_failed, suspended, not_a_learner). The mock skips the provider and signs in the first learner;
 * `?mock_reason=` simulates a failure.
 */
authRoutes.get('/api/v1/auth/oauth/:provider/redirect', (c: AppContext) => {
  const t = c.get('t');
  const next = safeNext(c.req.query('next'));
  const fail = (reason: string) => c.redirect(`/sign-in?${new URLSearchParams({ error: 'oauth', reason, next }).toString()}`, 302);
  const provider = c.req.param('provider') ?? '';
  // A provider the platform switched off (`signin_{provider}`) is refused like one with no OAuth client.
  if (!t.site.oauthProviders.includes(provider) || t.unavailable?.includes(`signin_${provider}`)) return fail('not_configured');
  const simulated = c.req.query('mock_reason');
  if (simulated) return fail(simulated);
  const user = t.users[0];
  if (!user) return fail('signup_closed');
  startSession(c, t, user, true);
  return c.redirect(next, 302);
});

/**
 * SAML single sign-on (Laravel: docs/sso.md). 404 unless the school has SAML on; the IdP round-trip ends at the ACS,
 * which signs the learner in and redirects to `next`, or to `/sign-in?sso_error={reason}`. The mock signs in the first
 * learner; `?mock_error=` simulates a failure.
 */
authRoutes.get('/api/v1/auth/saml/login', (c: AppContext) => {
  const t = c.get('t');
  if (!t.site.ssoEnabled || t.unavailable?.includes('sso')) return c.json({ message: 'Not found.' }, 404);
  const simulated = c.req.query('mock_error');
  if (simulated) return c.redirect(`/sign-in?sso_error=${encodeURIComponent(simulated)}`, 302);
  const user = t.users[0];
  if (!user) return c.redirect('/sign-in?sso_error=quota', 302);
  startSession(c, t, user, true, true);
  return c.redirect(safeNext(c.req.query('next')), 302);
});

authRoutes.post('/api/v1/auth/forgot-password', async (c: AppContext) => {
  const email = str((await body<{ email: string }>(c)).email).toLowerCase();
  if (!isEmail(email)) return invalid(c, { email: 'Enter a valid email address.' });
  // Always 200: never reveal whether an account exists.
  c.get('t').passwordResets.push(email);
  return ok(c, { sent: true });
});

/**
 * Password reset (also the invited learner's "set your password" link). The mock accepts the token `reset-valid` for
 * any learner's email; anything else is an expired link, as Laravel words it.
 */
authRoutes.post('/api/v1/auth/reset-password', async (c: AppContext) => {
  const b = await body<{ email: string; token: string; password: string; passwordConfirmation: string }>(c);
  const t = c.get('t');
  const email = str(b.email).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 8) return invalid(c, { password: 'The password field must be at least 8 characters.' });
  if (password !== b.passwordConfirmation) return invalid(c, { password: 'The password field confirmation does not match.' });
  const user = t.users.find((u) => u.email === email);
  if (!user || b.token !== 'reset-valid') return invalid(c, { token: 'This password reset link is invalid or has expired.' });
  user.password = password;
  return c.json({ data: { reset: true }, message: 'Your password has been reset. You can sign in now.' });
});

/**
 * Email confirmation link. The mock accepts `verify-valid`; anything else is Laravel's 410 `invalid_token` answer
 * (never 419, which the client would read as an expired CSRF token).
 */
authRoutes.post('/api/v1/auth/email/verify', async (c: AppContext) => {
  const tk = str((await body<{ token: string }>(c)).token);
  if (!tk) return invalid(c, { token: 'The token field is required.' });
  if (tk !== 'verify-valid')
    return new Response(JSON.stringify({ message: 'This confirmation link is invalid or has expired.', code: 'invalid_token' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    });
  return ok(c, { verified: true });
});

/** Sends a fresh confirmation link to the signed-in learner. */
authRoutes.post('/api/v1/auth/email/verification-notification', (c: AppContext) => {
  if (!c.get('user')) return unauthorized(c);
  return ok(c, { sent: true });
});

export { CART };
