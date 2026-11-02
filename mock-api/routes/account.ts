/** Profile, password, preferences, notifications. */
import { Hono } from 'hono';
import { CANCEL_REASONS, type CancelOffer, type CancelReason } from '@/features/account/types';
import type { DiscordLink, PasswordInput, Preferences, Profile, ProfileInput } from '@/features/account/types';
import type { Notification } from '@/features/account/types';
import { type AppContext, type Env, initials, requireUser } from '../lib/db';
import { apiError, body, invalid, isEmail, noContent, notFound, ok, str } from '../lib/http';
import { money } from '../lib/present';
import type { TenantData, UserRow } from '../lib/records';
import {
  type Survey,
  cancelSubscription,
  findSubscription,
  listSubscriptions,
  present,
  resumeSubscription,
  saveOffer,
  startFlow,
} from '../lib/subscriptions';

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
  // The membership as the subscriptions list has it (cancelled, paused…), once one exists.
  const sub = listSubscriptions(t, u).find((s) => s.kind === 'membership');
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
    membership: sub
      ? {
          planName: sub.title,
          price: sub.price,
          interval: sub.interval,
          status: sub.status,
          renewsAt: sub.renewsAt,
          trialEndsAt: sub.trialEndsAt,
          resumesAt: sub.resumesAt,
          endsAt: sub.endsAt,
        }
      : plan && u.membershipRenewsAt
        ? {
            planName: plan.name,
            price: money(t, plan.monthly),
            interval: 'month',
            status: 'active',
            renewsAt: u.membershipRenewsAt,
            trialEndsAt: null,
            resumesAt: null,
            endsAt: null,
          }
        : null,
    preferences: { certificateReminders: true, ...u.preferences },
    pendingEmail: u.pendingEmail ?? null,
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
  // A new address needs the current password and stays pending until its link is opened (docs/api/account.md).
  const emailChanged = isEmail(email) && email !== user.email;
  if (!Object.keys(errors).length && emailChanged && !str(b.currentPassword))
    errors.currentPassword = 'The current password field is required when changing your email.';
  else if (!Object.keys(errors).length && emailChanged && b.currentPassword !== user.password)
    errors.currentPassword = 'The current password is incorrect.';
  if (Object.keys(errors).length) return invalid(c, errors);
  Object.assign(user, { name, bio: str(b.bio), timezone: str(b.timezone), website, pendingEmail: emailChanged ? email : null });
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
  for (const k of ['newLessons', 'communityReplies', 'liveReminders', 'certificateReminders'] as const)
    if (typeof b[k] === 'boolean') user.preferences[k] = b[k];
  return ok(c, { certificateReminders: true, ...user.preferences });
});

/**
 * Card and plan changes happen in the payment provider's hosted billing portal (Stripe Customer Portal).
 * The API creates a portal session and redirects; the mock redirects straight back to `return`.
 */
accountRoutes.get('/me/billing-portal', (c: AppContext) => {
  const user = c.get('user')!;
  // Like Laravel: nothing on file → 409 with a message (the site shows it instead of following a link).
  if (!user.card && !user.membershipPlanId)
    return c.json({ message: 'You have no payment details on file at this school yet.', code: 'conflict' }, 409);
  const back = c.req.query('return') ?? '/account';
  return c.redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/account', 302);
});

/**
 * Memberships and course subscriptions: the cancel flow with its save offers, cancel and resume (lib/subscriptions.ts,
 * docs/api/account.md → Subscriptions).
 */
const surveyOf = (b: { reason?: unknown; reasonText?: unknown }, errors: Record<string, string>): Survey => {
  const reason = b.reason === undefined || b.reason === null || b.reason === '' ? null : b.reason;
  if (reason !== null && (typeof reason !== 'string' || !(CANCEL_REASONS as readonly string[]).includes(reason)))
    errors.reason = 'The selected reason is invalid.';
  const text = str(b.reasonText);
  if (text.length > 500) errors.reasonText = 'The reason text field must not be greater than 500 characters.';
  return { reason: reason as CancelReason | null, reasonText: text || null };
};

accountRoutes.get('/me/subscriptions', (c: AppContext) => ok(c, listSubscriptions(c.get('t'), c.get('user')!)));

accountRoutes.post('/me/subscriptions/:id/cancel-flow', (c: AppContext) => {
  const t = c.get('t');
  const r = findSubscription(t, c.get('user')!, c.req.param('id') ?? '');
  if (!r) return notFound(c, 'Subscription');
  const flow = startFlow(t, r);
  return 'conflict' in flow ? apiError(c, 409, flow.conflict, 'conflict') : ok(c, flow, 201);
});

