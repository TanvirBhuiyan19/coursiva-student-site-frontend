'use client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSession } from '@/features/auth/api';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { Review } from '@/features/catalog/types';
import { afterBeat } from './availability';
import { previewKeys, previewLessonPath, usePreview, type PreviewState } from './previewContext';
import type {
  AssignmentSubmission,
  CheckAnswer,
  CheckResult,
  LearnerBlock,
  Dashboard,
  Enrollment,
  Lesson,
  LessonQuestion,
  LessonTimeBeat,
  PlaybackResult,
  PeerReview,
  PeerReviewInput,
  PeerReviewList,
  PlayerCourse,
  Progress,
  QuizAttemptInput,
  QuizResult,
  SortInput,
  SortResult,
  SurveyInput,
  SurveySubmitResult,
  TutorAskInput,
  TutorReply,
  TutorState,
  TutorThread,
} from './types';

export const learningKeys = {
  enrollments: ['learning', 'enrollments'] as const,
  dashboard: ['learning', 'dashboard'] as const,
  course: (slug: string) => ['learning', 'course', slug] as const,
  lesson: (id: string) => ['learning', 'lesson', id] as const,
  certificates: ['account', 'certificates'] as const,
  tutor: (courseSlug: string) => ['learning', 'tutor', courseSlug] as const,
  peerReviews: (assignmentId: string) => ['learning', 'peer-reviews', assignmentId] as const,
  peerReview: (assignmentId: string, reviewId: string) => ['learning', 'peer-reviews', assignmentId, reviewId] as const,
};

/** Enrolments for the signed-in learner; `[]` for guests without a request. */
export function useEnrollments() {
  const { isSignedIn } = useSession();
  const q = useQuery({ queryKey: learningKeys.enrollments, queryFn: () => api.get<Enrollment[]>('/me/enrollments'), enabled: isSignedIn });
  return { ...q, data: isSignedIn ? q.data : [] };
}

/** Self-enrolment in a free course (`POST /me/enrollments`; paid courses go through checkout — the API answers 402). */
export function useEnrollFree() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (courseSlug: string) => api.post<Enrollment>('/me/enrollments', { courseSlug }),
    meta: { errorToast: false },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: learningKeys.enrollments });
      void qc.invalidateQueries({ queryKey: learningKeys.dashboard });
    },
  });
}

/** Lookup by course slug, used to personalise public course cards and the course page. */
export function useEnrollmentFor(slug: string) {
  const { data } = useEnrollments();
  return data?.find((e) => e.courseSlug === slug) ?? null;
}

export function useDashboard() {
  return useQuery({ queryKey: learningKeys.dashboard, queryFn: () => api.get<Dashboard>('/me/dashboard') });
}

export function useSetWeeklyGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weeklyGoal: number) => api.put<{ weeklyGoal: number }>('/me/goal', { weeklyGoal }),
    onSuccess: ({ weeklyGoal }) => qc.setQueryData<Dashboard>(learningKeys.dashboard, (d) => (d ? { ...d, weeklyGoal } : d)),
  });
}

export function usePlayerCourse(slug: string) {
  return useQuery({ queryKey: learningKeys.course(slug), queryFn: () => api.get<PlayerCourse>(`/me/courses/${encodeURIComponent(slug)}`) });
}

export function useLesson(id: string | null) {
  return useQuery({
    queryKey: learningKeys.lesson(id ?? ''),
    queryFn: () => api.get<Lesson>(`/me/lessons/${encodeURIComponent(id!)}`),
    enabled: !!id,
  });
}

/** Progress changed: refresh the player sidebar, enrolments, dashboard and certificates (a 100% course issues one). */
export function afterProgress(qc: QueryClient, courseSlug: string) {
  void qc.invalidateQueries({ queryKey: learningKeys.course(courseSlug) });
  void qc.invalidateQueries({ queryKey: learningKeys.enrollments });
  void qc.invalidateQueries({ queryKey: learningKeys.dashboard });
  void qc.invalidateQueries({ queryKey: learningKeys.certificates });
}

