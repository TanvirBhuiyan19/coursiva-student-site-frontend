// @vitest-environment jsdom
// Order history, the invoice's statuses and seller block, "Email me a copy", and the billing page's card and membership
// (docs/api/commerce.md → orders, docs/api/account.md → billing).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { BillingSection } from '../account/components/BillingSection';
import type { Profile } from '../account/types';
import { ApiError } from '@/lib/api/errors';
import { Invoice, OrderSuccess } from './components/OrderViews';
import { OrdersView } from './components/OrdersView';
import type { Order, OrderSummary } from './types';

const toast = vi.fn();
const emailInvoice = vi.fn();
let orders: { data: OrderSummary[]; meta: { currentPage: number; lastPage: number; perPage: number; total: number } } | undefined;
let order: Order;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useAppPathname: () => '/account/billing',
}));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => toast }));
vi.mock('@/components/layout/BrandMark', () => ({ BrandMark: () => null }));
vi.mock('@/features/tracking/TrackPurchase', () => ({ TrackPurchase: () => null }));
vi.mock('./components/PostPurchaseOfferCard', () => ({ PostPurchaseOfferCard: () => null }));
vi.mock('./api', () => ({
  useOrders: (page: number) =>
    orders
      ? {
          data: { ...orders, meta: { ...orders.meta, currentPage: page } },
          isPending: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        }
      : { data: undefined, isPending: false, isError: true, isFetching: false, refetch: vi.fn() },
  useOrder: () => ({ data: order, isPending: false, isError: false, refetch: vi.fn() }),
  useEmailInvoice: () => ({ mutate: emailInvoice, isPending: false }),
}));
const portal = vi.fn();
vi.mock('../account/api', () => ({ openBillingPortal: (path: string) => portal(path) as unknown }));

const usd = (amount: number) => ({ amount, currency: 'USD' });

const summary = (over: Partial<OrderSummary>): OrderSummary => ({
  id: 'ord_1',
  number: 'AMP-2026-1001',
  createdAt: '2026-02-04T12:00:00Z',
  status: 'paid',
  title: 'The Funnel Blueprint',
  itemCount: 1,
  total: usd(14900),
  refunded: usd(0),
  hasInvoice: true,
  ...over,
});

const baseOrder = (over: Partial<Order>): Order => ({
  id: 'ord_1',
  number: 'AMP-2026-1001',
  invoiceNumber: null,
  createdAt: '2026-02-04T12:00:00Z',
  status: 'paid',
  paidAt: '2026-02-04T12:00:00Z',
  items: [
    {
      kind: 'course',
      title: 'The Funnel Blueprint',
      meta: 'Lifetime access',
      cover: { url: null, color: '#123', alt: '' },
      unitPrice: usd(14900),
      quantity: 1,
      tax: usd(0),
      courseSlug: 'funnel',
      refId: 'crs_funnel',
      liveSessionId: null,
    },
  ],
  subtotal: usd(14900),
  discount: usd(0),
  couponCode: null,
  orderBump: null,
  tax: usd(0),
  taxLabel: null,
  taxDetails: { inclusive: false, rate: null, reverseCharge: false, note: null },
  total: usd(14900),
  dueToday: usd(14900),
  installments: null,
  refunded: usd(0),
  creditNotes: [],
  paymentMethod: 'Visa ··4242',
  giftCard: null,
  paidByCard: usd(14900),
  gift: null,
  seats: null,
  billing: { name: 'Jordan Tate', email: 'jordan@example.com', country: 'United States', region: null, taxId: null },
  seller: {
    name: 'Amplify',
    legalName: 'Amplify Coaching Ltd',
    email: 'help@amplify.test',
    address: '12 Market Street\nLondon',
    taxId: 'GB123456789',
  },
  startLesson: null,
  ...over,
});

