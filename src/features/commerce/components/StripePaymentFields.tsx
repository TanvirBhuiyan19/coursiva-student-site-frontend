'use client';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Appearance, type Stripe, type StripeElementsOptionsMode } from '@stripe/stripe-js';
import { useTranslations } from 'next-intl';
import { useImperativeHandle, type Ref } from 'react';
import type { ElementsAmount, PaymentHandle } from '../payments';

/** One Stripe.js instance per publishable key + connected account (loadStripe must not run on every render). */
const instances = new Map<string, Promise<Stripe | null>>();
function stripeFor(publishableKey: string, stripeAccount: string) {
  const key = `${publishableKey}|${stripeAccount}`;
  let p = instances.get(key);
  if (!p) instances.set(key, (p = loadStripe(publishableKey, { stripeAccount })));
  return p;
}

/**
 * The bank's challenge (3-D Secure) outside the checkout form — the thank-you page's one-click offer: the same
 * `stripe.handleNextAction` the Element's handle runs, on the school's connected account. `null` error = completed.
 */
export async function handleNextAction(
  publishableKey: string,
  stripeAccount: string,
  clientSecret: string,
): Promise<{ error: string | null }> {
  const stripe = await stripeFor(publishableKey, stripeAccount);
  if (!stripe) return { error: '' };
  const { error } = await stripe.handleNextAction({ clientSecret });
  return { error: error ? (error.message ?? '') : null };
}

/** The Element in the school's colours: read the brand tokens the root layout injected. */
function appearance(): Appearance {
  const css = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement);
  const v = (name: string) => css?.getPropertyValue(name).trim() || undefined;
  return {
    theme: 'stripe',
    variables: { colorPrimary: v('--brand'), colorText: v('--tx'), colorDanger: v('--bad-fg'), borderRadius: '10px' },
  };
}

/**
 * Stripe's Payment Element in deferred-intent mode (the PaymentIntent is created and confirmed by the API). Only
 * card-based methods are offered — Apple Pay / Google Pay / Link included — because the API confirms without
 * redirects. The amount and card saving must match what the API charges: the quote is the single source.
 */
export function StripePaymentFields({
  publishableKey,
  stripeAccount,
  amount,
  ref,
}: {
  publishableKey: string;
  stripeAccount: string;
  amount: ElementsAmount;
  ref: Ref<PaymentHandle | null>;
}) {
  const options: StripeElementsOptionsMode =
    amount.mode === 'setup'
      ? { mode: 'setup', currency: amount.currency, setupFutureUsage: 'off_session' }
      : {
          mode: 'payment',
          amount: amount.amount,
          currency: amount.currency,
          ...(amount.saveCard ? { setupFutureUsage: 'off_session' as const } : {}),
        };
  return (
    <Elements
      stripe={stripeFor(publishableKey, stripeAccount)}
      options={{ ...options, allowedPaymentMethodTypes: ['card', 'link'], appearance: appearance() }}
    >
      <ElementFields ref={ref} />
    </Elements>
  );
}

function ElementFields({ ref }: { ref: Ref<PaymentHandle | null> }) {
  const t = useTranslations('checkout');
  const stripe = useStripe();
  const elements = useElements();

  useImperativeHandle(
    ref,
    () => ({
      collect: async ({ name, email }) => {
        if (!stripe || !elements) return { error: t('paymentLoading') };
        // Validates the Element and collects wallet details.
        const { error: submitError } = await elements.submit();
        if (submitError) return { error: submitError.message ?? t('errGeneric') };
        const { error, confirmationToken } = await stripe.createConfirmationToken({
          elements,
          params: { payment_method_data: { billing_details: { name, email } } },
        });
        return error ? { error: error.message ?? t('errGeneric') } : { token: confirmationToken.id };
      },
      authenticate: async (clientSecret) => {
        if (!stripe) return { error: t('paymentLoading') };
        const { error } = await stripe.handleNextAction({ clientSecret });
        return error ? { error: error.message ?? t('errAuthentication') } : { ok: true as const };
      },
    }),
    [stripe, elements, t],
  );

  return <PaymentElement options={{ layout: 'tabs' }} />;
}
