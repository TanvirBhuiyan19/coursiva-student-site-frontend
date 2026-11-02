/** Community: spaces (with per-learner access), posts, likes, events, leaderboard. */
import { Hono } from 'hono';
import { FLAG_REASONS, type CommunityOverview, type NewPostInput, type Post, type Reply, type Space } from '@/features/community/types';
import { type AppContext, type Env, requireUser } from '../lib/db';
import { apiError, body, forbidden, id, invalid, noContent, notFound, ok, paginate, str } from '../lib/http';
import { boughtTicket, findLiveSession, needsTicket, presentLiveItem } from '../lib/liveSchedule';
import { isEnrolled, person } from '../lib/present';
import type { PostRow, ReplyRow, SpaceRow, TenantData, UserRow } from '../lib/records';
import { presentEvent } from './learning';

export const communityRoutes = new Hono<Env>();

// Scoped to the community paths: this router is mounted on /api/v1 with the others, so '*' would 404 every later
// route (account, assessments…) on a school without the community.
const requireCommunity = async (c: AppContext, next: () => Promise<void>) => {
  if (!c.get('t').site.features.community) return notFound(c, 'Community');
  await next();
};
communityRoutes.use('/community', requireCommunity);
communityRoutes.use('/community/*', requireCommunity);

function access(t: TenantData, user: UserRow | null, s: SpaceRow): { locked: boolean; reason: string | null } {
  if (s.access === 'course' && s.courseId && !isEnrolled(t, user, s.courseId)) {
    return { locked: true, reason: `Enrol in ${t.courses.find((c) => c.id === s.courseId)?.title ?? 'this course'} to join this space` };
  }
  if (s.access === 'paid' && user?.membershipPlanId !== 'plan_inner')
    return { locked: true, reason: 'Join Inner Circle to open this space' };
  return { locked: false, reason: null };
}

const postCount = (t: TenantData, s: SpaceRow) =>
  s.id === 'sp_all'
    ? t.posts.length + 20
    : t.posts.filter((p) => p.spaceId === s.id).length +
      ({ sp_intro: 4, sp_wins: 6, sp_q: 10, sp_f: 18, sp_e: 9, sp_b: 4, sp_w: 6, sp_q3: 12, sp_inner: 7 }[s.id] ?? 0);

communityRoutes.get('/community', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user');
  const spaces: Space[] = t.spaces.map((s) => {
    const a = access(t, user, s);
    return {
      id: s.id,
      name: s.name,
      group: s.group,
      access: s.access,
      postCount: postCount(t, s),
      locked: a.locked,
      lockedReason: a.reason,
      courseSlug: s.courseId ? (t.courses.find((x) => x.id === s.courseId)?.slug ?? null) : null,
    };
  });
  const event = presentEvent(t, user);
  const later = new Date(new Date(event.startsAt).getTime() + 7 * 86_400_000).toISOString();
  const overview: CommunityOverview = {
    name: `${t.site.name} Community`,
    memberCount: t.instructor.studentCount,
    onlineCount: 38,
    newThisWeek: 34,
    guidelines: 'Be kind · no self-promo · search before asking',
    spaces,
    leaderboard: t.leaderboard.map((l, i) => ({
      rank: i + 1,
      person: person(l.name, l.color),
      points: l.points,
      isMe: l.name === user?.name,
    })),
    events: [
      event,
      {
        id: 'evt_2',
        title: 'Landing page teardowns',
        startsAt: later,
        provider: event.provider,
        attendees: 0,
        going: false,
        joinUrl: null,
      },
    ],
  };
  return ok(c, overview);
});

function presentPost(t: TenantData, user: UserRow | null, p: PostRow): Post {
  const liked = !!user && t.likes.some((l) => l.userId === user.id && l.postId === p.id);
  return {
    id: p.id,
    spaceId: p.spaceId,
    spaceName: t.spaces.find((s) => s.id === p.spaceId)?.name ?? '',
    author: { ...person(p.name, p.color), isInstructor: p.isCoach },
    body: p.body,
    likes: p.likes + (liked ? 1 : 0),
    liked,
    replies: p.thread?.length ?? p.replies,
    held: !!p.held,
    createdAt: p.createdAt,
  };
}