export function patchLessonDone(qc: QueryClient, lessonId: string, courseSlug: string, completed: boolean) {
  qc.setQueryData<Lesson>(learningKeys.lesson(lessonId), (l) =>
    l ? { ...l, completed, ...(l.completion && { completion: { ...l.completion, done: completed } }) } : l,
  );
  qc.setQueryData<PlayerCourse>(learningKeys.course(courseSlug), (c) =>
    c
      ? { ...c, modules: c.modules.map((m) => ({ ...m, lessons: m.lessons.map((x) => (x.id === lessonId ? { ...x, completed } : x)) })) }
      : c,
  );
}

/**
 * Mark complete / incomplete — optimistic, rolled back on error. Only lessons with the `manual` completion rule; any
 * other rule answers `422` with a sentence for the learner, shown by the player.
 */
export function useToggleComplete(courseSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorToast: false },
    mutationFn: ({ lessonId, completed }: { lessonId: string; completed: boolean }) =>
      completed
        ? api.post<{ completed: boolean; progress: Progress }>(`/me/lessons/${lessonId}/complete`)
        : api.delete<{ completed: boolean; progress: Progress }>(`/me/lessons/${lessonId}/complete`),
    onMutate: ({ lessonId, completed }) => patchLessonDone(qc, lessonId, courseSlug, completed),
    onError: (_e, { lessonId, completed }) => patchLessonDone(qc, lessonId, courseSlug, !completed),
    onSettled: () => afterProgress(qc, courseSlug),
  });
}

/**
 * Re-reads a lesson's completion (the `video` rule after a playback report, the `checks` rule after an answer) and
 * patches only `completion`/`completed` into the cached lesson — the rest (signed media URLs, blocks) stays as it is,
 * so a playing video isn't reloaded. A lesson that just completed refreshes the progress queries.
 */
export async function refreshCompletion(qc: QueryClient, lessonId: string, courseSlug: string) {
  const before = qc.getQueryData<Lesson>(learningKeys.lesson(lessonId));
  const fresh = await api.get<Lesson>(`/me/lessons/${encodeURIComponent(lessonId)}`);
  qc.setQueryData<Lesson>(learningKeys.lesson(lessonId), (l) =>
    l ? { ...l, completed: fresh.completed, ...(fresh.completion && { completion: fresh.completion }) } : l,
  );
  if (fresh.completed && !before?.completed) {
    patchLessonDone(qc, lessonId, courseSlug, true);
    afterProgress(qc, courseSlug);
  }
}

/** Puts a completion the API returned (a playback report's answer) into the cached lesson, like `refreshCompletion`. */
export function applyCompletion(qc: QueryClient, lessonId: string, courseSlug: string, completion: Lesson['completion']) {
  if (!completion) return;
  const before = qc.getQueryData<Lesson>(learningKeys.lesson(lessonId));
  qc.setQueryData<Lesson>(learningKeys.lesson(lessonId), (l) => (l ? { ...l, completion, completed: l.completed || completion.done } : l));
  if (completion.done && !before?.completed) {
    patchLessonDone(qc, lessonId, courseSlug, true);
    afterProgress(qc, courseSlug);
  }
}

/**
 * After a playback report: the answer's `completion` (`200 { data: { completion } }`), or — from an older API's
 * `204` — a re-read of the lesson's completion. Failures are dropped (the next report tries again).
 */
export function usePlaybackCompletion(lessonId: string, courseSlug: string) {
  const qc = useQueryClient();
  return (result: PlaybackResult | undefined) => {
    if (result?.completion) applyCompletion(qc, lessonId, courseSlug, result.completion);
    else void refreshCompletion(qc, lessonId, courseSlug).catch(() => undefined);
  };
}

