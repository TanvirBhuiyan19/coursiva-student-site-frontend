// @vitest-environment jsdom
// "Preview this course" (docs/api/catalog.md → GET /courses/{slug}/preview): the modal fetches the free-preview video
// only when it opens, plays it in the lesson player (no playback reports for guests), and handles 404/errors; closing
// stops playback.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { VideoPlayer } from '@/features/learning/components/VideoPlayer';
import type { VideoBlock } from '@/features/learning/types';
import { PreviewButton } from './components/CourseDetailClient';
import type { CourseDetail } from './types';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocalizedRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/features/auth/api', () => ({ useSession: () => ({ user: null, isSignedIn: false }) }));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => vi.fn() }));

const course = {
  slug: 'launch-lab',
  title: 'Launch Lab',
  lessonCount: 12,
  price: { amount: 4900, currency: 'USD' },
  cover: { url: null, color: '#334', alt: '' },
  preview: { lessonId: 'les_l_0_0', title: 'Welcome to Launch Lab', type: 'video', posterUrl: 'https://cdn.test/poster-course.jpg' },
  // An older API (no `previews`): the free-preview rows of the curriculum are the previews.
  modules: [
    {
      id: 'mod_1',
      title: 'Module 1',
      lessons: [
        { id: 'les_l_0_0', title: 'Welcome to Launch Lab', type: 'video', durationSeconds: 312, questionCount: null, freePreview: true },
        { id: 'les_l_0_1', title: 'Paid lesson', type: 'video', durationSeconds: 60, questionCount: null, freePreview: false },
      ],
    },
  ],
} as CourseDetail;
const PREVIEW_URL = '/api/v1/courses/launch-lab/preview?lesson=les_l_0_0';

const SIGNED = 'https://media.test/source.mp4?token=signed-1';
const video = (over: Partial<VideoBlock> = {}): VideoBlock => ({
  hlsUrl: null,
  posterUrl: 'https://image.mux.test/poster.jpg?token=p',
  captions: [{ lang: 'en', label: 'English', url: 'https://media.test/en.vtt?token=c' }],
  drm: null,
  url: SIGNED,
  embedUrl: null,
  watermark: null,
  ...over,
});
const previewBody = (v: VideoBlock) => ({
  data: {
    lesson_id: 'les_l_0_0',
    title: 'Welcome to Launch Lab',
    type: 'video',
    duration_seconds: 312,
    poster_url: v.posterUrl,
    video: {
      hls_url: v.hlsUrl,
      poster_url: v.posterUrl,
      captions: v.captions,
      drm: v.drm,
      url: v.url,
      embed_url: v.embedUrl,
      watermark: v.watermark,
    },
    course: { slug: 'launch-lab', title: 'Launch Lab' },
  },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

/** The browser's fetch: answers the preview from `answers` (in order, the last one repeating) and records every call. */
function stubFetch(...answers: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; method: string }[] = [];
  let n = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url === PREVIEW_URL) {
      const answer = answers[Math.min(n++, answers.length - 1)]!;
      return Promise.resolve(answer());
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderPreview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <PreviewButton course={course} variant="chip" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const dialog = () => document.querySelector('dialog')!;
const videoEl = () => document.querySelector<HTMLVideoElement>('dialog video');

/** Plays 0 → 6 s and pauses: enough for the player to report, if it reports. */
function playSomething(el: HTMLVideoElement) {
  let t = 0;
  Object.defineProperty(el, 'currentTime', { configurable: true, get: () => t, set: (v: number) => (t = v) });
  Object.defineProperty(el, 'paused', { configurable: true, get: () => false });
  fireEvent(el, new Event('playing'));
  t = 6;
  fireEvent(el, new Event('timeupdate'));
  fireEvent(el, new Event('pause'));
}

let pause: ReturnType<typeof vi.fn<() => void>>;
let load: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  // jsdom has no modal dialogs or media playback.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  pause = vi.fn<() => void>();
  load = vi.fn<() => void>();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(load);
});

