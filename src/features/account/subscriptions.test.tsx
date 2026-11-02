// @vitest-environment jsdom
// Cancelling a membership or a course subscription online (docs/api/account.md → Subscriptions), against the mock API
// with a signed-in learner: the optional survey, the save offers, the confirmation, and undoing a cancellation.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { app } from '../../../mock-api/app';
import { allTenants, reset } from '../../../mock-api/lib/db';
import { subscriptionState } from '../../../mock-api/lib/subscriptions';
import messages from '../../../messages/en.json';
import { ToastProvider } from '@/components/toast/Toaster';
import { BillingView } from './components/BillingView';

vi.mock('@/features/auth/api', () => ({
  useSession: () => ({ user: null, isSignedIn: true }),
  authKeys: { me: ['auth', 'me'] },
  refreshMe: () => Promise.resolve(),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useAppPathname: () => '/account/billing',
}));

const calls: { method: string; url: string; body: string | null }[] = [];

/** Signs Jordan in on the mock and routes same-origin `/api/v1` calls to it with the session cookies. */
async function signIn() {
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair!.split('=');
      if (k && v) jar.set(k, v);
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  keep(await app.request('/sanctum/csrf-cookie', { headers: { 'X-Tenant': 'amplify' } }));
  keep(
    await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'X-Tenant': 'amplify',
        'Content-Type': 'application/json',
        Cookie: cookie(),
        'X-XSRF-TOKEN': decodeURIComponent(jar.get('XSRF-TOKEN')!),
      },
      body: JSON.stringify({ email: 'jordan.tate@gmail.com', password: 'password', remember: false }),
    }),
  );
  document.cookie = `XSRF-TOKEN=${jar.get('XSRF-TOKEN')!}; path=/`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const body = typeof init.body === 'string' ? init.body : null;
      calls.push({ method: init.method ?? 'GET', url, body });
      const headers = new Headers(init.headers);
      headers.set('X-Tenant', 'amplify');
      headers.set('Cookie', cookie());
      const res = await app.request(url, { method: init.method ?? 'GET', headers, body });
      keep(res);
      return res;
    }),
  );
}

const amplify = () => allTenants().find((x) => x.site.slug === 'amplify')!;
const renews = new Date(Date.now() + 20 * 86_400_000).toISOString();

/** Jordan is a Pro member (renewing in 20 days). */
function proMember() {
  const jordan = amplify().users.find((u) => u.email === 'jordan.tate@gmail.com')!;
  Object.assign(jordan, { membershipPlanId: 'plan_pro', membershipRenewsAt: renews });
}

function renderBilling() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ToastProvider>
          <BillingView />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  reset();
  calls.length = 0;
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  await signIn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/';
});

const section = () => screen.getByRole('region', { name: 'Subscriptions' });

describe('subscriptions on the billing page', () => {
  it('lists nothing for a learner without subscriptions', async () => {
    renderBilling();
    await screen.findByRole('heading', { name: 'Billing' });
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/me/subscriptions'))).toBe(true));
    expect(screen.queryByRole('region', { name: 'Subscriptions' })).toBeNull();
  });

  it('takes a save offer instead of cancelling, with the survey answer recorded', async () => {
    proMember();
    const user = userEvent.setup();
    renderBilling();
    expect(await screen.findByText('Pro membership')).toBeInTheDocument();
    await user.click(within(section()).getByRole('button', { name: 'Cancel Pro' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel Pro' });

    // The survey is optional; the reason and the text go with the outcome.
    await user.click(await within(dialog).findByRole('radio', { name: 'It’s too expensive' }));
    await user.type(within(dialog).getByLabelText('Anything else you’d like to tell us? (optional)'), 'Tight month');
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

    // The school's offers: pause, 30% off, Starter.
    expect(within(dialog).getByText('Pause billing for 1 month')).toBeInTheDocument();
    expect(within(dialog).getByText('Stay for 30% off')).toBeInTheDocument();
    expect(within(dialog).getByText('Switch to Starter')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Take the offer: Stay for 30% off' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(section()).findByText('30% off the next 3 renewals')).toBeInTheDocument();
    const save = calls.find((c) => c.url.endsWith('/save'))!;
    expect(JSON.parse(save.body!)).toMatchObject({ offer: 'discount', reason: 'too_expensive', reason_text: 'Tight month' });
    expect(subscriptionState(amplify()).flows.at(-1)).toMatchObject({
      outcome: 'saved',
      acceptedOffer: 'discount',
      reason: 'too_expensive',
    });
  });

  it('cancels in three steps, keeps access to the period end, and can be undone', async () => {
    proMember();
    const user = userEvent.setup();
    renderBilling();
    await user.click(
      await within(await screen.findByRole('region', { name: 'Subscriptions' })).findByRole('button', { name: 'Cancel Pro' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Cancel Pro' });
    await user.click(await within(dialog).findByRole('button', { name: 'Continue' })); // no survey answer
    await user.click(within(dialog).getByRole('button', { name: 'No thanks, continue to cancel' }));
    expect(within(dialog).getByText(/Your access lasts until/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(section()).findByText(/Cancelled · your access lasts until/)).toBeInTheDocument();
    expect(within(section()).queryByRole('button', { name: 'Cancel Pro' })).toBeNull();
    expect(subscriptionState(amplify()).flows.at(-1)).toMatchObject({ outcome: 'cancelled', reason: null });

    await user.click(within(section()).getByRole('button', { name: 'Keep Pro' }));
    expect(await within(section()).findByText(/renews/)).toBeInTheDocument();
    expect(within(section()).getByRole('button', { name: 'Cancel Pro' })).toBeInTheDocument();
  });

  it('pauses instead, and resumes', async () => {
    proMember();
    const user = userEvent.setup();
    renderBilling();
    await user.click(
      await within(await screen.findByRole('region', { name: 'Subscriptions' })).findByRole('button', { name: 'Cancel Pro' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Cancel Pro' });
    await user.click(await within(dialog).findByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Take the offer: Pause instead' }));
    expect(await within(section()).findByText(/Billing paused · resumes/)).toBeInTheDocument();
    await user.click(within(section()).getByRole('button', { name: 'Resume Pro' }));
    expect(await within(section()).findByText(/renews/)).toBeInTheDocument();
  });

  it('still cancels when the flow can’t be started', async () => {
    proMember();
    const user = userEvent.setup();
    const real = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        if (url.endsWith('/cancel-flow')) return new Response(JSON.stringify({ message: 'Server error' }), { status: 500 });
        return real(input, init);
      }),
    );
    renderBilling();
    await user.click(
      await within(await screen.findByRole('region', { name: 'Subscriptions' })).findByRole('button', { name: 'Cancel Pro' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Cancel Pro' });
    expect(await within(dialog).findByText('We couldn’t start the cancellation. Please try again.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel subscription' }));
    expect(await within(section()).findByText(/Cancelled · your access lasts until/)).toBeInTheDocument();
  });
});