/** Applies a `POST …/time` answer to the cached lesson; a beat that completed it refreshes progress like Complete does. */
export function useApplyTimeBeat(lessonId: string, courseSlug: string) {
  const qc = useQueryClient();
  return (beat: LessonTimeBeat) => {
    const before = qc.getQueryData<Lesson>(learningKeys.lesson(lessonId));
    qc.setQueryData<Lesson>(learningKeys.lesson(lessonId), (l) =>
      l?.completion ? { ...l, completion: afterBeat(l.completion, beat.timeSpentSec, beat.completed) } : l,
    );
    if (beat.completed && !before?.completed) {
      patchLessonDone(qc, lessonId, courseSlug, true);
      afterProgress(qc, courseSlug);
    }
  };
}

export function useSubmitQuiz(courseSlug: string, lessonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuizAttemptInput) => api.post<QuizResult>(`/me/lessons/${lessonId}/quiz-attempts`, input),
    onSuccess: (result) => {
      if (result.passed === true) patchLessonDone(qc, lessonId, courseSlug, true);
      // The lesson's quiz block (last result, attempts used) changed too.
      qc.setQueryData<Lesson>(learningKeys.lesson(lessonId), (l) =>
        l?.quiz ? { ...l, quiz: { ...l.quiz, lastResult: result, attemptsUsed: l.quiz.attemptsUsed + 1 } } : l,
      );
      afterProgress(qc, courseSlug);
    },
  });
}

/**
 * A Survey lesson's answers (`POST /me/lessons/{id}/survey`). The answer carries the new `survey` block (response,
 * can_submit) — put into the cached lesson — and whether the lesson completed (the `survey` rule). Errors (422 per
 * question, 409 already answered) are shown by the panel.
 */
export function useSubmitSurvey(courseSlug: string, lessonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SurveyInput) => api.post<SurveySubmitResult>(`/me/lessons/${encodeURIComponent(lessonId)}/survey`, input),
    meta: { errorToast: false },
    onSuccess: ({ survey, completed }) => {
      qc.setQueryData<Lesson>(learningKeys.lesson(lessonId), (l) => (l ? { ...l, survey } : l));
      if (completed) patchLessonDone(qc, lessonId, courseSlug, true);
      afterProgress(qc, courseSlug);
    },
    // 409: answered elsewhere (another tab) — reload the lesson (awaited, so the panel then has the stored response).
    onError: (err) =>
      err instanceof ApiError && err.isConflict ? qc.invalidateQueries({ queryKey: learningKeys.lesson(lessonId) }) : undefined,
  });
}

export function useSaveNote(lessonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.put<{ body: string }>(`/me/lessons/${lessonId}/note`, { body }),
    onSuccess: ({ body }) => qc.setQueryData<Lesson>(learningKeys.lesson(lessonId), (l) => (l ? { ...l, note: body } : l)),
  });
}

export function useAskQuestion(lessonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<LessonQuestion>(`/me/lessons/${lessonId}/questions`, { body }),
    // The thread is oldest first (a question, then its answers): a new question goes at the end.
    onSuccess: (q) => qc.setQueryData<Lesson>(learningKeys.lesson(lessonId), (l) => (l ? { ...l, questions: [...l.questions, q] } : l)),
  });
}

/* ---------------------------------------------------------------- interactive lesson blocks */

const blockPath = (lessonId: string, blockId: string, action: 'check' | 'sort' | 'continue', preview: PreviewState | null = null) =>
  preview
    ? `${previewLessonPath(preview.token, lessonId)}/blocks/${encodeURIComponent(blockId)}/${action}`
    : `/me/lessons/${encodeURIComponent(lessonId)}/blocks/${encodeURIComponent(blockId)}/${action}`;

/** The cached lesson: the learner's, or the staff preview's (seeded from the server render). */
const lessonKey = (lessonId: string, preview: PreviewState | null) =>
  preview ? previewKeys.lesson(preview.token, lessonId) : learningKeys.lesson(lessonId);

