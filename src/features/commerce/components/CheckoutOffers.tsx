'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import type { Money } from '@/lib/api/types';
import { useFormat } from '@/lib/useFormat';
import type { CrossSell, PriceOffer, Quote } from '../types';
import styles from './Offers.module.css';

/**
 * Checkout offers (docs/api/commerce.md → Offers). The API prices every offer — sale, seat tier, trial, cross-sell —
 * and decides when one stops applying; these components only show what the quote says.
 */

/** "2d 04:05:09" / "04:05:09" / "05:09": digits only, so it reads the same in every language. */
export function formatTimeLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = h > 0 || d > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return d > 0 ? `${d}d ${clock}` : clock;
}

/**
 * Milliseconds left until `endsAt`, ticking each second. When it reaches 0 `onEnd` runs (the checkout re-quotes: the
 * server's clock decides), and again every 15 s while the server still reports the same end (a fast client clock).
 */
export function useTimeLeft(endsAt: string | null, onEnd?: () => void): number | null {
  const [now, setNow] = useState(() => Date.now());
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);
  useEffect(() => {
    if (!endsAt) return;
    const end = Date.parse(endsAt);
    let lastCall = 0;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      if (at >= end && at - lastCall >= 15_000) {
        lastCall = at;
        onEndRef.current?.();
      }
    };
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Date.parse(endsAt) - now);
}

/** A struck-through list price before the offer price ("Was $179"). */
export function WasPrice({ price }: { price: Money | null | undefined }) {
  const t = useTranslations('checkout.offers');
  const f = useFormat();
  if (!price) return null;
  return (
    <>
      <s className={styles.was} aria-hidden="true">
        {f.money(price)}
      </s>
      <span className="sr-only">{t('was', { price: f.money(price) })}</span>{' '}
    </>
  );
}

/** The sale / seat tier / trial that sets the price, with the sale's countdown. */
export function PriceOfferBanner({ offer, tiers, onEnd }: { offer: PriceOffer; tiers: Quote['quantityTiers']; onEnd: () => void }) {
  const t = useTranslations('checkout.offers');
  const left = useTimeLeft(offer.kind === 'countdown' ? offer.endsAt : null, onEnd);
  const tier = offer.kind === 'quantity' ? (tiers ?? []).find((x) => x.discountPercent === offer.discountPercent) : undefined;
  const fallback =
    offer.kind === 'countdown'
      ? t('saleDefault', { percent: offer.discountPercent })
      : offer.kind === 'quantity'
        ? tier
          ? t('tierDefault', { percent: offer.discountPercent, seats: tier.minSeats })
          : t('tierDefaultNoSeats', { percent: offer.discountPercent })
        : offer.trialDays
          ? t('trialDefault', { days: offer.trialDays })
          : t('firstMonthDefault', { percent: offer.discountPercent });
  return (
    <section className={styles.banner} data-applied={offer.applied} aria-label={t('bannerLabel')}>
      <p className={styles.bannerTitle}>{offer.headline || fallback}</p>
      {offer.headline && <p className={styles.bannerSub}>{fallback}</p>}
      {offer.body && <p className={styles.bannerSub}>{offer.body}</p>}
      {offer.applied && left !== null && (
        <p className={styles.timer}>
          {left > 0
            ? t.rich('endsIn', {
                time: formatTimeLeft(left),
                clock: (chunks) => (
                  <span role="timer" className={styles.clock}>
                    {chunks}
                  </span>
                ),
              })
            : t('endingNow')}
        </p>
      )}
      {!offer.applied && offer.message && (
        <p className={styles.bannerSub} role="status">
          {offer.message}
        </p>
      )}
    </section>
  );
}

/** Team pricing next to the seats picker: each tier, the one reached marked. */
export function SeatTiers({ tiers, seats }: { tiers: NonNullable<Quote['quantityTiers']>; seats: number }) {
  const t = useTranslations('checkout.offers');
  if (!tiers.length) return null;
  const reached = [...tiers].reverse().find((x) => seats >= x.minSeats);
  const next = tiers.find((x) => seats < x.minSeats);
  return (
    <div className={styles.tiers}>
      <p className={styles.tiersTitle}>{t('tiersTitle')}</p>
      <ul>
        {tiers.map((x) => (
          <li key={x.minSeats} data-reached={x === reached}>
            {t('tier', { seats: x.minSeats, percent: x.discountPercent })}
          </li>
        ))}
      </ul>
      {next && <p className={styles.tiersNext}>{t('tierNext', { seats: next.minSeats, percent: next.discountPercent })}</p>}
    </div>
  );
}

/** "Frequently bought together": the companions and one tick that adds them all at the offer price. */
export function CrossSellBlock({
  crossSell,
  checked,
  onChange,
}: {
  crossSell: CrossSell;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations('checkout.offers');
  const f = useFormat();
  return (
    <section className={styles.cross} aria-labelledby="cross-sell-title">
      <h3 id="cross-sell-title" className={styles.crossTitle}>
        {crossSell.headline || t('crossSellDefault')}
      </h3>
      {crossSell.body && <p className={styles.crossSub}>{crossSell.body}</p>}
      <ul className={styles.crossItems}>
        {crossSell.items.map((i) => (
          <li key={i.courseSlug}>
            <CourseCover cover={i.cover} height={40} radius={8} className={styles.crossCover} sizes="56px" />
            <span className={styles.crossName}>{i.title}</span>
            <span className={styles.crossPrice}>
              <WasPrice price={i.compareAt} />
              {f.money(i.price)}
            </span>
          </li>
        ))}
      </ul>
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          {crossSell.discountPercent > 0
            ? t('crossSellAddSave', { count: crossSell.items.length, total: f.money(crossSell.total), percent: crossSell.discountPercent })
            : t('crossSellAdd', { count: crossSell.items.length, total: f.money(crossSell.total) })}
        </span>
      </label>
    </section>
  );
}
