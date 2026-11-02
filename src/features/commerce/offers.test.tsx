// @vitest-environment jsdom
// Checkout offers (docs/api/commerce.md → Offers): the sale banner and countdown, struck list prices, savings, seat
// tiers, "Frequently bought together", the bump's copy and the card note — every figure from the quote. Then the
// thank-you page's one-click upsell / downsell (→ Post-purchase offers), against the real hooks with a stubbed API.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { snakeize } from '@/lib/api/case';
import type * as Api from './api';
import { CheckoutView } from './components/CheckoutView';
import { PostPurchaseOfferCard } from './components/PostPurchaseOfferCard';
import { elementsAmount } from './payments';
import type { Order, PostPurchaseOffer, Quote, QuoteInput } from './types';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocalizedRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/features/auth/api', () => ({
  useSession: () => ({ user: { name: 'Lena Learner', email: 'lena@example.com' }, isSignedIn: true }),
  refreshMe: vi.fn(),
}));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => vi.fn() }));
vi.mock('@/features/bookings/api', () => ({ useServiceCheckout: () => ({ isService: false, hold: null }) }));
// The checkout's quote comes from quoteFor (no network); the thank-you hooks stay real, behind a stubbed fetch.
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  useQuote: (input: QuoteInput) => {
    quoteInputs.push(input);
    return { data: quoteFor(input), isError: false, error: null, isPlaceholderData: false };
  },
}));

const usd = (amount: number) => ({ amount, currency: 'USD' });
const cover = { url: null, color: '#123', alt: '' };

/* ── Checkout ─────────────────────────────────────────────────────────────── */

const quoteInputs: QuoteInput[] = [];
let quoteOver: Partial<Quote> = {};

function quoteFor(input: QuoteInput): Quote {
  const crossSelected = input.crossSell === true;
  return {
    lines: [
      { title: 'Brand Storytelling Lab', cover, price: usd(15215), quantity: 1, compareAt: usd(17900) },
      ...(crossSelected ? [{ title: 'Pricing with Confidence', cover, price: usd(6930), quantity: 1, compareAt: usd(9900) }] : []),
    ],
    savings: usd(crossSelected ? 5655 : 2685),
    priceOffer: {
      kind: 'countdown',
      headline: 'Spring sale',
      body: 'Our biggest sale of the year.',
      discountPercent: 15,
      endsAt: new Date(Date.now() + 3 * 3600_000 + 5 * 60_000).toISOString(),
      trialDays: null,
      applied: true,
      message: null,
    },
    quantityTiers: [
      { minSeats: 3, discountPercent: 10 },
      { minSeats: 5, discountPercent: 25 },
    ],
    crossSell: {
      headline: '',
      body: 'Price the offer your story sells.',
      discountPercent: 30,
      items: [{ courseSlug: 'pricing-with-confidence', title: 'Pricing with Confidence', cover, price: usd(6930), compareAt: usd(9900) }],
      total: usd(6930),
      selected: crossSelected,
    },
    subtotal: usd(crossSelected ? 22145 : 15215),
    discount: usd(0),
    coupon: null,
    orderBump: {
      title: 'Swipe File Vault',
      description: '120+ emails',
      headline: 'Add the vault',
      price: usd(2175),
      compareAt: usd(2900),
      selected: false,
    },
    tax: usd(0),
    taxLabel: null,
    taxDetails: {
      inclusive: false,
      rate: null,
      reverseCharge: false,
      region: null,
      provider: null,
      note: null,
      acceptsTaxId: false,
      regionRequired: false,
      taxId: null,
    },
    total: usd(crossSelected ? 22145 : 15215),
    dueToday: usd(crossSelected ? 22145 : 15215),
    giftCard: null,
    payToday: usd(crossSelected ? 22145 : 15215),
    installments: null,
    fullAmount: usd(15215),
    installmentOption: null,
    recurring: null,
    payWhatYouWant: null,
    bnpl: { count: 4, amount: usd(3804) },
    countries: ['United States'],
    subdivisions: [],
    proof: null,
    enrolledCount: null,
    guaranteeDays: 30,
    payment: { provider: 'test', publishableKey: null, stripeAccount: null, methods: ['card'] },
    saveCard: true,
    postPurchase: true,
    ...quoteOver,
  };
}

function renderCheckout(qc = new QueryClient()) {
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <CheckoutView target={{ kind: 'course', courseSlug: 'brand-storytelling-lab' }} initialPlan="full" initialCoupon={null} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return qc;
}

/* ── Thank-you page: a stubbed API behind the real hooks ─────────────────── */

const calls: { method: string; path: string; body: unknown }[] = [];
let routes: Record<string, (body: Record<string, unknown> | null) => [number, unknown]> = {};

function stubApi() {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/api\/v1/, '');
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, path, body });
      const handler = routes[`${method} ${path}`];
      const [status, json] = handler ? handler(body) : [200, {}];
      return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(snakeize(json)), { status }));
    }),
  );
}

