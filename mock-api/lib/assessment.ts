/**
 * Quizzes, assignments, peer review and SCORM state — the server-side rules Laravel owns (app/Modules/Assessment,
 * app/Modules/Scorm), ported closely enough that the site sees the same shapes and decisions.
 */
import type {
  AssignmentBlock,
  AssignmentSubmission,
  PeerFeedback,
  PeerReview,
  PeerReviewProgress,
  QuizBlock,
  QuizResult,
  ScormBlock,
  ScormState,
  VideoBlock,
} from '@/features/learning/types';
import type { AssignmentRow, CourseRow, LessonRow, ScormPackageRow, TenantData, UserRow } from './records';

export const PASS_PERCENT = 70;
export const MAX_FILES = 5;

/* ---------------------------------------------------------------- video */

/**
 * Laravel's Protection\Watermark: the learner's email and the last 6 characters of their id; a per-learner seed. The
 * course page's free preview (`user: null`) names no one, so it has no watermark.
 */
export function videoBlock(t: TenantData, user: UserRow | null, lesson: LessonRow): VideoBlock {
  const wm = user && lesson.watermark && t.watermark ? t.watermark : null;
  let seed = 7;
  for (const ch of user?.id ?? '') seed = (seed * 31 + ch.charCodeAt(0)) % 1000;
  return {
    hlsUrl: null,
    posterUrl: null,
    captions: [],
    drm: null,
    url: null,
    embedUrl: lesson.embedUrl ?? null,
    watermark: user && wm ? { text: `${user.email} · ${user.id.slice(-6)}`, style: 'email', seed, ...wm } : null,
  };
}

/* ---------------------------------------------------------------- quizzes */

type AttemptRow = TenantData['quizAttempts'][number];

export function quizResult(a: AttemptRow): QuizResult {
  const pending = a.reviewStatus === 'pending';
  return {
    scorePercent: a.scorePercent,
    passed: a.passed,
    correct: a.correct,
    total: a.total,
    pendingPoints: a.reviewStatus === 'reviewed' ? 0 : a.manualPoints,
    submittedAt: a.at,
    reviewStatus: a.reviewStatus,
    provisionalPercent: pending && a.autoPoints > 0 ? Math.round((a.earned / a.autoPoints) * 100) : null,
    feedback: a.reviewStatus === 'reviewed' ? a.feedback : null,
    reviewedAt: a.reviewedAt,
  };
}

export function quizBlock(t: TenantData, user: UserRow, lesson: LessonRow): QuizBlock {
  const mine = t.quizAttempts.filter((a) => a.userId === user.id && a.lessonId === lesson.id);
  const last = mine.at(-1);
  return {
    passPercent: PASS_PERCENT,
    questions: lesson.questions.map((q) => {
      const type = q.type ?? 'single_choice';
      return {
        id: q.id,
        type,
        prompt: q.prompt,
        points: q.points ?? 1,
        media: null,
        // Laravel's option ids are `o{index}`.
        options: q.options.map((label, i) => ({ id: `o${i}`, label })),
        multiple: type === 'multi_select',
        blankCount: 0,
        prompts: [],
        matches: [],
      };
    }),
    lastResult: last ? quizResult(last) : null,
    attemptsAllowed: null,
    attemptsUsed: mine.length,
    timeLimitMinutes: null,
    expiresAt: null,
  };
}

/* ---------------------------------------------------------------- SCORM */

type ScormAttempt = TenantData['scormAttempts'][number];

export const scormState = (a: ScormAttempt): ScormState => ({
  completionStatus: a.completionStatus,
  successStatus: a.successStatus,
  scoreScaled: a.scoreScaled,
  totalSeconds: a.totalSeconds,
  completed: a.completedAt !== null,
});

/** The package's files are served statelessly under a signed token (mock: base64url of the package, version, runtime). */
export const scormToken = (pkg: ScormPackageRow) =>
  Buffer.from(JSON.stringify({ p: pkg.id, v: pkg.version, r: pkg.runtime })).toString('base64url');

export const scormLaunchPath = (pkg: ScormPackageRow) => `/api/v1/files/scorm/${scormToken(pkg)}/index.html`;

export function scormBlock(t: TenantData, user: UserRow, lesson: LessonRow): ScormBlock | null {
  if (!lesson.scorm) return null;
  const a = t.scormAttempts.find((x) => x.userId === user.id && x.lessonId === lesson.id);
  return { launchUrl: scormLaunchPath(lesson.scorm), standard: lesson.scorm.standard, state: a ? scormState(a) : null };
}

