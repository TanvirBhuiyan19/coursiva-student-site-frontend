/**
 * The course AI tutor (Laravel: app/Modules/AiStudio, docs/ai-studio.md → learner API). The mock "answers" from the
 * course outline: a question that mentions a lesson's words is covered (citing the module and lesson), anything else
 * is not covered — which is when the player offers the hand-off to the school's team.
 */
import { Hono } from 'hono';
import type { TutorAskInput, TutorThread } from '@/features/learning/types';
import { type AppContext, type Env, requireUser } from '../lib/db';
import { apiError, body, id, invalid, notFound, ok } from '../lib/http';
import { isEnrolled } from '../lib/present';
import type { CourseRow, TenantData, UserRow } from '../lib/records';

export const tutorRoutes = new Hono<Env>();
tutorRoutes.use('/me/*', requireUser);

type ThreadRow = TenantData['tutorThreads'][number];
const HOURLY = 30;

const present = (r: ThreadRow): TutorThread => ({
  id: r.id,
  courseId: r.courseId,
  lessonId: r.lessonId,
  title: r.title,
  status: r.status,
  escalatedAt: r.escalatedAt,
  resolvedAt: r.resolvedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  messages: r.messages,
});

/** Course by slug or id (404), then a live enrolment (403, as the player). */
function enrolled(c: AppContext): { error: Response } | { t: TenantData; user: UserRow; course: CourseRow } {
  const t = c.get('t');
  const user = c.get('user')!;
  const key = c.req.param('course') ?? '';
  const course = t.courses.find((x) => x.slug === key || x.id === key);
  if (!course) return { error: notFound(c, 'Course') };
  if (!isEnrolled(t, user, course.id)) return { error: c.json({ message: 'Enrol in this course to use the tutor.' }, 403) };
  return { t, user, course };
}

function available(c: AppContext) {
  const r = enrolled(c);
  if ('error' in r) return r;
  if (!r.t.tutor.enabled || r.t.unavailable?.includes('ai')) return { error: notFound(c, 'Tutor') };
  return r;
}

function threadFor(r: { t: TenantData; user: UserRow; course: CourseRow }, threadId: unknown) {
  return r.t.tutorThreads.find((x) => x.id === threadId && x.userId === r.user.id && x.courseId === r.course.id) ?? null;
}

tutorRoutes.get('/me/courses/:course/tutor', (c: AppContext) => {
  const r = enrolled(c);
  if ('error' in r) return r.error;
  // AI switched off on the platform: the tutor is off for every course.
  if (!r.t.tutor.enabled || r.t.unavailable?.includes('ai')) return ok(c, { enabled: false, handoff: false, threads: [] });
  const threads = r.t.tutorThreads
    .filter((x) => x.userId === r.user.id && x.courseId === r.course.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map(present);
  return ok(c, { enabled: true, handoff: r.t.tutor.handoff, threads });
});

function answer(course: CourseRow, text: string, handoff: boolean): { text: string; covered: boolean } {
  const words = new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  for (const m of course.modules)
    for (const l of m.lessons) {
      const hit = (l.title.toLowerCase().match(/[a-z]{4,}/g) ?? []).find((w) => words.has(w));
      if (hit)
        return {
          covered: true,
          text: `${m.title} · “${l.title}” covers this. Work through that lesson first, then try applying it to your own offer — the worksheet walks you through it step by step.`,
        };
    }
  return {
    covered: false,
    text: handoff
      ? 'That isn’t covered in this course’s material, so I don’t want to guess. You can send the question to the course team with “Ask the team”.'
      : 'That isn’t covered in this course’s material, so I don’t want to guess. Try asking in the course community or contact the school.',
  };
}

tutorRoutes.post('/me/courses/:course/tutor/messages', async (c: AppContext) => {
  const r = available(c);
  if ('error' in r) return r.error;
  const { t, user, course } = r;
  const b = await body<TutorAskInput>(c);
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return invalid(c, { text: 'Ask the tutor a question.' });
  if (text.length > 2000) return invalid(c, { text: 'Questions can be up to 2,000 characters.' });
  const lessonId = typeof b.lessonId === 'string' && b.lessonId ? b.lessonId : null;
  if (lessonId && !course.modules.some((m) => m.lessons.some((l) => l.id === lessonId)))
    return invalid(c, { lessonId: 'Pick a lesson from this course.' });
  let thread: ThreadRow | null = null;
  if (b.threadId) {
    thread = threadFor(r, b.threadId);
    if (!thread) return notFound(c, 'Thread');
  }
  // throttle:ai-tutor — 30 an hour per learner.
  const hourAgo = Date.now() - 3_600_000;
  t.tutorAsks = t.tutorAsks.filter((x) => x.at > hourAgo);
  if (t.tutorAsks.filter((x) => x.userId === user.id).length >= HOURLY)
    return c.json({ message: 'Too many requests. Please slow down and try again shortly.' }, 429);
  t.tutorAsks.push({ userId: user.id, at: Date.now() });
  // The school's monthly AI cap: nothing is sent to the model.
  if (t.tutor.resting) return apiError(c, 409, 'The tutor is resting for this month.', 'conflict', { reason: 'tutor_resting' });

  const now = new Date().toISOString();
  if (!thread) {
    thread = {
      id: id('tut'),
      userId: user.id,
      courseId: course.id,
      lessonId,
      title: text.length > 80 ? `${text.slice(0, 79)}…` : text,
      status: 'open',
      escalatedAt: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    t.tutorThreads.push(thread);
  } else if (thread.status === 'resolved') {
    thread.status = 'open';
    thread.resolvedAt = null;
  }
  const result = answer(course, text, t.tutor.handoff);
  const asked: ThreadRow['messages'][number] = { id: id('tum'), role: 'student', text, lessonId, createdAt: now };
  const reply: ThreadRow['messages'][number] = { id: id('tum'), role: 'tutor', text: result.text, lessonId, createdAt: now };
  thread.messages.push(asked, reply);
  thread.updatedAt = now;
  return ok(
    c,
    { reply, covered: result.covered, canEscalate: t.tutor.handoff && thread.status !== 'escalated', thread: present(thread) },
    201,
  );
});

tutorRoutes.post('/me/courses/:course/tutor/threads/:thread/resolve', (c: AppContext) => {
  const r = available(c);
  if ('error' in r) return r.error;
  const thread = threadFor(r, c.req.param('thread'));
  if (!thread) return notFound(c, 'Thread');
  if (thread.status !== 'escalated') Object.assign(thread, { status: 'resolved', resolvedAt: new Date().toISOString() });
  return ok(c, present(thread));
});

tutorRoutes.post('/me/courses/:course/tutor/threads/:thread/escalate', async (c: AppContext) => {
  const r = available(c);
  if ('error' in r) return r.error;
  const thread = threadFor(r, c.req.param('thread'));
  if (!thread) return notFound(c, 'Thread');
  const note = (await body<{ text: string }>(c)).text;
  if (typeof note === 'string' && note.trim().length > 2000) return invalid(c, { text: 'Notes can be up to 2,000 characters.' });
  if (!r.t.tutor.handoff)
    return apiError(c, 409, 'This school answers through the tutor only — hand-off to the team is off.', 'conflict', {
      reason: 'handoff_off',
    });
  if (thread.status === 'escalated')
    return apiError(c, 409, 'This question is already with the team.', 'conflict', { reason: 'already_escalated' });
  Object.assign(thread, { status: 'escalated', escalatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  return ok(c, present(thread));
});
