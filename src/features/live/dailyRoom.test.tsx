// @vitest-environment jsdom
// The built-in room's video (Daily Prebuilt): joins with a fresh token, accessible frame, honest states.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
import { ApiError } from '@/lib/api/errors';
import { DailyRoom, type DailyFactory } from './components/DailyRoom';
import type { RoomToken } from './types';

const withIntl = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const token = (n: number): RoomToken => ({
  roomUrl: 'https://school.daily.co/cv-room',
  token: `tok-${n}`,
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  isOwner: false,
  canRecord: false,
});

/** A daily-js stand-in: records joins and lets the test fire events. */
function installDouble() {
  const handlers: Record<string, (e?: unknown) => void> = {};
  const joins: { url: string; token: string }[] = [];
  const destroyed: number[] = [];
  const double: DailyFactory = {
    supportedBrowser: () => ({ supported: true }),
    createFrame(parent) {
      const iframe = document.createElement('iframe');
      parent.appendChild(iframe);
      return {
        join: (o) => {
          joins.push(o);
          return Promise.resolve({});
        },
        on: (event, handler) => {
          handlers[event] = handler as (e?: unknown) => void;
          return undefined;
        },
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
  return { handlers, joins, destroyed };
}

afterEach(() => {
  delete window.__DAILY_TEST_DOUBLE__;
});

describe('DailyRoom', () => {
  it('joins with the token, titles the frame, and rejoins with a fresh token after leaving', async () => {
    const { handlers, joins, destroyed } = installDouble();
    let n = 0;
    const getToken = vi.fn(() => Promise.resolve(token(++n)));
    render(withIntl(<DailyRoom title="Funnel Q&A" getToken={getToken} />));

    await waitFor(() => expect(joins).toEqual([{ url: 'https://school.daily.co/cv-room', token: 'tok-1' }]));
    expect(document.querySelector('iframe')?.getAttribute('title')).toBe('Live video for Funnel Q&A');
    expect(screen.getByRole('region', { name: 'Video' })).toBeTruthy();

    handlers['camera-error']?.();
    handlers['joined-meeting']?.();
    expect(await screen.findByText(/camera or microphone is blocked/)).toBeTruthy();

    handlers['left-meeting']?.();
    await userEvent.click(await screen.findByRole('button', { name: 'Rejoin video' }));
    await waitFor(() => expect(joins.map((j) => j.token)).toEqual(['tok-1', 'tok-2']));
    expect(destroyed.length).toBe(1);
  });

  it('says when the platform has no live video, without a retry', async () => {
    installDouble();
    const getToken = () =>
      Promise.reject(new ApiError(409, 'Live video isn’t set up on this platform yet.', {}, 'feature_unavailable', 'video_not_configured'));
    render(withIntl(<DailyRoom title="Q" getToken={getToken} />));
    expect((await screen.findByRole('status')).textContent).toMatch(/isn’t available for this session/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a retry when the room isn’t open yet or Daily fails', async () => {
    installDouble();
    const getToken = vi
      .fn<() => Promise<RoomToken>>()
      .mockRejectedValueOnce(new ApiError(409, 'The room opens 15 minutes before the session starts.', {}, 'conflict', 'room_not_open'))
      .mockRejectedValueOnce(new ApiError(503, 'The live room is unavailable right now.', {}, 'service_unavailable'))
      .mockResolvedValue(token(1));
    render(withIntl(<DailyRoom title="Q" getToken={getToken} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn’t start/);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getToken).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
