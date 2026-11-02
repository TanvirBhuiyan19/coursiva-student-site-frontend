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
  /** A paid or members-only session: its price and whether this learner has a seat. Null (or absent) when free. */
  ticket?: LiveTicketOffer | null;
}

/**
 * A paid (`paid`) or members-only (`members`) live session as a learner sees it. `hasAccess`: a seat without buying
 * (course learner, included membership or product, or a ticket already bought). `seriesPrice`: one ticket for every
 * upcoming session of its series. Prices come from the API (docs/api/community.md → Paid sessions).
 */
export interface LiveTicketOffer {
  access: 'paid' | 'members';
  price: Money | null;
  seriesPrice: Money | null;
  hasAccess: boolean;
  soldOut: boolean;
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
  /** Why a locked lesson is locked — a `LockReason` (unknown values are possible; null when open; absent from older APIs). */
  lockReason?: string | null;
  /** When a date- or day-based lock opens (ISO), else null. */
  unlocksAt?: string | null;
  /** `after_item`: the lesson or module to complete first, else null. */
  after?: LockAfter | null;
}

/**
 * Why a lesson is locked (course builder v2 O4). `drip` (days after enrolment) and `date` carry `unlocksAt`;
 * `after_item` carries `after`. Unknown future reasons fall back to a generic message.
 */
export type LockReason = 'drip' | 'date' | 'previous_module' | 'previous_lesson' | 'prerequisite' | 'assignment_gate' | 'after_item';

export interface LockAfter {
  id: string;
  title: string;
}

/** A lesson's lock: from the outline entry, or the `403 lesson_locked` body of `GET /me/lessons/{id}`. */
export interface LessonLock {
  /** A `LockReason`, or a reason this site doesn't know yet ("" when the API sent none). */
  reason: string;
  unlocksAt: string | null;
  after: LockAfter | null;
}

/** How a lesson completes (O4). Only `manual` lessons have a Complete button. */
export type CompletionRule = 'manual' | 'video' | 'time' | 'quiz' | 'assignment' | 'checks' | 'live' | 'scorm' | 'survey';

export interface LessonCompletion {
  rule: CompletionRule;
  /** video: the % to watch (50–100); time: minutes (1–120); else null. */
  value: number | null;
  /** 0–100 for video (watched share), time (time share) and checks (answered share); else null. */
  progress: number | null;
  done: boolean;
}

/** `POST /me/lessons/{id}/time` → */
export interface LessonTimeBeat {
  timeSpentSec: number;
  completed: boolean;
}

/** A Live lesson's session (O4): the linked live session is the source of truth. */
export interface LiveLessonSession {
  sessionId: string;
  title: string;
  startsAt: string;
  durationMin: number;
  provider: LiveEvent['provider'];
  status: 'scheduled' | 'live' | 'ended';
  /** Only while the session is joinable (the live join rules), else null. */
  joinUrl: string | null;
  /** The published recording, else null. */
  recording: VideoBlock | null;
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

export type QuizQuestionType = 'single_choice' | 'multi_select' | 'true_false' | 'free_text' | 'fill_blanks' | 'matching';

/** A question as learners see it — correct options, accepted blanks and match keys never leave the server. */
export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  points: number | null;
  media: { kind: 'image' | 'video'; url: string; alt: string } | null;
  /** Option ids are `o{index}`. */
  options: { id: string; label: string }[];
  /** `multi_select`: pick every correct option. */
  multiple: boolean;
  /** `fill_blanks`: how many blanks to fill, in order. */
  blankCount: number;
  /** `matching`: the left-hand prompts, answered in order with one of `matches`. */
  prompts: string[];
  matches: string[];
}

/**
 * `POST …/quiz-attempts` → `QuizResult`, also the quiz's `lastResult`. `scorePercent`/`passed` are null while nothing
 * auto-scores or a written answer awaits the instructor's review (`reviewStatus: 'pending'`, with the auto-scored part
 * as `provisionalPercent`). Once reviewed, `feedback` and `reviewedAt` are set.
 */
