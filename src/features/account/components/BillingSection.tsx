'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, useAppPathname } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { openBillingPortal } from '../api';
import type { Membership, Profile } from '../types';
import styles from './Profile.module.css';

const MEMBERSHIP_TAG: Record<Membership['status'], string> = {
  active: 'tag-good',
  trialing: 'tag-good',
  past_due: 'tag-bad',
  paused: 'tag-warn',
  cancelled: 'tag-soft',
};

/** The membership's state in one line: the next charge, the trial, the pause or when a cancelled plan's access ends. */
function MembershipLine({ m }: { m: Membership }) {
  const t = useTranslations('account');
  const f = useFormat();
  const price = f.money(m.price);
  switch (m.status) {
    case 'trialing':
      return <>{m.trialEndsAt ? t('membershipTrial', { date: f.date(m.trialEndsAt), price, interval: m.interval }) : null}</>;
    case 'paused':
      return <>{m.resumesAt ? t('membershipPaused', { date: f.date(m.resumesAt) }) : t('membershipPausedOpen')}</>;
    case 'cancelled':
      return <>{m.endsAt ? t('membershipCancelled', { date: f.date(m.endsAt) }) : null}</>;
    default:
      return <>{m.renewsAt ? t('membershipRenews', { price, interval: m.interval, date: f.date(m.renewsAt) }) : null}</>;
  }
}

/**
 * Billing (`/account/billing`, and on the account page): the saved card, the membership, and the provider's billing
 * portal for changing them. The billing page lists the membership under Subscriptions instead (`hideMembership`), with
 * cancel and resume. The portal answers a redirect, or a message (e.g. nothing on file yet) shown inline.
 */
export function BillingSection({ profile, hideMembership = false }: { profile: Profile; hideMembership?: boolean }) {
  const t = useTranslations('account');
  const pathname = useAppPathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = profile.membership;

  const manage = async () => {
    setBusy(true);
    setError(null);
    const r = await openBillingPortal(pathname);
    if (r) {
      setError(r.error || t('portalError'));
      setBusy(false);
    }
  };

  return (
    <section className={styles.card} id="billing" aria-labelledby="billing-t">
      <h2 id="billing-t" className={styles.title}>
        {t('billing')}
      </h2>
      {m?.status === 'past_due' && (
        <p className="alert alert-bad" role="alert" style={{ marginBottom: 14 }}>
          {t('membershipPastDue')}
        </p>
      )}
      {profile.card ? (
        <div className={styles.row}>
          <span className={styles.brand}>{profile.card.brand.toUpperCase()}</span>
          <div style={{ flex: 1 }}>
            <p className={styles.strong}>{t('cardEnding', { last4: profile.card.last4 })}</p>
            {profile.card.expMonth > 0 && (
              <p className={styles.sub}>
                {t('cardSub', { exp: `${String(profile.card.expMonth).padStart(2, '0')}/${String(profile.card.expYear).slice(-2)}` })}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className={styles.sub}>{t('noCard')}</p>
      )}
      {m && !hideMembership && (
        <div className={styles.row} style={{ marginTop: 14 }}>
          <div style={{ flex: 1 }}>
            <p className={styles.strong}>
              {t('membershipPlan', { plan: m.planName })}{' '}
              <span className={`tag ${MEMBERSHIP_TAG[m.status]}`}>{t(`membershipStatus.${m.status}`)}</span>
            </p>
            <p className={styles.sub}>
              <MembershipLine m={m} />
            </p>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        {(profile.card || m) && (
          <button type="button" className="btn btn-outline" disabled={busy} aria-busy={busy} onClick={() => void manage()}>
            {m && m.status !== 'past_due' ? t('managePlan') : t('updateCard')}
          </button>
        )}
        <Link href={routes.accountOrders}>{t('orderHistory')}</Link>
      </div>
      {error && (
        <p className="field-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
    </section>
  );
}
