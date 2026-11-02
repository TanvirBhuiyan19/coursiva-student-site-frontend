/** Signed-in learner: enrolments, dashboard, player, lesson progress, quizzes, notes, Q&A, reviews, certificates. */
import { Hono } from 'hono';
import type { Dashboard, Lesson, LiveEvent, PlayerCourse, QuizAttemptInput } from '@/features/learning/types';
import type { Certificate } from '@/features/account/types';
import { type AppContext, type Env, requireUser } from '../lib/db';
import { assignmentBlock, PASS_PERCENT, quizBlock, quizResult, scormBlock, videoBlock } from '../lib/assessment';
import { gradeCheck, gradeSort, passGate, presentBlocks } from '../lib/blocks';
import { apiError, body, forbidden, id, invalid, notFound, ok, str } from '../lib/http';
import { breakoutOpen, nextId, participant, roomOf, toLearnerChat, toLearnerPoll } from '../lib/liveRoom';
import {
  allLessons,
  completedSet,
  courseSummary,
  enrolledCourses,
  enrollment,
  findLesson,
  isEnrolled,
  lessonRef,
  money,
  person,
  progressOf,
  resumeLesson,
} from '../lib/present';
import type { LessonRow, TenantData, UserRow } from '../lib/records';
import { submitSurvey, surveyBlock } from '../lib/survey';
import { completionOf, liveOf, LOCK_MESSAGES, lockOf, markComplete, ruleMet, ruleOf, ruleWhen, timeOf } from '../lib/rules';
import { snakeize } from '@/lib/api/case';

export const learningRoutes = new Hono<Env>();
learningRoutes.use('/me/*', requireUser);

export function presentEvent(t: TenantData, user: UserRow | null): LiveEvent {
  const e = t.event;
  const going = !!user && t.rsvps.some((r) => r.userId === user.id && r.eventId === e.id);
  // Like Laravel: only an RSVP'd learner gets a way in — the built-in room on the school's host, else the meeting link.
  const joinUrl = !going
    ? null
    : e.provider === 'built_in'
      ? `https://${t.site.primaryHost}/live/${e.id}/room`
      : `https://zoom.us/j/8812345678?pwd=${user?.id ?? ''}`;
  return { ...e, attendees: e.attendees + t.rsvps.filter((r) => r.eventId === e.id).length, going, joinUrl };
}

/**
 * The mock's built-in room: `evt_room` is live now (started 10 minutes ago) and every learner is registered, with
 * one open poll. Laravel builds the same shape from live_sessions.
 */
const ROOM = { id: 'evt_room', title: 'Office hours with Maya', provider: 'built_in' as const, attendees: 12 };

learningRoutes.get('/me/live/:id', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const sid = c.req.param('id');
  const course = t.courses[0];
  const courseRef = course ? { slug: course.slug, title: course.title } : null;
  if (sid === ROOM.id) {
    return ok(c, {
      ...ROOM,
      startsAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      going: true,
      joinUrl: `https://${t.site.primaryHost}/live/${ROOM.id}/room`,
      durationMin: 60,
      endsAt: new Date(Date.now() + 50 * 60_000).toISOString(),
      joinOpensAt: new Date(Date.now() - 25 * 60_000).toISOString(),
      waitlisted: false,
      space: null,
      replay: null,
      status: 'live',
      course: courseRef,
      polls: roomOf(t, ROOM.id)
        .polls.filter((p) => p.status === 'open')
        .map((p) => ({ id: p.id, question: p.question, options: p.options })),
    });
  }
  if (sid !== t.event.id) return notFound(c, 'Event');
  return ok(c, { ...presentEvent(t, user), durationMin: 60, status: 'scheduled', course: courseRef, polls: [] });
});

const CHAT_PAGE = 50;

/** Like Laravel's `inRoom`: a live built-in session the learner registered for and wasn't removed from. */
function inRoom(c: AppContext): Response | null {
  if (c.req.param('id') !== ROOM.id) return c.json({ message: 'This session isn’t live.', code: 'conflict' }, 409);
  const room = roomOf(c.get('t'), ROOM.id);
  if (room.participants.get(c.get('user')!.id)?.removed)
    return apiError(c, 403, 'The host removed you from this session.', 'forbidden', { reason: 'removed' });
  return null;
}
const roomState = (c: AppContext) => roomOf(c.get('t'), ROOM.id);

learningRoutes.post('/me/live/:id/presence', (c: AppContext) => inRoom(c) ?? c.body(null, 204));
/** Laravel: a short-lived Daily meeting token for the built-in room's video. The mock room URL is never loaded (e2e uses
 * a Daily test double); the real one is a private room on the platform's Daily domain. */
