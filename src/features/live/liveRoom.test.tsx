// @vitest-environment jsdom
// The learner's built-in room is the room's server state (`GET /me/live/{id}/room`, re-read every few seconds): hidden
// messages are gone, votes are final, the stage invite and removal come from the host.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import type * as Errors from '@/lib/api/errors';
import type { DailyFactory } from './components/DailyRoom';

type ErrorsModule = typeof Errors;
import { LiveRoom } from './components/LiveViews';
import type { RoomFeed } from './types';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => vi.fn() }));

/** A tiny server: the room as Laravel keeps it, read and written through the mocked API client. */
const server = vi.hoisted(() => {
  const state = {
    removed: false,
    feed: null as unknown as RoomFeed,
    votes: [] as number[],
    tokens: [] as string[],
    older: [] as RoomFeed['chat'],
    /** Older chat by cursor (null: every cursor answers `older`), and the cursors asked for. */
    pages: null as Record<string, { messages: RoomFeed['chat']; nextCursor: string | null }> | null,
    chatCalls: [] as string[],
  };
  return state;
});

const reset = () => {
  server.removed = false;
  server.votes = [];
  server.tokens = [];
  server.older = [];
  server.pages = null;
  server.chatCalls = [];
  server.feed = {
    status: 'live',
    me: { handRaised: false, stage: null, muted: false, breakout: null },
    moderation: { slowModeSec: 0, chatLocked: false },
    pinned: null,
    chat: [
      { id: 'lc_1', who: 'Priya N.', message: 'Morning from Lisbon!', kind: 'message', createdAt: '2026-10-26T10:00:00Z', mine: false },
      { id: 'lc_2', who: 'Troll', message: 'Something abusive', kind: 'message', createdAt: '2026-10-26T10:01:00Z', mine: false },
    ],
    chatCursor: null,
    polls: [
      {
        id: 'poll_1',
        question: 'Which topic next?',
        options: [
          { label: 'Pricing', votes: 2 },
          { label: 'Launch emails', votes: 1 },
        ],
        totalVotes: 3,
        status: 'open',
        myVote: null,
      },
    ],
  };
};

vi.mock('@/lib/api/client', async () => {
  const { ApiError: Err } = await vi.importActual<ErrorsModule>('@/lib/api/errors');
  const removed = () => new Err(403, 'The host removed you from this session.', {}, 'forbidden', 'removed');
  return {
    api: {
      get: (path: string) => {
        if (path === '/me/live/evt_room')
          return Promise.resolve({
            id: 'evt_room',
            title: 'Office hours',
            startsAt: '2026-10-26T10:00:00Z',
            provider: 'built_in',
            attendees: 3,
            going: true,
            joinUrl: 'https://amplify.localhost/live/evt_room/room',
            durationMin: 60,
            status: 'live',
            course: null,
            polls: [],
          });
        if (path === '/me/live/evt_room/room')
          return server.removed ? Promise.reject(removed()) : Promise.resolve(structuredClone(server.feed));
        if (path.startsWith('/me/live/evt_room/chat?before=')) {
          const before = decodeURIComponent(path.slice('/me/live/evt_room/chat?before='.length));
          server.chatCalls.push(before);
          const page = server.pages?.[before];
          if (page) return Promise.resolve(structuredClone(page));
          return Promise.resolve({ messages: structuredClone(server.older), nextCursor: null });
        }
        return Promise.reject(new Err(404, 'Not found.'));
      },
      post: (path: string, body?: { option?: number }) => {
        if (server.removed) return Promise.reject(removed());
        if (path.endsWith('/token')) {
          const token = `tok-${server.feed.me.stage === 'on_stage' ? 'stage' : 'audience'}`;
          server.tokens.push(token);
          return Promise.resolve({
            roomUrl: 'https://x.daily.co/r',
            token,
            expiresAt: '2099-01-01T00:00:00Z',
            isOwner: false,
            canRecord: false,
          });
        }
        if (path.endsWith('/votes')) {
          const poll = server.feed.polls[0]!;
          if (poll.myVote !== null) return Promise.reject(new Err(409, 'You already voted in this poll.', {}, 'conflict'));
          poll.myVote = body!.option!;
          poll.options[body!.option!]!.votes += 1;
          poll.totalVotes += 1;
          server.votes.push(body!.option!);
          return Promise.resolve(undefined);
        }
        if (path.endsWith('/stage/accept')) {
          server.feed.me.stage = 'on_stage';
          return Promise.resolve(undefined);
        }
        return Promise.resolve(undefined);
      },
      delete: () => Promise.resolve(undefined),
    },
  };
});

function installDaily() {
  const destroyed: number[] = [];
  const double: DailyFactory = {
    supportedBrowser: () => ({ supported: true }),
    createFrame(parent) {
      const iframe = document.createElement('iframe');
      parent.appendChild(iframe);
      return {
        join: () => Promise.resolve({}),
        on: () => undefined,
        destroy: () => {
          destroyed.push(1);
          iframe.remove();
          return Promise.resolve();
        },
        iframe: () => iframe,
      };
    },
  };
  window.__DAILY_TEST_DOUBLE__ = double;
  return { destroyed };
}

function renderRoom() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <LiveRoom id="evt_room" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  reset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  delete window.__DAILY_TEST_DOUBLE__;
});

