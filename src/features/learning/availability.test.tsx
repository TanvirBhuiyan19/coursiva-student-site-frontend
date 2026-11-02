// @vitest-environment jsdom
// Course builder v2 O4 in the player (docs/api/learning.md → availability, completion rules, live lessons): lock copy
// in the outline and the locked screen, the completion status per rule, the 422 message on Complete, the time
// heartbeat and the Live lesson card.
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { ApiError } from '@/lib/api/errors';
import { formatSchoolDateTime } from '@/lib/format';
import { SchoolTimeZone } from '@/lib/schoolTimeZone';
import { normalizeSite } from '@/features/tenant/normalize';
import { afterBeat, countdown, daysUntil, lockFromError, lockMessage, minutesSpent } from './availability';
import { Player } from './components/Player';
import { useLessonTime, VisibleClock } from './heartbeat';
import type { Lesson, PlayerCourse, PlayerLesson } from './types';

const state: {
  lesson: Lesson | null;
  error: unknown;
  course: PlayerCourse | null;
  toggle: ReturnType<typeof vi.fn>;
  applyBeat: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
} = { lesson: null, error: null, course: null, toggle: vi.fn(), applyBeat: vi.fn(), refresh: vi.fn() };

vi.mock('./api', () => ({
  learningKeys: { lesson: (id: string) => ['learning', 'lesson', id] },
  useApplyTimeBeat: () => state.applyBeat,
  usePlaybackCompletion: () => state.refresh,
  useAskQuestion: () => ({ mutate: vi.fn(), isPending: false }),
  useCheckBlock: () => ({ mutate: vi.fn(), isPending: false }),
  useContinueBlock: () => ({ mutate: vi.fn(), isPending: false }),
  useSortBlock: () => ({ mutate: vi.fn(), isPending: false }),
  useLesson: () =>
    state.error
      ? { data: undefined, isPending: false, isError: true, error: state.error, refetch: vi.fn() }
      : { data: state.lesson, isPending: false, isError: false },
  usePlayerCourse: () => ({ data: state.course }),
  useSaveNote: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitQuiz: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleComplete: () => ({ mutate: state.toggle, isPending: false }),
  useTutor: () => ({}),
}));
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { post: (...args: unknown[]) => post(...args) } }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  useLocalizedRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const NOW = new Date('2026-10-20T12:00:00Z').getTime();
const DAY = 86_400_000;

const entry = (id: string, title: string, over: Partial<PlayerLesson> = {}): PlayerLesson => ({
  id,
  title,
  type: 'text',
  durationSeconds: null,
  questionCount: null,
  moduleTitle: 'Go live',
  completed: false,
  locked: false,
  ...over,
});

const course = (lessons: PlayerLesson[]): PlayerCourse => ({
  courseId: 'c1',
  slug: 'lab',
  title: 'Launch Lab',
  progress: { completed: 0, total: lessons.length, percent: 0 },
  modules: [{ id: 'm1', title: 'Go live', lessons }],
  communitySpace: null,
});

const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: 'l1',
  title: 'Checklist',
  type: 'text',
  durationSeconds: null,
  questionCount: null,
  moduleTitle: 'Go live',
  courseSlug: 'lab',
  description: 'Work through it.',
  bodyHtml: null,
  blocks: null,
  link: null,
  completed: false,
  video: null,
  pdf: null,
  quiz: null,
  scorm: null,
  assignment: null,
  resources: [],
  note: '',
  questions: [],
  nextLessonId: null,
  ...over,
});

