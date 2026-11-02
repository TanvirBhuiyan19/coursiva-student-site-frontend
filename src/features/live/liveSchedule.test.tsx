// @vitest-environment jsdom
// The learner's live schedule (/live), the session page's countdown, join window and replay, and the calendar feed.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import type * as Errors from '@/lib/api/errors';
import { eventIcs } from '@/features/learning/calendar';
import { CalendarSubscribe } from './components/CalendarSubscribe';
import { LiveScheduleView } from './components/LiveSchedule';
import { LiveSessionView } from './components/LiveViews';
import { countdown, dayKey, livePhase, withinWeek } from './timing';
import type { LiveScheduleItem, LiveSession } from './types';

type ErrorsModule = typeof Errors;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => vi.fn() }));
vi.mock('@/features/auth/api', () => ({ useSession: () => ({ user: { timezone: 'UTC' } }) }));
vi.mock('@/features/learning/components/VideoPlayer', () => ({
  VideoPlayer: ({ title }: { title: string }) => <div role="img" aria-label={`Replay of ${title}`} />,
}));

const MIN = 60_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

function item(over: Partial<LiveScheduleItem> = {}): LiveScheduleItem {
  const startsAt = over.startsAt ?? iso(3 * 24 * 60 * MIN);
  const start = Date.parse(startsAt);
  return {
    id: 'lvs_1',
    title: 'Pricing workshop',
    startsAt,
    endsAt: new Date(start + 90 * MIN).toISOString(),
    durationMin: 90,
    joinOpensAt: new Date(start - 15 * MIN).toISOString(),
    status: 'scheduled',
    provider: 'zoom',
    attendees: 4,
    going: false,
    waitlisted: false,
    joinUrl: null,
    course: { slug: 'funnels-101', title: 'Funnels 101' },
    space: null,
    hasReplay: false,
    ...over,
  };
}

interface MockServer {
  pages: Record<string, unknown>;
  session: unknown;
  feed: { active: boolean; createdAt: string | null; lastUsedAt: string | null };
  rsvps: string[];
  posts: string[];
  deletes: string[];
}

const server = vi.hoisted<MockServer>(() => ({
  pages: {},
  session: null,
  feed: { active: false, createdAt: null as string | null, lastUsedAt: null as string | null },
  rsvps: [] as string[],
  posts: [] as string[],
  deletes: [] as string[],
}));

vi.mock('@/lib/api/client', async () => {
  const { ApiError: Err } = await vi.importActual<ErrorsModule>('@/lib/api/errors');
  return {
    api: {
      get: (path: string) => {
        if (path.startsWith('/me/live?')) {
          const scope = new URLSearchParams(path.split('?')[1]).get('scope')!;
          return Promise.resolve(structuredClone(server.pages[scope] ?? { sessions: [], nextCursor: null, timezone: null }));
        }
        if (path === '/me/live/calendar') return Promise.resolve({ ...server.feed });
        if (path === '/me/live/lvs_page') return Promise.resolve(structuredClone(server.session));
        return Promise.reject(new Err(404, 'Not found.'));
      },
      put: (path: string) => {
        server.rsvps.push(path);
        return Promise.resolve(item({ going: true }));
      },
      post: (path: string) => {
        server.posts.push(path);
        server.feed = { active: true, createdAt: '2026-11-02T10:00:00Z', lastUsedAt: null };
        return Promise.resolve({
          ...server.feed,
          url: `https://school.test/api/v1/live/calendar/lcal_${'a'.repeat(48)}.ics`,
          webcalUrl: `webcal://school.test/api/v1/live/calendar/lcal_${'a'.repeat(48)}.ics`,
          googleUrl: 'https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fschool.test',
          outlookUrl: 'https://outlook.live.com/calendar/0/addfromweb?url=https%3A%2F%2Fschool.test',
        });
      },
      delete: (path: string) => {
        server.deletes.push(path);
        server.feed = { active: false, createdAt: null, lastUsedAt: null };
        return Promise.resolve(undefined);
      },
    },
  };
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  server.pages = {};
  server.session = null;
  server.feed = { active: false, createdAt: null, lastUsedAt: null };
  server.rsvps = [];
  server.posts = [];
  server.deletes = [];
});

