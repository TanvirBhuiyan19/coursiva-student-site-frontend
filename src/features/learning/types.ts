/** Learner progress, the player and quizzes. Contract: docs/api/learning.md */
import type { Cover, Money, Person } from '@/lib/api/types';
import type { CourseSummary, LessonType } from '@/features/catalog/types';

export interface Progress {
  completed: number;
  total: number;
  /** Rounded by the API — the only place progress percentages are computed. */
  percent: number;
}

export interface LessonRef {
  id: string;
  title: string;
  type: LessonType;
  durationSeconds: number | null;
  questionCount: number | null;
  moduleTitle: string;
}

/** `GET /api/v1/me/enrollments` */
export interface Enrollment {
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  cover: Cover;
  progress: Progress;
  /** First incomplete lesson (or the first lesson once everything is done). */
  resumeLesson: LessonRef;
  completedAt: string | null;
  enrolledAt: string;
}

export interface LiveEvent {
  id: string;
  title: string;
  startsAt: string;
  provider: 'zoom' | 'google_meet' | 'teams' | 'built_in';
  attendees: number;
  going: boolean;
  /** Personal join link (BYO provider) or the in-browser room. Null for guests. */
  joinUrl: string | null;
}

export interface Achievement {
  id: string;
  kind: 'streak' | 'certificate' | 'lessons';
  title: string;
  detail: string;
}

export interface PurchaseRow {
  orderId: string;
  title: string;
  createdAt: string;
  total: Money;
}

/** `GET /api/v1/me/dashboard` — every figure pre-computed by the API. */
export interface Dashboard {
  streakDays: number;
  weeklyGoal: number;
  weekLessons: number;
  /** Seven entries, Monday first. */
  activity: { day: string; lessons: number }[];
  upNext: (LessonRef & { courseSlug: string; courseTitle: string })[];
  recommendation: { course: CourseSummary; reason: string } | null;
  nextEvent: LiveEvent | null;
  achievements: Achievement[];
  purchases: PurchaseRow[];
}

export interface PlayerLesson extends LessonRef {
  completed: boolean;
  locked: boolean;
}

/** `GET /api/v1/me/courses/{slug}` — the player's sidebar. */
export interface PlayerCourse {
  courseId: string;
  slug: string;
  title: string;
  progress: Progress;
  modules: { id: string; title: string; lessons: PlayerLesson[] }[];
  communitySpace: { id: string; name: string } | null;
}

export interface Resource {
  id: string;
  kind: 'pdf' | 'slides' | 'file';
  name: string;
  sizeBytes: number;
  url: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: { id: string; label: string }[];
}

export interface QuizResult {
  scorePercent: number;
  passed: boolean;
  correct: number;
  total: number;
}

export interface LessonQuestion {
  id: string;
  author: Person & { isInstructor: boolean };
  body: string;
  createdAt: string;
}

/** `GET /api/v1/me/lessons/{id}` — lesson content; quiz answers never leave the server. */
export interface Lesson extends LessonRef {
  courseSlug: string;
  description: string;
  completed: boolean;
  video: { hlsUrl: string | null; posterUrl: string | null; captions: { lang: string; label: string; url: string }[] } | null;
  pdf: { url: string; sizeBytes: number } | null;
  quiz: { passPercent: number; questions: QuizQuestion[]; lastResult: QuizResult | null } | null;
  resources: Resource[];
  note: string;
  questions: LessonQuestion[];
  nextLessonId: string | null;
}

export interface QuizAttemptInput {
  answers: { questionId: string; optionId: string }[];
}
