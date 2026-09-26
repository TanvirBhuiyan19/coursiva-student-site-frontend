'use client';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSession } from '@/features/auth/api';
import { api } from '@/lib/api/client';
import type { Review } from '@/features/catalog/types';
import type { Dashboard, Enrollment, Lesson, LessonQuestion, PlayerCourse, Progress, QuizAttemptInput, QuizResult } from './types';

export const learningKeys = {
  enrollments: ['learning', 'enrollments'] as const,
  dashboard: ['learning', 'dashboard'] as const,
  course: (slug: string) => ['learning', 'course', slug] as const,
  lesson: (id: string) => ['learning', 'lesson', id] as const,
  certificates: ['account', 'certificates'] as const,
};

/** Enrolments for the signed-in learner; `[]` for guests without a request. */
export function useEnrollments() {
  const { isSignedIn } = useSession();
  const q = useQuery({ queryKey: learningKeys.enrollments, queryFn: () => api.get<Enrollment[]>('/me/enrollments'), enabled: isSignedIn });
  return { ...q, data: isSignedIn ? q.data : [] };
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
function afterProgress(qc: QueryClient, courseSlug: string) {
  void qc.invalidateQueries({ queryKey: learningKeys.course(courseSlug) });
  void qc.invalidateQueries({ queryKey: learningKeys.enrollments });
  void qc.invalidateQueries({ queryKey: learningKeys.dashboard });
  void qc.invalidateQueries({ queryKey: learningKeys.certificates });
}

function patchLessonDone(qc: QueryClient, lessonId: string, courseSlug: string, completed: boolean) {
  qc.setQueryData<Lesson>(learningKeys.lesson(lessonId), (l) => (l ? { ...l, completed } : l));
  qc.setQueryData<PlayerCourse>(learningKeys.course(courseSlug), (c) =>
    c
      ? { ...c, modules: c.modules.map((m) => ({ ...m, lessons: m.lessons.map((x) => (x.id === lessonId ? { ...x, completed } : x)) })) }
      : c,
  );
}

/** Mark complete / incomplete — optimistic, rolled back on error. */
export function useToggleComplete(courseSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lessonId, completed }: { lessonId: string; completed: boolean }) =>
      completed
        ? api.post<{ completed: boolean; progress: Progress }>(`/me/lessons/${lessonId}/complete`)
        : api.delete<{ completed: boolean; progress: Progress }>(`/me/lessons/${lessonId}/complete`),
    onMutate: ({ lessonId, completed }) => patchLessonDone(qc, lessonId, courseSlug, completed),
    onError: (_e, { lessonId, completed }) => patchLessonDone(qc, lessonId, courseSlug, !completed),
    onSettled: () => afterProgress(qc, courseSlug),
  });
}

export function useSubmitQuiz(courseSlug: string, lessonId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuizAttemptInput) => api.post<QuizResult>(`/me/lessons/${lessonId}/quiz-attempts`, input),
    onSuccess: (result) => {
      if (result.passed) patchLessonDone(qc, lessonId, courseSlug, true);
      afterProgress(qc, courseSlug);
    },
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
    onSuccess: (q) => qc.setQueryData<Lesson>(learningKeys.lesson(lessonId), (l) => (l ? { ...l, questions: [q, ...l.questions] } : l)),
  });
}

export function useSubmitReview(courseSlug: string) {
  return useMutation({
    mutationFn: (input: { rating: number; body: string }) => api.post<Review>(`/courses/${encodeURIComponent(courseSlug)}/reviews`, input),
  });
}