learningRoutes.post('/me/live/:id/token', (c: AppContext) => {
  const sid = c.req.param('id');
  if (sid === c.get('t').event.id)
    return c.json({ message: 'The room opens 15 minutes before the session starts.', code: 'conflict', reason: 'room_not_open' }, 409);
  const stage = sid === ROOM.id ? roomState(c).participants.get(c.get('user')!.id)?.stage : null;
  return (
    inRoom(c) ??
    ok(c, {
      roomUrl: `https://mock.daily.co/cv-${sid}`,
      // The real token carries `permissions.canSend` (only on stage); the mock names it so e2e can see the rejoin.
      token: `mock-daily-token-${sid}${stage === 'on_stage' ? '-stage' : ''}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      isOwner: false,
      canRecord: false,
    })
  );
});

/** The learner's room feed (polled every 4 s): their own state, chat (never hidden messages), pinned, polls. */
learningRoutes.get('/me/live/:id/room', (c: AppContext) => {
  const blocked = inRoom(c);
  if (blocked) return blocked;
  const user = c.get('user')!;
  const room = roomState(c);
  const me = participant(room, user.id);
  const visible = room.chat.filter((m) => !m.hiddenAt);
  const latest = visible.slice(-CHAT_PAGE);
  const pinned = room.pinnedId ? visible.find((m) => m.id === room.pinnedId) : undefined;
  const bo = breakoutOpen(room) && me.breakoutId ? room.breakouts.rooms.find((r) => r.id === me.breakoutId) : undefined;
  return ok(c, {
    status: 'live',
    me: {
      handRaised: me.handRaised,
      stage: me.stage,
      muted: me.muted,
      breakout: bo ? { id: bo.id, name: bo.name, endsAt: room.breakouts.endsAt } : null,
    },
    moderation: { slowModeSec: room.slowSec, chatLocked: room.locked },
    pinned: pinned ? toLearnerChat(pinned, user.id) : null,
    chat: latest.map((m) => toLearnerChat(m, user.id)),
    chatCursor: visible.length > latest.length ? (latest[0]?.id ?? null) : null,
    polls: room.polls.slice(-5).map((p) => toLearnerPoll(p, user.id)),
  });
});

learningRoutes.get('/me/live/:id/chat', (c: AppContext) => {
  const blocked = inRoom(c);
  if (blocked) return blocked;
  const user = c.get('user')!;
  const visible = roomState(c).chat.filter((m) => !m.hiddenAt);
  const before = c.req.query('before');
  const end = before ? visible.findIndex((m) => m.id === before) : visible.length;
  if (end < 0) return invalid(c, { before: 'The cursor is invalid.' });
  const page = visible.slice(Math.max(0, end - CHAT_PAGE), end);
  return ok(c, { messages: page.map((m) => toLearnerChat(m, user.id)), nextCursor: end - CHAT_PAGE > 0 ? (page[0]?.id ?? null) : null });
});

learningRoutes.post('/me/live/:id/hands', (c: AppContext) => {
  const blocked = inRoom(c);
  if (blocked) return blocked;
  participant(roomState(c), c.get('user')!.id).handRaised = true;
  return c.body(null, 204);
});
learningRoutes.delete('/me/live/:id/hands', (c: AppContext) => {
  const blocked = inRoom(c);
  if (blocked) return blocked;
  participant(roomState(c), c.get('user')!.id).handRaised = false;
  return c.body(null, 204);
});
learningRoutes.post('/me/live/:id/questions', async (c: AppContext) => {
  const text = str((await body<{ text: string }>(c)).text);
  if (!text || text.length > 500) return invalid(c, { text: 'Ask your question in up to 500 characters.' });
  const blocked = inRoom(c);
  if (blocked) return blocked;
  if (participant(roomState(c), c.get('user')!.id).muted) return apiError(c, 403, 'The host muted you.', 'forbidden', { reason: 'muted' });
  return c.body(null, 204);
});
/** Chat: refused while locked (409), muted (403) or inside the slow-mode window (429 + retry_after) — like Laravel. */
learningRoutes.post('/me/live/:id/chat', async (c: AppContext) => {
  const message = str((await body<{ message: string }>(c)).message);
  if (!message || message.length > 500) return invalid(c, { message: 'Write a message of up to 500 characters.' });
  const blocked = inRoom(c);
  if (blocked) return blocked;
  const user = c.get('user')!;
  const room = roomState(c);
  const me = participant(room, user.id);
  if (room.locked) return apiError(c, 409, 'The host has paused the chat.', 'conflict', { reason: 'chat_locked' });
  if (me.muted) return apiError(c, 403, 'The host muted you.', 'forbidden', { reason: 'muted' });
  if (room.slowSec > 0 && me.lastChatAt !== null) {
    const wait = Math.ceil((me.lastChatAt + room.slowSec * 1000 - Date.now()) / 1000);
    if (wait > 0)
      return c.json(
        {
          message: `Slow mode is on: one message every ${room.slowSec} seconds.`,
          code: 'too_many_requests',
          reason: 'slow_mode',
          retry_after: wait,
        },
        429,
      );
  }
  me.lastChatAt = Date.now();
  room.chat.push({
    id: nextId('lc'),
    userId: user.id,
    who: user.name,
    message,
    kind: 'message',
    hiddenAt: null,
    createdAt: new Date().toISOString(),
  });
  return c.body(null, 204);
});
/** One vote per learner per poll: a second vote is 409. */
learningRoutes.post('/me/live/:id/polls/:poll/votes', async (c: AppContext) => {
  const option = (await body<{ option: number }>(c)).option;
  const blocked = inRoom(c);
  if (blocked) return blocked;
  const p = roomState(c).polls.find((x) => x.id === c.req.param('poll'));
  if (!p) return notFound(c, 'Poll');
  if (p.status !== 'open') return apiError(c, 409, 'This poll is closed.', 'conflict');
  if (typeof option !== 'number' || !Number.isInteger(option) || option < 0 || option >= p.options.length)
    return invalid(c, { option: 'Choose one of the answers.' });
  const user = c.get('user')!;
  if (p.votes.has(user.id)) return apiError(c, 409, 'You already voted in this poll.', 'conflict');
  p.votes.set(user.id, option);
  return c.body(null, 204);
});
learningRoutes.post('/me/live/:id/stage/accept', (c: AppContext) => {
  const blocked = inRoom(c);
  if (blocked) return blocked;
  const me = participant(roomState(c), c.get('user')!.id);
  if (me.stage !== 'invited' && me.stage !== 'on_stage') return apiError(c, 409, 'The host hasn’t invited you to the stage.', 'conflict');
  me.stage = 'on_stage';
  return c.body(null, 204);
});
learningRoutes.post('/me/live/:id/stage/leave', (c: AppContext) => {
  const blocked = inRoom(c);
  if (blocked) return blocked;
  participant(roomState(c), c.get('user')!.id).stage = null;
  return c.body(null, 204);
});
learningRoutes.post('/me/live/:id/breakout/token', (c: AppContext) => {
  const blocked = inRoom(c);
  if (blocked) return blocked;
  const room = roomState(c);
  const me = participant(room, c.get('user')!.id);
  const bo = breakoutOpen(room) && me.breakoutId ? room.breakouts.rooms.find((r) => r.id === me.breakoutId) : undefined;
  if (!bo) return apiError(c, 409, 'You aren’t in a breakout room.', 'conflict');
  return ok(c, {
    roomUrl: `https://mock.daily.co/cv-${bo.id}`,
    token: `mock-daily-token-${bo.id}`,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    isOwner: false,
    canRecord: false,
  });
});

/** A course reaching 100% issues a certificate (idempotent). The platform registry owns the id space. */
export function maybeIssueCertificate(t: TenantData, user: UserRow, courseId: string) {
  if (!t.site.features.certificates) return;
  const course = t.courses.find((c) => c.id === courseId);
  if (!course || progressOf(course, completedSet(t, user.id)).percent < 100) return;
  if (t.certificates.some((x) => x.userId === user.id && x.courseId === courseId)) return;
  const n = 341 + t.certificates.length;
  t.certificates.push({ id: `AC-2026-${String(n).padStart(4, '0')}`, userId: user.id, courseId, issuedAt: new Date().toISOString() });
}

learningRoutes.get('/me/enrollments', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  return ok(
    c,
    enrolledCourses(t, user).map((x) => enrollment(t, user, x)),
  );
});

