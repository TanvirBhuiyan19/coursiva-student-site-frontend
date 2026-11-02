// @vitest-environment jsdom
// Track F: the public webinar page (registration, bot protection, paid → checkout), the join link and the paid
// session CTA on /live/{id}.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import type * as Errors from '@/lib/api/errors';
import { LiveTicketCta } from '@/features/live/components/LiveTicketCta';
import { WebinarJoin } from './components/WebinarJoin';
import { WebinarView } from './components/WebinarView';
import type { PublicWebinar } from './types';

type ErrorsModule = typeof Errors;

const nav = vi.hoisted(() => ({ pushed: [] as string[], hard: [] as string[] }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocalizedRouter: () => ({ push: (h: string) => nav.pushed.push(h) }),
  useHardNavigate: () => (h: string) => nav.hard.push(h),
}));
const auth = vi.hoisted(() => ({ signedIn: false }));
vi.mock('@/features/auth/api', () => ({
  useSession: () => ({ user: auth.signedIn ? { timezone: 'UTC' } : null, isSignedIn: auth.signedIn, isLoading: false }),
}));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => vi.fn() }));

interface Failure {
  status: number;
  message: string;
  errors?: Record<string, string>;
  reason?: string;
  details?: Record<string, unknown>;
}

interface MockServer {
  webinar: unknown;
  posts: { path: string; body: unknown }[];
  reply: unknown;
  fail: Failure | null;
  session: unknown;
}

const server = vi.hoisted<MockServer>(() => ({ webinar: null, posts: [], reply: null, fail: null, session: null }));

vi.mock('@/lib/api/client', async () => {
  const { ApiError: Err } = await vi.importActual<ErrorsModule>('@/lib/api/errors');
  return {
    api: {
      get: (path: string) => {
        if (path.startsWith('/webinars/')) return Promise.resolve(structuredClone(server.webinar));
        if (path.startsWith('/me/live/')) return Promise.resolve(structuredClone(server.session));
        return Promise.reject(new Err(404, 'Not found.'));
      },
      post: (path: string, body: unknown) => {
        server.posts.push({ path, body });
        if (server.fail) {
          const f = server.fail;
          return Promise.reject(new Err(f.status, f.message, f.errors ?? {}, null, f.reason ?? null, null, f.details ?? {}));
        }
        return Promise.resolve(structuredClone(server.reply));
      },
      put: () => Promise.resolve({}),
      delete: () => Promise.resolve({}),
    },
  };
});

function webinar(over: Partial<PublicWebinar> = {}): PublicWebinar {
  return {
    id: 'lv_1',
    slug: 'launch-workshop',
    title: 'Launch workshop',
    description: 'Ship your launch.\n\nBring questions.',
    startsAt: '2026-11-10T15:00:00Z',
    durationMin: 60,
    status: 'scheduled',
    timeZone: 'America/New_York',
    course: { title: 'Funnels 101', slug: 'funnels-101' },
    access: 'free',
    price: null,
    seatsLeft: 8,
    soldOut: false,
    registrationOpen: true,
    form: { token: 'tok_form', turnstileSiteKey: null, minFillSeconds: 3 },
    calendar: { google: 'https://calendar.google.com/x', outlook: 'https://outlook.live.com/x' },
    ...over,
  };
}

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
  server.posts = [];
  server.reply = null;
  server.fail = null;
  server.session = null;
  nav.pushed = [];
  nav.hard = [];
  auth.signedIn = false;
});

