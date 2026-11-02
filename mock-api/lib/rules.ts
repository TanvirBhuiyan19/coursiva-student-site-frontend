import type { CompletionRule, LessonCompletion, LessonLock, LiveLessonSession, Segment } from '@/features/learning/types';
import { checkProgress } from './blocks';
import { completedSet } from './present';
import type { CourseRow, LessonRow, TenantData, UserRow } from './records';

/**
 * Course builder v2 O4 in the mock: lesson availability (days / date / after another lesson), completion rules and
 * Live lessons. Laravel's LessonAccess / Go's learning access own the real rules (module rules, drip_schedule,
 * progressive unlock…); the mock implements the lesson-level ones its seed uses.
 */

const DAY = 86_400_000;

/** The lesson's lock for this learner, or null when it's open. Completed lessons always stay open. */
export function lockOf(t: TenantData, user: UserRow, course: CourseRow, lesson: LessonRow, now = Date.now()): LessonLock | null {
  const enrolled = t.enrollments.find((e) => e.userId === user.id && e.courseId === course.id);
  return lockFor(course, lesson, { done: completedSet(t, user.id), enrolledAt: enrolled?.enrolledAt ?? null, now });
}

/**
 * The lock rules themselves, for any learner — a real one (`lockOf`) or the staff preview's virtual learner (enrolled
 * `day` days before the simulated now, nothing completed).
 */
export function lockFor(
  course: CourseRow,
  lesson: LessonRow,
  learner: { done: Set<string>; enrolledAt: string | null; now: number },
): LessonLock | null {
  const a = lesson.available;
  const { done, now } = learner;
  if (!a || done.has(lesson.id)) return null;
  if (a.mode === 'date') return new Date(a.at).getTime() > now ? { reason: 'date', unlocksAt: a.at, after: null } : null;
  if (a.mode === 'days') {
    if (!learner.enrolledAt) return null;
    // Start of the enrolment day (the school's time zone — UTC in the mock) + N days.
    const start = new Date(learner.enrolledAt);
    start.setUTCHours(0, 0, 0, 0);
    const opens = start.getTime() + a.days * DAY;
    return opens > now ? { reason: 'drip', unlocksAt: new Date(opens).toISOString(), after: null } : null;
  }
  if (done.has(a.lessonId)) return null;
  const target = course.modules.flatMap((m) => m.lessons).find((l) => l.id === a.lessonId);
  return { reason: 'after_item', unlocksAt: null, after: target ? { id: target.id, title: target.title } : null };
}

export const LOCK_MESSAGES: Record<string, string> = {
  drip: 'This lesson unlocks later in your schedule.',
  date: 'This lesson opens on a later date.',
  after_item: 'Complete the earlier lesson first.',
};

export function ruleOf(lesson: LessonRow): CompletionRule {
  if (lesson.completionRule) return lesson.completionRule;
  if (lesson.type === 'quiz') return 'quiz';
  if (lesson.scorm) return 'scorm';
  if (lesson.assignment) return 'assignment';
  if (lesson.survey) return 'survey';
  return 'manual';
}

/** "This lesson completes on its own when {…}." — the 422 on `POST/DELETE …/complete` for non-manual rules (Laravel's copy). */
export function ruleWhen(rule: Exclude<CompletionRule, 'manual'>, value: number | null | undefined): string {
  switch (rule) {
    case 'video':
      return `you’ve watched ${value ?? 0}% of the video`;
    case 'time':
      return value === 1 ? 'you’ve spent 1 minute on it' : `you’ve spent ${value ?? 0} minutes on it`;
    case 'quiz':
      return 'you pass the quiz';
    case 'assignment':
      return 'your assignment is graded';
    case 'checks':
      return 'you’ve answered every knowledge check';
    case 'live':
      return 'you attend the live session';
    case 'scorm':
      return 'you finish the SCORM activity';
    case 'survey':
      return 'you submit the survey';
  }
}