/* ---------------------------------------------------------------- assignments */

type SubmissionRow = TenantData['submissions'][number];
type PeerRow = TenantData['peerReviews'][number];

export function findAssignment(t: TenantData, assignmentId: string) {
  for (const course of t.courses)
    for (const [mi, m] of course.modules.entries())
      for (const lesson of m.lessons) if (lesson.assignment?.id === assignmentId) return { course, moduleIndex: mi, lesson };
  return null;
}

const maxPoints = (a: AssignmentRow) => a.rubric.reduce((n, c) => n + c.max, 0);

/**
 * Laravel's Assignments\Deadlines. Weekly with a weekday: rolling per learner — week 1 is due at 23:59:59 on the first
 * `due_weekday` at least 7 days after the enrolment date, week n (the lesson's module number) 7 × (n − 1) days later.
 * The mock uses UTC as the school's time zone. Otherwise the staff-set `due_at`.
 */
export function deadlineFor(t: TenantData, user: UserRow, assignment: AssignmentRow): string | null {
  if (assignment.dueKind !== 'weekly' || assignment.dueWeekday === null) return assignment.dueAt;
  const found = findAssignment(t, assignment.id);
  const course = found?.course;
  const enrolledAt = course ? t.enrollments.find((e) => e.userId === user.id && e.courseId === course.id)?.enrolledAt : undefined;
  if (!enrolledAt) return null;
  const d = new Date(enrolledAt);
  d.setUTCHours(23, 59, 59, 0);
  d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() !== assignment.dueWeekday) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * (found?.moduleIndex ?? 0));
  return d.toISOString();
}

export function closedReason(assignment: AssignmentRow, submission: SubmissionRow | undefined, due: string | null): string | null {
  if (submission && submission.status !== 'resubmit')
    return submission.status === 'graded' ? 'This assignment has been graded.' : 'Your submission is waiting to be graded.';
  if (submission && assignment.attempts !== null && submission.attempt >= assignment.attempts)
    return 'You have used every attempt at this assignment.';
  if (assignment.latePolicy === 'rejected' && due !== null && new Date(due) < new Date())
    return 'The deadline has passed and late work is not accepted.';
  return null;
}

const peerState = (r: PeerRow): PeerReview['status'] =>
  r.status === 'submitted' ? 'submitted' : new Date(r.dueAt) < new Date() ? 'missed' : 'assigned';

export function peerProgress(t: TenantData, user: UserRow, assignment: AssignmentRow): PeerReviewProgress | null {
  if (assignment.reviewMode !== 'peer_instructor') return null;
  const rows = t.peerReviews.filter((r) => r.assignmentId === assignment.id && r.reviewerId === user.id);
  const open = rows.filter((r) => peerState(r) === 'assigned').sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return {
    required: Math.max(1, Math.min(5, assignment.peerReviewCount)),
    assigned: rows.length,
    completed: rows.filter((r) => r.status === 'submitted').length,
    nextDueAt: open?.dueAt ?? null,
  };
}

function peerFeedback(t: TenantData, assignment: AssignmentRow, submission: SubmissionRow): PeerFeedback[] {
  return t.peerReviews
    .filter((r) => r.submissionId === submission.id && r.status === 'submitted')
    .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))
    .map((r) => ({
      scores: (r.scores ?? []).map((s) => {
        const c = assignment.rubric.find((x) => x.id === s.criterionId);
        return { label: c?.label ?? '', score: s.score, max: c?.max ?? 0 };
      }),
      percent: r.percent,
      comment: r.comment,
      submittedAt: r.submittedAt,
    }));
}

export function learnerSubmission(t: TenantData, assignment: AssignmentRow, s: SubmissionRow): AssignmentSubmission {
  const grade = s.status === 'graded' ? s.grade : null;
  return {
    id: s.id,
    status: s.status,
    attempt: s.attempt,
    submittedAt: s.submittedAt,
    lateByDays: s.lateByDays,
    text: s.text,
    files: s.files,
    grade,
    resubmitFeedback: s.status === 'resubmit' ? s.resubmitFeedback : null,
    peerFeedback: grade && assignment.reviewMode === 'peer_instructor' ? peerFeedback(t, assignment, s) : [],
  };
}

