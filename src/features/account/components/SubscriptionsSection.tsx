'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useResumeSubscription, useSubscriptions } from '../api';
import type { LearnerSubscription } from '../types';
import { CancelFlowDialog } from './CancelFlowDialog';
import styles from './Profile.module.css';

const TAG: Record<LearnerSubscription['status'], string> = {
  active: 'tag-good',
  trialing: 'tag-good',
  past_due: 'tag-bad',
  paused: 'tag-warn',
  cancelled: 'tag-soft',
};

/** The subscription's state in one line: the next charge, the trial, the pause or when a cancelled one's access ends. */
function StatusLine({ s }: { s: LearnerSubscription }) {
  const t = useTranslations('account.subscriptions');
  const f = useFormat();
  const price = f.money(s.nextCharge ?? s.price);
  switch (s.status) {
    case 'trialing':
      return <>{s.trialEndsAt ? t('trial', { date: f.date(s.trialEndsAt), price, interval: s.interval }) : null}</>;
    case 'paused':
      return <>{s.resumesAt ? t('paused', { date: f.date(s.resumesAt) }) : t('pausedOpen')}</>;
    case 'cancelled':
      return <>{s.endsAt ? t('cancelled', { date: f.date(s.endsAt) }) : null}</>;
    default:
      return <>{s.renewsAt ? t('renews', { price, interval: s.interval, date: f.date(s.renewsAt) }) : null}</>;
  }
}

/**
 * Subscriptions on the billing page: every membership and course sold as a subscription, with cancel (the cancel flow)
 * and resume. Renders nothing when the learner has none.
 */
export function SubscriptionsSection() {
  const t = useTranslations('account.subscriptions');
  const ta = useTranslations('account');
  const toast = useToast();
  const { data, isError, refetch } = useSubscriptions();
  const resume = useResumeSubscription();
  const [cancelling, setCancelling] = useState<LearnerSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isError)
    return (
      <section className={styles.card} aria-labelledby="subscriptions-t" style={{ marginTop: 20 }}>
        <h2 id="subscriptions-t" className={styles.title}>
          {t('title')}
        </h2>
        <p className="alert alert-bad" role="alert">
          {t('loadError')}{' '}
          <button type="button" className="link-btn" onClick={() => void refetch()}>
            {ta('retry')}
          </button>
        </p>
      </section>
    );
  if (!data?.length) return null;

  const undo = (s: LearnerSubscription) => {
    setError(null);
    resume.mutate(s.id, {
      onSuccess: () => toast(t('resumed')),
      onError: (err) => setError(err instanceof ApiError ? err.message : t('error')),
    });
  };

  return (
    <section className={styles.card} aria-labelledby="subscriptions-t" style={{ marginTop: 20 }}>
      <h2 id="subscriptions-t" className={styles.title}>
        {t('title')}
      </h2>
      <ul className={styles.subscriptions}>
        {data.map((s) => (
          <li key={s.id} className={styles.row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className={styles.strong}>
                {s.kind === 'course' ? t('course', { title: s.title }) : t('membership', { title: s.title })}{' '}
                <span className={`tag ${TAG[s.status]}`}>{ta(`membershipStatus.${s.status}`)}</span>
              </p>
              <p className={styles.sub}>
                <StatusLine s={s} />
              </p>
              {s.discount && <p className={styles.sub}>{t('discount', { percent: s.discount.percent, cycles: s.discount.cycles })}</p>}
              {s.pendingPlanName && <p className={styles.sub}>{t('pending', { plan: s.pendingPlanName })}</p>}
              {s.courseSlug && (
                <Link href={routes.player(s.courseSlug)} className={styles.sub}>
                  {t('openCourse')}
                </Link>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {s.canResume && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={resume.isPending}
                  aria-label={s.status === 'paused' ? t('resumeNamed', { title: s.title }) : t('undoNamed', { title: s.title })}
                  onClick={() => undo(s)}
                >
                  {s.status === 'paused' ? t('resume') : t('undo')}
                </button>
              )}
              {s.canCancel && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  aria-label={t('cancelNamed', { title: s.title })}
                  onClick={() => setCancelling(s)}
                >
                  {t('cancel')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p className="field-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
      {cancelling && <CancelFlowDialog subscription={cancelling} onClose={() => setCancelling(null)} />}
    </section>
  );
}
