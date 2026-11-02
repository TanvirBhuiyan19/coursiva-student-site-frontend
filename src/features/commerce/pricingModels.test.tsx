// @vitest-environment jsdom
// Course pricing models at checkout (docs/api/commerce.md → Pricing models): a subscription course says it renews and
// saves the card; a pay-what-you-want course takes the learner's amount and the API's minimum message blocks paying.
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

/** The API's quotes: `monthly` is a $35/month subscription course; `pwyw` takes any amount from $10 (suggested $25). */
function quoteFor(input: QuoteInput): Quote {
  const slug = input.target.kind === 'course' ? input.target.courseSlug : '';
  const pwyw = slug === 'pwyw';
  const amount = pwyw ? (input.amount ?? 2500) : 3500;
  const charged = Math.max(amount, 1000);
  return {
    lines: [
      {
        title: pwyw ? 'Name Your Price' : 'Monthly Mastery',
        cover: { url: null, color: '#ccc', alt: '' },
        price: usd(charged),
        quantity: 1,
      },
    ],
    subtotal: usd(charged),
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
    total: usd(charged),
    dueToday: usd(charged),
    giftCard: null,
    payToday: usd(charged),
    installments: null,
    fullAmount: usd(charged),
    installmentOption: null,
    recurring: pwyw ? null : { interval: 'month', amount: usd(3500), trialDays: 0 },
    payWhatYouWant: pwyw
      ? { minimum: usd(1000), suggested: usd(2500), amount: usd(amount), message: amount < 1000 ? 'Pay at least $10.' : null }
      : null,
    bnpl: { count: 4, amount: usd(Math.ceil(charged / 4)) },
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

function renderCheckout(courseSlug: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <CheckoutView target={{ kind: 'course', courseSlug }} initialPlan="full" initialCoupon={null} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  inputs.length = 0;
});

describe('course pricing models at checkout', () => {
  it('a subscription course says what renews, subscribes, and is never a gift or team seats', () => {
    renderCheckout('monthly');
    expect(screen.getByText('Renews at $35 every month until cancelled.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Subscribe · $35 today' })).toBeTruthy();
    const summary = screen.getByRole('complementary');
    expect(within(summary).getByText('Due today')).toBeTruthy();
    expect(within(summary).getByText('Then every month')).toBeTruthy();
    expect(screen.queryByText('Buy as a gift')).toBeNull();
    expect(screen.queryByLabelText(/seats/i)).toBeNull();
    // The card is collected even when nothing is due today (it pays the renewals).
    expect(screen.getByText('Test card')).toBeTruthy();
  });

  it('a pay-what-you-want course sends the learner’s amount and blocks paying under the minimum', async () => {
    renderCheckout('pwyw');
    const user = userEvent.setup();
    const field = screen.getByLabelText<HTMLInputElement>('Name your price');
    // Untouched: the suggested price, and no amount sent (the API uses its suggestion).
    expect(field.value).toBe('25');
    expect(inputs.at(-1)!.amount).toBeUndefined();
    expect(screen.getByText('Pay what you want — at least $10 (suggested $25).')).toBeTruthy();

    await user.clear(field);
    await user.type(field, '5');
    expect(inputs.at(-1)!.amount).toBe(500);
    expect(screen.getByText('Pay at least $10.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Pay \$10/ }).disabled).toBe(true);

    await user.clear(field);
    await user.type(field, '12.50');
    expect(inputs.at(-1)!.amount).toBe(1250);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pay $12.50' }).disabled).toBe(false);

    // Something that isn't an amount is never sent.
    await user.clear(field);
    await user.type(field, 'abc');
    expect(screen.getByText('Enter an amount, like 25 or 25.50.')).toBeTruthy();
    expect(inputs.at(-1)!.amount).toBeUndefined();
  });
});