/** Self-enrolment in a free course; paid courses answer 402 like Laravel (they go through checkout). */
learningRoutes.post('/me/enrollments', async (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const slug = str((await body<{ courseSlug: string }>(c)).courseSlug);
  const course = t.courses.find((x) => x.slug === slug);
  if (!course) return notFound(c, 'Course');
  if (course.price > 0) return c.json({ message: 'Buy this course to enrol.', code: 'payment_required' }, 402);
  if (!t.enrollments.some((e) => e.userId === user.id && e.courseId === course.id))
    t.enrollments.push({ userId: user.id, courseId: course.id, enrolledAt: new Date().toISOString(), orderId: null });
  return ok(c, enrollment(t, user, course), 201);
});

learningRoutes.get('/me/dashboard', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const done = completedSet(t, user.id);
  const mine = enrolledCourses(t, user);
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const activity = user.weekActivity.map((lessons, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    return { day: d.toISOString().slice(0, 10), lessons };
  });
  const finished = mine.filter((x) => progressOf(x, done).percent === 100);
  const rec = t.courses.find((x) => !mine.includes(x));
  const certs = t.certificates.filter((x) => x.userId === user.id);
  const firstCert = certs[0] ? t.courses.find((x) => x.id === certs[0]!.courseId) : undefined;
  const dash: Dashboard = {
    streakDays: t.site.features.streaks ? user.streakDays : 0,
    weeklyGoal: user.weeklyGoal,
    weekLessons: activity.reduce((a, d) => a + d.lessons, 0),
    activity,
    upNext: mine
      .filter((x) => progressOf(x, done).percent < 100)
      .slice(0, 3)
      .map((x) => ({ ...resumeLesson(x, done), courseSlug: x.slug, courseTitle: x.title })),
    recommendation: rec
      ? {
          course: courseSummary(t, rec),
          reason: finished.length ? `Because you finished ${finished.at(-1)!.title}` : `Popular with ${t.site.name} students`,
        }
      : null,
    nextEvent: t.site.features.community ? presentEvent(t, user) : null,
    achievements: [
      ...(user.streakDays > 0 && t.site.features.streaks
        ? [{ id: 'ach_streak', kind: 'streak' as const, title: `${user.streakDays}-day streak`, detail: 'Your longest so far' }]
        : []),
      ...(firstCert ? [{ id: 'ach_cert', kind: 'certificate' as const, title: 'First certificate', detail: firstCert.title }] : []),
      ...(done.size > 0
        ? [
            {
              id: 'ach_lessons',
              kind: 'lessons' as const,
              title: `${done.size} lessons completed`,
              detail: `Across ${mine.length} courses`,
            },
          ]
        : []),
    ],
    // The five latest receipted orders (LearnerOrders::recent).
    purchases: t.orders
      .filter((o) => o.userId === user.id && o.status !== 'pending' && o.status !== 'failed')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
      .map((o) => ({ orderId: o.id, title: o.items[0]?.title ?? '', createdAt: o.createdAt, total: money(t, o.total) })),
  };
  return ok(c, dash);
});

