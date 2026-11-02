import type {
  AssignmentBlock,
  LessonLock,
  PreviewContent,
  PreviewCourse,
  PreviewLesson,
  PreviewLock,
  PreviewSession,
  QuizBlock,
} from '@/features/learning/types';
import { PASS_PERCENT, scormLaunchPath, videoBlock } from './assessment';
import { presentPreviewBlocks } from './blocks';
import { lessonRef } from './present';
import type { CourseRow, LessonRow, ModuleRow, TenantData } from './records';
import { liveOf, lockFor, ruleOf } from './rules';

/**
 * The staff preview (course builder v2 O7; docs/api/learning.md → Staff preview). The dashboard's
 * `POST /courses/{id}/preview-sessions` makes a short-lived token; this site's player renders the course for a virtual
 * learner with it. The mock has no dashboard, so its tokens are seeded here — two live ones for Amplify's Launch Lab
 * and an expired one. Live tokens never run out in the mock (their `expires_at` is always 30 minutes ahead).
 */

const DAY = 86_400_000;
export const PREVIEW_TTL_MS = 30 * 60_000;
export const PREVIEW_EXPIRED_MESSAGE = 'This preview has expired — open it again from the builder.';

interface PreviewTokenRow {
  tenant: string;
  courseId: string;
  content: PreviewContent;
  /** Days since the virtual enrolment (0–365). */
  day: number;
  /** The simulated "now" (ISO), or null for the real time. */
  at: string | null;
  /** A fixed expiry in the past, for the expired token. */
  expiredAt?: string;
}

/** 43-character base64url tokens, like the real 32 random bytes. */
export const PREVIEW_TOKENS: Record<string, PreviewTokenRow> = {
  pv_launchlab_working_day0_demo_000000000000: { tenant: 'amplify', courseId: 'crs_l', content: 'working', day: 0, at: null },
  pv_launchlab_published_day15_demo_00000000: { tenant: 'amplify', courseId: 'crs_l', content: 'published', day: 15, at: null },
  pv_launchlab_expired_demo_0000000000000000: {
    tenant: 'amplify',
    courseId: 'crs_l',
    content: 'working',
    day: 0,
    at: null,
    expiredAt: '2026-01-01T00:00:00.000Z',
  },
};

/**
 * Lessons that exist only in a course's working copy (never published): learners never see them, the preview shows
 * them in `working` mode with `draft: true`. The mock keeps them here, outside the learner data, so no learner
 * endpoint can leak them. Its blocks are the demo document's (lib/blocks.ts).
 */
const DRAFTS: Record<string, { moduleIndex: number; lesson: LessonRow }[]> = {
  crs_l: [
    {
      moduleIndex: 2,
      lesson: {
        id: 'les_l_draft_0',
        title: 'Launch retrospective (draft)',
        type: 'text',
        durationSeconds: 360,
        freePreview: false,
        questions: [],
        pdfSizeBytes: null,
      },
    },
  ],
};

export interface PreviewScope {
  token: string;
  row: PreviewTokenRow;
  course: CourseRow;
  /** Simulated now (ms) and the virtual enrolment start (ISO). */
  now: number;
  enrolledAt: string;
}

/** The token's preview, or null for an unknown, expired or other-school token (→ 404). */
export function previewScope(t: TenantData, token: string): PreviewScope | null {
  const row = Object.hasOwn(PREVIEW_TOKENS, token) ? PREVIEW_TOKENS[token] : undefined;
  if (!row || row.tenant !== t.site.slug || row.expiredAt) return null;
  const course = t.courses.find((c) => c.id === row.courseId);
  if (!course) return null;
  const now = row.at ? new Date(row.at).getTime() : Date.now();
  return { token, row, course, now, enrolledAt: new Date(now - row.day * DAY).toISOString() };
}

type Entry = { lesson: LessonRow; module: ModuleRow; draft: boolean };

/** The previewed outline: published lessons, plus the working copy's drafts in `working` mode. */
function outline(s: PreviewScope): { module: ModuleRow; draft: boolean; entries: Entry[] }[] {
  const drafts = s.row.content === 'working' ? (DRAFTS[s.course.id] ?? []) : [];
  return s.course.modules.map((m, i) => ({
    module: m,
    draft: false,
    entries: [
      ...m.lessons.map((lesson) => ({ lesson, module: m, draft: false })),
      ...drafts.filter((d) => d.moduleIndex === i).map((d) => ({ lesson: d.lesson, module: m, draft: true })),
    ],
  }));
}

const entriesOf = (s: PreviewScope) => outline(s).flatMap((m) => m.entries);

/** O4 for the virtual learner: enrolled `day` days before "now", nothing completed. */
function lockIn(s: PreviewScope, lesson: LessonRow): LessonLock | null {
  return lockFor(s.course, lesson, { done: new Set(), enrolledAt: s.enrolledAt, now: s.now });
}

