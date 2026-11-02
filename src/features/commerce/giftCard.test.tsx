// @vitest-environment jsdom
// Gift cards at checkout (docs/api/commerce.md → gift_card): its own field, a line after the total, `payToday` drives
// the payment step, and the order pages show the gift card's part.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { CheckoutView } from './components/CheckoutView';
import type { Quote, QuoteInput } from './types';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocalizedRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/features/auth/api', () => ({
  useSession: () => ({ user: { name: 'Jordan Tate', email: 'jordan@example.com' }, isSignedIn: true }),
}));
vi.mock('@/components/toast/Toaster', () => ({ useToast: () => vi.fn() }));

const usd = (amount: number) => ({ amount, currency: 'USD' });
const inputs: QuoteInput[] = [];

/** The API's quote for a $49 course: GIFT-TEST-0050 covers it, GIFT-HALF-0025 pays half, anything else is refused. */
function quoteFor(input: QuoteInput): Quote {
  const applied = input.giftCard === 'GIFT-TEST-0050' ? 4900 : input.giftCard === 'GIFT-HALF-0025' ? 2500 : 0;
  return {
    lines: [{ title: 'Funnels 101', cover: { url: null, color: '#123', alt: '' }, price: usd(4900), quantity: 1 }],
    subtotal: usd(4900),
    discount: usd(0),
    coupon: null,
    orderBump: null,
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
    total: usd(4900),
    dueToday: usd(4900),
    giftCard:
      input.giftCard === null
        ? null
        : applied > 0
          ? {
              code: `GIFT-••••-${input.giftCard.slice(-4)}`,
              valid: true,
              message: `Gift card applied: $${applied / 100}`,
              applied: usd(applied),
              remaining: usd(applied === 2500 ? 0 : 100),
            }
          : { code: input.giftCard, valid: false, message: 'This gift card isn’t valid.', applied: usd(0), remaining: null },
    payToday: usd(4900 - applied),
    installments: input.plan === 'installments' ? { count: 3, amount: usd(1700) } : null,
    fullAmount: usd(4900),
    installmentOption: { count: 3, amount: usd(1700) },
    recurring: null,
    payWhatYouWant: null,
    bnpl: { count: 4, amount: usd(1225) },
    countries: ['United States'],
    subdivisions: [],
    proof: null,
    enrolledCount: null,
    guaranteeDays: 30,
    payment: { provider: 'test', publishableKey: null, stripeAccount: null, methods: ['card'] },
  };
}

vi.mock('./api', () => ({
  commerceKeys: { order: (id: string) => ['commerce', 'order', id] },
  useCheckout: () => ({ mutateAsync: vi.fn() }),
  waitForPayment: vi.fn(),
  useQuote: (input: QuoteInput) => {
    inputs.push(input);
    return { data: quoteFor(input), isError: false, error: null, isPlaceholderData: false };
  },
}));

function renderCheckout() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <CheckoutView target={{ kind: 'course', courseSlug: 'funnels' }} initialPlan="full" initialCoupon={null} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function apply(code: string) {
  const user = userEvent.setup();
  if (screen.queryByRole('button', { name: 'Have a gift card?' }))
    await user.click(screen.getByRole('button', { name: 'Have a gift card?' }));
  const field = screen.getByLabelText('Gift card');
  await user.clear(field);
  await user.type(field, code);
  // The coupon's Apply comes first; the gift card's is its own.
  await user.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1)!);
  return user;
}

beforeEach(() => {
  inputs.length = 0;
});

describe('gift card at checkout', () => {
  it('sends the code only after Apply, and a covered order skips the payment step', async () => {
    renderCheckout();
    expect(screen.getByText('Test card')).toBeTruthy();
    expect(inputs.every((i) => i.giftCard === null)).toBe(true);

    await apply('GIFT-TEST-0050');
    expect(inputs.at(-1)!.giftCard).toBe('GIFT-TEST-0050');
    expect(screen.getByText('Gift card applied: $49')).toBeTruthy();
    const summary = screen.getByRole('complementary');
    expect(within(summary).getByText('Gift card (GIFT-••••-0050)')).toBeTruthy();
    expect(within(summary).getByText('To pay now')).toBeTruthy();
    // Fully covered: no payment fields, and the button says so.
    expect(screen.queryByText('Test card')).toBeNull();
    expect(screen.getByRole('button', { name: 'Complete order · paid by gift card' })).toBeTruthy();
  });

  it('charges the card the rest, and removes the gift card', async () => {
    renderCheckout();
    const user = await apply('GIFT-HALF-0025');
    expect(screen.getByText('Test card')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pay \$24/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(inputs.at(-1)!.giftCard).toBeNull();
    expect(screen.getByRole('button', { name: /Pay \$49/ })).toBeTruthy();
  });

  it('keeps a refused code on screen but drops it from the next quotes', async () => {
    renderCheckout();
    await apply('GIFT-NOPE-NOPE');
    expect(screen.getByText('This gift card isn’t valid.')).toBeTruthy();
    expect(inputs.at(-1)!.giftCard).toBeNull();
    expect(screen.getByText('This gift card isn’t valid.')).toBeTruthy();
  });

  it('hides the field on a payment plan', async () => {
    renderCheckout();
    await userEvent.click(screen.getByText(/Payment plan/));
    expect(screen.getByText('Gift cards can’t be used with payment plans.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Have a gift card?' })).toBeNull();
    expect(inputs.at(-1)!.giftCard).toBeNull();
  });
});