function renderPlayer(
  l: Lesson | null,
  lessons: PlayerLesson[] = [entry('l1', 'Checklist')],
  error: unknown = null,
  timeZone: string | null = null,
) {
  state.lesson = l;
  state.error = error;
  state.course = course(lessons);
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SchoolTimeZone value={timeZone}>
        <Player courseSlug="lab" lessonId="l1" />
      </SchoolTimeZone>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.toggle = vi.fn();
  state.applyBeat = vi.fn();
  state.refresh = vi.fn();
  post.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('availability helpers', () => {
  it('picks the sentence for each lock reason', () => {
    const lock = (reason: string, over = {}) => ({ reason, unlocksAt: null, after: null, ...over });
    expect(lockMessage(lock('date', { unlocksAt: '2026-11-01T09:00:00Z' }), NOW)).toEqual({
      key: 'date',
      unlocksAt: '2026-11-01T09:00:00Z',
    });
    expect(lockMessage(lock('drip', { unlocksAt: new Date(NOW + 3 * DAY).toISOString() }), NOW)).toEqual({ key: 'dripIn', days: 3 });
    expect(lockMessage(lock('drip'), NOW)).toEqual({ key: 'drip' });
    expect(lockMessage(lock('after_item', { after: { id: 'l0', title: 'Intro' } }), NOW)).toEqual({ key: 'afterItem', title: 'Intro' });
    expect(lockMessage(lock('after_item'), NOW)).toEqual({ key: 'prerequisite' });
    for (const r of ['previous_module', 'previous_lesson', 'prerequisite', 'assignment_gate'])
      expect(lockMessage(lock(r), NOW)).toEqual({ key: r });
    expect(lockMessage(lock('something_new'), NOW)).toEqual({ key: 'generic' });
    expect(lockMessage(lock('date'), NOW)).toEqual({ key: 'generic' });
  });

  it('counts calendar days, countdowns and time shares', () => {
    expect(daysUntil(new Date(NOW - DAY).toISOString(), NOW)).toBe(0);
    expect(daysUntil(new Date(NOW + 2 * DAY).toISOString(), NOW)).toBe(2);
    expect(countdown(new Date(NOW - 1000).toISOString(), NOW)).toBeNull();
    expect(countdown(new Date(NOW + 2 * DAY + 3 * 3_600_000).toISOString(), NOW)).toEqual({ key: 'days', days: 2, hours: 3 });
    expect(countdown(new Date(NOW + 90 * 60_000).toISOString(), NOW)).toEqual({ key: 'hours', hours: 1, minutes: 30 });
    expect(countdown(new Date(NOW + 5 * 60_000).toISOString(), NOW)).toEqual({ key: 'minutes', minutes: 5 });
    const c = { rule: 'time' as const, value: 10, progress: 45, done: false };
    expect(minutesSpent(c)).toBe(4);
    expect(afterBeat(c, 300, false)).toEqual({ ...c, progress: 50 });
    expect(afterBeat(c, 600, true)).toEqual({ ...c, progress: 100, done: true });
  });

  it('reads the lock from a 403 lesson_locked answer only', () => {
    const err = new ApiError(403, 'Locked', {}, 'lesson_locked', 'after_item', null, {
      after: { id: 'l0', title: 'Intro' },
      unlocksAt: null,
    });
    expect(lockFromError(err)).toEqual({ reason: 'after_item', unlocksAt: null, after: { id: 'l0', title: 'Intro' } });
    expect(lockFromError(new ApiError(403, 'Enrol first'))).toBeNull();
    expect(lockFromError(new Error('x'))).toBeNull();
  });
});

describe('locks in the player', () => {
  it('explains each locked lesson in the outline', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    renderPlayer(lesson(), [
      entry('l1', 'Checklist'),
      entry('l2', 'Review', { locked: true, lockReason: 'drip', unlocksAt: new Date(NOW + 4 * DAY).toISOString() }),
      entry('l3', 'Plan', { locked: true, lockReason: 'date', unlocksAt: '2026-11-10T09:00:00Z' }),
      entry('l4', 'Celebrate', { locked: true, lockReason: 'after_item', after: { id: 'l1', title: 'Checklist' } }),
      entry('l5', 'Module 2', { locked: true, lockReason: 'previous_module' }),
      entry('l6', 'Old API', { locked: true }),
    ]);
    const nav = within(screen.getByRole('navigation', { name: 'Lessons' }));
    expect(nav.getByText('Opens in 4 days')).toBeTruthy();
    expect(nav.getByText(/^Opens on Nov 10, 2026/)).toBeTruthy();
    expect(nav.getByText('Complete “Checklist” first')).toBeTruthy();
    expect(nav.getByText('Finish the previous module to unlock this lesson.')).toBeTruthy();
    expect(nav.getByText('This lesson isn’t available yet.')).toBeTruthy();
  });

  it('formats unlock dates and live times in the school’s time zone', () => {
    expect(formatSchoolDateTime('2026-11-10T09:00:00Z', 'en-US', 'America/Los_Angeles')).toBe('Nov 10, 2026, 1:00 AM PST');
    expect(normalizeSite({ timeZone: 'Europe/London' }).timeZone).toBe('Europe/London');
    expect(normalizeSite({ timeZone: 'Not/AZone' }).timeZone).toBeNull();
    expect(normalizeSite({}).timeZone).toBeNull();
    renderPlayer(
      lesson(),
      [entry('l1', 'Checklist'), entry('l2', 'Plan', { locked: true, lockReason: 'date', unlocksAt: '2026-11-10T09:00:00Z' })],
      null,
      'America/Los_Angeles',
    );
    expect(screen.getByText('Opens on Nov 10, 2026, 1:00 AM PST')).toBeTruthy();
  });

  it('shows the locked screen with the reason and a link to the lesson to finish first', () => {
    const err = new ApiError(403, 'Complete the earlier lesson first.', {}, 'lesson_locked', 'after_item', null, {
      after: { id: 'l0', title: 'Intro' },
      unlocksAt: null,
    });
    renderPlayer(null, [entry('l0', 'Intro'), entry('l1', 'Checklist', { locked: true })], err);
    const main = screen.getByRole('region', { name: 'This lesson is locked' });
    expect(within(main).getByText('Complete “Intro” first')).toBeTruthy();
    expect(within(main).getByRole('link', { name: 'Go to “Intro”' }).getAttribute('href')).toContain('l0');
  });

  it('shows other lesson errors with a retry', () => {
    renderPlayer(null, undefined, new ApiError(500, 'Server error'));
    expect(screen.getByRole('alert').textContent).toContain('We couldn’t load this lesson.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('completion rules in the player', () => {
  it('keeps the Complete button for the manual rule and shows the 422 message', () => {
    state.toggle = vi.fn((_vars, opts: { onError: (e: unknown) => void }) =>
      opts.onError(new ApiError(422, 'This lesson completes on its own when you’ve spent enough time on it.')),
    );
    renderPlayer(lesson({ completion: { rule: 'manual', value: null, progress: null, done: false } }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    expect(screen.getByRole('alert').textContent).toBe('This lesson completes on its own when you’ve spent enough time on it.');
  });

  it.each([
    [{ rule: 'video', value: 80, progress: 45 }, 'Watch 80% of the video to complete — 45% so far', true],
    [{ rule: 'time', value: 10, progress: 40 }, 'Spend 10 minutes on this lesson — 4 min so far', true],
    [{ rule: 'quiz', value: null, progress: null }, 'Pass the quiz', false],
    [{ rule: 'assignment', value: null, progress: null }, 'Your assignment completes when it’s graded', false],
    [{ rule: 'live', value: null, progress: null }, 'Attend the live session', false],
    [{ rule: 'scorm', value: null, progress: null }, 'Finish the SCORM activity', false],
  ] as const)('shows how a %o lesson completes', (c, text, bar) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    renderPlayer(lesson({ completion: { ...c, done: false } }));
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    expect(screen.getByText(text)).toBeTruthy();
    expect(!!screen.queryByRole('progressbar', { name: 'Lesson completion' })).toBe(bar);
  });

  it('counts answered knowledge checks', () => {
    const check = (id: string, answered: boolean) => ({
      id,
      type: 'check' as const,
      kind: 'single' as const,
      questionHtml: '<p>Q</p>',
      options: [{ id: 'a', text: 'A' }],
      required: false,
      state: answered ? { correct: true, correctOptionIds: ['a'], feedback: null, answer: { optionIds: ['a'] } } : null,
    });
    const blocks = [check('b1', true), check('b2', true), check('b3', false)];
    renderPlayer(lesson({ blocks, completion: { rule: 'checks', value: null, progress: 66, done: false } }));
    expect(screen.getByText('Answer every knowledge check — 2 of 3')).toBeTruthy();
  });

  it('shows the done state without an un-complete button for automatic rules', () => {
    renderPlayer(lesson({ completed: true, completion: { rule: 'video', value: 80, progress: 100, done: true } }));
    expect(screen.getByText('✓ Completed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Completed/ })).toBeNull();
  });
});

describe('time heartbeat', () => {
  it('drains visible seconds only, capped at 60 per beat', () => {
    let now = 0;
    const clock = new VisibleClock(() => now);
    clock.set(true);
    now = 15_400;
    expect(clock.take()).toBe(15);
    clock.set(false);
    now = 100_000;
    expect(clock.take()).toBe(0);
    clock.set(true);
    now = 300_000;
    expect(clock.take()).toBe(60);
  });

  it('beats every 15 s while visible and focused, then once more on unmount', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    post.mockResolvedValue({ timeSpentSec: 15, completed: false });
    const onBeat = vi.fn();
    const { unmount } = renderHook(() => useLessonTime('l1', onBeat));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(post).toHaveBeenCalledWith('/me/lessons/l1/time', { seconds: 15 }, { keepalive: false });
    expect(onBeat).toHaveBeenCalledWith({ timeSpentSec: 15, completed: false });
    // Hidden time isn't counted.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(post).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    unmount();
    expect(post).toHaveBeenLastCalledWith('/me/lessons/l1/time', { seconds: 5 }, { keepalive: true });
  });

  it('sends nothing without a lesson, and stops after a 422', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    renderHook(() => useLessonTime(null, vi.fn()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(post).not.toHaveBeenCalled();
    post.mockRejectedValue(new ApiError(422, 'Invalid'));
    renderHook(() => useLessonTime('l1', vi.fn()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('runs in the player only for an unfinished time-rule lesson', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    post.mockResolvedValue({ timeSpentSec: 15, completed: false });
    renderPlayer(lesson({ completion: { rule: 'time', value: 10, progress: 0, done: false } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(state.applyBeat).toHaveBeenCalledWith({ timeSpentSec: 15, completed: false });
    cleanup();
    post.mockClear();
    renderPlayer(lesson({ completion: { rule: 'time', value: 10, progress: 100, done: true } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('live lessons', () => {
  const live = (over = {}) =>
    lesson({
      type: 'live',
      completion: { rule: 'live', value: null, progress: null, done: false },
      live: {
        sessionId: 'lsn_1',
        title: 'Launch review',
        startsAt: new Date(NOW + 2 * DAY + 3 * 3_600_000).toISOString(),
        durationMin: 60,
        provider: 'zoom',
        status: 'scheduled',
        joinUrl: null,
        recording: null,
        ...over,
      },
    });

  it('shows the session with a countdown before the start', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    renderPlayer(live());
    const card = within(screen.getByRole('region', { name: 'Launch review' }));
    expect(card.getByText('Upcoming')).toBeTruthy();
    expect(card.getByText(/· 1 ?h/)).toBeTruthy();
    expect(card.getByText(/On Zoom/)).toBeTruthy();
    expect(card.getByText('Starts in 2 days, 3 h')).toBeTruthy();
    expect(card.queryByRole('link')).toBeNull();
  });

  it('offers Join in a new tab while joinable', () => {
    renderPlayer(live({ status: 'live', startsAt: new Date(Date.now() - 60_000).toISOString(), joinUrl: 'https://zoom.us/j/1' }));
    const join = screen.getByRole('link', { name: 'Join the live session ↗' });
    expect(join.getAttribute('href')).toBe('https://zoom.us/j/1');
    expect(join.getAttribute('target')).toBe('_blank');
    expect(join.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText('Live now')).toBeTruthy();
  });

  it('plays the recording once published', () => {
    const recording = {
      hlsUrl: null,
      posterUrl: null,
      captions: [],
      drm: null,
      url: null,
      embedUrl: 'https://www.youtube-nocookie.com/embed/x',
      watermark: null,
    };
    renderPlayer(live({ status: 'ended', startsAt: new Date(Date.now() - DAY).toISOString(), recording }));
    expect(screen.getByRole('heading', { name: 'Recording' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play Launch review' })).toBeTruthy();
  });
});
