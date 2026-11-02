'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { markdownToPlain } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { commerceKeys, offerPaymentSetup, useAcceptOffer, useDeclineOffer, usePostPurchaseOffer, waitForPayment } from '../api';
import type { Order, PostPurchaseOffer } from '../types';
import { formatTimeLeft, useTimeLeft, WasPrice } from './CheckoutOffers';
import styles from './Offers.module.css';

type Phase = 'idle' | 'accepting' | 'authenticating' | 'confirming' | 'declining';

/**
 * The thank-you page's one-click offer (`GET /orders/{id}/offer`): an upsell right after payment, the downsell after
 * "No thanks". Accepting charges the card saved at checkout — the bank may ask for 3-D Secure, run here like the
 * checkout does — and the new order is read until it is paid. Nothing is charged unless the learner accepts; the API
 * decides what is offered, its price, tax and when the offer closes (30 minutes after the payment).
 */
export function PostPurchaseOfferCard({ orderId }: { orderId: string }) {
  const t = useTranslations('order.offer');
  const { data: offer } = usePostPurchaseOffer(orderId, true);
  const accept = useAcceptOffer(orderId);
  const decline = useDeclineOffer(orderId);
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  // The offer can no longer be taken (409, or a bank challenge that failed): its message, no buttons.
  const [gone, setGone] = useState<string | null>(null);
  const [done, setDone] = useState<{ order: Order; title: string; kind: PostPurchaseOffer['item']['kind'] } | null>(null);
  const [status, setStatus] = useState('');
  // "No thanks" with nothing after it: a short note takes the focus the buttons had.
  const [closed, setClosed] = useState(false);

  const run = async (o: PostPurchaseOffer) => {
    setError(null);
    setPhase('accepting');
    setStatus(t('statusAdding', { title: o.item.title }));
    let result;
    try {
      result = await accept.mutateAsync(o.key);
    } catch (e) {
      failed(e);
      return;
    }
    let order: Order = result;
    if (result.nextAction) {
      // The bank wants the cardholder (3-D Secure); the processor then tells the API, which completes the order.
      setPhase('authenticating');
      setStatus(t('statusBank'));
      const auth = await authenticate(o, result.nextAction.clientSecret);
      if (auth.error !== null) {
        end(auth.error || t('errBank'));
        return;
      }
      setPhase('confirming');
      setStatus(t('statusConfirming'));
      const settled = await waitForPayment(result.id);
      if (settled) {
        qc.setQueryData(commerceKeys.order(result.id), settled);
        order = settled;
      }
      if (settled?.status === 'failed') {
        end(t('errBank'));
        return;
      }
    }
    setPhase('idle');
    qc.setQueryData(commerceKeys.offer(orderId), null);
    // The confirmation takes focus (and is read out): the live region has nothing more to say.
    setDone({ order, title: o.item.title, kind: o.item.kind });
    setStatus('');
  };

  const authenticate = async (o: PostPurchaseOffer, clientSecret: string): Promise<{ error: string | null }> => {
    const setup = o.payment ?? (await offerPaymentSetup(qc, o.item).catch(() => null));
    if (!setup) return { error: '' };
    // The fake gateway's challenge always passes; the order completes when the API hears back (mock: next read).
    if (setup.provider === 'test') return { error: null };
    if (!setup.publishableKey || !setup.stripeAccount) return { error: '' };
    const { handleNextAction } = await import('./StripePaymentFields');
    return handleNextAction(setup.publishableKey, setup.stripeAccount, clientSecret);
  };

  /** The offer is over (taken elsewhere, expired, a failed challenge): say why, keep nothing to click. */
  const end = (message: string) => {
    setPhase('idle');
    setGone(message);
    setStatus('');
  };

  const failed = (e: unknown) => {
    if (e instanceof ApiError && e.isConflict) {
      end(e.message);
      return;
    }
    const message =
      e instanceof ApiError && e.isValidation
        ? (e.fieldErrors.paymentToken ?? e.fieldErrors.paymentMethod ?? Object.values(e.fieldErrors)[0] ?? e.message)
        : t('errGeneric');
    setPhase('idle');
    setError(message);
    setStatus('');
  };

  const no = async (o: PostPurchaseOffer) => {
    setError(null);
    setPhase('declining');
    try {
      const next = await decline.mutateAsync(o.key);
      setStatus(next ? t('statusNext', { title: next.item.title }) : '');
      if (!next) setClosed(true);
    } catch (e) {
      failed(e);
      return;
    }
    setPhase('idle');
  };

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {done ? (
        <Done done={done} />
      ) : offer ? (
        <OfferCard
          key={offer.key}
          offer={offer}
          phase={phase}
          error={error}
          gone={gone}
          onAccept={() => void run(offer)}
          onDecline={() => void no(offer)}
        />
      ) : closed ? (
        <Closed />
      ) : null}
    </>
  );
}