learningRoutes.put('/me/goal', async (c: AppContext) => {
  const n = Number((await body<{ weeklyGoal: number }>(c)).weeklyGoal);
  if (!Number.isInteger(n) || n < 1 || n > 30) return invalid(c, { weeklyGoal: 'Pick between 1 and 30 lessons a week.' });
  c.get('user')!.weeklyGoal = n;
  return ok(c, { weeklyGoal: n });
});

learningRoutes.get('/me/courses/:slug', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const course = t.courses.find((x) => x.slug === c.req.param('slug'));
  if (!course) return notFound(c, 'Course');
  if (!isEnrolled(t, user, course.id)) return forbidden(c, 'Enrol in this course to open the player.');
  const done = completedSet(t, user.id);
  const space = t.spaces.find((s) => s.courseId === course.id);
  const player: PlayerCourse = {
    courseId: course.id,
    slug: course.slug,
    title: course.title,
    progress: progressOf(course, done),
    modules: course.modules.map((m) => ({
      id: m.id,
      title: m.title,
      lessons: m.lessons.map((l) => {
        const lock = lockOf(t, user, course, l);
        return {
          ...lessonRef(l, m.title),
          completed: done.has(l.id),
          locked: !!lock,
          lockReason: lock?.reason ?? null,
          unlocksAt: lock?.unlocksAt ?? null,
          after: lock?.after ?? null,
        };
      }),
    })),
    communitySpace: space && t.site.features.community ? { id: space.id, name: space.name } : null,
  };
  return ok(c, player);
});

export type LessonCtx = { error: Response } | ({ t: TenantData; user: UserRow } & NonNullable<ReturnType<typeof findLesson>>);

export function lessonFor(c: AppContext): LessonCtx {
  const t = c.get('t');
  const user = c.get('user')!;
  const found = findLesson(t, c.req.param('id') ?? '');
  if (!found) return { error: notFound(c, 'Lesson') };
  if (!isEnrolled(t, user, found.course.id) && !found.lesson.freePreview) return { error: forbidden(c, 'Enrol to open this lesson.') };
  // O4 availability: `403 lesson_locked { reason, unlocks_at, after }` (Laravel's ApiException details).
  const lock = isEnrolled(t, user, found.course.id) ? lockOf(t, user, found.course, found.lesson) : null;
  if (lock)
    return {
      error: c.json(
        snakeize({ message: LOCK_MESSAGES[lock.reason] ?? 'This lesson isn’t available yet.', code: 'lesson_locked', ...lock }) as Record<
          string,
          unknown
        >,
        403,
      ),
    };
  return { t, user, ...found };
}

/** The lesson's plain-text description (the mock's lessons have no authored Markdown body). */
export function lessonDescription(lesson: LessonRow): string {
  if (lesson.survey) return lesson.survey.intro;
  return lesson.type === 'quiz'
    ? `Answer the questions below. You need ${PASS_PERCENT}% to pass — passing marks this lesson complete automatically, and you can retake it as often as you like.`
    : lesson.assignment
      ? lesson.assignment.brief
      : lesson.scorm
        ? 'Work through the interactive module below. Your progress is saved as you go, and the lesson completes when you finish it.'
        : 'In this lesson you will work through the concept step by step, see it applied to a real student business, and leave with one action to complete before the next lesson.';
}

