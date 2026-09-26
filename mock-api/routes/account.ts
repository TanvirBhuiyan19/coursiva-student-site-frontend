/** Profile, password, preferences, notifications. */
import { Hono } from 'hono';
import type { PasswordInput, Preferences, Profile, ProfileInput } from '@/features/account/types';
import type { Notification } from '@/features/account/types';
import { type AppContext, type Env, initials, requireUser } from '../lib/db';
import { body, invalid, isEmail, ok, str } from '../lib/http';
import { money } from '../lib/present';
import type { TenantData, UserRow } from '../lib/records';

export const accountRoutes = new Hono<Env>();
accountRoutes.use('/me/*', requireUser);

const TIMEZONES = [
  { id: 'America/Los_Angeles', label: 'Pacific (UTC−7)' },
  { id: 'America/New_York', label: 'Eastern (UTC−4)' },
  { id: 'Europe/London', label: 'London (UTC+1)' },
  { id: 'Europe/Berlin', label: 'Berlin (UTC+2)' },
];

function presentProfile(t: TenantData, u: UserRow): Profile {
  const plan = t.membership.plans.find((p) => p.id === u.membershipPlanId);
  return {
    name: u.name,
    email: u.email,
    bio: u.bio,
    timezone: u.timezone,
    website: u.website,
    initials: initials(u.name),
    color: u.color,
    avatarUrl: null,
    timezones: TIMEZONES,
    card: u.card,
    membership:
      plan && u.membershipRenewsAt
        ? { planName: plan.name, price: money(t, plan.monthly), interval: 'month', renewsAt: u.membershipRenewsAt }
        : null,
    preferences: u.preferences,
  };
}

accountRoutes.get('/me/profile', (c: AppContext) => ok(c, presentProfile(c.get('t'), c.get('user')!)));

accountRoutes.patch('/me/profile', async (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const b = await body<ProfileInput>(c);
  const name = str(b.name);
  const email = str(b.email).toLowerCase();
  const website = str(b.website);
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'Enter your name.';
  if (!isEmail(email)) errors.email = 'Enter a valid email address.';
  else if (t.users.some((u) => u.email === email && u.id !== user.id)) errors.email = 'Another account already uses this email.';
  if (str(b.bio).length > 500) errors.bio = 'Keep your bio under 500 characters.';
  if (!TIMEZONES.some((z) => z.id === str(b.timezone))) errors.timezone = 'Choose a timezone.';
  if (website && !/^https?:\/\/\S+\.\S+/.test(website)) errors.website = 'Enter a full link, starting with https://';
  if (Object.keys(errors).length) return invalid(c, errors);
  Object.assign(user, { name, email, bio: str(b.bio), timezone: str(b.timezone), website });
  return ok(c, presentProfile(t, user));
});

accountRoutes.put('/me/password', async (c: AppContext) => {
  const user = c.get('user')!;
  const b = await body<PasswordInput>(c);
  if (b.currentPassword !== user.password) return invalid(c, { currentPassword: 'Your current password is incorrect.' });
  if (typeof b.password !== 'string' || b.password.length < 8) return invalid(c, { password: 'Passwords need at least 8 characters.' });
  user.password = b.password;
  return ok(c, { updated: true });
});

accountRoutes.put('/me/preferences', async (c: AppContext) => {
  const user = c.get('user')!;
  const b = await body<Preferences>(c);
  for (const k of ['newLessons', 'communityReplies', 'liveReminders'] as const) if (typeof b[k] === 'boolean') user.preferences[k] = b[k];
  return ok(c, user.preferences);
});

/**
 * Card and plan changes happen in the payment provider's hosted billing portal (Stripe Customer Portal).
 * The API creates a portal session and redirects; the mock redirects straight back to `return`.
 */
accountRoutes.get('/me/billing-portal', (c: AppContext) => {
  const back = c.req.query('return') ?? '/account';
  return c.redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/account', 302);
});

/** GDPR data export: everything we hold about the learner in this school, as JSON. */
accountRoutes.get('/me/export', (c: AppContext) => {
  const t = c.get('t');
  const u = c.get('user')!;
  const { password: _password, ...profile } = u;
  const data = {
    school: t.site.name,
    exportedAt: new Date().toISOString(),
    profile,
    enrollments: t.enrollments.filter((e) => e.userId === u.id),
    completedLessons: t.completions.filter((x) => x.userId === u.id),
    notes: t.notes.filter((n) => n.userId === u.id),
    quizAttempts: t.quizAttempts.filter((a) => a.userId === u.id),
    orders: t.orders.filter((o) => o.userId === u.id),
    certificates: t.certificates.filter((x) => x.userId === u.id),
    posts: t.posts.filter((p) => p.userId === u.id),
  };
  c.header('Content-Disposition', `attachment; filename="${t.site.slug}-my-data.json"`);
  return c.json(data);
});

accountRoutes.get('/me/notifications', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const rows: Notification[] = t.notifications
    .filter((n) => n.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((n) => ({ id: n.id, text: n.text, href: n.href, createdAt: n.createdAt, read: !!n.readAt }));
  return ok(c, rows);
});

accountRoutes.post('/me/notifications/read-all', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const now = new Date().toISOString();
  t.notifications.forEach((n) => {
    if (n.userId === user.id && !n.readAt) n.readAt = now;
  });
  return ok(c, { read: true });
});