const SEED_REPLIERS = [
  { name: 'Priya Shah', color: 'oklch(0.5 0.14 160)' },
  { name: 'Tom Becker', color: 'oklch(0.5 0.15 30)' },
  { name: 'Lena Ortiz', color: 'oklch(0.5 0.15 220)' },
];
const SEED_REPLY_BODIES = ['This helped me a lot, thanks!', 'Same here: the second module made it click.', 'Great point. Saving this.'];

/** The thread of a post; seeded posts get their seeded count of replies (deterministic), oldest first. */
function thread(p: PostRow): ReplyRow[] {
  p.thread ??= Array.from({ length: p.replies }, (_, i) => {
    const who = SEED_REPLIERS[i % SEED_REPLIERS.length]!;
    return {
      id: `${p.id}_r${i + 1}`,
      userId: null,
      name: who.name,
      color: who.color,
      isCoach: false,
      body: SEED_REPLY_BODIES[i % SEED_REPLY_BODIES.length]!,
      createdAt: new Date(new Date(p.createdAt).getTime() + (i + 1) * 600_000).toISOString(),
    };
  });
  return p.thread;
}

const presentReply = (r: ReplyRow): Reply => ({
  id: r.id,
  author: { ...person(r.name, r.color), isInstructor: r.isCoach },
  body: r.body,
  createdAt: r.createdAt,
});

/** A published post the visitor can read (404 / 403 otherwise), like the backends' `readable`. */
function readable(c: AppContext): PostRow | Response {
  const t = c.get('t');
  const p = t.posts.find((x) => x.id === c.req.param('id') && !x.held);
  if (!p) return notFound(c, 'Post');
  const space = t.spaces.find((s) => s.id === p.spaceId);
  const a = space ? access(t, c.get('user'), space) : { locked: false, reason: null };
  return a.locked ? forbidden(c, a.reason ?? undefined) : p;
}

communityRoutes.get('/community/posts', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user');
  const spaceId = c.req.query('space') ?? 'sp_all';
  const space = t.spaces.find((s) => s.id === spaceId);
  if (!space) return notFound(c, 'Space');
  if (access(t, user, space).locked) return forbidden(c, access(t, user, space).reason ?? undefined);
  const rows = t.posts.filter((p) => !p.held && (spaceId === 'sp_all' || p.spaceId === spaceId));
  const sorted =
    c.req.query('sort') === 'top'
      ? [...rows].sort((a, b) => b.likes - a.likes)
      : [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return paginate(
    c,
    sorted.map((p) => presentPost(t, user, p)),
  );
});

communityRoutes.post('/community/posts', requireUser, async (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const b = await body<NewPostInput>(c);
  const text = str(b.body);
  const space = t.spaces.find((s) => s.id === str(b.spaceId));
  if (!space || space.id === 'sp_all') return invalid(c, { spaceId: 'Choose a space to post in.' });
  if (access(t, user, space).locked) return forbidden(c, access(t, user, space).reason ?? undefined);
  if (text.length < 2) return invalid(c, { body: 'Write something first.' });
  if (text.length > 5000) return invalid(c, { body: 'Posts can be up to 5,000 characters.' });
  // Laravel Community::holdReason: a link from a member with fewer than 3 published posts waits for a moderator.
  const held = /https?:\/\/|www\./i.test(text) && t.posts.filter((p) => p.userId === user.id && !p.held).length < 3;
  const row: PostRow = {
    held,
    id: id('post'),
    spaceId: space.id,
    userId: user.id,
    name: user.name,
    color: user.color,
    isCoach: false,
    body: text,
    likes: 0,
    replies: 0,
    createdAt: new Date().toISOString(),
  };
  t.posts.unshift(row);
  return ok(c, presentPost(t, user, row), 201);
});

