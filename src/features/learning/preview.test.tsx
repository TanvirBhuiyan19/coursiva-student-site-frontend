// @vitest-environment jsdom
// The staff preview (course builder O7, docs/api/learning.md → Staff preview): the real player for a virtual learner,
// against the mock API. The browser may only call `/api/v1/preview/{token}/…` — without cookies — and nothing is ever
// reported: no playback, time or progress, no `/me/*` call.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { app } from '../../../mock-api/app';
import { reset } from '../../../mock-api/lib/db';
import messages from '../../../messages/en.json';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { camelize } from '@/lib/api/case';
import { PreviewAssessmentNotice, PreviewBar, PreviewLockBanner, PreviewPlayer } from './components/PreviewPlayer';
import { useLessonTime } from './heartbeat';
import { usePlaybackReport } from './playback';
import { PreviewProvider } from './previewContext';
import type { PreviewLesson, PreviewSession } from './types';

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

const TOKEN = 'pv_launchlab_working_day0_demo_000000000000';
const calls: { method: string; url: string; credentials: RequestCredentials | undefined }[] = [];

/** What the server render hands the player (lib: features/learning/server.ts), read from the mock. */
async function read<T>(path: string): Promise<T> {
  const res = await app.request(`/api/v1/preview/${TOKEN}${path}`, { headers: { 'X-Tenant': 'amplify' } });
  return camelize<{ data: T }>(await res.json()).data;
}

// "Opens in N days" counts the viewer's calendar days (availability.daysUntil, correct in production), while the mock
// opens drip lessons at UTC midnight and words its own lock text in UTC days. Viewed from Europe/London between 00:00 and
// 01:00 (BST) the UTC unlock falls on the viewer's previous date, so the two disagree by a day: pin the viewer to UTC.
let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'UTC';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

