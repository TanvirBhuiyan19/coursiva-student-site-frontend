'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { stars } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { BillingInterval, Membership } from '../types';
import styles from './Membership.module.css';
import { PlanCard } from './PlanCard';

/** Membership pricing: monthly/annual toggle, plan cards, comparison table, proof, FAQ and a closing CTA. */
export function MembershipView({ membership, currency }: { membership: Membership; currency: string }) {
  const t = useTranslations('membership');
  const f = useFormat();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const popular = membership.plans.find((p) => p.popular) ?? membership.plans[0];
  const popularPrice = popular?.prices.find((p) => p.interval === interval) ?? popular?.prices[0];

  return (
    <div className="container page">
      <header className={styles.head}>
        <h1 className="h1">{membership.title}</h1>
        <p className="lead">{membership.subtitle}</p>
        <div className="segmented" role="group" aria-label={t('billing')} style={{ marginTop: 22 }}>
          <button type="button" aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>
            {t('monthly')}
          </button>
          <button type="button" aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>
            {t('annual', { percent: membership.annualDiscountPercent })}
          </button>
        </div>
      </header>

      <ul className={`grid-3 ${styles.plans}`}>
        {membership.plans.map((p) => (
          <li key={p.id}>
            <PlanCard plan={p} interval={interval} detailed />
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        {t('note', { days: membership.guaranteeDays, currency })}{' '}
        <Link href={routes.courses} className={styles.noteLink}>
          {t('buyIndividually')}
        </Link>
      </p>

      <section aria-labelledby="compare-title" className={styles.section}>
        <h2 id="compare-title" className={`h2 ${styles.center}`} style={{ fontSize: 24 }}>
          {t('compare')}
        </h2>
        {/* Scrolls sideways on phones: focusable so keyboard users can scroll it too. */}
        <div className={`card ${styles.tableWrap}`} tabIndex={0} role="region" aria-labelledby="compare-title">
          <table className={styles.table}>
            <thead>
              <tr>
                <td />
                {membership.plans.map((p) => (
                  <th key={p.id} scope="col" data-popular={p.popular}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {membership.comparison.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((v, i) => (
                    <td key={membership.plans[i]?.id ?? i} data-kind={typeof v === 'boolean' ? String(v) : 'text'}>
                      {typeof v === 'string' ? (
                        v
                      ) : v ? (
                        <>
                          <span aria-hidden="true">✓</span>
                          <span className="sr-only">{t('included')}</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">{t('notIncluded')}</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {membership.testimonial && (
        <figure className={`card-soft ${styles.testimonial}`}>
          <span
            className="avatar"
            style={{ width: 48, height: 48, fontSize: 16, background: membership.testimonial.color }}
            aria-hidden="true"
          >
            {membership.testimonial.initials}
          </span>
          <div>
            <p className="stars" style={{ fontSize: 12, letterSpacing: 2 }} aria-hidden="true">
              {stars(membership.testimonial.rating)}
            </p>
            <blockquote className={styles.quote}>{membership.testimonial.quote}</blockquote>
            <figcaption className={styles.quoteBy}>
              {membership.testimonial.author} · {membership.testimonial.context}
            </figcaption>
          </div>
        </figure>
      )}

      <section aria-labelledby="mfaq-title" className={styles.faq}>
        <h2 id="mfaq-title" className={`h2 ${styles.center}`} style={{ fontSize: 24 }}>
          {t('faqTitle')}
        </h2>
        <div className="accordion" style={{ marginTop: 18 }}>
          {membership.faqs.map((q) => (
            <details key={q.question}>
              <summary>{q.question}</summary>
              <p className="accordion-body">{q.answer}</p>
            </details>
          ))}
        </div>
      </section>

      {popular && popularPrice && (
        <section className={styles.cta} aria-labelledby="mcta-title">
          <h2 id="mcta-title" className="h2" style={{ fontSize: 28 }}>
            {t('ctaTitle', { name: popular.name })}
          </h2>
          <p>{t('ctaBody', { days: membership.guaranteeDays })}</p>
          <Link href={routes.checkoutMembership(popular.id, interval)} className="btn btn-white btn-lg" style={{ marginTop: 20 }}>
            {t('ctaButton', { name: popular.name, price: f.money(popularPrice.perMonth) })}
          </Link>
        </section>
      )}
    </div>
  );
}