function OfferCard({
  offer,
  phase,
  error,
  gone,
  onAccept,
  onDecline,
}: {
  offer: PostPurchaseOffer;
  phase: Phase;
  error: string | null;
  gone: string | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const t = useTranslations('order.offer');
  const f = useFormat();
  const left = useTimeLeft(offer.expiresAt);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // A downsell replaces the upsell: move focus to it so keyboard and screen-reader users land on the new offer.
  useEffect(() => {
    if (offer.kind === 'downsell') titleRef.current?.focus();
  }, [offer.kind]);

  const busy = phase !== 'idle';
  const expired = left !== null && left <= 0;
  const id = `offer-${offer.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const included = offer.taxLabel !== null && offer.tax.amount > 0 && offer.total.amount === offer.price.amount;
  const card =
    offer.card.brand && offer.card.last4 ? t('chargedTo', { brand: offer.card.brand, last4: offer.card.last4 }) : t('chargedToSame');

  return (
    <section className={styles.offer} aria-labelledby={`${id}-title`} aria-busy={busy}>
      <p className={styles.offerEyebrow}>{offer.kind === 'upsell' ? t('eyebrowUpsell') : t('eyebrowDownsell')}</p>
      <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1} className={styles.offerTitle}>
        {offer.headline ||
          (offer.kind === 'upsell' ? t('upsellDefault', { title: offer.item.title }) : t('downsellDefault', { title: offer.item.title }))}
      </h2>
      <div className={styles.offerItem}>
        <CourseCover cover={offer.item.cover} height={64} radius={10} className={styles.offerCover} sizes="96px" />
        <div style={{ minWidth: 0 }}>
          <p className={styles.offerItemTitle}>{offer.item.title}</p>
          <p className={styles.offerItemSub}>{offer.body || markdownToPlain(offer.item.description)}</p>
        </div>
      </div>
      <dl className={styles.offerFigures}>
        <div>
          <dt>{t('price')}</dt>
          <dd>
            <WasPrice price={offer.compareAt} />
            {f.money(offer.price)}
          </dd>
        </div>
        {offer.taxLabel && (
          <div>
            <dt>{included ? t('taxIncluded', { label: offer.taxLabel }) : offer.taxLabel}</dt>
            <dd>{f.money(offer.tax)}</dd>
          </div>
        )}
        <div className={styles.offerTotal}>
          <dt>{t('total')}</dt>
          <dd>{f.money(offer.total)}</dd>
        </div>
      </dl>
      {gone ? (
        <p className="alert alert-bad" role="alert">
          {gone}
        </p>
      ) : expired ? (
        <p className="alert alert-bad" role="alert">
          {t('expired')}
        </p>
      ) : (
        <>
          <p className={styles.offerNote}>
            {card} {t('onlyIfAccepted')}
          </p>
          {left !== null && (
            <p className={styles.offerNote}>
              {t.rich('endsIn', {
                time: formatTimeLeft(left),
                clock: (chunks) => (
                  <span role="timer" className={styles.clock}>
                    {chunks}
                  </span>
                ),
              })}
            </p>
          )}
          {error && (
            <p className="alert alert-bad" role="alert">
              {error}
            </p>
          )}
          <div className={styles.offerActions}>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={busy}
              aria-busy={phase === 'accepting' || phase === 'authenticating' || phase === 'confirming'}
              onClick={onAccept}
            >
              {phase === 'accepting' || phase === 'authenticating' || phase === 'confirming'
                ? t('adding')
                : t('accept', { total: f.money(offer.total) })}
            </button>
            <button type="button" className="btn btn-outline btn-lg" disabled={busy} aria-busy={phase === 'declining'} onClick={onDecline}>
              {t('decline')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Declined, and nothing else to offer: confirm it where the buttons were. */
function Closed() {
  const t = useTranslations('order.offer');
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <p ref={ref} tabIndex={-1} className={`muted ${styles.offerDone}`}>
      {t('statusDeclined')}
    </p>
  );
}

/** The offer was added: what happens now, and where it is. */
function Done({ done }: { done: { order: Order; title: string; kind: PostPurchaseOffer['item']['kind'] } }) {
  const t = useTranslations('order.offer');
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const pending = done.order.status === 'pending';
  return (
    <div className={`alert ${pending ? '' : 'alert-ok'} ${styles.offerDone}`}>
      <p ref={ref} tabIndex={-1} style={{ fontWeight: 700 }}>
        {pending ? t('donePending', { title: done.title }) : t('doneTitle', { title: done.title })}
      </p>
      <p>
        {t('doneSub', { number: done.order.number })}{' '}
        <Link href={done.kind === 'product' ? routes.accountDownloads : routes.learning}>
          {done.kind === 'product' ? t('doneDownloads') : t('doneLearning')}
        </Link>
      </p>
    </div>
  );
}
