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

function startSession(c: AppContext, t: TenantData, user: UserRow, remember: boolean) {
  const tk = token();
  sessions.set(tk, { tenant: t.site.slug, userId: user.id });
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

authRoutes.post('/api/v1/auth/logout', (c: AppContext) => {
  const tk = getCookie(c, SESSION);
  if (tk) sessions.delete(tk);
  deleteCookie(c, SESSION, { path: '/' });
  return noContent(c);
});

/**
 * Social sign-in. Laravel (Socialite) redirects to the provider and back to its callback, then to `next`.
 * The mock skips the provider round-trip and signs in the tenant's first seeded learner.
 */
authRoutes.get('/api/v1/auth/oauth/:provider/redirect', (c: AppContext) => {
  const t = c.get('t');
  const next = c.req.query('next') ?? '/learning';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/learning';
  if (!t.site.oauthProviders.includes(c.req.param('provider') as 'google')) return c.redirect(`/sign-in?error=oauth`, 302);
  const user = t.users[0];
  if (!user) return c.redirect(`/sign-in?error=oauth`, 302);
  startSession(c, t, user, true);
  return c.redirect(safeNext, 302);
});

authRoutes.post('/api/v1/auth/forgot-password', async (c: AppContext) => {
  const email = str((await body<{ email: string }>(c)).email).toLowerCase();
  if (!isEmail(email)) return invalid(c, { email: 'Enter a valid email address.' });
  // Always 200: never reveal whether an account exists.
  c.get('t').passwordResets.push(email);
  return ok(c, { sent: true });
});

export { CART };