export interface QuizResult {
  scorePercent: number | null;
  passed: boolean | null;
  correct: number;
  total: number;
  pendingPoints: number;
  submittedAt: string | null;
  reviewStatus: 'pending' | 'reviewed' | null;
  provisionalPercent: number | null;
  /** The instructor's Markdown. */
  feedback: string | null;
  reviewedAt: string | null;
  /** Only on the attempt response. */
  attemptNo?: number;
  attemptsLeft?: number | null;
  /** Only when the school reveals answers after an attempt. */
  results?: { questionId: string; verdict: string; explanation: string }[];
}

export interface QuizBlock {
  passPercent: number;
  questions: QuizQuestion[];
  lastResult: QuizResult | null;
  /** Null = unlimited. */
  attemptsAllowed: number | null;
  attemptsUsed: number;
  timeLimitMinutes: number | null;
  /** A timed quiz's clock, started when the lesson was opened. */
  expiresAt: string | null;
}

export interface LessonQuestion {
  id: string;
  author: Person & { isInstructor: boolean };
  body: string;
  createdAt: string;
}

export interface Caption {
  lang: string;
  label: string;
  url: string;
}

/** Mux DRM licence URLs (`video.drm`) — mapped onto Shaka's `drm` config (see `video.ts`). */
export interface VideoDrm {
  widevineLicenseUrl: string | null;
  fairplayLicenseUrl: string | null;
  fairplayCertificateUrl: string | null;
  playreadyLicenseUrl: string | null;
}

export type WatermarkPosition = 'top-left' | 'top-right' | 'center' | 'bottom-left' | 'bottom-right';

/** The school's dynamic watermark, per learner: drawn by the player over the video (also in fullscreen). */
export interface VideoWatermark {
  text: string;
  style: string;
  opacity: number;
  color: string;
  /** Font size as a percentage of the player's height. */
  fontSizePct: number;
  positions: WatermarkPosition[];
  intervalSeconds: number;
  /** The first position is `positions[seed % positions.length]`. */
  seed: number;
}

export interface VideoBlock {
  /** Signed Mux HLS (4 h) once transcoded, else null. */
  hlsUrl: string | null;
  posterUrl: string | null;
  captions: Caption[];
  /** Licence URLs when the stream is DRM-encrypted, else null. */
  drm: VideoDrm | null;
  /** Signed stream of the source file — the fallback while there is no HLS. */
  url: string | null;
  /** Third-party embed (YouTube/Vimeo), played in an iframe. */
  embedUrl: string | null;
  watermark: VideoWatermark | null;
}

export type ScormRuntimeKind = 'scorm12' | 'scorm2004' | 'tincan' | 'cmi5';

export interface ScormState {
  completionStatus: string | null;
  successStatus: string | null;
  scoreScaled: number | null;
  totalSeconds: number;
  completed: boolean;
}

/** A SCORM / xAPI lesson's block on `GET /me/lessons/{id}`. `state` is null before the first launch. */
export interface ScormBlock {
  launchUrl: string;
  standard: string;
  state: ScormState | null;
}

/**
 * `GET /me/lessons/{id}/scorm` — the launch. `cmi` is the SCORM data model keyed by element name
 * (`cmi.core.lesson_status`); it is read without case conversion (its keys are data). Null for xAPI runtimes.
 */
export interface ScormLaunch {
  launchUrl: string;
  standard: string;
  runtime: ScormRuntimeKind;
  version: number;
  tracking: string;
  cmi: Record<string, string> | null;
  state: ScormState;
}

/** `PUT /me/lessons/{id}/scorm` → */
export interface ScormCommitResult {
  completed: boolean;
  progress: Progress;
  state: ScormState;
}

export type ScanStatus = 'pending' | 'clean' | 'infected' | 'skipped' | 'error';

export interface SubmissionFile {
  id: string;
  name: string;
  ext: string;
  sizeKb: number;
  /** Virus scan. An `infected` file was quarantined and can't be downloaded. */
  scanStatus: ScanStatus;
}

export interface PeerFeedback {
  scores: { label: string; score: number; max: number }[];
  percent: number | null;
  comment: string;
  submittedAt: string | null;
}

