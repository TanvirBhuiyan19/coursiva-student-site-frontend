'use client';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useId, useImperativeHandle, useState, type Ref } from 'react';
import { TEST_CARDS, type ElementsAmount, type PaymentHandle, type PaymentSetup, type TestCardKey } from '../payments';
import styles from './Commerce.module.css';

/** Stripe.js only loads on the checkout, and only when the school takes real payments. */
const StripePaymentFields = dynamic(() => import('./StripePaymentFields').then((m) => m.StripePaymentFields), {
  ssr: false,
  loading: () => <div className="skeleton" style={{ height: 180 }} />,
});

/**
 * Where card details are entered: Stripe's Payment Element in production, a test-card picker with the fake gateway
 * (development, e2e). Either way the checkout only ever sees a token (see ../payments.ts).
 */
export function PaymentFields({ setup, amount, ref }: { setup: PaymentSetup; amount: ElementsAmount; ref: Ref<PaymentHandle | null> }) {
  const t = useTranslations('checkout');
  if (setup.provider === 'test') return <TestPaymentFields ref={ref} />;
  if (!setup.publishableKey || !setup.stripeAccount) {
    return (
      <p className="alert alert-bad" role="alert">
        {t('paymentsUnavailable')}
      </p>
    );
  }
  return <StripePaymentFields publishableKey={setup.publishableKey} stripeAccount={setup.stripeAccount} amount={amount} ref={ref} />;
}

/** The fake gateway's stand-in for the Payment Element: pick a Stripe test card (no card fields, no card data). */
function TestPaymentFields({ ref }: { ref: Ref<PaymentHandle | null> }) {
  const t = useTranslations('checkout');
  const id = useId();
  const [card, setCard] = useState<TestCardKey>('visa');

  useImperativeHandle(
    ref,
    () => ({
      collect: () => Promise.resolve({ token: TEST_CARDS.find((c) => c.key === card)?.token ?? 'tok_visa' }),
      // The fake gateway's challenge always passes; the order completes when the API hears back (mock: next read).
      authenticate: () => Promise.resolve({ ok: true as const }),
    }),
    [card],
  );

  return (
    <fieldset className={styles.testCards}>
      <legend className="field-label">{t('testCard')}</legend>
      {TEST_CARDS.map((c) => (
        <label key={c.key} className="option">
          <input type="radio" className="sr-only" name={`${id}-card`} checked={card === c.key} onChange={() => setCard(c.key)} />
          <span className="radio-dot" aria-hidden="true" />
          <span className={styles.optTitle}>{t(`testCards.${c.key}`)}</span>
        </label>
      ))}
      <p className={styles.optSub}>{t('testCardNote')}</p>
    </fieldset>
  );
}