export function assignmentBlock(t: TenantData, user: UserRow, lesson: LessonRow): AssignmentBlock | null {
  const a = lesson.assignment;
  if (!a) return null;
  const submission = t.submissions.find((s) => s.assignmentId === a.id && s.userId === user.id);
  const due = deadlineFor(t, user, a);
  return {
    id: a.id,
    title: a.title,
    brief: a.brief,
    points: a.points,
    dueAt: due,
    dueKind: a.dueKind,
    dueWeekday: a.dueWeekday,
    reviewMode: a.reviewMode,
    peerReview: peerProgress(t, user, a),
    latePolicy: a.latePolicy,
    attempts: a.attempts,
    fileTypes: a.fileTypes,
    maxFileMb: a.maxFileMb,
    maxFiles: MAX_FILES,
    gatesNextModule: a.gatesNextModule,
    rubric: a.rubric.map(({ label, hint, max }) => ({ label, hint, max })),
    submission: submission ? learnerSubmission(t, a, submission) : null,
    canSubmit: closedReason(a, submission, due) === null,
  };
}

/** A review as its reviewer sees it: the work without its author, the rubric with ids. */
export function presentPeerReview(t: TenantData, r: PeerRow): PeerReview {
  const found = findAssignment(t, r.assignmentId)!;
  const assignment = found.lesson.assignment!;
  const work = t.submissions.find((s) => s.id === r.submissionId)!;
  const state = peerState(r);
  return {
    id: r.id,
    assignmentId: r.assignmentId,
    status: state,
    assignedAt: r.assignedAt,
    dueAt: r.dueAt,
    submittedAt: r.submittedAt,
    canSubmit: state !== 'missed',
    rubric: assignment.rubric,
    work: { text: work.text, files: work.files, submittedAt: work.submittedAt },
    scores: r.scores ?? [],
    percent: r.percent,
    comment: r.comment,
  };
}

export const peerMaxPoints = maxPoints;

/**
 * Laravel's PeerReviews::allocate after a (re)submission: the author reviews classmates' work (least-reviewed first),
 * then classmates with reviews to spare review the author's. Returns how many reviews each reviewer was given.
 */
export function allocatePeerReviews(t: TenantData, course: CourseRow, assignment: AssignmentRow, submission: SubmissionRow) {
  if (assignment.reviewMode !== 'peer_instructor') return new Map<string, number>();
  const live = new Set(t.enrollments.filter((e) => e.courseId === course.id).map((e) => e.userId));
  const subs = t.submissions
    .filter((s) => s.assignmentId === assignment.id && live.has(s.userId))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const pairs = t.peerReviews.filter((r) => r.assignmentId === assignment.id);
  const received = (sid: string) => pairs.filter((p) => p.submissionId === sid).length;
  const given = (uid: string) => pairs.filter((p) => p.reviewerId === uid).length;
  const taken = (sid: string, uid: string) => pairs.some((p) => p.submissionId === sid && p.reviewerId === uid);
  const n = Math.max(1, Math.min(5, assignment.peerReviewCount));
  const author = submission.userId;
  const created = new Map<string, number>();
  const now = new Date();
  const add = (submissionId: string, reviewerId: string) => {
    const row: PeerRow = {
      id: `prv_${Math.random().toString(36).slice(2, 10)}`,
      assignmentId: assignment.id,
      submissionId,
      reviewerId,
      status: 'assigned',
      assignedAt: now.toISOString(),
      dueAt: new Date(now.getTime() + Math.max(1, assignment.peerReviewDays) * 86_400_000).toISOString(),
      submittedAt: null,
      scores: null,
      percent: null,
      comment: '',
    };
    pairs.push(row);
    t.peerReviews.push(row);
    created.set(reviewerId, (created.get(reviewerId) ?? 0) + 1);
  };
  while (given(author) < n) {
    const pick = subs.filter((s) => s.userId !== author && !taken(s.id, author)).sort((a, b) => received(a.id) - received(b.id))[0];
    if (!pick) break;
    add(pick.id, author);
  }
  while (received(submission.id) < n) {
    const pick = subs
      .filter((s) => s.userId !== author && !taken(submission.id, s.userId) && given(s.userId) < n)
      .sort((a, b) => given(a.userId) - given(b.userId))[0];
    if (!pick) break;
    add(submission.id, pick.userId);
  }
  return created;
}