export interface AssignmentSubmission {
  id: string;
  status: 'needs_grading' | 'graded' | 'resubmit';
  attempt: number;
  submittedAt: string;
  lateByDays: number;
  text: string;
  files: SubmissionFile[];
  /** `feedback` and `resubmitFeedback` are the instructor's Markdown. */
  grade: { points: number; maxPoints: number; percent: number; feedback: string; gradedAt: string } | null;
  resubmitFeedback: string | null;
  /** Classmates' anonymous reviews, once the instructor has graded (peer mode). */
  peerFeedback: PeerFeedback[];
}

export interface PeerReviewProgress {
  required: number;
  assigned: number;
  completed: number;
  nextDueAt: string | null;
}

/** An `Assignment` lesson's block. `dueAt` is this learner's own deadline (rolling for weekly assignments). */
export interface AssignmentBlock {
  id: string;
  title: string;
  /** The school's Markdown. */
  brief: string;
  points: number | null;
  dueAt: string | null;
  dueKind: 'module_gate' | 'end_of_course' | 'weekly' | null;
  /** 0 = Sunday. */
  dueWeekday: number | null;
  reviewMode: string;
  /** Null unless the assignment is peer-reviewed (`review_mode: peer_instructor`). */
  peerReview: PeerReviewProgress | null;
  latePolicy: 'accepted' | 'accepted_flagged' | 'rejected';
  attempts: number | null;
  fileTypes: string[];
  maxFileMb: number;
  maxFiles: number;
  gatesNextModule: boolean;
  rubric: { label: string; hint: string; max: number }[];
  submission: AssignmentSubmission | null;
  canSubmit: boolean;
}

export interface RubricCriterion {
  id: string;
  label: string;
  hint: string;
  max: number;
}

/** `GET /me/assignments/{a}/peer-reviews/{r}` — a classmate's work, anonymously. */
export interface PeerReview {
  id: string;
  assignmentId: string;
  status: 'assigned' | 'submitted' | 'missed';
  assignedAt: string;
  dueAt: string;
  submittedAt: string | null;
  canSubmit: boolean;
  rubric: RubricCriterion[];
  work: { text: string; files: SubmissionFile[]; submittedAt: string };
  scores: { criterionId: string; score: number }[];
  percent: number | null;
  comment: string;
}

/** `GET /me/assignments/{a}/peer-reviews` */
export interface PeerReviewList {
  assignment: { id: string; title: string; reviewMode: string; rubric: RubricCriterion[] };
  progress: PeerReviewProgress | null;
  reviews: PeerReview[];
}

export interface PeerReviewInput {
  scores: { criterionId: string; score: number }[];
  comment: string;
}

/* ── Survey lessons — `survey` on `GET /me/lessons/{id}`, answered with `POST /me/lessons/{id}/survey` ──────────── */

export type SurveyFieldType = 'text' | 'long_text' | 'email' | 'phone' | 'number' | 'choice' | 'checkbox' | 'rating';

/** One question of the lesson's form (the form's `email` field is never asked: the account says who answered). */
export interface SurveyField {
  key: string;
  label: string;
  required: boolean;
  type: SurveyFieldType;
  /** `choice` only, else []. */
  options: string[];
}

/** text types → string; number → number; choice → one of `options`; checkbox → boolean; rating → 1–5; unanswered → null. */
export type SurveyValue = string | number | boolean | null;

/** The learner's stored answers: one entry per question in form order (a snapshot of the labels at submit time). */
export interface SurveyResponse {
  answers: { key: string; label: string; type: SurveyFieldType; value: SurveyValue }[];
  /** How many times the learner has submitted (re-submitting replaces the answers). */
  submissions: number;
  submittedAt: string;
}

/** A Survey lesson's block (its intro is the lesson's `bodyHtml`). */
export interface SurveyBlock {
  formId: string;
  title: string;
  fields: SurveyField[];
  allowResubmit: boolean;
  /** Enrolled and (no response yet or `allowResubmit`). */
  canSubmit: boolean;
  response: SurveyResponse | null;
}

/** `POST /me/lessons/{id}/survey` body: unanswered questions are omitted (or null). */
export interface SurveyInput {
  answers: { key: string; value: SurveyValue }[];
}

/** `POST /me/lessons/{id}/survey` → 201 */
export interface SurveySubmitResult {
  survey: SurveyBlock;
  completed: boolean;
  progress: Progress;
}