/** The lesson's downloads (signed URLs in the real API). */
export function lessonResources(lesson: LessonRow): Lesson['resources'] {
  const short = lesson.title.length > 34 ? `${lesson.title.slice(0, 31)}…` : lesson.title;
  return lesson.type === 'quiz' || lesson.scorm || lesson.assignment || lesson.survey
    ? []
    : lesson.type === 'pdf'
      ? [{ id: `${lesson.id}_r0`, kind: 'pdf', name: short, sizeBytes: 1_258_291, url: `/api/v1/me/lessons/${lesson.id}/resources/0` }]
      : [
          {
            id: `${lesson.id}_r0`,
            kind: 'pdf',
            name: `${short} — worksheet`,
            sizeBytes: 1_258_291,
            url: `/api/v1/me/lessons/${lesson.id}/resources/0`,
          },
          {
            id: `${lesson.id}_r1`,
            kind: 'slides',
            name: `${short} — slides`,
            sizeBytes: 5_033_165,
            url: `/api/v1/me/lessons/${lesson.id}/resources/1`,
          },
        ];
}

learningRoutes.get('/me/lessons/:id', (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, module, lesson } = r;
  const done = completedSet(t, user.id);
  const all = allLessons(course);
  const idx = all.findIndex((x) => x.lesson.id === lesson.id);
  const payload: Lesson = {
    ...lessonRef(lesson, module.title),
    courseSlug: course.slug,
    description: lessonDescription(lesson),
    // The API renders authored Markdown to sanitised HTML; the mock's text lessons have plain descriptions only (a
    // survey's intro is its body, like Laravel's).
    bodyHtml: lesson.survey ? `<p>${escapeHtml(lesson.survey.intro)}</p>` : null,
    // Blocks after the first continue gate this learner hasn't passed are withheld (counted in blocks_locked).
    ...presentBlocks(t, lesson.id, user.id),
    link: null,
    completed: done.has(lesson.id),
    video: lesson.type === 'video' ? videoBlock(t, user, lesson) : null,
    pdf: lesson.type === 'pdf' ? { url: `/api/v1/me/lessons/${lesson.id}/file`, sizeBytes: lesson.pdfSizeBytes ?? 0 } : null,
    quiz: lesson.type === 'quiz' ? quizBlock(t, user, lesson) : null,
    scorm: scormBlock(t, user, lesson),
    assignment: assignmentBlock(t, user, lesson),
    resources: lessonResources(lesson),
    note: t.notes.find((n) => n.userId === user.id && n.lessonId === lesson.id)?.body ?? '',
    questions: t.lessonQuestions
      .filter((q) => q.lessonId === lesson.id || q.lessonId === '*')
      // Thread order: oldest first (a question, then its answers). The client prepends questions the learner just asked.
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((q) => ({ id: q.id, author: { ...person(q.name, q.color), isInstructor: q.isCoach }, body: q.body, createdAt: q.createdAt })),
    nextLessonId: all[idx + 1]?.lesson.id ?? null,
    completion: completionOf(t, user, lesson),
    live: liveOf(t, lesson),
    survey: surveyBlock(t, user, lesson, isEnrolled(t, user, course.id)),
  };
  return ok(c, payload);
});

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * A Survey lesson's answers: `{ answers: [{ key, value }] }` → 201 `{ survey, completed, progress }`. 422 keyed
 * `answers.{i}` (the question's index in `survey.fields`) or `answers`; 403 not enrolled; 404 no survey; 409 already
 * answered (re-submitting off). Submitting completes the lesson under the `survey` rule.
 */
learningRoutes.post('/me/lessons/:id/survey', async (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, lesson } = r;
  if (!isEnrolled(t, user, course.id)) return forbidden(c, 'Enrol to answer this survey.');
  const out = submitSurvey(t, user, lesson, (await body<{ answers: unknown }>(c)).answers);
  if (out.status === 404) return c.json({ message: out.message }, 404);
  if (out.status === 409) return apiError(c, 409, out.message, 'conflict');
  if (out.status === 422) return invalid(c, out.errors);
  let completed = false;
  if (ruleOf(lesson) === 'survey') {
    markComplete(t, user, lesson.id);
    maybeIssueCertificate(t, user, course.id);
    completed = true;
  }
  return ok(c, { survey: surveyBlock(t, user, lesson, true), completed, progress: progressOf(course, completedSet(t, user.id)) }, 201);
});

