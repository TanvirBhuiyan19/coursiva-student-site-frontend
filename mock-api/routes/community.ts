/** Community: spaces (with per-learner access), posts, likes, events, leaderboard. */
import { Hono } from 'hono';
import type { CommunityOverview, NewPostInput, Post, Space } from '@/features/community/types';
import { type AppContext, type Env, requireUser } from '../lib/db';
import { body, forbidden, id, invalid, noContent, notFound, ok, paginate, str } from '../lib/http';
import { isEnrolled, person } from '../lib/present';
import type { PostRow, SpaceRow, TenantData, UserRow } from '../lib/records';
import { presentEvent } from './learning';

export const communityRoutes = new Hono<Env>();

communityRoutes.use('*', async (c: AppContext, next) => {
  if (!c.get('t').site.features.community) return notFound(c, 'Community');
  await next();
});

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
    replies: p.replies,
    createdAt: p.createdAt,
  };
}

communityRoutes.get('/community/posts', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user');
  const spaceId = c.req.query('space') ?? 'sp_all';
  const space = t.spaces.find((s) => s.id === spaceId);
  if (!space) return notFound(c, 'Space');
  if (access(t, user, space).locked) return forbidden(c, access(t, user, space).reason ?? undefined);
  const rows = t.posts.filter((p) => spaceId === 'sp_all' || p.spaceId === spaceId);
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
  const row: PostRow = {
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

communityRoutes.put('/community/events/:id/rsvp', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  if (c.req.param('id') !== t.event.id) return notFound(c, 'Event');
  if (!t.rsvps.some((r) => r.userId === user.id && r.eventId === t.event.id)) t.rsvps.push({ userId: user.id, eventId: t.event.id });
  return ok(c, presentEvent(t, user));
});

communityRoutes.delete('/community/events/:id/rsvp', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  t.rsvps = t.rsvps.filter((r) => !(r.userId === user.id && r.eventId === c.req.param('id')));
  return c.req.param('id') === t.event.id ? ok(c, presentEvent(t, user)) : noContent(c);
});