const nextPoll = () => act(() => vi.advanceTimersByTimeAsync(4_100));

describe('learner live room', () => {
  it('shows the conversation and drops a message once the host hides it', async () => {
    installDaily();
    renderRoom();
    const log = await screen.findByRole('list', { name: 'Room chat' });
    expect(within(log).getByText('Something abusive')).toBeInTheDocument();
    // The host hides it: the next feed doesn't have it.
    server.feed.chat = server.feed.chat.filter((m) => m.id !== 'lc_2');
    await nextPoll();
    await waitFor(() => expect(within(log).queryByText('Something abusive')).not.toBeInTheDocument());
    expect(within(log).getByText('Morning from Lisbon!')).toBeInTheDocument();
  });

  it('drops a hidden message from earlier pages the learner loaded too', async () => {
    installDaily();
    server.feed.chatCursor = 'lc_1';
    server.older = [
      { id: 'lc_0a', who: 'Marcus W.', message: 'Older hello', kind: 'message', createdAt: '2026-10-26T09:58:00Z', mine: false },
      { id: 'lc_0b', who: 'Troll', message: 'Older abuse', kind: 'message', createdAt: '2026-10-26T09:59:00Z', mine: false },
    ];
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderRoom();
    await user.click(await screen.findByRole('button', { name: 'Load earlier messages' }));
    const log = screen.getByRole('list', { name: 'Room chat' });
    expect(await within(log).findByText('Older abuse')).toBeInTheDocument();
    // The host hides it after the learner loaded it: earlier pages are re-read every 30 s.
    server.older = server.older.filter((m) => m.id !== 'lc_0b');
    await act(() => vi.advanceTimersByTimeAsync(30_100));
    await waitFor(() => expect(within(log).queryByText('Older abuse')).not.toBeInTheDocument());
    expect(within(log).getByText('Older hello')).toBeInTheDocument();
  });

  it('re-reads only the last 5 loaded pages, each from its own cursor', async () => {
    installDaily();
    server.feed.chatCursor = 'c0';
    server.pages = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [
        `c${i}`,
        {
          messages: [
            { id: `old_${i}`, who: 'Ana', message: `Older ${i}`, kind: 'message' as const, createdAt: '2026-10-26T09:00:00Z', mine: false },
          ],
          nextCursor: i < 6 ? `c${i + 1}` : null,
        },
      ]),
    );
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderRoom();
    for (let i = 0; i < 7; i++) {
      await user.click(await screen.findByRole('button', { name: 'Load earlier messages' }));
      await screen.findByText(`Older ${i}`);
    }
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).not.toBeInTheDocument();
    // New messages arrive (the feed's start moves on): the re-read still uses each page's stored cursor.
    server.feed.chat = [
      ...server.feed.chat,
      { id: 'lc_new', who: 'Ben', message: 'New one', kind: 'message', createdAt: '2026-10-26T10:30:00Z', mine: false },
    ];
    server.feed.chatCursor = 'c-moved';
    server.chatCalls = [];
    await act(() => vi.advanceTimersByTimeAsync(30_100));
    await waitFor(() => expect(server.chatCalls).toEqual(['c2', 'c3', 'c4', 'c5', 'c6']));
    for (let i = 0; i < 7; i++) expect(screen.getByText(`Older ${i}`)).toBeInTheDocument();
  });

  it('votes once and shows the live results', async () => {
    installDaily();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderRoom();
    await user.click(await screen.findByRole('radio', { name: 'Pricing' }));
    expect(await screen.findByText(/Thanks for voting · 4 votes so far/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Pricing' })).toHaveAttribute('aria-valuenow', '75');
    // Voting is closed for this learner (the server answers 409 to a second vote anyway).
    expect(screen.getByRole('radio', { name: /^Launch emails/ })).toBeDisabled();
    expect(server.votes).toEqual([0]);
  });

  it('accepts a stage invite and rejoins the video with a token that can send', async () => {
    installDaily();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderRoom();
    await waitFor(() => expect(server.tokens).toEqual(['tok-audience']));
    server.feed.me.stage = 'invited';
    await nextPoll();
    await user.click(await screen.findByRole('button', { name: 'Join the stage' }));
    expect(await screen.findByText(/You’re on stage/)).toBeInTheDocument();
    await waitFor(() => expect(server.tokens).toEqual(['tok-audience', 'tok-stage']));
  });

  it('stops the room when the host removes the learner', async () => {
    const daily = installDaily();
    renderRoom();
    await screen.findByRole('list', { name: 'Room chat' });
    server.removed = true;
    await nextPoll();
    expect(await screen.findByRole('alert')).toHaveTextContent('The host removed you from this session.');
    await waitFor(() => expect(daily.destroyed.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('daily-frame')).not.toBeInTheDocument();
  });

  it('explains slow mode, the lock and mute from the server', async () => {
    installDaily();
    server.feed.moderation = { slowModeSec: 30, chatLocked: false };
    renderRoom();
    expect(await screen.findByText('Slow mode: one message every 30 seconds.')).toBeInTheDocument();
    server.feed.moderation.chatLocked = true;
    await nextPoll();
    expect(await screen.findByText('The host has paused the chat.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
  });
});