/**
 * Interactive lesson blocks (course builder v2 O3): grade a knowledge check or a sorting block, pass a continue gate.
 * Grading is server-side — answers, categories and feedback are never in the lesson payload. A block behind a gate the
 * learner hasn't passed is 404 like an unknown one. Laravel/Go throttle each to 60/min per learner.
 */
learningRoutes.post('/me/lessons/:id/blocks/:blockId/check', async (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const b = await body<{ optionIds: unknown; text: unknown }>(c);
  const out = gradeCheck(r.t, r.lesson.id, r.user.id, c.req.param('blockId') ?? '', b);
  if ('notFound' in out) return notFound(c, 'Block');
  if ('invalid' in out) return invalid(c, out.invalid);
  // The `checks` completion rule: every check answered completes the lesson.
  if (ruleOf(r.lesson) === 'checks' && isEnrolled(r.t, r.user, r.course.id) && ruleMet(r.t, r.user, r.lesson)) {
    markComplete(r.t, r.user, r.lesson.id);
    maybeIssueCertificate(r.t, r.user, r.course.id);
  }
  return ok(c, out.data);
});

learningRoutes.post('/me/lessons/:id/blocks/:blockId/sort', async (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  // Raw keys: placements are keyed by item id (data, not field names).
  let placements: unknown = null;
  try {
    const raw: unknown = await c.req.json();
    if (raw !== null && typeof raw === 'object' && 'placements' in raw) placements = raw.placements;
  } catch {
    placements = null;
  }
  const out = gradeSort(r.t, r.lesson.id, r.user.id, c.req.param('blockId') ?? '', placements);
  if ('notFound' in out) return notFound(c, 'Block');
  if ('invalid' in out) return invalid(c, out.invalid);
  return ok(c, out.data);
});

learningRoutes.post('/me/lessons/:id/blocks/:blockId/continue', (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const out = passGate(r.t, r.lesson.id, r.user.id, c.req.param('blockId') ?? '');
  if ('notFound' in out) return notFound(c, 'Block');
  if ('required' in out) {
    // The standard validation shape, with the message under `errors.required`.
    const message = 'Answer the questions above first.';
    return c.json({ message, code: 'validation_failed', errors: { required: [message] } }, 422);
  }
  if ('invalid' in out) return invalid(c, out.invalid);
  return ok(c, out.data);
});

learningRoutes.post('/me/lessons/:id/complete', (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, lesson } = r;
  // O4: only the `manual` rule completes by a click; the others complete on their own.
  const rule = ruleOf(lesson);
  if (rule !== 'manual')
    return invalid(c, { completion: `This lesson completes on its own when ${ruleWhen(rule, lesson.completionValue)}.` });
  markComplete(t, user, lesson.id);
  maybeIssueCertificate(t, user, course.id);
  return ok(c, { completed: true, progress: progressOf(course, completedSet(t, user.id)) });
});

learningRoutes.delete('/me/lessons/:id/complete', (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, lesson } = r;
  const rule = ruleOf(lesson);
  if (rule !== 'manual')
    return invalid(c, { completion: `This lesson completes on its own when ${ruleWhen(rule, lesson.completionValue)}.` });
  t.completions = t.completions.filter((x) => !(x.userId === user.id && x.lessonId === lesson.id));
  return ok(c, { completed: false, progress: progressOf(course, completedSet(t, user.id)) });
});

/**
 * Video playback report: `{ session, device, segments: [[from, to], …] }` → 204. Laravel merges the ranges per session,
 * counts re-played seconds as rewatches and caps a report by wall-clock time; the mock validates and discards.
 */
learningRoutes.post('/me/lessons/:id/playback', async (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  if (r.lesson.type !== 'video') return notFound(c, 'Lesson');
  const b = await body<{ session: unknown; device: unknown; segments: unknown }>(c);
  if (typeof b.session !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(b.session))
    return invalid(c, { session: 'The session field format is invalid.' });
  if (b.device !== undefined && b.device !== null && !['web', 'tablet', 'app'].includes(b.device as string))
    return invalid(c, { device: 'The selected device is invalid.' });
  const isTime = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 86_400;
  const segmentsOk =
    Array.isArray(b.segments) &&
    b.segments.length <= 50 &&
    b.segments.every((s: unknown) => Array.isArray(s) && s.length === 2 && s.every(isTime));
  if (!segmentsOk) return invalid(c, { segments: 'The segments field must be a list of [from, to] seconds.' });
  // O4 `video` rule: the watched share (union of segments ÷ duration) is evaluated on every report.
  const { t, user, course, lesson } = r;
  if (isEnrolled(t, user, course.id)) {
    (t.videoViews ??= []).push({ userId: user.id, lessonId: lesson.id, segments: b.segments as [number, number][] });
    if (ruleOf(lesson) === 'video' && ruleMet(t, user, lesson) && markComplete(t, user, lesson.id))
      maybeIssueCertificate(t, user, course.id);
  }
  // 200 with the lesson's completion after the report (older APIs answered 204).
  return ok(c, { completion: completionOf(t, user, lesson) });
});