beforeEach(() => {
  reset();
  calls.length = 0;
  window.history.replaceState(null, '', `/preview/${TOKEN}`);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      calls.push({ method: init.method ?? 'GET', url, credentials: init.credentials });
      const headers = new Headers(init.headers);
      headers.set('X-Tenant', 'amplify');
      return app.request(url, { method: init.method ?? 'GET', headers, body: typeof init.body === 'string' ? init.body : null });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

async function renderPreview(lessonId: string) {
  const [session, lesson] = await Promise.all([read<PreviewSession>(''), read<PreviewLesson>(`/lessons/${lessonId}`)]);
  render(wrap(<PreviewPlayer token={TOKEN} session={session} lesson={lesson} />));
  return { session, lesson };
}

describe('preview chrome', () => {
  it('shows the top bar: day, working copy or published, the expiry and the note for the hidden account UI', () => {
    const { rerender } = render(
      wrap(<PreviewBar simulation={{ now: '2026-10-21T10:00:00Z', day: 3, content: 'working' }} expiresAt="2026-10-21T10:30:00Z" />),
    );
    const bar = screen.getByRole('region', { name: 'Preview' });
    expect(bar).toHaveTextContent('Preview · Day 3 · Working copy');
    expect(within(bar).getByText(/^Expires at /)).toHaveAttribute('datetime', '2026-10-21T10:30:00Z');
    expect(bar).toHaveTextContent('Sign-in, enrolment and checkout are hidden, and nothing you do here is saved.');
    rerender(
      wrap(<PreviewBar simulation={{ now: '2026-10-21T10:00:00Z', day: 0, content: 'published' }} expiresAt="2026-10-21T10:30:00Z" />),
    );
    expect(screen.getByRole('region', { name: 'Preview' })).toHaveTextContent('Preview · Day 0 · Published');
  });

  it('explains locks and assessments', () => {
    render(
      wrap(
        <>
          <PreviewLockBanner text="Opens in 14 days" />
          <PreviewAssessmentNotice />
        </>,
      ),
    );
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('Learners can’t open this yet — Opens in 14 days');
    expect(screen.getAllByRole('note')[1]).toHaveTextContent('Quizzes and assignments can’t be taken in preview.');
  });
});

describe('the preview player', () => {
  it('keeps the outline inside the preview, with drafts badged and locks as of the simulated day', async () => {
    await renderPreview('les_l_0_0');
    const outline = screen.getByRole('navigation', { name: 'Lessons' });
    const links = within(outline).getAllByRole('link');
    expect(links.length).toBeGreaterThan(10);
    for (const a of links) expect(a.getAttribute('href')).toMatch(new RegExp(`^/preview/${TOKEN}\\?lesson=les_`));
    // No way out to the course page or the account.
    expect(screen.queryByRole('link', { name: /course page/i })).toBeNull();
    const draft = within(outline).getByRole('link', { name: /Launch retrospective/ });
    expect(draft).toHaveTextContent('Draft');
    expect(within(outline).getByRole('link', { name: /Post-launch review/ })).toHaveTextContent('Opens in 14 days');
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome to the lab' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next →' })).toHaveAttribute('href', `/preview/${TOKEN}?lesson=les_l_0_1`);
  });

  it('opens a locked lesson under a banner', async () => {
    await renderPreview('les_l_2_5');
    expect(screen.getByRole('note')).toHaveTextContent('Learners can’t open this yet — Opens in 14 days');
    expect(screen.getByRole('heading', { level: 1, name: 'Post-launch review' })).toBeInTheDocument();
  });

  it('shows a quiz’s intro with the notice instead of its questions', async () => {
    await renderPreview('les_l_0_2');
    expect(screen.getByText('Quizzes and assignments can’t be taken in preview.')).toBeInTheDocument();
    expect(screen.getByText(/You need \d+% to pass/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit answers' })).toBeNull();
    expect(screen.queryAllByRole('radio')).toEqual([]);
  });

  it('grades through the preview API, opens continue gates in the browser and never calls a learner endpoint', async () => {
    const user = userEvent.setup();
    await renderPreview('les_l_draft_0');
    expect(screen.getByText(/learners won’t see this lesson/)).toBeInTheDocument();
    // Behind the gate until Continue (the preview API sent it, the browser holds it back).
    expect(screen.queryByRole('form', { name: /Which belong on a landing page/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Answer the questions above first.')).toBeInTheDocument();

    const form = screen.getByRole('form', { name: 'Which stage turns visitors into leads?' });
    await user.click(within(form).getByRole('radio', { name: 'Convert' }));
    await user.click(within(form).getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(within(form).getByRole('status')).toHaveTextContent('Correct!'));

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('form', { name: /Which belong on a landing page/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();

    // One request: the stateless check. No continue request, no cookies, no /me/*, no CSRF handshake.
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `/api/v1/preview/${TOKEN}/lessons/les_l_draft_0/blocks/blk_demo000000000018/check`,
        credentials: 'omit',
      },
    ]);
    expect(document.cookie).toBe('');
  });

  it('refuses learner requests on a preview page before they leave the browser', async () => {
    await expect(api.get('/me/enrollments')).rejects.toBeInstanceOf(ApiError);
    await expect(api.post('/me/lessons/les_l_0_0/complete')).rejects.toMatchObject({ status: 403 });
    expect(calls).toEqual([]);
  });
});

describe('no reports in preview', () => {
  const preview = ({ children }: { children: ReactNode }) => <PreviewProvider token={TOKEN}>{children}</PreviewProvider>;

  /** A <video> that "plays" 0–5 s, pauses, and is left. */
  function play(video: HTMLVideoElement) {
    let t = 0;
    Object.defineProperty(video, 'currentTime', { get: () => t, configurable: true });
    act(() => {
      video.dispatchEvent(new Event('playing'));
      t = 5;
      video.dispatchEvent(new Event('timeupdate'));
      video.dispatchEvent(new Event('pause'));
      window.dispatchEvent(new Event('pagehide'));
    });
  }

  it('sends no playback report (while the learner player does)', async () => {
    const video = document.createElement('video');
    const inPreview = renderHook(() => usePlaybackReport(video, 'les_l_0_0'), { wrapper: preview });
    play(video);
    inPreview.unmount();
    expect(calls).toEqual([]);

    // Control: the same playback in the learner's player is reported.
    window.history.replaceState(null, '', '/learn/launch-lab/les_l_0_0');
    const learner = renderHook(() => usePlaybackReport(video, 'les_l_0_0'));
    play(video);
    learner.unmount();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/me/lessons/les_l_0_0/playback')).toBe(true));
  });

  it('sends no time heartbeat', () => {
    vi.useFakeTimers();
    const onBeat = vi.fn();
    const { unmount } = renderHook(() => useLessonTime('les_l_2_1', onBeat), { wrapper: preview });
    act(() => {
      vi.advanceTimersByTime(120_000);
      window.dispatchEvent(new Event('pagehide'));
    });
    unmount();
    expect(calls).toEqual([]);
    expect(onBeat).not.toHaveBeenCalled();
  });
});
