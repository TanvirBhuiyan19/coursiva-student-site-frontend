/** Signed-in learner: enrolments, dashboard, player, lesson progress, quizzes, notes, Q&A, reviews, certificates. */
import { Hono } from 'hono';
import type { Dashboard, Lesson, LiveEvent, PlayerCourse, QuizAttemptInput } from '@/features/learning/types';
import type { Certificate } from '@/features/account/types';
import { type AppContext, type Env, requireUser } from '../lib/db';
import { body, forbidden, id, invalid, notFound, ok, str } from '../lib/http';
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
import type { TenantData, UserRow } from '../lib/records';

export const learningRoutes = new Hono<Env>();
learningRoutes.use('/me/*', requireUser);

const PASS_PERCENT = 70;

export function presentEvent(t: TenantData, user: UserRow | null): LiveEvent {
  const e = t.event;
  const going = !!user && t.rsvps.some((r) => r.userId === user.id && r.eventId === e.id);
  const joinUrl = !user ? null : e.provider === 'built_in' ? `/live/${e.id}` : `https://zoom.us/j/8812345678?pwd=${user.id}`;
  return { ...e, attendees: e.attendees + t.rsvps.filter((r) => r.eventId === e.id).length, going, joinUrl };
}

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
    purchases: t.orders
      .filter((o) => o.userId === user.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((o) => ({ orderId: o.id, title: o.items.map((i) => i.title).join(', '), createdAt: o.createdAt, total: money(t, o.total) })),
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
      lessons: m.lessons.map((l) => ({ ...lessonRef(l, m.title), completed: done.has(l.id), locked: false })),
    })),
    communitySpace: space && t.site.features.community ? { id: space.id, name: space.name } : null,
  };
  return ok(c, player);
});

type LessonCtx = { error: Response } | ({ t: TenantData; user: UserRow } & NonNullable<ReturnType<typeof findLesson>>);

function lessonFor(c: AppContext): LessonCtx {
  const t = c.get('t');
  const user = c.get('user')!;
  const found = findLesson(t, c.req.param('id') ?? '');
  if (!found) return { error: notFound(c, 'Lesson') };
  if (!isEnrolled(t, user, found.course.id) && !found.lesson.freePreview) return { error: forbidden(c, 'Enrol to open this lesson.') };
  return { t, user, ...found };
}

learningRoutes.get('/me/lessons/:id', (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, module, lesson } = r;
  const done = completedSet(t, user.id);
  const all = allLessons(course);
  const idx = all.findIndex((x) => x.lesson.id === lesson.id);
  const short = lesson.title.length > 34 ? `${lesson.title.slice(0, 31)}…` : lesson.title;
  const last = t.quizAttempts.filter((a) => a.userId === user.id && a.lessonId === lesson.id).at(-1);
  const payload: Lesson = {
    ...lessonRef(lesson, module.title),
    courseSlug: course.slug,
    description:
      lesson.type === 'quiz'
        ? `Answer the questions below. You need ${PASS_PERCENT}% to pass — passing marks this lesson complete automatically, and you can retake it as often as you like.`
        : 'In this lesson you will work through the concept step by step, see it applied to a real student business, and leave with one action to complete before the next lesson.',
    completed: done.has(lesson.id),
    video: lesson.type === 'video' ? { hlsUrl: null, posterUrl: null, captions: [] } : null,
    pdf: lesson.type === 'pdf' ? { url: `/api/v1/me/lessons/${lesson.id}/file`, sizeBytes: lesson.pdfSizeBytes ?? 0 } : null,
    quiz:
      lesson.type === 'quiz'
        ? {
            passPercent: PASS_PERCENT,
            questions: lesson.questions.map((q) => ({
              id: q.id,
              prompt: q.prompt,
              options: q.options.map((label, i) => ({ id: `${q.id}_o${i}`, label })),
            })),
            lastResult: last ? { scorePercent: last.scorePercent, passed: last.passed, correct: 0, total: lesson.questions.length } : null,
          }
        : null,
    resources:
      lesson.type === 'quiz'
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
            ],
    note: t.notes.find((n) => n.userId === user.id && n.lessonId === lesson.id)?.body ?? '',
    questions: t.lessonQuestions
      .filter((q) => q.lessonId === lesson.id || q.lessonId === '*')
      // Thread order: oldest first (a question, then its answers). The client prepends questions the learner just asked.
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((q) => ({ id: q.id, author: { ...person(q.name, q.color), isInstructor: q.isCoach }, body: q.body, createdAt: q.createdAt })),
    nextLessonId: all[idx + 1]?.lesson.id ?? null,
  };
  return ok(c, payload);
});

learningRoutes.post('/me/lessons/:id/complete', (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, lesson } = r;
  if (lesson.type === 'quiz') return invalid(c, { lesson: 'Pass the quiz to complete this lesson.' });
  if (!t.completions.some((x) => x.userId === user.id && x.lessonId === lesson.id)) {
    t.completions.push({ userId: user.id, lessonId: lesson.id, at: new Date().toISOString() });
  }
  maybeIssueCertificate(t, user, course.id);
  return ok(c, { completed: true, progress: progressOf(course, completedSet(t, user.id)) });
});

learningRoutes.delete('/me/lessons/:id/complete', (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, lesson } = r;
  t.completions = t.completions.filter((x) => !(x.userId === user.id && x.lessonId === lesson.id));
  return ok(c, { completed: false, progress: progressOf(course, completedSet(t, user.id)) });
});

learningRoutes.post('/me/lessons/:id/quiz-attempts', async (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, lesson } = r;
  if (lesson.type !== 'quiz') return notFound(c, 'Quiz');
  const b = await body<QuizAttemptInput>(c);
  const answers = Array.isArray(b.answers) ? b.answers : [];
  const picked = new Map(answers.map((a) => [str(a.questionId), str(a.optionId)]));
  if (lesson.questions.some((q) => !picked.has(q.id))) return invalid(c, { answers: 'Answer every question before submitting.' });
  const correct = lesson.questions.filter((q) => picked.get(q.id) === `${q.id}_o${q.answer}`).length;
  const scorePercent = Math.round((correct / lesson.questions.length) * 100);
  const passed = scorePercent >= PASS_PERCENT;
  t.quizAttempts.push({
    userId: user.id,
    lessonId: lesson.id,
    answers: Object.fromEntries(lesson.questions.map((q) => [q.id, Number(picked.get(q.id)!.split('_o').at(-1))])),
    scorePercent,
    passed,
    at: new Date().toISOString(),
  });
  if (passed && !t.completions.some((x) => x.userId === user.id && x.lessonId === lesson.id)) {
    t.completions.push({ userId: user.id, lessonId: lesson.id, at: new Date().toISOString() });
    maybeIssueCertificate(t, user, course.id);
  }
  return ok(c, { scorePercent, passed, correct, total: lesson.questions.length }, 201);
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
      const verifyUrl = `https://verify.coursiva.io/${x.id}`;
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
      };
    });
  return ok(c, certs);
});