afterEach(() => {
  // Unmount while the media stubs are still in place (the player pauses and unloads on unmount).
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('course preview modal', () => {
  it('shows the free lesson’s content blocks under the video, headings below the dialog title', async () => {
    const body = previewBody(video());
    const calls = stubFetch(() =>
      json(200, {
        data: {
          ...body.data,
          blocks: [
            { id: 'blk_a', type: 'heading', text: 'What you’ll build', level: 2 },
            { id: 'blk_b', type: 'text', html: '<p>A <strong>funnel</strong></p>' },
          ],
        },
      }),
    );
    renderPreview();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const region = await screen.findByRole('region', { name: 'Lesson content' });
    expect(within(region).getByRole('heading', { level: 3, name: 'What you’ll build' })).toBeTruthy();
    expect(region.querySelector('strong')?.textContent).toBe('funnel');
    // One request: the blocks share the player's query.
    expect(calls.filter((c) => c.url.startsWith('/api/v1/courses/launch-lab/preview'))).toHaveLength(1);
  });

  it('lets guests try interactive blocks without checking them, and stops at the first continue gate', async () => {
    const body = previewBody(video());
    const calls = stubFetch(() =>
      json(200, {
        data: {
          ...body.data,
          blocks: [
            {
              id: 'blk_c',
              type: 'check',
              kind: 'single',
              question_html: '<p>Pick one</p>',
              options: [
                { id: 'a', text: 'Yes' },
                { id: 'b', text: 'No' },
              ],
              required: true,
              state: null,
            },
            { id: 'blk_g', type: 'continue', label: 'Continue', passed: false },
          ],
          blocks_locked: 5,
        },
      }),
    );
    renderPreview();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const region = await screen.findByRole('region', { name: 'Lesson content' });
    await userEvent.click(within(region).getByRole('radio', { name: 'Yes' }));
    expect(within(region).getByText('Sign in and enrol to check your answer.')).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Check' })).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(within(region).getByText('Enrol to see the rest of this lesson.')).toBeTruthy();
    expect(within(region).getByText('5 more blocks after you continue')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('fetches the preview only on open, then plays the signed source with poster and captions', async () => {
    let answer: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const calls = stubFetch(() => answered.then(() => json(200, previewBody(video()))));
    renderPreview();
    expect(calls).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(dialog().open).toBe(true);
    // Loading: the course's poster behind a spinner.
    const loading = await screen.findByRole('status');
    expect(loading).toHaveTextContent('Loading the preview…');
    expect(loading.getAttribute('style')).toContain('poster-course.jpg');
    answer();

    await waitFor(() => expect(videoEl()).not.toBeNull());
    const el = videoEl()!;
    expect(el.getAttribute('src')).toBe(SIGNED);
    expect(el.getAttribute('poster')).toBe('https://image.mux.test/poster.jpg?token=p');
    expect(el.controls).toBe(true);
    const track = el.querySelector('track')!;
    expect(track).toHaveAttribute('kind', 'captions');
    expect(track).toHaveAttribute('src', 'https://media.test/en.vtt?token=c');
    expect(track).toHaveAttribute('srclang', 'en');
    expect(calls).toEqual([{ url: PREVIEW_URL, method: 'GET' }]);
  });

  it('plays a third-party embed in a titled iframe', async () => {
    stubFetch(() => json(200, previewBody(video({ url: null, embedUrl: 'https://player.vimeo.test/video/1?h=signed' }))));
    renderPreview();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const frame = await screen.findByTitle('Welcome to Launch Lab');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'https://player.vimeo.test/video/1?h=signed');
  });

  it('says so when the course has no preview (404), without a retry', async () => {
    stubFetch(() => json(404, { message: 'This course has no preview.' }));
    renderPreview();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This course has no preview.');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(videoEl()).toBeNull();
  });

  it('shows a friendly error with Retry, and plays once a retry succeeds', async () => {
    const calls = stubFetch(
      () => json(500, { message: 'Server error.' }),
      () => json(200, previewBody(video())),
    );
    renderPreview();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load the preview. Check your connection and try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(videoEl()?.getAttribute('src')).toBe(SIGNED));
    expect(calls.filter((c) => c.url.startsWith('/api/v1/courses/launch-lab/preview'))).toHaveLength(2);
  });

  it('stops and unloads the video on close, and fetches fresh signed URLs when reopened', async () => {
    const calls = stubFetch(() => json(200, previewBody(video())));
    renderPreview();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(videoEl()).not.toBeNull());
    const el = videoEl()!;

    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(dialog().open).toBe(false);
    expect(videoEl()).toBeNull();
    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(el.hasAttribute('src')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(videoEl()).not.toBeNull());
    expect(calls.filter((c) => c.url.startsWith('/api/v1/courses/launch-lab/preview'))).toHaveLength(2);
  });

  it('sends no playback reports for a guest preview', async () => {
    const calls = stubFetch(() => json(200, previewBody(video())));
    const view = renderPreview();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(videoEl()).not.toBeNull());
    playSomething(videoEl()!);
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    view.unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([{ url: PREVIEW_URL, method: 'GET' }]);
  });

  it('(control) the same playback is reported in the lesson player', async () => {
    const calls = stubFetch(() => json(200, {}));
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <VideoPlayer video={video()} title="Lesson" durationSeconds={312} completed={false} reportLessonId="les_1" />
      </NextIntlClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Play Lesson' }));
    playSomething(document.querySelector('video')!);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/me/lessons/les_1/playback')).toBe(true));
  });
});

/* ── Every free preview (Udemy pattern): a "Free previews" list, each format in its viewer ── */

const multi = {
  ...course,
  previews: [
    { lessonId: 'les_v', title: 'Welcome', type: 'video', durationSeconds: 312, posterUrl: null },
    { lessonId: 'les_t', title: 'Read me first', type: 'text', durationSeconds: null, posterUrl: null },
    { lessonId: 'les_p', title: 'Worksheet', type: 'pdf', durationSeconds: null, posterUrl: null },
    { lessonId: 'les_q', title: 'Check-in', type: 'quiz', durationSeconds: null, posterUrl: null },
  ],
  modules: [],
} as unknown as CourseDetail;

const base = (lessonId: string, title: string, type: string, format: string) => ({
  lesson_id: lessonId,
  title,
  type,
  format,
  duration_seconds: null,
  poster_url: null,
  video: null,
  blocks: null,
  blocks_locked: 0,
  body_html: null,
  pdf: null,
  file: null,
  link: null,
  resources: [],
  summary: null,
  course: { slug: 'launch-lab', title: 'Launch Lab' },
});

const ANSWERS: Record<string, unknown> = {
  les_v: { ...previewBody(video()).data, lesson_id: 'les_v', title: 'Welcome', format: 'video' },
  les_t: { ...base('les_t', 'Read me first', 'text', 'text'), body_html: '<p>The <strong>free</strong> chapter.</p>' },
  les_p: {
    ...base('les_p', 'Worksheet', 'pdf', 'pdf'),
    pdf: { url: 'https://media.test/worksheet.pdf?token=s', name: 'Worksheet.pdf', size_bytes: 2048, downloadable: false },
  },
  les_q: {
    ...base('les_q', 'Check-in', 'quiz', 'quiz'),
    summary: {
      kind: 'quiz',
      question_count: 5,
      pass_percent: 80,
      time_limit_minutes: 10,
      attempts_allowed: 3,
      points: null,
      starts_at: null,
      duration_minutes: null,
    },
  },
};

/** Answers `?lesson=` from ANSWERS; records every call. */
function stubLessons() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      const m = /^\/api\/v1\/courses\/launch-lab\/preview\?lesson=(\w+)$/.exec(url);
      const data = m ? ANSWERS[m[1]!] : undefined;
      return Promise.resolve(data ? json(200, { data }) : json(404, { message: 'This course has no preview.' }));
    }),
  );
  return calls;
}