accountRoutes.post('/me/subscriptions/:id/save', async (c: AppContext) => {
  const t = c.get('t');
  const r = findSubscription(t, c.get('user')!, c.req.param('id') ?? '');
  if (!r) return notFound(c, 'Subscription');
  const b = await body<{ flowId: string; offer: string; reason: string; reasonText: string }>(c);
  const errors: Record<string, string> = {};
  if (!str(b.flowId)) errors.flowId = 'The flow id field is required.';
  if (!['pause', 'discount', 'downgrade'].includes(str(b.offer))) errors.offer = 'The selected offer is invalid.';
  const survey = surveyOf(b, errors);
  if (Object.keys(errors).length) return invalid(c, errors);
  const conflict = saveOffer(t, r, str(b.flowId), str(b.offer) as CancelOffer['key'], survey);
  return conflict ? apiError(c, 409, conflict, 'conflict') : ok(c, present(t, r));
});

accountRoutes.post('/me/subscriptions/:id/cancel', async (c: AppContext) => {
  const t = c.get('t');
  const r = findSubscription(t, c.get('user')!, c.req.param('id') ?? '');
  if (!r) return notFound(c, 'Subscription');
  const b = await body<{ flowId: string | null; reason: string; reasonText: string }>(c);
  const errors: Record<string, string> = {};
  const survey = surveyOf(b, errors);
  if (Object.keys(errors).length) return invalid(c, errors);
  const conflict = cancelSubscription(t, r, str(b.flowId) || null, survey);
  return conflict ? apiError(c, 409, conflict, 'conflict') : ok(c, present(t, r));
});

accountRoutes.post('/me/subscriptions/:id/resume', (c: AppContext) => {
  const t = c.get('t');
  const r = findSubscription(t, c.get('user')!, c.req.param('id') ?? '');
  if (!r) return notFound(c, 'Subscription');
  const conflict = resumeSubscription(r);
  return conflict ? apiError(c, 409, conflict, 'conflict') : ok(c, present(t, r));
});

/**
 * Purchased files (Laravel ProductDownloads). The mock: Jordan bought the "Launch checklist" (3 downloads); each link
 * counts, then `409 download_limit`.
 */
