/**
 * Assignment submissions, submission files and peer reviews (Laravel: app/Modules/Assessment, docs/assessments.md).
 * Uploads are virus-scanned in Laravel by a queued job; the mock scans at once — a file whose name contains "eicar"
 * is infected, quarantined and reported to the learner's bell.
 */
import { Hono } from 'hono';
import type { PeerReviewInput } from '@/features/learning/types';
import {
  allocatePeerReviews,
  closedReason,
  deadlineFor,
  findAssignment,
  learnerSubmission,
  MAX_FILES,
  peerMaxPoints,
  peerProgress,
  presentPeerReview,
} from '../lib/assessment';
import { type AppContext, type Env, requireUser } from '../lib/db';
import { apiError, body, id, invalid, notFound, ok } from '../lib/http';
import { isEnrolled } from '../lib/present';
import { lessonFor, maybeIssueCertificate } from './learning';

export const assessmentRoutes = new Hono<Env>();
assessmentRoutes.use('/me/*', requireUser);

/** Multipart `text` and/or up to five `files[]`, checked against the assignment's file types and size. */
assessmentRoutes.post('/me/lessons/:id/submission', async (c: AppContext) => {
  const r = lessonFor(c);
  if ('error' in r) return r.error;
  const { t, user, course, lesson } = r;
  const assignment = lesson.assignment;
  if (!assignment) return c.json({ message: 'This lesson has no assignment.' }, 404);
  if (!isEnrolled(t, user, course.id)) return c.json({ message: 'Enrol to open this lesson.' }, 403);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return invalid(c, { text: 'Write your answer or attach a file.' });
  }
  const text = typeof form.get('text') === 'string' ? (form.get('text') as string).trim() : '';
  const files = [...form.getAll('files[]'), ...form.getAll('files')].filter((f): f is File => typeof f !== 'string');
  const list = assignment.fileTypes.map((x) => x.toUpperCase()).join(', ');
  if (text.length > 50_000) return invalid(c, { text: 'The text field must not be greater than 50000 characters.' });
  if (files.length > MAX_FILES) return invalid(c, { files: `The files field must not have more than ${MAX_FILES} items.` });
  for (const [i, f] of files.entries()) {
    const ext = f.name.includes('.') ? f.name.split('.').at(-1)!.toLowerCase() : '';
    if (!assignment.fileTypes.includes(ext)) return invalid(c, { [`files.${i}`]: `Upload one of: ${list}.` });
    if (f.size > assignment.maxFileMb * 1024 * 1024)
      return invalid(c, { [`files.${i}`]: `Each file must be ${assignment.maxFileMb} MB or smaller.` });
  }
  if (!text && files.length === 0) return invalid(c, { text: 'Write your answer or attach a file.' });

  const existing = t.submissions.find((s) => s.assignmentId === assignment.id && s.userId === user.id);
  const due = deadlineFor(t, user, assignment);
  const reason = closedReason(assignment, existing, due);
  if (reason) return apiError(c, 409, reason, 'submission_closed');

  const now = new Date();
  const late = due && new Date(due) < now ? Math.max(1, Math.floor((now.getTime() - new Date(due).getTime()) / 86_400_000)) : 0;
  const stored = files.map((f) => ({
    id: id('fil'),
    name: f.name.replace(/[^\w.\- ]+/g, '').slice(0, 180) || 'file',
    ext: (f.name.split('.').at(-1) ?? '').toUpperCase(),
    sizeKb: Math.max(1, Math.ceil(f.size / 1024)),
    scanStatus: /eicar/i.test(f.name) ? ('infected' as const) : ('clean' as const),
  }));
  const row = existing ?? {
    id: id('sub'),
    assignmentId: assignment.id,
    lessonId: lesson.id,
    userId: user.id,
    status: 'needs_grading' as const,
    attempt: 0,
    submittedAt: now.toISOString(),
    lateByDays: 0,
    text: '',
    files: [],
    grade: null,
    resubmitFeedback: null,
  };
  Object.assign(row, {
    attempt: row.attempt + 1,
    status: 'needs_grading',
    text,
    files: stored,
    submittedAt: now.toISOString(),
    lateByDays: late,
  });
  if (!existing) t.submissions.push(row);

  if (!assignment.gatesNextModule && !t.completions.some((x) => x.userId === user.id && x.lessonId === lesson.id)) {
    t.completions.push({ userId: user.id, lessonId: lesson.id, at: now.toISOString() });
    maybeIssueCertificate(t, user, course.id);
  }

  const path = `/learn/${course.slug}/${lesson.id}`;
  for (const [reviewerId, count] of allocatePeerReviews(t, course, assignment, row)) {
    t.notifications.unshift({
      id: id('ntf'),
      userId: reviewerId,
      kind: 'peer_review_assigned',
      text:
        count === 1
          ? `A classmate’s work is ready for your review in “${assignment.title}”.`
          : `${count} classmates’ submissions are ready for your review in “${assignment.title}”.`,
      href: path,
      createdAt: now.toISOString(),
      readAt: null,
    });
  }
  const infected = stored.filter((f) => f.scanStatus === 'infected').map((f) => f.name);
  if (infected.length) {
    t.notifications.unshift({
      id: id('ntf'),
      userId: user.id,
      kind: 'file_quarantined',
      text: `A file you submitted to “${assignment.title}” contains malware and was removed (${infected.join(', ')}). Ask your instructor how to send a clean copy.`,
      href: path,
      createdAt: now.toISOString(),
      readAt: null,
    });
  }
  return ok(c, learnerSubmission(t, assignment, row), 201);
});