function renderMulti(lessonId: string | null, variant: 'media' | 'chip' = 'chip') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <PreviewButton course={multi} variant={variant} lessonId={lessonId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe('every free preview', () => {
  it('opens on the row’s lesson and switches between free previews from the list', async () => {
    const calls = stubLessons();
    renderMulti('les_t');
    await userEvent.click(screen.getByRole('button', { name: /Preview/ }));
    const list = screen.getByRole('navigation', { name: 'Free previews' });
    const items = within(list).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Welcome'),
      expect.stringContaining('Read me first'),
      expect.stringContaining('Worksheet'),
      expect.stringContaining('Check-in'),
    ]);
    expect(items[1]).toHaveAttribute('aria-current', 'true');
    // A text preview: the lesson's own body.
    const region = await screen.findByRole('region', { name: 'Lesson content' });
    expect(region.querySelector('strong')?.textContent).toBe('free');
    expect(screen.getByRole('heading', { level: 3, name: 'Read me first' })).toBeTruthy();
    expect(calls).toEqual(['/api/v1/courses/launch-lab/preview?lesson=les_t']);

    // The PDF: an inline viewer, view only (no download link).
    await userEvent.click(within(list).getByRole('button', { name: /Worksheet/ }));
    expect(within(list).getByRole('button', { name: /Worksheet/ })).toHaveAttribute('aria-current', 'true');
    // An iframe (the CSP blocks <object>); view only: the viewer's toolbar is hidden.
    const frame = await screen.findByTitle('PDF: Worksheet.pdf');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'https://media.test/worksheet.pdf?token=s#toolbar=0');
    expect(screen.getByText(/View only — enrol to download/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Download/ })).toBeNull();

    // The video plays in the player.
    await userEvent.click(within(list).getByRole('button', { name: /Welcome/ }));
    await waitFor(() => expect(videoEl()?.getAttribute('src')).toBe(SIGNED));
    expect(calls.at(-1)).toBe('/api/v1/courses/launch-lab/preview?lesson=les_v');
  });

  it('shows a quiz’s summary and “Enrol to take this”, never its questions', async () => {
    stubLessons();
    renderMulti('les_q');
    await userEvent.click(screen.getByRole('button', { name: /Preview/ }));
    const inside = await screen.findByRole('region', { name: 'What’s inside' });
    expect(inside).toHaveTextContent('Quiz');
    expect(inside).toHaveTextContent('5 questions');
    expect(inside).toHaveTextContent('Pass mark 80%');
    expect(inside).toHaveTextContent('10 minutes time limit');
    expect(inside).toHaveTextContent('3 attempts');
    expect(inside).toHaveTextContent('Enrol to take this.');
    expect(within(inside).getByRole('link', { name: 'Enroll now' })).toBeTruthy();
    expect(document.querySelector('dialog input[type="radio"]')).toBeNull();
  });

  it('opens the cover on the first free preview and moves through the list with the arrow keys', async () => {
    const calls = stubLessons();
    renderMulti(null, 'media');
    await userEvent.click(screen.getByRole('button', { name: 'Preview this course' }));
    await waitFor(() => expect(videoEl()).not.toBeNull());
    expect(calls).toEqual(['/api/v1/courses/launch-lab/preview?lesson=les_v']);
    const list = screen.getByRole('navigation', { name: 'Free previews' });
    const [first, second, , last] = within(list).getAllByRole('button');
    first!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(second);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(last);
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('region', { name: 'What’s inside' })).toBeTruthy();
  });

  it('says so when a lesson isn’t a free preview (404), keeping the list', async () => {
    stubLessons();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={messages}>
          <PreviewButton
            course={{
              ...multi,
              previews: [...multi.previews!, { lessonId: 'les_gone', title: 'Gone', type: 'text', durationSeconds: null, posterUrl: null }],
            }}
            variant="chip"
            lessonId="les_gone"
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Preview/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This course has no preview.');
    expect(screen.getByRole('navigation', { name: 'Free previews' })).toBeTruthy();
  });
});
