// @vitest-environment jsdom
// Service bookings on the site: the slot picker (time-zone switch, DST), the booking flow's outcomes (confirmed,
// checkout, taken) and the account's session page (cancel policy, reschedule). Contract: docs/api/commerce.md and
// docs/api/account.md → Bookings.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useState, type ReactNode } from 'react';
import messages from '../../../messages/en.json';
import type { ProductPage } from '@/features/commerce/types';
import { ApiError } from '@/lib/api/errors';
import { BookingDetailView } from './components/BookingsViews';
import { ServiceBooking } from './components/ServiceBooking';
import { SlotPicker } from './components/SlotPicker';
import type { Availability, LearnerBooking, MyBookings, ServiceInfo } from './types';

const push = vi.fn();
const toast = vi.fn();
const get = vi.fn();
const post = vi.fn();
let session = { isSignedIn: true, isLoading: false };
let search = new URLSearchParams('tz=Europe/London');

vi.mock('@/lib/api/client', () => ({
  api: { get: (p: string) => get(p) as unknown, post: (p: string, b?: unknown) => post(p, b) as unknown },
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocalizedRouter: () => ({ push, replace: push }),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => search }));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => toast }));
vi.mock('@/features/auth/api', () => ({ useSession: () => session }));

/** Maya's Sunday 09:00 New York, before and after the clocks change in London (Oct 25) and New York (Nov 1). */
const SUNDAYS = ['2026-10-25T13:00:00Z', '2026-11-01T14:00:00Z'];

function availability(tz: string): Availability {
  const local = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  return {
    timezone: tz,
    slotMinutes: 60,
    days: SUNDAYS.map((s) => ({ date: local(s), slots: [{ startsAt: s, endsAt: new Date(Date.parse(s) + 3_600_000).toISOString() }] })),
  };
}

let mine: MyBookings = { upcoming: [], past: [], credits: [] };
let booking: LearnerBooking;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  push.mockReset();
  toast.mockReset();
  post.mockReset();
  get.mockReset();
  session = { isSignedIn: true, isLoading: false };
  search = new URLSearchParams('tz=Europe/London');
  mine = { upcoming: [], past: [], credits: [] };
  get.mockImplementation((path: string) => {
    const tz = new URL(path, 'https://x').searchParams.get('timezone');
    if (path.includes('/availability')) return Promise.resolve(availability(tz ?? 'UTC'));
    if (path === '/me/bookings') return Promise.resolve(mine);
    if (path.startsWith('/me/bookings/')) return Promise.resolve(booking);
    return Promise.reject(new ApiError(404, 'Not found.'));
  });
});
afterEach(() => vi.useRealTimers());

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

function Picker({ initial }: { initial: string }) {
  const [tz, setTz] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  return <SlotPicker slug="strategy-call" timezone={tz} onTimezoneChange={setTz} selected={selected} onSelect={setSelected} />;
}

const slotsGroup = () => screen.getByRole('group', { name: /Open times on/ });