/** The learner's sentence for a lock, as of the simulated now (the site prefixes "Learners can’t open this yet — "). */
export function lockText(t: TenantData, lock: LessonLock, now: number): string {
  switch (lock.reason) {
    case 'date': {
      const when = new Date(lock.unlocksAt ?? now).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: t.site.timeZone ?? 'UTC',
        timeZoneName: 'short',
      });
      return `Opens on ${when}`;
    }
    case 'drip': {
      if (!lock.unlocksAt) return 'This lesson unlocks later in your schedule.';
      const day = (ms: number) => Math.floor(ms / DAY);
      const days = Math.max(0, day(new Date(lock.unlocksAt).getTime()) - day(now));
      return days === 0 ? 'Opens later today' : days === 1 ? 'Opens tomorrow' : `Opens in ${days} days`;
    }
    case 'after_item':
      return lock.after ? `Complete “${lock.after.title}” first` : 'Complete the prerequisite lesson first.';
    default:
      return 'This lesson isn’t available yet.';
  }
}

export function previewSession(s: PreviewScope): PreviewSession {
  const course: PreviewCourse = {
    courseId: s.course.id,
    slug: s.course.slug,
    title: s.course.title,
    progress: { completed: 0, total: entriesOf(s).length, percent: 0 },
    modules: outline(s).map((m) => ({
      id: m.module.id,
      title: m.module.title,
      draft: m.draft,
      lessons: m.entries.map(({ lesson, module, draft }) => {
        const lock = lockIn(s, lesson);
        return {
          ...lessonRef(lesson, module.title),
          completed: false,
          locked: !!lock,
          lockReason: lock?.reason ?? null,
          unlocksAt: lock?.unlocksAt ?? null,
          after: lock?.after ?? null,
          draft,
        };
      }),
    })),
    // No learner, so no discussion space.
    communitySpace: null,
  };
  return {
    course,
    simulation: { now: new Date(s.now).toISOString(), day: s.row.day, content: s.row.content },
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
  };
}

export function findPreviewLesson(s: PreviewScope, lessonId: string): Entry | null {
  return entriesOf(s).find((e) => e.lesson.id === lessonId) ?? null;
}

/** Signed storage URLs in the real API; never a learner (`/me/…`) endpoint. */
const fileUrl = (lessonId: string, name: string) => `https://storage.example.com/mock/preview/${lessonId}/${name}?signature=mock`;

/** Quizzes come without questions: they can't be taken in preview. */
function previewQuiz(): QuizBlock {
  return {
    passPercent: PASS_PERCENT,
    questions: [],
    lastResult: null,
    attemptsAllowed: null,
    attemptsUsed: 0,
    timeLimitMinutes: null,
    expiresAt: null,
  };
}

function previewAssignment(lesson: LessonRow): AssignmentBlock | null {
  const a = lesson.assignment;
  if (!a) return null;
  return {
    id: a.id,
    title: a.title,
    brief: a.brief,
    points: a.points,
    dueAt: null,
    dueKind: a.dueKind,
    dueWeekday: a.dueWeekday,
    reviewMode: a.reviewMode,
    peerReview: null,
    latePolicy: a.latePolicy,
    attempts: a.attempts,
    fileTypes: a.fileTypes,
    maxFileMb: a.maxFileMb,
    maxFiles: 5,
    gatesNextModule: a.gatesNextModule,
    rubric: a.rubric.map(({ label, hint, max }) => ({ label, hint, max })),
    submission: null,
    canSubmit: false,
  };
}

export function previewLesson(
  t: TenantData,
  s: PreviewScope,
  entry: Entry,
  extras: { description: string; resources: PreviewLesson['resources'] },
): PreviewLesson {
  const { lesson, module, draft } = entry;
  const all = entriesOf(s);
  const idx = all.findIndex((e) => e.lesson.id === lesson.id);
  const lock = lockIn(s, lesson);
  const rule = ruleOf(lesson);
  const previewLock: PreviewLock | null = lock ? { reason: lock.reason, unlocksAt: lock.unlocksAt, text: lockText(t, lock, s.now) } : null;
  return {
    ...lessonRef(lesson, module.title),
    courseSlug: s.course.slug,
    description: extras.description,
    bodyHtml: null,
    ...presentPreviewBlocks(lesson.id),
    link: null,
    completed: false,
    // No learner: no watermark.
    video: lesson.type === 'video' ? videoBlock(t, null, lesson) : null,
    pdf: lesson.type === 'pdf' ? { url: fileUrl(lesson.id, 'lesson.pdf'), sizeBytes: lesson.pdfSizeBytes ?? 0 } : null,
    quiz: lesson.type === 'quiz' ? previewQuiz() : null,
    scorm: lesson.scorm ? { launchUrl: scormLaunchPath(lesson.scorm), standard: lesson.scorm.standard, state: null } : null,
    assignment: previewAssignment(lesson),
    resources: extras.resources.map((r, i) => ({ ...r, url: fileUrl(lesson.id, `resource-${i}`) })),
    note: '',
    questions: [],
    nextLessonId: all[idx + 1]?.lesson.id ?? null,
    completion: {
      rule,
      value: rule === 'video' || rule === 'time' ? (lesson.completionValue ?? null) : null,
      progress: rule === 'video' || rule === 'time' || rule === 'checks' ? 0 : null,
      done: false,
    },
    live: liveOf(t, lesson, s.now),
    // Previews carry no survey (no learner to answer it).
    survey: null,
    draft,
    previewLock,
  };
}