const fileBody = (name: string) => `Mock file “${name}” — Laravel streams the stored upload as an attachment.\n`;

function quarantined(c: AppContext) {
  return apiError(c, 409, 'This file contains malware and was quarantined.', 'conflict', { reason: 'file_quarantined' });
}

/** A learner downloads a file of their own submission (an infected file is 409 file_quarantined). */
assessmentRoutes.get('/me/submissions/:submission/files/:file', (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const s = t.submissions.find((x) => x.id === c.req.param('submission') && x.userId === user.id);
  if (!s) return notFound(c, 'Submission');
  const f = s.files.find((x) => x.id === c.req.param('file'));
  if (!f) return notFound(c, 'File');
  if (f.scanStatus === 'infected') return quarantined(c);
  return c.body(fileBody(f.name), 200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${f.name}"`,
    'Cache-Control': 'private, no-store',
  });
});

/* ------------------------------------------------------------------ peer reviews */

function assignmentFor(c: AppContext) {
  const t = c.get('t');
  const user = c.get('user')!;
  const found = findAssignment(t, c.req.param('assignment') ?? '');
  if (!found || !isEnrolled(t, user, found.course.id)) return null;
  return { t, user, ...found, assignment: found.lesson.assignment! };
}

function reviewFor(c: AppContext) {
  const a = assignmentFor(c);
  if (!a) return { error: notFound(c, 'Assignment') };
  const row = a.t.peerReviews.find(
    (r) => r.id === c.req.param('review') && r.assignmentId === a.assignment.id && r.reviewerId === a.user.id,
  );
  if (!row) return { error: notFound(c, 'Peer review') };
  return { ...a, row };
}

assessmentRoutes.get('/me/assignments/:assignment/peer-reviews', (c: AppContext) => {
  const a = assignmentFor(c);
  if (!a) return notFound(c, 'Assignment');
  const { t, user, assignment } = a;
  const mine = t.peerReviews
    .filter((r) => r.assignmentId === assignment.id && r.reviewerId === user.id)
    .map((r) => presentPeerReview(t, r))
    // Open ones first, then by due date.
    .sort((x, y) => x.status.localeCompare(y.status) || x.dueAt.localeCompare(y.dueAt));
  return ok(c, {
    assignment: { id: assignment.id, title: assignment.title, reviewMode: assignment.reviewMode, rubric: assignment.rubric },
    progress: peerProgress(t, user, assignment),
    reviews: mine,
  });
});

assessmentRoutes.get('/me/assignments/:assignment/peer-reviews/:review', (c: AppContext) => {
  const r = reviewFor(c);
  if (r.error !== undefined) return r.error;
  return ok(c, presentPeerReview(r.t, r.row));
});

assessmentRoutes.put('/me/assignments/:assignment/peer-reviews/:review', async (c: AppContext) => {
  const r = reviewFor(c);
  if (r.error !== undefined) return r.error;
  const { t, row, assignment } = r;
  if (new Date(row.dueAt) < new Date()) return apiError(c, 409, 'The deadline for this peer review has passed.', 'submission_closed');
  const b = await body<PeerReviewInput>(c);
  const comment = typeof b.comment === 'string' ? b.comment.trim() : '';
  if (comment.length > 5000) return invalid(c, { comment: 'Keep your comment under 5,000 characters.' });
  const given = new Map((Array.isArray(b.scores) ? b.scores : []).map((s) => [s.criterionId, s.score]));
  const marks: { criterionId: string; score: number }[] = [];
  for (const crit of assignment.rubric) {
    const score = given.get(crit.id);
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > crit.max)
      return invalid(c, { scores: 'Score every rubric row first.' });
    marks.push({ criterionId: crit.id, score });
  }
  const max = peerMaxPoints(assignment);
  Object.assign(row, {
    status: 'submitted',
    scores: marks,
    percent: max > 0 ? Math.round((marks.reduce((n, m) => n + m.score, 0) / max) * 100) : 0,
    comment,
    submittedAt: new Date().toISOString(),
  });
  return ok(c, presentPeerReview(t, row));
});

assessmentRoutes.get('/me/assignments/:assignment/peer-reviews/:review/files/:file', (c: AppContext) => {
  const r = reviewFor(c);
  if (r.error !== undefined) return r.error;
  const work = r.t.submissions.find((s) => s.id === r.row.submissionId);
  const f = work?.files.find((x) => x.id === c.req.param('file'));
  if (!f) return notFound(c, 'File');
  if (f.scanStatus === 'infected') return quarantined(c);
  return c.body(fileBody(f.name), 200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${f.name}"`,
    'Cache-Control': 'private, no-store',
  });
});