/**
 * `GET /api/v1/me/lessons/{id}` — lesson content; quiz answers never leave the server. SCORM and assignment lessons
 * come as `type: 'text'` (the learner types are coarse): the `scorm` / `assignment` blocks say what they are.
 */
export interface Lesson extends LessonRef {
  courseSlug: string;
  description: string;
  /** The author's Markdown (text body, instructions, intro, prompt) as HTML sanitised by the API; null = use `description`. */
  bodyHtml: string | null;
  /**
   * The lesson's content blocks (course builder v2), shown under the activity in order; null for lessons without a
   * body (then `bodyHtml` / `description` apply). Types the site doesn't know are skipped.
   */
  blocks: LearnerBlock[] | null;
  /**
   * How many blocks the API withheld after the first continue gate the learner hasn't passed (0 when none; absent from
   * older APIs). Shown as a hint at that gate.
   */
  blocksLocked?: number;
  /** Where an External lesson or a Coaching booking sends the learner (https). */
  link: { url: string; newTab: boolean } | null;
  completed: boolean;
  video: VideoBlock | null;
  pdf: { url: string; sizeBytes: number } | null;
  quiz: QuizBlock | null;
  scorm: ScormBlock | null;
  assignment: AssignmentBlock | null;
  resources: Resource[];
  note: string;
  questions: LessonQuestion[];
  nextLessonId: string | null;
  /** How the lesson completes (absent from older APIs: then quizzes, SCORM and assignments complete themselves). */
  completion?: LessonCompletion;
  /** Live lessons: the linked session; null/absent otherwise. */
  live?: LiveLessonSession | null;
  /** Survey lessons with a linked form: its questions and this learner's response; null/absent otherwise (and in previews). */
  survey?: SurveyBlock | null;
}

/* ── Lesson blocks (course builder v2) — `blocks` on `GET /me/lessons/{id}` and the free-preview lesson ───────── */

/**
 * Rendered by the API: `html` (text/callout) is the author's Markdown as safe HTML (the `bodyHtml` rules); every other
 * string is plain text the site escapes. Media URLs are the short-lived signed lesson media URLs; a block whose asset
 * is missing, not ready or infected is left out by the API.
 */
export interface LearnerHeadingBlock {
  id: string;
  type: 'heading';
  text: string;
  level: 2 | 3;
}
export interface LearnerTextBlock {
  id: string;
  type: 'text';
  html: string;
}
export type CalloutTone = 'info' | 'tip' | 'warning' | 'success';
export interface LearnerCalloutBlock {
  id: string;
  type: 'callout';
  html: string;
  tone: CalloutTone;
}
export interface LearnerQuoteBlock {
  id: string;
  type: 'quote';
  text: string;
  cite: string | null;
  style: 'plain' | 'large';
}
export interface LearnerListBlock {
  id: string;
  type: 'list';
  style: 'bullet' | 'numbered' | 'check';
  items: string[];
}
export interface LearnerDividerBlock {
  id: string;
  type: 'divider';
}
export interface LearnerCodeBlock {
  id: string;
  type: 'code';
  language: string | null;
  code: string;
}
export interface LearnerButtonBlock {
  id: string;
  type: 'button';
  label: string;
  /** https */
  url: string;
  style: 'primary' | 'secondary';
}
export interface LearnerTableBlock {
  id: string;
  type: 'table';
  /** The first row is the header row. */
  header: boolean;
  /** Every row has the same number of cells. */
  rows: string[][];
}
export interface LearnerImageBlock {
  id: string;
  type: 'image';
  url: string;
  /** "" when the image is decorative. */
  alt: string;
  caption: string | null;
  width: 'normal' | 'wide' | 'full';
}
export interface LearnerGalleryBlock {
  id: string;
  type: 'gallery';
  items: { url: string; alt: string; caption: string | null }[];
}
/** The lesson `video` object (signed HLS / source file, or `embedUrl`). */
export interface LearnerVideoBlock extends VideoBlock {
  id: string;
  type: 'video';
}
export interface LearnerAudioBlock {
  id: string;
  type: 'audio';
  url: string;
  name: string;
}
export interface LearnerPdfBlock {
  id: string;
  type: 'pdf';
  url: string;
  sizeBytes: number;
  name: string;
}
export interface LearnerFileBlock {
  id: string;
  type: 'file';
  url: string;
  name: string;
  sizeBytes: number;
  label: string | null;
}
export interface LearnerEmbedBlock {
  id: string;
  type: 'embed';
  /** The iframe player URL the API derived from the author's link (allow-listed hosts only). */
  src: string;
  /** px, 200–1,200 */
  height: number;
  /** e.g. "YouTube", "Figma" — names the frame. */
  provider: string;
}