function wrap(ui: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const site = { name: 'Amplify', logoUrl: null, primaryHost: 'amplify.example.com' };

beforeEach(() => {
  toast.mockReset();
  emailInvoice.mockReset();
  portal.mockReset();
});

describe('order history', () => {
  it('lists orders with their status, refunds, receipt and invoice links, and pages through them', async () => {
    orders = {
      data: [
        summary({ id: 'ord_2', number: 'AMP-2026-1002', title: 'Email Mastery', itemCount: 3 }),
        summary({ id: 'ord_1', status: 'partially_refunded', refunded: usd(1000) }),
        summary({ id: 'ord_0', number: 'AMP-2026-1000', status: 'failed', hasInvoice: false }),
      ],
      meta: { currentPage: 1, lastPage: 2, perPage: 10, total: 13 },
    };
    wrap(<OrdersView />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Email Mastery and 2 more items')).toBeTruthy();
    expect(within(rows[0]!).getByRole('link', { name: 'Invoice for order AMP-2026-1002' }).getAttribute('href')).toBe(
      '/orders/ord_2/invoice',
    );
    expect(within(rows[1]!).getByText('Partially refunded')).toBeTruthy();
    expect(within(rows[1]!).getByText('$10 refunded')).toBeTruthy();
    // A failed payment has a receipt page but no invoice.
    expect(within(rows[2]!).getByText('Failed')).toBeTruthy();
    expect(within(rows[2]!).queryByRole('link', { name: /Invoice/ })).toBeNull();
    expect(within(rows[2]!).getByRole('link', { name: 'Receipt for order AMP-2026-1000' }).getAttribute('href')).toBe('/orders/ord_0');

    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
  });

  it('has an empty state and an error state with retry', () => {
    orders = { data: [], meta: { currentPage: 1, lastPage: 1, perPage: 10, total: 0 } };
    const { unmount } = wrap(<OrdersView />);
    expect(screen.getByText(/You haven’t bought anything yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse courses' })).toBeTruthy();
    unmount();
    orders = undefined;
    wrap(<OrdersView />);
    expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your orders.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('thank-you page', () => {
  it('opens the bought live class itself, and the schedule for an older order without its session', () => {
    const live = {
      ...baseOrder({}).items[0]!,
      kind: 'live' as const,
      title: 'Launch workshop',
      meta: 'Live class ticket',
      courseSlug: null,
    };
    order = baseOrder({ items: [{ ...live, refId: 'lv_42', liveSessionId: 'lv_42' }] });
    const { unmount } = wrap(<OrderSuccess orderId="ord_1" community={false} />);
    expect(screen.getByRole('link', { name: 'Go to your live class →' })).toHaveAttribute('href', '/live/lv_42');
    unmount();
    order = baseOrder({ items: [{ ...live, refId: null, liveSessionId: null }] });
    wrap(<OrderSuccess orderId="ord_1" community={false} />);
    expect(screen.getByRole('link', { name: 'Go to my live classes →' })).toHaveAttribute('href', '/live');
  });
});

describe('invoice', () => {
  it('prints the seller’s legal name, address and tax ID, and stamps a refund with its amount', () => {
    order = baseOrder({ status: 'refunded', refunded: usd(14900) });
    wrap(<Invoice orderId="ord_1" site={site} />);
    expect(screen.getByText('REFUNDED')).toBeTruthy();
    expect(screen.queryByText('PAID')).toBeNull();
    const paper = screen.getByRole('article');
    expect(paper.textContent).toContain('Amplify Coaching Ltd');
    expect(paper.textContent).toContain('12 Market Street');
    expect(paper.textContent).toContain('Tax ID: GB123456789');
    const refunded = within(paper).getByText('Refunded').closest('div')!;
    expect(refunded.textContent).toContain('−$149');
  });

  it('stamps a partial refund with its credit note, and a failed payment, which has nothing to email', () => {
    order = baseOrder({
      status: 'partially_refunded',
      refunded: usd(1000),
      creditNotes: [{ number: 'CN-0007', amount: usd(1000), createdAt: '2026-10-27T10:00:00Z' }],
    });
    const { unmount } = wrap(<Invoice orderId="ord_1" site={site} />);
    expect(screen.getByText('PARTIALLY REFUNDED')).toBeTruthy();
    expect(within(screen.getByRole('article')).getByText('Partially refunded').closest('div')!.textContent).toContain('−$10');
    // Each refund's credit note is listed under it.
    expect(within(screen.getByRole('article')).getByText('Credit note CN-0007').closest('div')!.textContent).toContain('−$10');
    unmount();
    order = baseOrder({ status: 'failed', paidAt: null });
    wrap(<Invoice orderId="ord_1" site={site} />);
    expect(screen.getByText('FAILED')).toBeTruthy();
    expect(screen.getByText(/This payment failed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Email me a copy' })).toHaveProperty('disabled', true);
  });

  it('emails a copy through the API and says where it went, or why not', async () => {
    order = baseOrder({});
    wrap(<Invoice orderId="ord_1" site={site} />);
    expect(screen.getByText('PAID')).toBeTruthy();
    emailInvoice.mockImplementation((_id: string, o: { onSuccess: (r: { email: string }) => void }) =>
      o.onSuccess({ email: 'jordan@example.com' }),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Email me a copy' }));
    expect(emailInvoice).toHaveBeenCalledWith('ord_1', expect.anything());
    expect(toast).toHaveBeenLastCalledWith('Invoice sent to jordan@example.com');
    emailInvoice.mockImplementation((_id: string, o: { onError: (e: unknown) => void }) =>
      o.onError(new ApiError(429, 'Too Many Attempts.')),
    );
    await user.click(screen.getByRole('button', { name: 'Email me a copy' }));
    expect(toast).toHaveBeenLastCalledWith('You’ve asked for a few copies already. Try again in 10 minutes.');
  });
});

describe('billing', () => {
  const profile = (over: Partial<Profile>): Profile => ({
    name: 'Jordan Tate',
    email: 'jordan@example.com',
    bio: '',
    timezone: 'UTC',
    website: '',
    initials: 'JT',
    color: '#123',
    avatarUrl: null,
    timezones: [],
    card: { brand: 'visa', last4: '4242', expMonth: 4, expYear: 2028 },
    membership: null,
    preferences: { newLessons: true, communityReplies: true, liveReminders: true, certificateReminders: true },
    pendingEmail: null,
    ...over,
  });
  const membership = {
    planName: 'Pro',
    price: usd(4900),
    interval: 'month' as const,
    renewsAt: '2026-11-01T00:00:00Z',
    trialEndsAt: null,
    resumesAt: null,
    endsAt: null,
  };

  it('shows the saved card and an active membership, and opens the billing portal', async () => {
    portal.mockResolvedValue(null);
    wrap(<BillingSection profile={profile({ membership: { ...membership, status: 'active' } })} />);
    expect(screen.getByText('Card ending 4242')).toBeTruthy();
    expect(screen.getByText('Expires 04/28 · used for membership renewal')).toBeTruthy();
    expect(screen.getByText('Pro membership')).toBeTruthy();
    expect(screen.getByText(/^\$49 per month · renews Nov 1, 2026$/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Manage plan' }));
    expect(portal).toHaveBeenCalledWith('/account/billing');
    expect(screen.getByRole('link', { name: 'Order history →' }).getAttribute('href')).toBe('/account/orders');
  });

  it('asks a past-due member to update the card, and says when a cancelled plan ends', () => {
    const { unmount } = wrap(<BillingSection profile={profile({ membership: { ...membership, status: 'past_due' } })} />);
    expect(screen.getByRole('alert').textContent).toContain('Update your card to keep your access');
    expect(screen.getByRole('button', { name: 'Update card' })).toBeTruthy();
    unmount();
    wrap(
      <BillingSection
        profile={profile({
          card: null,
          membership: { ...membership, status: 'cancelled', renewsAt: null, endsAt: '2026-11-01T00:00:00Z' },
        })}
      />,
    );
    expect(screen.getByText('Cancelled · your access lasts until Nov 1, 2026')).toBeTruthy();
    expect(screen.getByText(/No payment details saved/)).toBeTruthy();
  });

  it('shows the portal’s message when nothing is on file', async () => {
    portal.mockResolvedValue({ error: 'You have no payment details on file at this school yet.' });
    wrap(<BillingSection profile={profile({})} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Update card' }));
    expect((await screen.findByRole('alert')).textContent).toBe('You have no payment details on file at this school yet.');
  });
});