/**
 * O4 time heartbeat: `{ seconds: 1–60 }` of visible time since the last beat → `{ time_spent_sec, completed }`.
 * Throttled 6/min per learner and lesson; the total is capped at 10× the rule's minutes; meeting the `time` rule
 * completes the lesson.
 */
learningRoutes.post('/me/lessons/:id/time', async (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, lesson } = r;
  if (!isEnrolled(t, user, course.id)) return forbidden(c, 'Enrol to open this lesson.');
  const seconds = (await body<{ seconds: unknown }>(c)).seconds;
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > 60)
    return invalid(c, { seconds: 'The seconds field must be between 1 and 60.' });
  let row = timeOf(t, user.id, lesson.id);
  if (!row) {
    row = { userId: user.id, lessonId: lesson.id, seconds: 0, beats: [] };
    t.lessonTime!.push(row);
  }
  const now = Date.now();
  row.beats = row.beats.filter((at) => now - at < 60_000);
  if (row.beats.length >= 6) return apiError(c, 429, 'Too many requests.', 'too_many_requests');
  row.beats.push(now);
  const cap = ruleOf(lesson) === 'time' ? (lesson.completionValue ?? 1) * 600 : Infinity;
  row.seconds = Math.min(cap, row.seconds + seconds);
  if (ruleOf(lesson) === 'time' && ruleMet(t, user, lesson) && markComplete(t, user, lesson.id)) maybeIssueCertificate(t, user, course.id);
  return ok(c, { timeSpentSec: row.seconds, completed: completedSet(t, user.id).has(lesson.id) });
});

learningRoutes.post('/me/lessons/:id/quiz-attempts', async (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, lesson } = r;
  if (lesson.type !== 'quiz') return notFound(c, 'Quiz');
  // An attempt awaiting the instructor's review blocks the next one (Laravel: 409 conflict).
  if (t.quizAttempts.some((a) => a.userId === user.id && a.lessonId === lesson.id && a.reviewStatus === 'pending'))
    return apiError(c, 409, 'Your last attempt is awaiting review. You can try again once it has been graded.', 'conflict');
  const b = await body<QuizAttemptInput>(c);
  const answers = Array.isArray(b.answers) ? b.answers : [];
  const given = new Map(answers.map((a) => [str(a.questionId), a]));
  const optionIndex = (v: unknown) => (typeof v === 'string' && /^o\d{1,3}$/.test(v) ? Number(v.slice(1)) : -1);
  let earned = 0;
  let autoPoints = 0;
  let manualPoints = 0;
  let correct = 0;
  for (const q of lesson.questions) {
    const a = given.get(q.id);
    const type = q.type ?? 'single_choice';
    const points = q.points ?? 1;
    const picked = (a?.optionIds ?? [a?.optionId]).map(optionIndex).filter((i) => i >= 0 && i < q.options.length);
    const answered = type === 'free_text' ? str(a?.text) !== '' : picked.length > 0 && (type === 'multi_select' || picked.length === 1);
    if (!answered) return invalid(c, { answers: 'Answer every question before submitting.' });
    if (type === 'free_text') {
      manualPoints += points;
      continue;
    }
    autoPoints += points;
    const want = type === 'multi_select' ? (q.answers ?? []) : [q.answer];
    const right = picked.length === want.length && want.every((i) => picked.includes(i));
    if (right) {
      earned += points;
      correct += 1;
    }
  }
  const held = manualPoints > 0;
  const scorePercent = held || autoPoints === 0 ? null : Math.round((earned / autoPoints) * 100);
  const passed = scorePercent === null ? null : scorePercent >= PASS_PERCENT;
  const row = {
    id: id('qat'),
    userId: user.id,
    lessonId: lesson.id,
    scorePercent,
    passed,
    correct,
    total: lesson.questions.length,
    earned,
    autoPoints,
    manualPoints,
    reviewStatus: held ? ('pending' as const) : null,
    feedback: null,
    reviewedAt: null,
    at: new Date().toISOString(),
  };
  t.quizAttempts.push(row);
  if (passed && !t.completions.some((x) => x.userId === user.id && x.lessonId === lesson.id)) {
    t.completions.push({ userId: user.id, lessonId: lesson.id, at: new Date().toISOString() });
    maybeIssueCertificate(t, user, course.id);
  }
  const attemptNo = t.quizAttempts.filter((a) => a.userId === user.id && a.lessonId === lesson.id).length;
  return ok(c, { ...quizResult(row), attemptNo, attemptsLeft: null }, 201);
});