communityRoutes.put('/community/posts/:id/like', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const p = t.posts.find((x) => x.id === c.req.param('id'));
  if (!p) return notFound(c, 'Post');
  if (!t.likes.some((l) => l.userId === user.id && l.postId === p.id)) t.likes.push({ userId: user.id, postId: p.id });
  return ok(c, presentPost(t, user, p));
});

communityRoutes.delete('/community/posts/:id/like', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const p = t.posts.find((x) => x.id === c.req.param('id'));
  if (!p) return notFound(c, 'Post');
  t.likes = t.likes.filter((l) => !(l.userId === user.id && l.postId === p.id));
  return ok(c, presentPost(t, user, p));
});

communityRoutes.get('/community/posts/:id/replies', (c: AppContext) => {
  const p = readable(c);
  if (p instanceof Response) return p;
  return ok(c, thread(p).slice(0, 200).map(presentReply));
});

communityRoutes.post('/community/posts/:id/replies', requireUser, async (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const p = readable(c);
  if (p instanceof Response) return p;
  const text = str((await body<{ body: string }>(c)).body);
  if (text.length < 2 || text.length > 5000) return invalid(c, { body: 'Write a reply (5,000 characters max).' });
  thread(p).push({
    id: id('rep'),
    userId: user.id,
    name: user.name,
    color: user.color,
    isCoach: false,
    body: text,
    createdAt: new Date().toISOString(),
  });
  return ok(c, presentPost(t, user, p), 201);
});

communityRoutes.post('/community/posts/:id/flags', requireUser, async (c: AppContext) => {
  const user = c.get('user')!;
  const p = readable(c);
  if (p instanceof Response) return p;
  const reason = str((await body<{ reason?: string }>(c)).reason) || null;
  if (reason !== null && !(FLAG_REASONS as readonly string[]).includes(reason))
    return invalid(c, { reason: 'Choose why you’re reporting this post.' });
  if (p.userId !== user.id) {
    p.flags ??= [];
    if (!p.flags.some((f) => f.userId === user.id)) p.flags.push({ userId: user.id, reason });
    if (p.flags.length >= 3) p.held = true;
  }
  return c.json({ data: { flagged: true } }, 202);
});

communityRoutes.put('/community/events/:id/rsvp', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const eventId = c.req.param('id') ?? '';
  // The community event, or another session of the live schedule (mock-api/lib/liveSchedule.ts).
  const other = eventId === t.event.id ? null : findLiveSession(t, eventId);
  if (eventId !== t.event.id && (!other || other.endedAt))
    return other ? apiError(c, 409, 'This session has ended.', 'conflict') : notFound(c, 'Event');
  // Track F: a paid or members-only session needs a ticket or a membership (Laravel: 402 payment_required).
  const refused = other ? needsTicket(t, user, other) : null;
  if (refused)
    return c.json(
      {
        message:
          refused === 'members_only'
            ? 'This session is for members. Join a membership that includes it to take part.'
            : 'Buy a ticket to join this session.',
        code: 'payment_required',
        reason: refused,
      },
      402,
    );
  if (!t.rsvps.some((r) => r.userId === user.id && r.eventId === eventId)) t.rsvps.push({ userId: user.id, eventId });
  return ok(c, other ? presentLiveItem(t, user, other) : presentEvent(t, user));
});

communityRoutes.delete('/community/events/:id/rsvp', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  // Track F: a bought seat isn't dropped by the learner (the school refunds it).
  if (boughtTicket(t, user, c.req.param('id') ?? ''))
    return apiError(c, 409, 'You bought a ticket for this session — contact the school to cancel it.', 'conflict', {
      reason: 'ticket_bought',
    });
  t.rsvps = t.rsvps.filter((r) => !(r.userId === user.id && r.eventId === c.req.param('id')));
  const other = c.req.param('id') === t.event.id ? null : findLiveSession(t, c.req.param('id') ?? '');
  return c.req.param('id') === t.event.id ? ok(c, presentEvent(t, user)) : other ? ok(c, presentLiveItem(t, user, other)) : noContent(c);
});
