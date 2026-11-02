// @vitest-environment jsdom
// The `video` completion rule after a playback report: the answer's `completion` (200) is applied to the cached lesson;
// an older API's 204 falls back to re-reading the lesson's completion.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { learningKeys, usePlaybackCompletion } from './api';
import type { Lesson, PlayerCourse } from './types';

const get = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { get: (...args: unknown[]) => get(...args) } }));
vi.mock('@/features/auth/api', () => ({ useSession: () => ({ user: null, isSignedIn: true }) }));

const lesson = {
  id: 'l1',
  courseSlug: 'lab',
  completed: false,
  completion: { rule: 'video', value: 80, progress: 10, done: false },
} as Lesson;
const course = { slug: 'lab', modules: [{ id: 'm1', title: 'M', lessons: [{ id: 'l1', completed: false }] }] } as PlayerCourse;

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(learningKeys.lesson('l1'), lesson);
  qc.setQueryData(learningKeys.course('lab'), course);
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => usePlaybackCompletion('l1', 'lab'), { wrapper });
  return { qc, invalidate, onReported: result.current };
}

beforeEach(() => get.mockReset());

describe('playback completion', () => {
  it('applies the completion from the playback answer without re-reading the lesson', () => {
    const { qc, onReported } = setup();
    onReported({ completion: { rule: 'video', value: 80, progress: 55, done: false } });
    expect(qc.getQueryData<Lesson>(learningKeys.lesson('l1'))!.completion).toMatchObject({ progress: 55, done: false });
    expect(get).not.toHaveBeenCalled();
  });

  it('marks the lesson done and refreshes progress when the report completed it', () => {
    const { qc, invalidate, onReported } = setup();
    onReported({ completion: { rule: 'video', value: 80, progress: 100, done: true } });
    expect(qc.getQueryData<Lesson>(learningKeys.lesson('l1'))!.completed).toBe(true);
    expect(qc.getQueryData<PlayerCourse>(learningKeys.course('lab'))!.modules[0]!.lessons[0]!.completed).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: learningKeys.course('lab') });
  });

  it('re-reads the completion after an older API’s 204', async () => {
    const { qc, onReported } = setup();
    get.mockResolvedValue({ ...lesson, video: { url: 'new-signed-url' }, completion: { ...lesson.completion, progress: 70 } });
    onReported(undefined);
    await waitFor(() => expect(qc.getQueryData<Lesson>(learningKeys.lesson('l1'))!.completion!.progress).toBe(70));
    expect(get).toHaveBeenCalledWith('/me/lessons/l1');
    // Only the completion is patched: the playing video's signed URL stays.
    expect(qc.getQueryData<Lesson>(learningKeys.lesson('l1'))!.video).toBeUndefined();
  });
});