learningRoutes.put('/me/lessons/:id/note', async (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, lesson } = r;
  const b = await body<{ body: string }>(c);
  const text = typeof b.body === 'string' ? b.body : '';
  if (text.length > 10_000) return invalid(c, { body: 'Notes can be up to 10,000 characters.' });
  const row = t.notes.find((n) => n.userId === user.id && n.lessonId === lesson.id);
  if (row) row.body = text;
  else t.notes.push({ userId: user.id, lessonId: lesson.id, body: text });
  return ok(c, { body: text });
});

learningRoutes.post('/me/lessons/:id/questions', async (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, lesson } = r;
  const text = str((await body<{ body: string }>(c)).body);
  if (text.length < 3) return invalid(c, { body: 'Write your question first.' });
  if (text.length > 2000) return invalid(c, { body: 'Questions can be up to 2,000 characters.' });
  // Free previews can read the thread but not ask (Laravel: enrolled, unlocked lessons only).
  if (!isEnrolled(t, user, r.course.id)) return forbidden(c, 'Enrol to open this lesson.');
  const q = {
    id: id('lq'),
    lessonId: lesson.id,
    userId: user.id,
    name: user.name,
    color: user.color,
    isCoach: false,
    body: text,
    createdAt: new Date().toISOString(),
  };
  t.lessonQuestions.push(q);
  return ok(c, { id: q.id, author: { ...person(q.name, q.color), isInstructor: false }, body: q.body, createdAt: q.createdAt }, 201);
});

learningRoutes.post('/courses/:slug/reviews', async (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user');
  if (!user) return c.json({ message: 'Unauthenticated.' }, 401);
  const course = t.courses.find((x) => x.slug === c.req.param('slug'));
  if (!course) return notFound(c, 'Course');
  if (!isEnrolled(t, user, course.id)) return forbidden(c, 'Only enrolled students can review this course.');
  if (t.reviews.some((r) => r.userId === user.id && r.courseId === course.id))
    return invalid(c, { body: 'You’ve already reviewed this course.' });
  const b = await body<{ rating: number; body: string }>(c);
  const rating = Number(b.rating);
  const text = str(b.body);
  const errors: Record<string, string> = {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = 'Pick a star rating.';
  if (text.length < 10) errors.body = 'Write at least a sentence — 10 characters or more.';
  if (Object.keys(errors).length) return invalid(c, errors);
  const row = {
    id: id('rev'),
    courseId: course.id,
    userId: user.id,
    name: user.name,
    color: user.color,
    rating,
    body: text,
    createdAt: new Date().toISOString(),
  };
  t.reviews.push(row);
  course.reviewCount += 1;
  return ok(c, { id: row.id, author: person(row.name, row.color), rating, body: text, createdAt: row.createdAt }, 201);
});

learningRoutes.get('/me/certificates', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const certs: Certificate[] = t.certificates
    .filter((x) => x.userId === user.id)
    .map((x) => {
      const course = t.courses.find((cc) => cc.id === x.courseId)!;
      const verifyUrl = `https://${t.site.primaryHost}/verify/${x.id}`;
      return {
        id: x.id,
        courseTitle: course.title,
        courseSlug: course.slug,
        learnerName: user.name,
        instructorName: t.instructor.name,
        issuedAt: x.issuedAt,
        verifyUrl,
        linkedInUrl: `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(course.title)}&organizationName=${encodeURIComponent(t.site.name)}&certId=${x.id}&certUrl=${encodeURIComponent(verifyUrl)}`,
        pdfUrl: `/api/v1/me/certificates/${x.id}/pdf`,
        status: x.revoked ? 'revoked' : 'active',
        // Open Badges 3.0 (an addition): the learner's download, and the registry URL a wallet fetches.
        credentialUrl: x.openBadge && !x.revoked ? `/api/v1/me/certificates/${x.id}/credential` : null,
        credentialPublicUrl: x.openBadge ? `https://${t.site.primaryHost}/api/v1/registry/certificates/${x.id}/credential` : null,
      };
    });
  return ok(c, certs);
});

/** The signed Open Badges 3.0 credential (`application/vc+jwt`). 403 when revoked, 404 when not published. */
learningRoutes.get('/me/certificates/:code/credential', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const cert = t.certificates.find((x) => x.id === c.req.param('code') && x.userId === user.id);
  if (!cert?.openBadge) return notFound(c, 'Credential');
  if (cert.revoked) return forbidden(c, 'This certificate was revoked.');
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${part({ alg: 'EdDSA', typ: 'vc+jwt' })}.${part({ sub: user.id, jti: cert.id, iss: 'did:web:registry.coursiva.io' })}.mock-signature`;
  return c.body(jwt, 200, {
    'Content-Type': 'application/vc+jwt',
    'Content-Disposition': `attachment; filename="certificate-${cert.id}.jwt"`,
  });
});