/** Seconds covered by the union of the segments. */
export function coveredSeconds(segments: Segment[]): number {
  const sorted = [...segments].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [from, to] of sorted) {
    if (to <= end) continue;
    total += to - Math.max(from, end);
    end = to;
  }
  return total;
}

export const timeOf = (t: TenantData, userId: string, lessonId: string) =>
  (t.lessonTime ??= []).find((r) => r.userId === userId && r.lessonId === lessonId);

/** The `video` / `time` / `checks` share (0–100), or null for rules without one. */
function shareOf(t: TenantData, user: UserRow, lesson: LessonRow, rule: CompletionRule): number | null {
  if (rule === 'video') {
    const segs = (t.videoViews ?? []).filter((v) => v.userId === user.id && v.lessonId === lesson.id).flatMap((v) => v.segments);
    if (!lesson.durationSeconds) return 0;
    return Math.min(100, Math.floor((coveredSeconds(segs) / lesson.durationSeconds) * 100));
  }
  if (rule === 'time') {
    const goal = (lesson.completionValue ?? 1) * 60;
    return Math.min(100, Math.floor(((timeOf(t, user.id, lesson.id)?.seconds ?? 0) / goal) * 100));
  }
  if (rule === 'checks') {
    const { answered, total } = checkProgress(t, lesson.id, user.id);
    return total ? Math.floor((answered / total) * 100) : 100;
  }
  return null;
}

export function completionOf(t: TenantData, user: UserRow, lesson: LessonRow): LessonCompletion {
  const rule = ruleOf(lesson);
  const done = completedSet(t, user.id).has(lesson.id);
  const progress = shareOf(t, user, lesson, rule);
  return {
    rule,
    value: rule === 'video' || rule === 'time' ? (lesson.completionValue ?? null) : null,
    progress: done && progress !== null ? 100 : progress,
    done,
  };
}

/** Completes the lesson when its rule is met (after a playback report, a heartbeat or a check answer). */
export function ruleMet(t: TenantData, user: UserRow, lesson: LessonRow): boolean {
  const rule = ruleOf(lesson);
  const share = shareOf(t, user, lesson, rule);
  if (rule === 'video') return share !== null && share >= (lesson.completionValue ?? 100);
  if (rule === 'time' || rule === 'checks') return share === 100;
  if (rule === 'live')
    return !!lesson.live && (t.liveAttendance ?? []).some((a) => a.userId === user.id && a.sessionId === lesson.live!.sessionId);
  return false;
}

export function markComplete(t: TenantData, user: UserRow, lessonId: string): boolean {
  if (t.completions.some((x) => x.userId === user.id && x.lessonId === lessonId)) return false;
  t.completions.push({ userId: user.id, lessonId, at: new Date().toISOString() });
  return true;
}

/** A Live lesson's session; `join_url` only from 15 minutes before the start until it ends. */
export function liveOf(t: TenantData, lesson: LessonRow, now = Date.now()): LiveLessonSession | null {
  const l = lesson.live;
  if (!l) return null;
  const start = new Date(l.startsAt).getTime();
  const status = l.status === 'scheduled' && start <= now ? 'live' : l.status;
  const joinable = status === 'live' || (status === 'scheduled' && start - now <= 15 * 60_000);
  return {
    sessionId: l.sessionId,
    title: l.title,
    startsAt: l.startsAt,
    durationMin: l.durationMin,
    provider: l.provider,
    status,
    joinUrl: !joinable
      ? null
      : l.provider === 'built_in'
        ? `https://${t.site.primaryHost}/live/${l.sessionId}/room`
        : `https://zoom.us/j/8812345678?session=${l.sessionId}`,
    recording: l.recordingEmbedUrl
      ? { hlsUrl: null, posterUrl: null, captions: [], drm: null, url: null, embedUrl: l.recordingEmbedUrl, watermark: null }
      : null,
  };
}