describe('slot picker', () => {
  it('shows times in the chosen zone, DST-correct, and refetches when the zone changes', async () => {
    wrap(<Picker initial="Europe/London" />);
    // London left summer time on Oct 25, New York only on Nov 1: the same 09:00 New York start reads 13:00, then 14:00.
    expect(
      await within(await screen.findByRole('group', { name: 'Open times on Sunday, October 25' })).findByRole('button'),
    ).toHaveTextContent('1:00 PM');
    await userEvent.click(screen.getByRole('button', { name: 'Sun, Nov 1' }));
    expect(within(slotsGroup()).getByRole('button')).toHaveTextContent('2:00 PM');
    expect(get).toHaveBeenCalledWith(expect.stringContaining('from=2026-10-20&days=14&timezone=Europe%2FLondon'));

    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'America/New_York' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('timezone=America%2FNew_York')));
    expect(await within(await screen.findByRole('group', { name: 'Open times on Sunday, October 25' })).findByText('9:00 AM')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sun, Nov 1' }));
    expect(within(slotsGroup()).getByRole('button')).toHaveTextContent('9:00 AM');
  });

  it('turns two weeks at a time', async () => {
    wrap(<Picker initial="UTC" />);
    await screen.findByRole('group', { name: /Open times on/ });
    expect(screen.getByRole('button', { name: 'Earlier dates' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Later dates' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('from=2026-11-03&days=14')));
  });
});

const service: ServiceInfo = {
  sessionMinutes: 60,
  sessions: 1,
  locationType: 'video',
  intakeQuestions: [{ key: 'goal_area', label: 'Your goal', type: 'textarea', required: true }],
  cancelNoticeHours: 24,
};
const product: ProductPage = {
  slug: 'strategy-call',
  kind: 'service',
  title: 'Strategy call',
  description: '',
  thumbnailUrl: null,
  price: { amount: 15000, currency: 'USD' },
  compareAtPrice: null,
  file: null,
  delivery: null,
  courses: [],
  service,
};

const learnerBooking = (over: Partial<LearnerBooking> = {}): LearnerBooking => ({
  id: 'bk_1',
  status: 'confirmed',
  product: { slug: 'strategy-call', title: 'Strategy call' },
  startsAt: '2026-10-25T13:00:00Z',
  endsAt: '2026-10-25T14:00:00Z',
  timezone: 'Europe/London',
  host: { name: 'Maya Reyes' },
  location: { type: 'video', detail: null },
  joinAvailable: false,
  holdExpiresAt: null,
  canCancel: true,
  canReschedule: true,
  cancelNoticeHours: 24,
  cancelReason: null,
  answers: [],
  ...over,
});

async function pickAndAnswer() {
  await userEvent.click(
    await within(await screen.findByRole('group', { name: /Open times on/ })).findByRole('button', { name: '1:00 PM' }),
  );
  await userEvent.type(screen.getByLabelText('Your goal'), 'Launch in March');
}

describe('booking flow', () => {
  it('asks the required questions before booking', async () => {
    wrap(<ServiceBooking product={product} service={service} />);
    await userEvent.click(await screen.findByRole('button', { name: /^Book and pay · \$150/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a time first.');
    await userEvent.click(
      await within(await screen.findByRole('group', { name: /Open times on/ })).findByRole('button', { name: '1:00 PM' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Book and pay/ }));
    expect(screen.getByText('Answer “Your goal”.')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('a held time goes to checkout with the answers', async () => {
    post.mockResolvedValue({
      booking: learnerBooking({ status: 'held' }),
      next: 'checkout',
      checkoutUrlPath: '/checkout?product=strategy-call',
    });
    wrap(<ServiceBooking product={product} service={service} />);
    await pickAndAnswer();
    await userEvent.click(screen.getByRole('button', { name: /Book and pay/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/checkout?product=strategy-call'));
    expect(post).toHaveBeenCalledWith('/products/strategy-call/bookings', {
      startsAt: '2026-10-25T13:00:00Z',
      timezone: 'Europe/London',
      answers: { goal_area: 'Launch in March' },
    });
  });

  it('with a credit it books at once and opens the session', async () => {
    mine = {
      upcoming: [],
      past: [],
      credits: [{ productSlug: 'strategy-call', productTitle: 'Strategy call', remaining: 3, total: 5, packageId: 'bp_1' }],
    };
    post.mockResolvedValue({ booking: learnerBooking(), next: 'confirmed' });
    wrap(<ServiceBooking product={product} service={service} />);
    expect(await screen.findByText('You have 3 sessions left')).toBeTruthy();
    await pickAndAnswer();
    await userEvent.click(screen.getByRole('button', { name: 'Book this time · uses 1 session' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/account/bookings/bk_1'));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Booked: Strategy call on Sun, Oct 25, 1:00 PM'));
  });

  it('a time someone just took: says so, clears it and reloads the open times', async () => {
    post.mockRejectedValue(new ApiError(409, 'That time was just taken. Pick another time.', {}, 'conflict'));
    wrap(<ServiceBooking product={product} service={service} />);
    await pickAndAnswer();
    const reads = get.mock.calls.filter(([p]) => String(p).includes('/availability')).length;
    await userEvent.click(screen.getByRole('button', { name: /Book and pay/ }));
    expect(await screen.findByText('That time was just taken. Pick another time.')).toBeTruthy();
    await waitFor(() => expect(get.mock.calls.filter(([p]) => String(p).includes('/availability')).length).toBeGreaterThan(reads));
    expect(within(slotsGroup()).getByRole('button', { name: '1:00 PM' })).toHaveAttribute('aria-pressed', 'false');
    expect(push).not.toHaveBeenCalled();
  });

  it('maps a camelCased answers.* error back to its question', async () => {
    post.mockRejectedValue(new ApiError(422, 'Answer “Your goal”.', { 'answers.goalArea': 'Answer “Your goal”.' }));
    wrap(<ServiceBooking product={product} service={service} />);
    await pickAndAnswer();
    await userEvent.click(screen.getByRole('button', { name: /Book and pay/ }));
    await waitFor(() => expect(screen.getByLabelText('Your goal')).toHaveAttribute('aria-invalid', 'true'));
  });

  it('guests sign in first and come back to the same time', async () => {
    session = { isSignedIn: false, isLoading: false };
    wrap(<ServiceBooking product={product} service={service} />);
    await pickAndAnswer();
    await userEvent.click(screen.getByRole('button', { name: /^Sign in to book · \$150/ }));
    expect(push).toHaveBeenCalledWith(
      `/sign-in?next=${encodeURIComponent('/products/strategy-call?slot=2026-10-25T13%3A00%3A00Z&tz=Europe%2FLondon')}`,
    );
    expect(post).not.toHaveBeenCalled();
  });
});

describe('account: a booked session', () => {
  it('shows the time in the learner’s zone and the cancellation policy; cancels with a reason', async () => {
    booking = learnerBooking();
    post.mockResolvedValue(learnerBooking({ status: 'cancelled', canCancel: false, canReschedule: false, cancelReason: 'Travelling' }));
    wrap(<BookingDetailView id="bk_1" />);
    expect(await screen.findByText('Sunday, October 25, 2026 · 1:00 – 2:00 PM (Europe/London)')).toBeTruthy();
    expect(screen.getByText('You can cancel or reschedule up to 24 hours before the start.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add to calendar' })).toHaveAttribute('href', '/api/v1/me/bookings/bk_1/calendar.ics');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel session' }));
    await userEvent.type(screen.getByLabelText('Reason (optional)'), 'Travelling');
    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/me/bookings/bk_1/cancel', { reason: 'Travelling' }));
    expect(toast).toHaveBeenCalledWith('Session cancelled');
  });

  it('inside the notice window it can’t be changed', async () => {
    booking = learnerBooking({ canCancel: false, canReschedule: false });
    wrap(<BookingDetailView id="bk_1" />);
    expect(await screen.findByText(/less than 24 hours to the start/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel session' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });

  it('reschedules with the slot picker; a taken time shows the API’s message', async () => {
    booking = learnerBooking();
    post
      .mockRejectedValueOnce(new ApiError(409, 'That time was just taken. Pick another time.', {}, 'conflict'))
      .mockResolvedValueOnce(learnerBooking({ startsAt: '2026-11-01T14:00:00Z', endsAt: '2026-11-01T15:00:00Z' }));
    wrap(<BookingDetailView id="bk_1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule' }));
    await userEvent.click(
      await within(await screen.findByRole('group', { name: /Open times on/ })).findByRole('button', { name: '1:00 PM' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move to this time' }));
    expect(await screen.findByText('That time was just taken. Pick another time.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sun, Nov 1' }));
    await userEvent.click(within(slotsGroup()).getByRole('button', { name: '2:00 PM' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move to this time' }));
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith('/me/bookings/bk_1/reschedule', {
        startsAt: '2026-11-01T14:00:00Z',
        timezone: 'Europe/London',
      }),
    );
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Moved to Sun, Nov 1, 2:00 PM'));
  });

  it('opens a provider’s meeting link from the join button', async () => {
    booking = learnerBooking({ location: { type: 'zoom', detail: null }, joinAvailable: true });
    post.mockResolvedValue({ kind: 'link', joinUrl: 'https://zoom.example.com/j/1' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    wrap(<BookingDetailView id="bk_1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Join session' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://zoom.example.com/j/1', '_blank', 'noopener,noreferrer'));
    expect(screen.getByRole('link', { name: 'Open the meeting' })).toHaveAttribute('href', 'https://zoom.example.com/j/1');
    open.mockRestore();
  });
});
