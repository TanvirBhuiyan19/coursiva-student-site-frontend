import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { BillingInterval, MembershipPlan } from '../types';
import styles from './PlanCard.module.css';

/** A membership tier. `detailed` adds the billing line and feature list (membership page); home shows the summary. */
export function PlanCard({
  plan,
  interval = 'month',
  detailed = false,
}: {
  plan: MembershipPlan;
  interval?: BillingInterval;
  detailed?: boolean;
}) {
  const t = useTranslations('membership');
  const tc = useTranslations('common');
  const f = useFormat();
  const price = plan.prices.find((p) => p.interval === interval) ?? plan.prices[0]!;
  return (
    <article className={styles.plan} data-popular={plan.popular}>
      {plan.popular && <span className={`tag tag-brand ${styles.flag}`}>{t('popular')}</span>}
      <h3 className={styles.name}>{plan.name}</h3>
      <p className={styles.price}>
        {f.money(price.perMonth)}
        <span>{tc('perMonth')}</span>
      </p>
      {detailed ? (
        <>
          <p className={styles.billed}>
            {interval === 'year' ? t('billedAnnually', { total: f.money(price.billed) }) : t('billedMonthly')}
          </p>
          <ul className={`ticks ${styles.features}`}>
            {plan.features.map((feat) => (
              <li key={feat}>{feat}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.summary}>{plan.summary}</p>
      )}
      <Link
        href={routes.checkoutMembership(plan.id, interval)}
        className={`btn btn-block ${plan.popular ? 'btn-primary' : 'btn-outline'} ${styles.cta}`}
      >
        {t('join', { name: plan.name })}
      </Link>
    </article>
  );
}