/* ── Interactive blocks (course builder v2 O3) ── `html` / `questionHtml` are the API's sanitised Markdown. ───────── */

/** One accordion section, tab, process step or timeline entry. */
export interface LearnerSectionItem {
  title: string;
  html: string;
}
export interface LearnerAccordionBlock {
  id: string;
  type: 'accordion';
  items: LearnerSectionItem[];
}
export interface LearnerTabsBlock {
  id: string;
  type: 'tabs';
  items: LearnerSectionItem[];
}
export interface LearnerProcessBlock {
  id: string;
  type: 'process';
  items: LearnerSectionItem[];
}
export interface LearnerTimelineBlock {
  id: string;
  type: 'timeline';
  /** `date` is free text ("1998", "Week 2"). */
  items: (LearnerSectionItem & { date: string })[];
}
export interface LearnerFlashcardsBlock {
  id: string;
  type: 'flashcards';
  style: 'grid' | 'stack';
  /** `front` / `back` are plain text; `imageUrl` (front side) is a signed URL or null. */
  cards: { front: string; back: string; imageUrl: string | null }[];
}
export interface LearnerHotspotsBlock {
  id: string;
  type: 'hotspots';
  /** Signed image URL. */
  url: string;
  alt: string;
  /** `x` / `y` are percentages (0–100) of the image's width / height. */
  spots: { x: number; y: number; title: string; html: string }[];
}

/** The learner's last sorting attempt: per item, whether it was in the right category. */
export interface SortResult {
  correct: boolean;
  results: Record<string, boolean>;
}
export interface LearnerSortingBlock {
  id: string;
  type: 'sorting';
  prompt: string;
  categories: { id: string; label: string }[];
  /** Shuffled per learner; no category — grading is server-side. */
  items: { id: string; text: string }[];
  /** The last attempt: verdicts plus its placements (`answer`), so the board can be restored. */
  state: (SortResult & { answer: SortInput }) | null;
}
/** `{ placements: { [itemId]: categoryId } }` — every item exactly once. Ids are `[a-z0-9]{1,12}`. */
export interface SortInput {
  placements: Record<string, string>;
}

export type CheckKind = 'single' | 'multiple' | 'fill';
/** single / multiple: `optionIds`; fill: `text` (≤ 200). */
export interface CheckAnswer {
  optionIds?: string[];
  text?: string;
}
/** `POST …/check` → the verdict; `correctOptionIds` is empty for fill. `feedback` is plain text. */
export interface CheckResult {
  correct: boolean;
  correctOptionIds: string[];
  feedback: string | null;
}
export interface LearnerCheckBlock {
  id: string;
  type: 'check';
  kind: CheckKind;
  questionHtml: string;
  /** null for fill. */
  options: { id: string; text: string }[] | null;
  /** The next continue gate needs an answer (right or wrong). */
  required: boolean;
  /** null until answered; then the last answer and its verdict. */
  state: (CheckResult & { answer: CheckAnswer }) | null;
}
export interface LearnerContinueBlock {
  id: string;
  type: 'continue';
  label: string;
  passed: boolean;
}

export type LearnerBlock =
  | LearnerHeadingBlock
  | LearnerTextBlock
  | LearnerCalloutBlock
  | LearnerQuoteBlock
  | LearnerListBlock
  | LearnerDividerBlock
  | LearnerCodeBlock
  | LearnerButtonBlock
  | LearnerTableBlock
  | LearnerImageBlock
  | LearnerGalleryBlock
  | LearnerVideoBlock
  | LearnerAudioBlock
  | LearnerPdfBlock
  | LearnerFileBlock
  | LearnerEmbedBlock
  | LearnerAccordionBlock
  | LearnerTabsBlock
  | LearnerProcessBlock
  | LearnerTimelineBlock
  | LearnerFlashcardsBlock
  | LearnerHotspotsBlock
  | LearnerSortingBlock
  | LearnerCheckBlock
  | LearnerContinueBlock;

