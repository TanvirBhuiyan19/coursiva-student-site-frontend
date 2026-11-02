/**
 * Payment-provider boundary. Card data never touches our servers, our React state or our logs (PCI SAQ-A).
 *
 * The quote says how to collect payment details (`Quote.payment`, Laravel's PaymentSetup):
 * - `stripe`: Stripe's Payment Element (an iframe from js.stripe.com) mounted on the school's connected account
 *   (`stripeAccount`, direct charges). On submit the Element creates a ConfirmationToken (`ctoken_…`), which goes
 *   to `POST /checkout` as `payment_token`; the API confirms the PaymentIntent server-side and, when the bank wants
 *   3-D Secure, answers `next_action.client_secret`, which `stripe.handleNextAction` completes in the browser.
 *   Wallets (Apple Pay, Google Pay) and Link appear inside the Element; PayPal and pay-later stay hidden because the
 *   API confirms without redirects.
 * - `test`: Laravel's fake gateway and the mock API. A test-card picker (a stand-in for the Element) sends Stripe's
 *   well-known test tokens; no card fields exist at all.
 *
 * Components: `components/PaymentFields.tsx` renders either one and exposes a `PaymentHandle` to the checkout.
 */
import type { PaymentMethod, Quote } from './types';

/** `Quote.payment`. */
export interface PaymentSetup {
  provider: 'stripe' | 'test';
  /** The platform's publishable key; null until Stripe is connected. */
  publishableKey: string | null;
  /** The school's connected account (Stripe-Account); null until the school finished onboarding. */
  stripeAccount: string | null;
  /** Methods the school's gateway can take on this site (always includes `card`). */
  methods: PaymentMethod[];
}

/** What the checkout asks of the payment fields. */
export interface PaymentHandle {
  /** Validates the fields and returns the token for `payment_token`, or a message to show. */
  collect: (billing: { name: string; email: string }) => Promise<{ token: string } | { error: string }>;
  /** Runs the bank's challenge (3-D Secure) for `next_action.client_secret`. */
  authenticate: (clientSecret: string) => Promise<{ ok: true } | { error: string }>;
}

/** Options for Stripe Elements in deferred-intent mode; they must match what the API confirms (amount, saving). */
export interface ElementsAmount {
  mode: 'payment' | 'setup';
  amount: number;
  currency: string;
  /**
   * The card is kept for later charges — instalments, subscriptions, the one-click offer after payment (`Quote.saveCard`;
   * the API sets `setup_future_usage`).
   */
  saveCard: boolean;
}

/** Stripe's test tokens, as the fake gateway and the mock API understand them. */
export const TEST_CARDS = [
  { token: 'tok_visa', key: 'visa' },
  { token: 'tok_threeDSecure', key: 'threeDSecure' },
  { token: 'tok_chargeDeclined', key: 'declined' },
] as const;
export type TestCardKey = (typeof TEST_CARDS)[number]['key'];

/**
 * Whether the learner has to enter payment details: free orders and orders a gift card fully covers skip it, but a
 * subscription (a membership or a subscription course: `quote.recurring`), trial or covered, still saves a card for
 * its renewals.
 */
export function needsPayment(quote: Pick<Quote, 'payToday' | 'recurring'>): boolean {
  return quote.payToday.amount > 0 || quote.recurring !== null;
}

/**
 * Elements options for this quote: the card is charged `payToday` (what is due less the gift card's part); a
 * zero-amount subscription (a trial, or covered by a gift card) only saves the card (a SetupIntent).
 */
export function elementsAmount(quote: Pick<Quote, 'payToday' | 'installments' | 'recurring' | 'saveCard'>): ElementsAmount {
  // The API says when the card is kept (instalments, subscriptions, a one-click offer after payment); older APIs don't.
  const saveCard = quote.saveCard ?? (quote.recurring !== null || quote.installments !== null);
  return {
    mode: quote.payToday.amount === 0 ? 'setup' : 'payment',
    amount: quote.payToday.amount,
    currency: quote.payToday.currency.toLowerCase(),
    saveCard,
  };
}

/** Methods offered on the page: the gateway's list, `card` always first. */
export const offeredMethods = (setup: PaymentSetup | undefined): PaymentMethod[] => {
  const list = setup?.methods ?? ['card'];
  return ['card', ...list.filter((m) => m !== 'card')];
};
