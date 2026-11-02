// @vitest-environment jsdom
// Tax at checkout and on the invoice (docs/api/commerce.md → tax): the site sends the state and VAT number and prints
// the API's verdict — added, included or reverse-charged — never working anything out itself.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { ApiError } from '@/lib/api/errors';
import { CheckoutView } from './components/CheckoutView';
import { Invoice } from './components/OrderViews';
import type { Order, Quote, QuoteInput, TaxDetails } from './types';

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
vi.mock('@/components/layout/BrandMark', () => ({ BrandMark: () => null }));

const usd = (amount: number) => ({ amount, currency: 'USD' });
const inputs: QuoteInput[] = [];
const checkout = vi.fn();
let order: Order;

const details = (over: Partial<TaxDetails> = {}): TaxDetails => ({
  inclusive: false,
  rate: null,
  reverseCharge: false,
  region: null,
  provider: null,
  note: null,
  acceptsTaxId: false,
  regionRequired: false,
  taxId: null,
  ...over,
});

const NOTE = 'VAT reverse charge: the customer accounts for VAT (Article 196, Council Directive 2006/112/EC).';

/** The API's answer for a $100 course: UK VAT added, Australian GST included, EU VAT (reverse charge), US states. */
function quoteFor(input: QuoteInput): Quote {
  let tax = 0;
  let taxLabel: string | null = null;
  let taxDetails = details();
  let total = 10000;
  if (input.country === 'United Kingdom') {
    tax = 2000;
    taxLabel = 'VAT (20%)';
    total = 12000;
    taxDetails = details({ rate: 20, region: 'United Kingdom', provider: 'builtin' });
  } else if (input.country === 'Australia') {
    tax = 909;
    taxLabel = 'GST (10%)';
    taxDetails = details({ inclusive: true, rate: 10, region: 'Australia', provider: 'builtin' });
  } else if (input.country === 'Germany') {
    const id = input.taxId ?? '';
    const valid = id !== '' && !id.endsWith('000');
    tax = valid ? 0 : 1900;
    taxLabel = valid ? 'Reverse charge' : 'VAT (19%)';
    total = 10000 + tax;
    taxDetails = details({
      rate: 19,
      region: 'European Union (OSS)',
      provider: 'builtin',
      acceptsTaxId: true,
      reverseCharge: valid,
      note: valid ? NOTE : null,
      taxId: id
        ? valid
          ? { status: 'valid', message: null }
          : { status: 'invalid', message: 'This VAT number isn’t registered in VIES.' }
        : null,
    });
  } else if (input.country === 'United States') {
    const ca = input.region === 'CA';
    tax = ca ? 725 : 0;
    taxLabel = ca ? 'Sales tax (7.25%)' : null;
    total = 10000 + tax;
    taxDetails = details(
      ca ? { rate: 7.25, region: 'United States — California', provider: 'builtin' } : { regionRequired: !input.region },
    );
  }
  return {
    lines: [{ title: 'Funnels 101', cover: { url: null, color: '#123', alt: '' }, price: usd(10000), quantity: 1 }],
    subtotal: usd(10000),
    discount: usd(0),
    coupon: null,
    orderBump: null,
    tax: usd(tax),
    taxLabel,
    taxDetails,
    total: usd(total),
    dueToday: usd(total),
    giftCard: null,
    payToday: usd(total),
    installments: null,
    fullAmount: usd(10000),
    installmentOption: null,
    recurring: null,
    payWhatYouWant: null,
    bnpl: { count: 4, amount: usd(Math.round(total / 4)) },
    countries: ['United States', 'United Kingdom', 'Germany', 'Australia'],
    subdivisions: [
      { country: 'United States', code: 'CA', name: 'California' },
      { country: 'United States', code: 'NY', name: 'New York' },
      { country: 'Canada', code: 'ON', name: 'Ontario' },
    ],
    proof: null,
    enrolledCount: null,
    guaranteeDays: 30,
    payment: { provider: 'test', publishableKey: null, stripeAccount: null, methods: ['card'] },
  };
}