/** One answer; which fields apply depends on the question type. */
export interface QuizAnswer {
  questionId: string;
  /** single_choice / true_false */
  optionId?: string;
  /** multi_select */
  optionIds?: string[];
  /** free_text */
  text?: string;
  /** fill_blanks, in order */
  blanks?: string[];
  /** matching: the chosen match for each prompt, in order */
  matches?: string[];
}

export interface QuizAttemptInput {
  answers: QuizAnswer[];
}

/** `GET /me/courses/{course}/tutor` */
export interface TutorState {
  /** False when the school's tutor (or AI studio) is off — hide the tutor. */
  enabled: boolean;
  /** The school takes hand-offs to its team ("Ask the team"). */
  handoff: boolean;
  threads: TutorThread[];
}

export interface TutorMessage {
  id: string;
  role: 'student' | 'tutor';
  text: string;
  lessonId: string | null;
  createdAt: string | null;
}

export interface TutorThread {
  id: string;
  courseId: string;
  lessonId: string | null;
  title: string;
  status: 'open' | 'resolved' | 'escalated';
  escalatedAt: string | null;
  resolvedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  messages: TutorMessage[];
}

/** `POST …/tutor/messages` → 201 */
export interface TutorReply {
  reply: TutorMessage;
  /** False when the course material doesn't cover the question. */
  covered: boolean;
  canEscalate: boolean;
  thread: TutorThread;
}

export interface TutorAskInput {
  text: string;
  lessonId?: string | null;
  threadId?: string | null;
}

/** `POST /me/lessons/{id}/playback` body: what one player session played since its previous report. */
export interface PlaybackReport {
  /** 8–64 chars `[A-Za-z0-9-]`, one per player mount and lesson. */
  session: string;
  device: PlaybackDevice;
  /** ≤ 50 `[from, to]` ranges in seconds of media time (0–86 400); overlaps are rewatches. */
  segments: Segment[];
}
export type PlaybackDevice = 'web' | 'tablet' | 'app';
/** `POST …/playback` → `200 { data: { completion } }` (the lesson's completion after the report); older APIs: `204`. */
export interface PlaybackResult {
  completion: LessonCompletion;
}
export type Segment = [from: number, to: number];

/* ── Staff preview (course builder v2 O7) — `GET /api/v1/preview/{token}…`, no learner session ─────────────────── */

/** `working`: every lesson's working copy, drafts included (with `draft`); `published`: what learners get today. */
export type PreviewContent = 'working' | 'published';

/** The virtual learner: "now" (ISO), days since their enrolment, which copy of the course. */
export interface PreviewSimulation {
  now: string;
  day: number;
  content: PreviewContent;
}

export interface PreviewOutlineLesson extends PlayerLesson {
  /** A draft lesson (only in `working` mode). Absent = false. */
  draft?: boolean;
}

/** The learner course shape (the player's outline with lock fields) for the virtual learner (nothing completed). */
export interface PreviewCourse extends PlayerCourse {
  modules: { id: string; title: string; draft?: boolean; lessons: PreviewOutlineLesson[] }[];
}

/** `GET /api/v1/preview/{token}` */
export interface PreviewSession {
  course: PreviewCourse;
  simulation: PreviewSimulation;
  expiresAt: string;
}

/** Why learners can't open the lesson yet; `text` is the learner's sentence as of the simulated now. */
export interface PreviewLock {
  reason: string;
  unlocksAt: string | null;
  text: string;
}

/**
 * `GET /api/v1/preview/{token}/lessons/{lessonId}` — the learner lesson shape for the virtual learner. Locked lessons
 * stay viewable (`previewLock`). Every block is sent (continue gates open client-side only); quizzes come without
 * questions; no note, questions, submission or progress.
 */
export interface PreviewLesson extends Lesson {
  draft?: boolean;
  previewLock: PreviewLock | null;
}