describe('live timing', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const at = (startMin: number, over: Partial<LiveScheduleItem> = {}) =>
    item({ startsAt: new Date(now + startMin * MIN).toISOString(), ...over });

  it('opens the way in 15 minutes before the start and keeps it until the end plus an hour', () => {
    expect(livePhase(at(3 * 24 * 60), now)).toBe('later');
    expect(livePhase(at(120), now)).toBe('soon');
    expect(livePhase(at(16), now)).toBe('soon');
    expect(livePhase(at(15), now)).toBe('open');
    expect(livePhase(at(-60), now)).toBe('open'); // in its slot, the host hasn't started yet
    expect(livePhase(at(-151), now)).toBe('missed'); // 90 min + the hour's grace are over
    expect(livePhase(at(-151, { status: 'live' }), now)).toBe('live');
    expect(livePhase(at(-151, { status: 'ended' }), now)).toBe('ended');
  });

  it('counts down and groups by day in a zone', () => {
    expect(countdown(now + (26 * 60 + 5) * MIN + 30_000, now)).toMatchObject({ d: 1, h: 2, m: 5, s: 30 });
    expect(countdown(now - 1, now).total).toBe(0);
    expect(dayKey('2026-11-02T23:30:00Z', 'UTC')).toBe('2026-11-02');
    expect(dayKey('2026-11-02T23:30:00Z', 'Asia/Dhaka')).toBe('2026-11-03');
    expect(withinWeek(new Date(now + 6 * 24 * 60 * MIN).toISOString(), now)).toBe(true);
    expect(withinWeek(new Date(now + 8 * 24 * 60 * MIN).toISOString(), now)).toBe(false);
  });

  it('writes the session’s real length into the .ics (not a fixed hour)', () => {
    const ics = eventIcs({ ...item({ startsAt: '2026-11-10T14:00:00.000Z' }), durationMin: 90 }, { name: 'School', email: '' });
    expect(ics).toContain('DTSTART:20261110T140000Z');
    expect(ics).toContain('DTEND:20261110T153000Z');
  });
});