vi.mock('./api', () => ({
  commerceKeys: { order: (id: string) => ['commerce', 'order', id] },
  useCheckout: () => ({ mutateAsync: checkout }),
  waitForPayment: vi.fn(),
  useQuote: (input: QuoteInput) => {
    inputs.push(input);
    return { data: quoteFor(input), isError: false, error: null, isPlaceholderData: false };
  },
  useOrder: () => ({ data: order, isPending: false, isError: false, refetch: vi.fn() }),
  useEmailInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

function wrap(ui: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const renderCheckout = () =>
  wrap(<CheckoutView target={{ kind: 'course', courseSlug: 'funnels' }} initialPlan="full" initialCoupon={null} />);

async function chooseCountry(country: string) {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Billing country'), country);
  return user;
}

const summary = () => within(screen.getByRole('complementary'));

beforeEach(() => {
  inputs.length = 0;
  checkout.mockReset();
});

describe('tax at checkout', () => {
  it('prints added tax as its own line, included tax as "Includes …" without adding it', async () => {
    renderCheckout();
    await chooseCountry('United Kingdom');
    expect(summary().getByText('VAT (20%)')).toBeTruthy();
    expect(summary().getByText('$20')).toBeTruthy();
    expect(summary().getByText('$120')).toBeTruthy();

    await chooseCountry('Australia');
    expect(summary().getByText('Includes GST (10%)')).toBeTruthy();
    expect(summary().getByText('$9.09')).toBeTruthy();
    // The total is the API's (prices already include it).
    expect(within(summary().getByText('Total').closest('div')!).getByText('$100')).toBeTruthy();
  });

  it('asks for the state where the API needs it, and sends it to the quote and the checkout', async () => {
    renderCheckout();
    // No state list for a country without subdivisions.
    await chooseCountry('United Kingdom');
    expect(screen.queryByLabelText('State or province')).toBeNull();
    const user = await chooseCountry('United States');
    const state = screen.getByLabelText('State or province');
    expect(state.getAttribute('aria-required')).toBe('true');
    expect(within(state).queryByText('Ontario')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await user.click(screen.getByRole('button', { name: /^Pay/ }));
    expect(checkout).not.toHaveBeenCalled();
    expect(screen.getAllByText('Choose your state or province.').length).toBeGreaterThan(0);
    expect(state.getAttribute('aria-invalid')).toBe('true');

    await user.selectOptions(state, 'CA');
    expect(inputs.at(-1)).toMatchObject({ country: 'United States', region: 'CA' });
    expect(summary().getByText('Sales tax (7.25%)')).toBeTruthy();
    expect(summary().getByText('$7.25')).toBeTruthy();
  });

  it('shows a 422 on the state from the checkout on the field', async () => {
    checkout.mockRejectedValue(
      new ApiError(422, 'The given data was invalid.', { region: 'Choose a state or province from the list.' }, 'validation_failed'),
    );
    renderCheckout();
    const user = await chooseCountry('United States');
    await user.selectOptions(screen.getByLabelText('State or province'), 'NY');
    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await user.click(screen.getByRole('button', { name: /^Pay/ }));
    await waitFor(() => expect(checkout).toHaveBeenCalled());
    expect(checkout.mock.calls[0]![0]).toMatchObject({ region: 'NY', taxId: null });
    expect(screen.getAllByText('Choose a state or province from the list.').length).toBeGreaterThan(0);
  });

  it('offers the VAT number field when the API accepts one, and shows its check (reverse charge when verified)', async () => {
    renderCheckout();
    expect(screen.queryByLabelText('VAT number (optional)')).toBeNull();
    const user = await chooseCountry('Germany');
    const field = screen.getByLabelText('VAT number (optional)');
    expect(summary().getByText('VAT (19%)')).toBeTruthy();

    await user.type(field, 'DE123456000');
    expect(await screen.findByText('This VAT number isn’t registered in VIES.')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(summary().getByText('VAT (19%)')).toBeTruthy();

    await user.clear(field);
    await user.type(field, 'DE123456789');
    expect(await screen.findByText('VAT number verified — reverse charge applies')).toBeTruthy();
    expect(inputs.at(-1)).toMatchObject({ country: 'Germany', taxId: 'DE123456789' });
    expect(summary().getByText('Reverse charge')).toBeTruthy();
    expect(summary().getByText('$0')).toBeTruthy();
    expect(summary().getByText(NOTE)).toBeTruthy();

    // Another country clears it.
    await chooseCountry('United Kingdom');
    expect(screen.queryByLabelText('VAT number (optional)')).toBeNull();
    await waitFor(() => expect(inputs.at(-1)).toMatchObject({ country: 'United Kingdom', taxId: null }));
  });
});

const baseOrder = (over: Partial<Order> = {}): Order => ({
  id: 'ord_1',
  number: 'AMP-2026-1001',
  invoiceNumber: 'INV-0001',
  createdAt: '2026-02-04T12:00:00Z',
  status: 'paid',
  paidAt: '2026-02-04T12:00:00Z',
  items: [
    {
      kind: 'course',
      title: 'The Funnel Blueprint',
      meta: 'Lifetime access',
      cover: { url: null, color: '#123', alt: '' },
      unitPrice: usd(10000),
      quantity: 1,
      tax: usd(2000),
      courseSlug: 'funnel',
      refId: 'crs_funnel',
      liveSessionId: null,
    },
  ],
  subtotal: usd(10000),
  discount: usd(0),
  couponCode: null,
  orderBump: null,
  tax: usd(2000),
  taxLabel: 'VAT (20%)',
  taxDetails: { inclusive: false, rate: 20, reverseCharge: false, note: null },
  total: usd(12000),
  dueToday: usd(12000),
  installments: null,
  refunded: usd(0),
  creditNotes: [],
  paymentMethod: 'Visa ··4242',
  giftCard: null,
  paidByCard: usd(12000),
  gift: null,
  seats: null,
  billing: { name: 'Jordan Tate', email: 'jordan@example.com', country: 'United Kingdom', region: null, taxId: null },
  seller: { name: 'Amplify', legalName: null, email: 'help@amplify.test', address: null, taxId: 'GB123456789' },
  startLesson: null,
  ...over,
});

const site = { name: 'Amplify', logoUrl: null, primaryHost: 'amplify.example.com' };

describe('tax on the invoice', () => {
  it('shows the invoice number with the order number, a tax column and the added tax', () => {
    order = baseOrder();
    wrap(<Invoice orderId="ord_1" site={site} />);
    const paper = screen.getByRole('article', { name: 'Invoice INV-0001' });
    expect(within(paper).getByText('INV-0001')).toBeTruthy();
    expect(within(paper).getByText('Order #AMP-2026-1001')).toBeTruthy();
    expect(within(paper).getByRole('columnheader', { name: 'Tax' })).toBeTruthy();
    expect(within(paper).getByRole('cell', { name: '$20' })).toBeTruthy();
    expect(within(paper).getByText('VAT (20%)')).toBeTruthy();
    expect(within(paper).getByText('Tax ID: GB123456789', { exact: false })).toBeTruthy();
  });

  it('prints included tax as "Includes …", no tax column without tax, and the order number before an invoice exists', () => {
    order = baseOrder({
      invoiceNumber: null,
      tax: usd(909),
      taxLabel: 'GST (10%)',
      taxDetails: { inclusive: true, rate: 10, reverseCharge: false, note: null },
      items: [{ ...baseOrder().items[0]!, tax: usd(0) }],
    });
    wrap(<Invoice orderId="ord_1" site={site} />);
    const paper = screen.getByRole('article', { name: 'Invoice AMP-2026-1001' });
    expect(within(paper).getByText('#AMP-2026-1001')).toBeTruthy();
    expect(within(paper).queryByRole('columnheader', { name: 'Tax' })).toBeNull();
    expect(within(paper).getByText('Includes GST (10%)')).toBeTruthy();
    expect(within(paper).getByText('$9.09')).toBeTruthy();
  });

  it('shows the reverse charge, its note, and the buyer’s VAT number and state', () => {
    order = baseOrder({
      tax: usd(0),
      taxLabel: 'Reverse charge',
      taxDetails: { inclusive: false, rate: 19, reverseCharge: true, note: NOTE },
      items: [{ ...baseOrder().items[0]!, tax: usd(0) }],
      billing: { name: 'Jordan Tate', email: 'jordan@example.com', country: 'Germany', region: null, taxId: 'DE123456789' },
      seller: { name: 'Amplify', legalName: null, email: 'help@amplify.test', address: null, taxId: 'EU372000041' },
    });
    const { unmount } = wrap(<Invoice orderId="ord_1" site={site} />);
    let paper = screen.getByRole('article');
    expect(within(paper).getByText('Reverse charge')).toBeTruthy();
    expect(within(paper).getByText(NOTE)).toBeTruthy();
    expect(within(paper).getByText('VAT number: DE123456789')).toBeTruthy();
    expect(within(paper).getByText('Tax ID: EU372000041', { exact: false })).toBeTruthy();
    unmount();

    order = baseOrder({
      billing: { name: 'Jordan Tate', email: 'jordan@example.com', country: 'United States', region: 'CA', taxId: null },
    });
    wrap(<Invoice orderId="ord_1" site={site} />);
    paper = screen.getByRole('article');
    expect(within(paper).getByText('CA, United States')).toBeTruthy();
  });
});