describe('webinar page', () => {
  it('shows the facts, low seats and calendar links, and registers a visitor (honeypot empty, one request)', async () => {
    const w = webinar();
    server.webinar = w;
    server.reply = { next: 'check_email', status: 'registered' };
    wrap(<WebinarView initial={w} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Launch workshop' })).toBeInTheDocument();
    expect(screen.getByTestId('webinar-price')).toHaveTextContent('Free');
    expect(screen.getByText('8 seats left')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Part of Funnels 101' })).toHaveAttribute('href', '/courses/funnels-101');
    expect(screen.getByRole('link', { name: 'Add to Google Calendar' })).toHaveAttribute('href', w.calendar.google);
    expect(screen.getByText('Bring questions.')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save my seat' }));
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument();
    expect(server.posts).toHaveLength(0);

    await user.type(screen.getByLabelText('Your name'), 'Vee Visitor');
    await user.type(screen.getByLabelText('Email'), 'vee@example.com');
    await user.dblClick(screen.getByRole('button', { name: 'Save my seat' }));
    expect(await screen.findByTestId('webinar-check-email')).toHaveTextContent('vee@example.com');
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]).toEqual({
      path: '/webinars/launch-workshop/registrations',
      body: { name: 'Vee Visitor', email: 'vee@example.com', token: 'tok_form', website: '', turnstileToken: null },
    });
  });

  it('sends a paid webinar visitor on to checkout, and shows API field errors', async () => {
    const w = webinar({ access: 'paid', price: { amount: 4900, currency: 'USD' } });
    server.webinar = w;
    server.fail = { status: 422, message: 'Enter a valid email address.', errors: { email: 'Enter a valid email address.' } };
    wrap(<WebinarView initial={w} />);
    expect(screen.getByTestId('webinar-price')).toHaveTextContent('$49');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your name'), 'Pat');
    await user.type(screen.getByLabelText('Email'), 'pat@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue — $49' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();

    server.fail = null;
    server.reply = { next: 'checkout', status: null, checkoutUrlPath: '/checkout?live=lv_1' };
    await user.click(screen.getByRole('button', { name: 'Continue — $49' }));
    await waitFor(() => expect(nav.pushed).toEqual(['/checkout?live=lv_1']));
  });

  it('shows a signed-in learner they are registered', async () => {
    auth.signedIn = true;
    const w = webinar();
    server.webinar = w;
    server.session = { id: 'lv_1', going: true, waitlisted: false, ticket: null };
    wrap(<WebinarView initial={w} />);
    expect(await screen.findByTestId('webinar-registered')).toHaveTextContent('You’re registered');
    expect(screen.getByRole('link', { name: 'Go to the session' })).toHaveAttribute('href', '/live/lv_1');
  });

  it('says when it has ended', () => {
    const w = webinar({ status: 'ended', registrationOpen: false });
    server.webinar = w;
    wrap(<WebinarView initial={w} />);
    expect(screen.getByText('This webinar has ended.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});

describe('join link', () => {
  it('signs a guest in and opens the session with a full navigation', async () => {
    server.reply = { sessionId: 'lv_1', signedIn: true };
    wrap(<WebinarJoin token="wjt_x" />);
    await waitFor(() => expect(nav.hard).toEqual(['/live/lv_1']));
    expect(server.posts).toEqual([{ path: '/webinars/join', body: { t: 'wjt_x' } }]);
  });

  it('asks an account with a password to sign in, back to the session', async () => {
    server.fail = { status: 401, message: 'Sign in to join this session.', reason: 'sign_in_required', details: { sessionId: 'lv_1' } };
    wrap(<WebinarJoin token="wjt_x" />);
    expect(await screen.findByRole('link', { name: 'Sign in to join' })).toHaveAttribute('href', '/sign-in?next=%2Flive%2Flv_1');
  });

  it('explains someone else’s link and a dead one', async () => {
    server.fail = { status: 403, message: 'Not yours', reason: 'join_link_not_yours' };
    const { unmount } = wrap(<WebinarJoin token="wjt_x" />);
    expect(await screen.findByText('This link isn’t yours')).toBeInTheDocument();
    unmount();
    wrap(<WebinarJoin token={null} />);
    expect(screen.getByText('This link doesn’t work')).toBeInTheDocument();
  });
});

describe('ticket CTA', () => {
  it('sells a ticket and a series ticket, says sold out, and points members-only sessions to memberships', () => {
    const offer = {
      access: 'paid' as const,
      price: { amount: 2900, currency: 'USD' },
      seriesPrice: { amount: 7900, currency: 'USD' },
      hasAccess: false,
      soldOut: false,
    };
    const { rerender } = wrap(<LiveTicketCta sessionId="lv_1" ticket={offer} />);
    expect(screen.getByRole('link', { name: 'Buy ticket — $29' })).toHaveAttribute('href', '/checkout?live=lv_1');
    expect(screen.getByRole('link', { name: 'Buy the series — $79' })).toHaveAttribute('href', '/checkout?live=lv_1&series=1');
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <LiveTicketCta sessionId="lv_1" ticket={{ ...offer, soldOut: true }} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Sold out' })).toBeDisabled();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <LiveTicketCta sessionId="lv_1" ticket={{ ...offer, access: 'members', price: null, seriesPrice: null }} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('link', { name: 'See memberships' })).toHaveAttribute('href', '/membership');
  });
});
