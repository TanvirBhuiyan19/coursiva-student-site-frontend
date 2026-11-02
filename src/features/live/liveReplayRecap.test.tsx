// @vitest-environment jsdom
// The AI recap beside a live session's replay (`replay.recap` on GET /me/live/{id}): shown only once the school
// published it; chapters jump the replay.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
import { LiveReplayRecap } from './components/LiveReplayRecap';
import { clock, replayRecapOf, seekReplay } from './recap';

const recap = {
  summary: 'We tore down a landing page.',
  chapters: [
    { startSec: 0, title: 'Welcome' },
    { startSec: 3725, title: 'Q&A' },
  ],
  actionItems: ['Rewrite your headline'],
};

const view = (session: unknown, onSeek?: (s: number) => void) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LiveReplayRecap session={session} {...(onSeek ? { onSeek } : {})} />
    </NextIntlClientProvider>,
  );

describe('LiveReplayRecap', () => {
  it('shows the published recap and jumps the replay to a chapter', async () => {
    const onSeek = vi.fn();
    view({ status: 'ended', replay: { status: 'available', video: {}, recap } }, onSeek);
    expect(screen.getByRole('heading', { name: 'Class recap' })).toBeInTheDocument();
    expect(screen.getByText('We tore down a landing page.')).toBeInTheDocument();
    expect(screen.getByText('Rewrite your headline')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Jump to 1:02:05: Q&A' }));
    expect(onSeek).toHaveBeenCalledWith(3725);
  });

  it('renders nothing without a published recap or an available replay', () => {
    const { container } = view({ status: 'ended', replay: { status: 'available', video: {}, recap: null } });
    expect(container).toBeEmptyDOMElement();
    expect(replayRecapOf({ replay: { status: 'restricted', video: null, recap } })).toBeNull();
    expect(replayRecapOf({ status: 'ended' })).toBeNull();
    expect(replayRecapOf(null)).toBeNull();
  });

  it('seeks the page’s replay video and announces the jump', () => {
    const video = document.createElement('video');
    video.setAttribute('data-live-replay', '');
    video.play = vi.fn(() => Promise.resolve());
    document.body.append(video);
    const heard = vi.fn();
    document.addEventListener('live:seek', (e) => heard((e as CustomEvent<{ seconds: number }>).detail.seconds));
    seekReplay(65);
    expect(video.currentTime).toBe(65);
    expect(heard).toHaveBeenCalledWith(65);
    expect(clock(65)).toBe('1:05');
    video.remove();
  });
});