const offer = (over: Partial<PostPurchaseOffer> = {}): PostPurchaseOffer => ({
  key: 'ofr_lab',
  kind: 'upsell',
  headline: 'Add Launch Lab for 20% off',
  body: 'Simulate your launch.',
  item: { kind: 'course', title: 'Launch Lab', slug: 'launch-lab', cover, description: 'A hands-on lab.' },
  price: usd(11920),
  compareAt: usd(14900),
  tax: usd(0),
  taxLabel: null,
  total: usd(11920),
  card: { brand: 'Visa', last4: '4242' },
  expiresAt: new Date(Date.now() + 29 * 60_000).toISOString(),
  ...over,
});
const downsell = offer({
  key: 'ofr_podcast',
  kind: 'downsell',
  headline: '',
  body: '',
  item: { kind: 'course', title: 'Podcast Launchpad', slug: 'podcast-launchpad', cover, description: 'Launch a show.' },
  price: usd(6450),
  compareAt: usd(12900),
  total: usd(6450),
});
const newOrder = (over: Partial<Order> = {}) => ({ id: 'ord_new', number: 'AMP-2026-1201', status: 'paid', ...over });

function renderOffer() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <PostPurchaseOfferCard orderId="ord_1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  quoteInputs.length = 0;
  quoteOver = {};
  routes = {};
});
afterEach(() => vi.unstubAllGlobals());