describe('/live schedule', () => {
  it('groups sessions by day, offers RSVP and the way in, and filters to this week', async () => {
    const user = userEvent.setup();
    server.pages.upcoming = {
      sessions: [
        item({
          id: 'lvs_live',
          title: 'Office hours',
          status: 'live',
          startsAt: iso(-10 * MIN),
          going: true,
          joinUrl: 'https://zoom.us/j/1',
        }),
        item({ id: 'lvs_far', title: 'Ads build', startsAt: iso(10 * 24 * 60 * MIN) }),
      ],
      nextCursor: null,
      timezone: null,
    };
    wrap(<LiveScheduleView />);

    const live = await screen.findByRole('article', { name: 'Office hours' });
    expect(within(live).getByText('Live now')).toBeInTheDocument();
    expect(within(live).getByRole('link', { name: 'Join on Zoom' })).toHaveAttribute('href', 'https://zoom.us/j/1');
    const far = screen.getByRole('article', { name: 'Ads build' });
    await user.click(within(far).getByRole('button', { name: 'Save my seat for Ads build' }));
    await waitFor(() => expect(server.rsvps).toEqual(['/community/events/lvs_far/rsvp']));

    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(screen.queryByRole('article', { name: 'Ads build' })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Office hours' })).toBeInTheDocument();
  });

  it('shows replays and an empty state per filter', async () => {
    const user = userEvent.setup();
    server.pages.recordings = {
      sessions: [item({ id: 'lvs_done', title: 'Pricing workshop', status: 'ended', startsAt: iso(-2 * 24 * 60 * MIN), hasReplay: true })],
      nextCursor: null,
      timezone: 'Europe/London',
    };
    wrap(<LiveScheduleView />);
    expect(await screen.findByText('No live classes scheduled')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replays' }));
    const done = await screen.findByRole('article', { name: 'Pricing workshop' });
    expect(within(done).getByRole('link', { name: /Watch replay/ })).toHaveAttribute('href', '/live/lvs_done');
    await user.click(screen.getByRole('button', { name: 'My RSVPs' }));
    expect(await screen.findByText('You haven’t saved any seats')).toBeInTheDocument();
  });
});

describe('calendar feed', () => {
  it('shows the subscribe link once, then offers a new link or turning it off', async () => {
    const user = userEvent.setup();
    wrap(<CalendarSubscribe />);
    await user.click(await screen.findByRole('button', { name: 'Get my calendar link' }));
    expect(await screen.findByRole('link', { name: 'Google Calendar' })).toHaveAttribute(
      'href',
      expect.stringContaining('calendar.google.com'),
    );
    expect(screen.getByRole('link', { name: 'Apple Calendar' })).toHaveAttribute('href', expect.stringMatching(/^webcal:\/\//));
    expect(screen.getByLabelText('Or copy the subscribe link')).toHaveValue(
      `https://school.test/api/v1/live/calendar/lcal_${'a'.repeat(48)}.ics`,
    );
    expect(server.posts).toEqual(['/me/live/calendar']);

    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await user.click(within(screen.getByRole('group', { name: 'Stop updating your calendar?' })).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(server.deletes).toEqual(['/me/live/calendar']));
    expect(await screen.findByRole('button', { name: 'Get my calendar link' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Or copy the subscribe link')).not.toBeInTheDocument();
  });

  it('says it is connected without showing the link again', async () => {
    server.feed = { active: true, createdAt: '2026-11-01T10:00:00Z', lastUsedAt: null };
    wrap(<CalendarSubscribe />);
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.queryByLabelText('Or copy the subscribe link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Get a new link/ })).toBeInTheDocument();
  });
});

describe('/live/{id}', () => {
  const session = (over: Partial<LiveSession> = {}): LiveSession => ({
    ...item({ id: 'lvs_page', title: 'Pricing workshop' }),
    polls: [],
    replay: null,
    ...over,
  });

  it('counts down to a session the learner saved a seat for, with the join opening 15 minutes before', async () => {
    server.session = session({
      going: true,
      joinUrl: 'https://zoom.us/j/2',
      startsAt: iso(3 * 60 * MIN),
      endsAt: iso(4.5 * 60 * MIN),
      joinOpensAt: iso(2.75 * 60 * MIN),
    });
    wrap(<LiveSessionView id="lvs_page" organizer={{ name: 'School', email: '' }} />);
    expect(await screen.findByTestId('live-countdown')).toHaveTextContent(/Starts in 2 h 5\d min|Starts in 3 h 0 min/);
    expect(screen.getByRole('button', { name: 'Join opens 15 min before' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Join on Zoom' })).not.toBeInTheDocument();
    expect(screen.getByText(/90 min/)).toBeInTheDocument();
  });

  it('lets the learner join inside the window', async () => {
    server.session = session({
      going: true,
      joinUrl: 'https://zoom.us/j/2',
      startsAt: iso(5 * MIN),
      endsAt: iso(95 * MIN),
      joinOpensAt: iso(-10 * MIN),
    });
    wrap(<LiveSessionView id="lvs_page" organizer={{ name: 'School', email: '' }} />);
    expect(await screen.findByRole('link', { name: 'Join on Zoom' })).toHaveAttribute('href', 'https://zoom.us/j/2');
    expect(screen.getByText('Starting soon — you can join now.')).toBeInTheDocument();
  });

  it('plays the replay after it ends, and explains when there is none (no dead end)', async () => {
    server.session = session({
      status: 'ended',
      startsAt: iso(-2 * 24 * 60 * MIN),
      replay: {
        status: 'available',
        video: { hlsUrl: null, posterUrl: null, drm: null, captions: [], url: 'https://x/v.mp4', embedUrl: null, watermark: null },
        recap: null,
      },
    });
    const { unmount } = wrap(<LiveSessionView id="lvs_page" organizer={{ name: 'School', email: '' }} />);
    expect(await screen.findByLabelText('Replay of Pricing workshop')).toBeInTheDocument();
    unmount();

    server.session = session({
      status: 'ended',
      startsAt: iso(-2 * 24 * 60 * MIN),
      replay: { status: 'processing', video: null, recap: null },
    });
    wrap(<LiveSessionView id="lvs_page" organizer={{ name: 'School', email: '' }} />);
    expect(await screen.findByText('The recording is on its way')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← All live classes' })).toHaveAttribute('href', '/live');
  });
});
