'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PlanCard } from '@/features/membership/components/PlanCard';
import type { BillingInterval } from '@/features/membership/types';
import type { MembershipSection } from '../types';
import { SiteLink } from './SiteLink';
import styles from './Sections.module.css';

/**
 * Pricing section: the school's real membership plans (with the monthly/annual switch when the school turned it on),
 * or — without memberships — the plan cards it typed in the builder, so the section never vanishes.
 */
export function MembershipPlans({ s, headingId }: { s: MembershipSection; headingId: string }) {
  const t = useTranslations('pages');
  const tm = useTranslations('membership');
  const [interval, setInterval] = useState<BillingInterval>('month');
  const real = s.plans.length > 0;
  return (
    <>
      <div className={styles.centerHead}>
        {s.title !== '' && (
          <h2 id={headingId} className={`h2 ${styles.heading}`}>
            {s.title}
          </h2>
        )}
        {s.subtitle !== '' && <p>{s.subtitle}</p>}
        {real && s.annualToggle && (
          <div className={`segmented ${styles.billing}`} role="group" aria-label={tm('billing')}>
            <button type="button" aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>
              {tm('monthly')}
            </button>
            <button type="button" aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>
              {t('annual')}
            </button>
          </div>
        )}
      </div>
      <ul className={`grid-3 ${styles.plans}`}>
        {real
          ? s.plans.map((p) => (
              <li key={p.id}>
                <PlanCard plan={p} interval={interval} />
              </li>
            ))
          : s.staticPlans.map((p, i) => (
              <li key={i}>
                <article className={styles.staticPlan} data-highlighted={p.highlighted}>
                  {p.highlighted && <span className={`tag tag-brand ${styles.planFlag}`}>{tm('popular')}</span>}
                  <h3 className={styles.planName}>{p.name}</h3>
                  <p className={styles.planPrice}>{p.price}</p>
                  <p className={styles.planDesc}>{p.description}</p>
                  <SiteLink
                    href={p.button.href}
                    className={`btn btn-block ${p.highlighted ? 'btn-primary' : 'btn-outline'} ${styles.planBtn}`}
                  >
                    {p.button.label}
                  </SiteLink>
                </article>
              </li>
            ))}
      </ul>
    </>
  );
}