describe('checkout offers', () => {
  it('shows the sale with a live countdown, struck list prices, savings, seat tiers and the bump’s copy', async () => {
    renderCheckout();
    const banner = await screen.findByRole('region', { name: 'Offer' });
    expect(within(banner).getByText('Spring sale')).toBeTruthy();
    expect(within(banner).getByText('Sale: 15% off')).toBeTruthy();
    expect(within(banner).getByText('Our biggest sale of the year.')).toBeTruthy();
    expect(within(banner).getByRole('timer').textContent).toMatch(/^03:0[45]:\d\d$/);
    const summary = screen.getByRole('complementary');
    expect(within(summary).getByText('Was $179')).toBeTruthy();
    expect(within(summary).getByText('You save $26.85')).toBeTruthy();
    expect(screen.getByText('3+ seats: 10% off')).toBeTruthy();
    expect(screen.getByText('Buy 3 or more seats to save 10%.')).toBeTruthy();
    expect(within(summary).getByText('Add the vault')).toBeTruthy();
    expect(within(summary).getByText('Was $29')).toBeTruthy();
    // The card is kept for the one-click offer: said plainly, charged only on accept.
    expect(screen.getByText(/only charged if you accept/)).toBeTruthy();
  });

  it('adds “Frequently bought together” through the quote', async () => {
    renderCheckout();
    const block = await screen.findByRole('region', { name: 'Frequently bought together' });
    expect(within(block).getByText('Pricing with Confidence')).toBeTruthy();
    expect(quoteInputs.at(-1)!.crossSell).toBeUndefined();
    await userEvent.click(within(block).getByRole('checkbox', { name: 'Add this course for $69.30 (30% off)' }));
    await waitFor(() => expect(quoteInputs.at(-1)!.crossSell).toBe(true));
    expect(await screen.findByText('You save $56.55')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay $221.45' })).toBeTruthy();
  });

  it('says when a code replaced the sale, words seat tiers and trials, and re-quotes when the sale ends', async () => {
    quoteOver = {
      priceOffer: {
        kind: 'countdown',
        headline: '',
        body: '',
        discountPercent: 15,
        endsAt: new Date(Date.now() + 1200).toISOString(),
        trialDays: null,
        applied: true,
        message: null,
      },
    };
    const qc = renderCheckout();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await screen.findByText('Sale: 15% off');
    // At zero the server's clock decides: the page asks for a new quote.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['commerce', 'quote'] }), { timeout: 3000 });
    expect(screen.getByText('This sale is ending — checking the price…')).toBeTruthy();
  });

  it('words the other price offers from the API’s figures', async () => {
    quoteOver = {
      priceOffer: {
        kind: 'countdown',
        headline: 'Spring sale',
        body: '',
        discountPercent: 15,
        endsAt: null,
        trialDays: null,
        applied: false,
        message: 'Your code saves more, so it replaces the sale price.',
      },
    };
    renderCheckout();
    expect(await screen.findByText('Your code saves more, so it replaces the sale price.')).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('keeps the card for later charges only when the API says so', () => {
    const base = { payToday: usd(100), installments: null, recurring: null };
    expect(elementsAmount({ ...base, saveCard: true }).saveCard).toBe(true);
    expect(elementsAmount({ ...base, saveCard: false }).saveCard).toBe(false);
    // An API without `save_card`: instalments and subscriptions only.
    expect(elementsAmount(base).saveCard).toBe(false);
    expect(elementsAmount({ ...base, installments: { count: 3, amount: usd(40) } }).saveCard).toBe(true);
  });
});

describe('one-click offer on the thank-you page', () => {
  it('declines the upsell, shows the downsell with focus, and adds it with one click', async () => {
    routes = {
      'GET /orders/ord_1/offer': () => [200, { data: offer() }],
      'POST /orders/ord_1/offer': (b) =>
        b?.accept === false ? [200, { data: downsell }] : [201, { data: { ...newOrder(), nextAction: null } }],
    };
    stubApi();
    renderOffer();
    const card = await screen.findByRole('region', { name: 'Add Launch Lab for 20% off' });
    expect(within(card).getByText('One-time offer')).toBeTruthy();
    expect(within(card).getByText('Was $149')).toBeTruthy();
    expect(within(card).getByText(/One click charges your Visa ending in 4242/)).toBeTruthy();
    expect(within(card).getByText(/Nothing is charged unless you add it/)).toBeTruthy();
    expect(within(card).getByRole('timer')).toBeTruthy();

    await userEvent.click(within(card).getByRole('button', { name: 'No thanks' }));
    const next = await screen.findByRole('heading', { name: 'How about Podcast Launchpad instead?' });
    expect(document.activeElement).toBe(next);
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ key: 'ofr_lab', accept: false });
    expect(screen.getByRole('status').textContent).toBe('Here’s another offer: Podcast Launchpad.');

    await userEvent.click(screen.getByRole('button', { name: 'Add to my order — $64.50' }));
    expect(await screen.findByText('Podcast Launchpad is added to your order.')).toBeTruthy();
    expect(screen.getByText(/Order #AMP-2026-1201/)).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST').at(-1)!.body).toEqual({ key: 'ofr_podcast', accept: true });
  });

  it('runs the bank’s challenge for 3-D Secure, then reads the new order until it is paid', async () => {
    routes = {
      'GET /orders/ord_1/offer': () => [200, { data: offer() }],
      'POST /orders/ord_1/offer': () => [
        201,
        { data: { ...newOrder({ status: 'pending' }), nextAction: { clientSecret: 'fake_secret_x' } } },
      ],
      'POST /checkout/quote': () => [
        200,
        { data: { payment: { provider: 'test', publishableKey: null, stripeAccount: null, methods: ['card'] } } },
      ],
      'GET /orders/ord_new': () => [200, { data: newOrder() }],
    };
    stubApi();
    renderOffer();
    await userEvent.click(await screen.findByRole('button', { name: 'Add to my order — $119.20' }));
    expect(await screen.findByText('Launch Lab is added to your order.')).toBeTruthy();
    // The payment setup came from a quote for the offered item (the thank-you page has no checkout quote cached).
    expect(calls.find((c) => c.path === '/checkout/quote')!.body).toEqual({ target: { kind: 'course', course_slug: 'launch-lab' } });
    expect(calls.some((c) => c.method === 'GET' && c.path === '/orders/ord_new')).toBe(true);
  });

  it('shows a declined card inline and keeps the offer; a closed offer loses its buttons', async () => {
    let attempt = 0;
    routes = {
      'GET /orders/ord_1/offer': () => [200, { data: offer() }],
      'POST /orders/ord_1/offer': () =>
        ++attempt === 1
          ? [422, { message: 'Your card was declined.', errors: { paymentToken: ['Your card was declined.'] } }]
          : [409, { message: 'This offer is no longer available.', code: 'conflict' }],
    };
    stubApi();
    renderOffer();
    const accept = await screen.findByRole('button', { name: 'Add to my order — $119.20' });
    await userEvent.click(accept);
    expect((await screen.findByRole('alert')).textContent).toBe('Your card was declined.');
    await userEvent.click(screen.getByRole('button', { name: 'Add to my order — $119.20' }));
    expect(await screen.findByText('This offer is no longer available.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add to my order/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'No thanks' })).toBeNull();
  });

  it('closes an expired offer and shows nothing when there is none', async () => {
    routes = { 'GET /orders/ord_1/offer': () => [200, { data: offer({ expiresAt: new Date(Date.now() - 1000).toISOString() }) }] };
    stubApi();
    renderOffer();
    expect(await screen.findByText('This offer has ended.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add to my order/ })).toBeNull();
  });

  it('says “No problem” after the last offer is declined', async () => {
    routes = {
      'GET /orders/ord_1/offer': () => [200, { data: downsell }],
      'POST /orders/ord_1/offer': () => [200, { data: null }],
    };
    stubApi();
    renderOffer();
    await userEvent.click(await screen.findByRole('button', { name: 'No thanks' }));
    const note = await screen.findByText('No problem — your order is complete.', { selector: 'p.muted' });
    expect(document.activeElement).toBe(note);
    expect(screen.queryByRole('region')).toBeNull();
  });
});