const DOWNLOAD = {
  orderId: 'ord_seed_dl',
  productId: 'prd_checklist',
  name: 'Launch checklist',
  fileName: 'launch-checklist.pdf',
  sizeMb: 1.2,
};
const downloadsLeft = (t: TenantData) => 3 - (t.downloadsUsed?.[`${DOWNLOAD.orderId}:${DOWNLOAD.productId}`] ?? 0);
accountRoutes.get('/me/downloads', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  // Downloads bought at the checkout (`target.kind: product`), newest first — the mock doesn't count their links.
  const bought = t.orders
    .filter((o) => o.userId === user.id && o.status === 'paid')
    .flatMap((o) =>
      o.items.flatMap((i) => {
        const p = i.kind === 'product' ? (t.products ?? []).find((x) => x.id === i.refId) : undefined;
        if (!p) return [];
        const expires = new Date(Date.parse(o.createdAt) + p.linkExpiryDays * 86_400_000).toISOString();
        return [
          {
            orderId: o.id,
            productId: p.id,
            name: p.title,
            fileName: p.fileName,
            sizeMb: p.sizeMb,
            purchasedAt: o.createdAt,
            expiresAt: expires,
            downloadsLeft: p.downloadLimit,
            available: true,
          },
        ];
      }),
    )
    .reverse();
  if (user.id !== 'usr_jordan') return ok(c, bought);
  const left = downloadsLeft(t);
  return ok(c, [
    ...bought,
    { ...DOWNLOAD, purchasedAt: '2026-09-01T10:00:00Z', expiresAt: null, downloadsLeft: left, available: left > 0 },
  ]);
});
accountRoutes.post('/me/downloads/:order/:product/link', (c: AppContext) => {
  const t = c.get('t');
  const order = t.orders.find((o) => o.id === c.req.param('order') && o.userId === c.get('user')!.id && o.status === 'paid');
  const bought = order?.items.some((i) => i.kind === 'product' && i.refId === c.req.param('product'))
    ? (t.products ?? []).find((p) => p.id === c.req.param('product'))
    : undefined;
  if (bought)
    return ok(c, {
      url: `/api/v1/files/mock/${bought.fileName}?signature=mock`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
  if (c.get('user')!.id !== 'usr_jordan' || c.req.param('order') !== DOWNLOAD.orderId || c.req.param('product') !== DOWNLOAD.productId)
    return notFound(c, 'Download');
  if (downloadsLeft(t) <= 0)
    return c.json({ message: 'You’ve used all your downloads of this file.', code: 'conflict', reason: 'download_limit' }, 409);
  t.downloadsUsed ??= {};
  const k = `${DOWNLOAD.orderId}:${DOWNLOAD.productId}`;
  t.downloadsUsed[k] = (t.downloadsUsed[k] ?? 0) + 1;
  return ok(c, {
    url: `/api/v1/files/mock/${DOWNLOAD.fileName}?signature=mock`,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
});
accountRoutes.get('/files/mock/:name', (c: AppContext) =>
  c.body('%PDF-1.4 mock', 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${c.req.param('name') ?? 'file'}"`,
  }),
);

/**
 * One-question surveys e-mailed by the school (`/account?survey={id}`). The mock has one, `sr_demo`; answers are kept
 * per learner in memory and a second answer is a 409 like Laravel's.
 */
const SURVEYS: Record<string, string> = { sr_demo: 'What should we teach next?' };
accountRoutes.get('/me/surveys/:id', (c: AppContext) => {
  const sid = c.req.param('id') ?? '';
  const question = SURVEYS[sid];
  if (!question) return notFound(c, 'Survey');
  return ok(c, { id: sid, question, answered: (c.get('t').surveyAnswers ?? []).includes(`${c.get('user')!.id}:${sid}`) });
});
accountRoutes.post('/me/surveys/:id/answers', async (c: AppContext) => {
  const sid = c.req.param('id') ?? '';
  if (!SURVEYS[sid]) return notFound(c, 'Survey');
  const b = await body<{ score: number | null; text: string }>(c);
  const score = b.score ?? null;
  if (score !== null && (!Number.isInteger(score) || score < 0 || score > 10)) return invalid(c, { score: 'Pick a score from 0 to 10.' });
  if (score === null && !str(b.text)) return invalid(c, { text: 'Write an answer (2,000 characters max).' });
  const key = `${c.get('user')!.id}:${sid}`;
  const t = c.get('t');
  t.surveyAnswers ??= [];
  if (t.surveyAnswers.includes(key)) return c.json({ message: 'You already answered this survey — thank you!', code: 'conflict' }, 409);
  t.surveyAnswers.push(key);
  return ok(c, { received: true }, 201);
});

/**
 * Discord (Laravel: docs/sync.md → Discord). Laravel's `link` 302s to Discord (`identify guilds.join`, PKCE) and the
 * callback lands back on `next` with `?discord=linked` or `?discord=error&reason=not_available|denied|expired|
 * exchange_failed|already_linked`. The mock skips Discord and links a made-up account; `?mock_reason=` simulates a
 * failure. `next` must be a same-site path (default `/account`).
 */
const discordNext = (next: string | undefined) =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && next.length <= 2000 ? next : '/account';
const withDiscordStatus = (next: string, reason: string | null) => {
  const path = next.split('#')[0]!;
  const query = new URLSearchParams(reason === null ? { discord: 'linked' } : { discord: 'error', reason }).toString();
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
};

accountRoutes.get('/me/discord', (c: AppContext) => {
  const t = c.get('t');
  const link = t.discordLinks.find((l) => l.userId === c.get('user')!.id);
  const out: DiscordLink = {
    available: t.discord.available,
    linked: !!link,
    username: link?.username ?? null,
    linkedAt: link?.linkedAt ?? null,
    needsRelink: link?.status === 'needs_relink',
  };
  return ok(c, out);
});

accountRoutes.get('/me/discord/link', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const next = discordNext(c.req.query('next'));
  if (!t.discord.available) return c.redirect(withDiscordStatus(next, 'not_available'), 302);
  const simulated = c.req.query('mock_reason');
  if (simulated) return c.redirect(withDiscordStatus(next, simulated), 302);
  const handle = user.email
    .split('@')[0]!
    .replace(/[^a-z0-9_.]/gi, '')
    .toLowerCase();
  const discordUserId = `10${String(1e15 + t.users.indexOf(user))}`;
  t.discordLinks = t.discordLinks.filter((l) => l.userId !== user.id);
  t.discordLinks.push({ userId: user.id, discordUserId, username: handle, linkedAt: new Date().toISOString(), status: 'linked' });
  return c.redirect(withDiscordStatus(next, null), 302);
});

/** 204 whether or not there was a link; Laravel also removes the managed roles and revokes the grant (queued). */
accountRoutes.delete('/me/discord', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  t.discordLinks = t.discordLinks.filter((l) => l.userId !== user.id);
  return noContent(c);
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