/** Keeps the cached lesson in step with an answer, so the block shows it after a remount. */
function patchBlock(
  qc: QueryClient,
  lessonId: string,
  blockId: string,
  patch: (b: LearnerBlock) => LearnerBlock,
  preview: PreviewState | null = null,
) {
  qc.setQueryData<Lesson>(lessonKey(lessonId, preview), (l) =>
    l?.blocks ? { ...l, blocks: l.blocks.map((b) => (b.id === blockId ? patch(b) : b)) } : l,
  );
}

/**
 * A knowledge check's answer → the server's verdict (unlimited retries; the latest answer is stored). In the staff
 * preview it's graded statelessly (`POST /preview/{token}/…/check`, nothing stored, no completion).
 */
export function useCheckBlock(lessonId: string, blockId: string) {
  const qc = useQueryClient();
  const preview = usePreview();
  return useMutation({
    mutationFn: (answer: CheckAnswer) => api.post<CheckResult>(blockPath(lessonId, blockId, 'check', preview), answer),
    // Errors are shown next to the block.
    meta: { errorToast: false },
    onSuccess: (result, answer) => {
      patchBlock(qc, lessonId, blockId, (b) => (b.type === 'check' ? { ...b, state: { ...result, answer } } : b), preview);
      if (preview) return;
      // The `checks` completion rule: the answer may have completed the lesson.
      const lesson = qc.getQueryData<Lesson>(learningKeys.lesson(lessonId));
      if (lesson?.completion?.rule === 'checks' && !lesson.completion.done)
        void refreshCompletion(qc, lessonId, lesson.courseSlug).catch(() => undefined);
    },
  });
}

/** A sorting block's placements → per-item results (stateless in the staff preview). */
export function useSortBlock(lessonId: string, blockId: string) {
  const qc = useQueryClient();
  const preview = usePreview();
  return useMutation({
    mutationFn: (input: SortInput) => api.post<SortResult>(blockPath(lessonId, blockId, 'sort', preview), input),
    meta: { errorToast: false },
    onSuccess: (result, answer) =>
      patchBlock(qc, lessonId, blockId, (b) => (b.type === 'sorting' ? { ...b, state: { ...result, answer } } : b), preview),
  });
}

/** The API's message for a continue gate with an unanswered required check above it. */
export const GATE_REQUIRED_MESSAGE = 'Answer the questions above first.';

/**
 * The staff preview's continue gate, client-side only (the preview API sends every block and records nothing): the
 * learner rule — every required check since the previous gate answered (in this preview) — then the gate opens.
 */
export function passPreviewGate(qc: QueryClient, preview: PreviewState, lessonId: string, blockId: string): { passed: boolean } {
  const key = previewKeys.lesson(preview.token, lessonId);
  const blocks = qc.getQueryData<Lesson>(key)?.blocks ?? [];
  const at = blocks.findIndex((b) => b.id === blockId);
  let from = at - 1;
  while (from >= 0 && blocks[from]!.type !== 'continue') from--;
  const unanswered = blocks.slice(from + 1, Math.max(at, 0)).some((b) => b.type === 'check' && b.required && b.state === null);
  if (unanswered) throw new ApiError(422, GATE_REQUIRED_MESSAGE, { required: GATE_REQUIRED_MESSAGE }, 'validation_failed');
  patchBlock(qc, lessonId, blockId, (b) => (b.type === 'continue' ? { ...b, passed: true } : b), preview);
  return { passed: true };
}

/**
 * Pass a continue gate, then reload the lesson: the API only sends the next section once the gate is passed. Settles
 * after the refetch, so the button stays busy until the new blocks are there. `422 { code: required }` when a required
 * check above is unanswered (`422 validation_failed`, `errors.required`). The staff preview opens gates in the
 * browser only (`passPreviewGate`).
 */
export function useContinueBlock(lessonId: string, blockId: string) {
  const qc = useQueryClient();
  const preview = usePreview();
  return useMutation({
    mutationFn: () =>
      preview
        ? Promise.resolve().then(() => passPreviewGate(qc, preview, lessonId, blockId))
        : api.post<{ passed: boolean }>(blockPath(lessonId, blockId, 'continue')),
    meta: { errorToast: false },
    onSuccess: () => (preview ? undefined : qc.invalidateQueries({ queryKey: learningKeys.lesson(lessonId) })),
  });
}

export function useSubmitReview(courseSlug: string) {
  return useMutation({
    mutationFn: (input: { rating: number; body: string }) => api.post<Review>(`/courses/${encodeURIComponent(courseSlug)}/reviews`, input),
  });
}

/* ---------------------------------------------------------------- assignments & peer review */

/** Multipart `text` + `files[]`. Submitting completes the lesson unless the assignment gates the next module. */
export function useSubmitAssignment(courseSlug: string, lessonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ text, files }: { text: string; files: File[] }) => {
      const form = new FormData();
      if (text.trim()) form.append('text', text.trim());
      for (const f of files) form.append('files[]', f);
      return api.form<AssignmentSubmission>(`/me/lessons/${encodeURIComponent(lessonId)}/submission`, form);
    },
    onSuccess: () => {
      // can_submit, peer-review allocation and completion are decided by the API: reload the lesson.
      void qc.invalidateQueries({ queryKey: learningKeys.lesson(lessonId) });
      afterProgress(qc, courseSlug);
    },
  });
}

export function usePeerReviews(assignmentId: string, enabled: boolean) {
  return useQuery({
    queryKey: learningKeys.peerReviews(assignmentId),
    queryFn: () => api.get<PeerReviewList>(`/me/assignments/${encodeURIComponent(assignmentId)}/peer-reviews`),
    enabled,
  });
}

export function usePeerReview(assignmentId: string, reviewId: string | null) {
  return useQuery({
    queryKey: learningKeys.peerReview(assignmentId, reviewId ?? ''),
    queryFn: () => api.get<PeerReview>(`/me/assignments/${encodeURIComponent(assignmentId)}/peer-reviews/${encodeURIComponent(reviewId!)}`),
    enabled: !!reviewId,
  });
}

export function useSubmitPeerReview(assignmentId: string, reviewId: string, lessonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PeerReviewInput) =>
      api.put<PeerReview>(`/me/assignments/${encodeURIComponent(assignmentId)}/peer-reviews/${encodeURIComponent(reviewId)}`, input),
    onSuccess: (review) => {
      qc.setQueryData(learningKeys.peerReview(assignmentId, reviewId), review);
      void qc.invalidateQueries({ queryKey: learningKeys.peerReviews(assignmentId), exact: true });
      // The lesson's peer_review progress (completed count, next due) changed.
      void qc.invalidateQueries({ queryKey: learningKeys.lesson(lessonId) });
    },
  });
}

/* ---------------------------------------------------------------- AI tutor */

/** `{ enabled: false }` hides the tutor; guests and other errors just hide it too. */
export function useTutor(courseSlug: string) {
  return useQuery({
    queryKey: learningKeys.tutor(courseSlug),
    queryFn: () => api.get<TutorState>(`/me/courses/${encodeURIComponent(courseSlug)}/tutor`),
    retry: false,
  });
}

function patchThread(qc: QueryClient, courseSlug: string, thread: TutorThread) {
  qc.setQueryData<TutorState>(learningKeys.tutor(courseSlug), (s) =>
    s ? { ...s, threads: [thread, ...s.threads.filter((x) => x.id !== thread.id)] } : s,
  );
}

export function useAskTutor(courseSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TutorAskInput) => api.post<TutorReply>(`/me/courses/${encodeURIComponent(courseSlug)}/tutor/messages`, input),
    onSuccess: (r) => patchThread(qc, courseSlug, r.thread),
  });
}

export function useTutorThreadAction(courseSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, action, text }: { threadId: string; action: 'resolve' | 'escalate'; text?: string }) =>
      api.post<TutorThread>(
        `/me/courses/${encodeURIComponent(courseSlug)}/tutor/threads/${encodeURIComponent(threadId)}/${action}`,
        action === 'escalate' && text ? { text } : {},
      ),
    onSuccess: (thread) => patchThread(qc, courseSlug, thread),
  });
}
