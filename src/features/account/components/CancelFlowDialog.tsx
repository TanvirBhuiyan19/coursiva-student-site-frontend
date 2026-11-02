'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { ApiError } from '@/lib/api/errors';
import { useFormat } from '@/lib/useFormat';
import { useCancelSubscription, useSaveSubscription, useStartCancelFlow } from '../api';
import type { CancelFlow, CancelOffer, CancelReason, LearnerSubscription } from '../types';
import styles from './Profile.module.css';

type Step = 'survey' | 'offers' | 'confirm';

/**
 * Cancelling a membership or course subscription online (student-site account contract → Subscriptions): an optional
 * survey, the save offers the school switched on (if any), then one confirmation. Every step can be skipped towards
 * cancelling, and if the flow can't be started the learner can still cancel. Access lasts until the end of the paid
 * period; the billing page offers to undo it until then.
 */
export function CancelFlowDialog({ subscription, onClose }: { subscription: LearnerSubscription; onClose: () => void }) {
  const t = useTranslations('account.cancelFlow');
  const f = useFormat();
  const toast = useToast();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const start = useStartCancelFlow();
  const save = useSaveSubscription();
  const cancel = useCancelSubscription();
  const [flow, setFlow] = useState<CancelFlow | null>(null);
  const [step, setStep] = useState<Step>('survey');
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const begin = start.mutate;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    begin(subscription.id, { onSuccess: setFlow });
  }, [begin, subscription.id]);

  const survey = { reason, reasonText: reasonText.trim() || null };
  const close = () => ref.current?.close();
  const busy = save.isPending || cancel.isPending;
  const accessUntil = flow?.accessUntil ?? subscription.renewsAt ?? subscription.endsAt;
  // A past-due subscription ends at once (the server says so in accessUntil too).
  const endsNow = subscription.status === 'past_due';

  const next = (e: SyntheticEvent) => {
    e.preventDefault();
    setStep(flow?.offers.length ? 'offers' : 'confirm');
  };

  const take = (offer: CancelOffer) => {
    if (!flow) return;
    setError(null);
    save.mutate(
      { id: subscription.id, flowId: flow.id, offer: offer.key, ...survey },
      {
        onSuccess: () => {
          toast(t('saved', { name: offer.name }));
          close();
        },
        onError: (err) => {
          // The flow expired (an hour) or the offer went: show what can be offered now.
          if (err instanceof ApiError && err.status === 409) {
            setError(t('expired'));
            begin(subscription.id, { onSuccess: setFlow });
          } else setError(err instanceof ApiError ? err.message : t('startError'));
        },
      },
    );
  };

  const confirm = (flowId: string | null) => {
    setError(null);
    cancel.mutate(
      { id: subscription.id, flowId, ...survey },
      {
        onSuccess: (row) => {
          toast(row.endsAt && Date.parse(row.endsAt) > Date.now() ? t('cancelled', { date: f.date(row.endsAt) }) : t('cancelledNow'));
          close();
        },
        // Cancelling never depends on the flow: an expired one is simply left out.
        onError: (err) => {
          if (flowId && err instanceof ApiError && err.status === 409) confirm(null);
          else setError(err instanceof ApiError ? err.message : t('startError'));
        },
      },
    );
  };

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={`${id}-t`} onClose={onClose}>
      <h2 id={`${id}-t`} className={styles.title}>
        {t('title', { title: subscription.title })}
      </h2>
      {start.isPending && !flow ? (
        <p className={styles.sub} role="status">
          {t('loading')}
        </p>
      ) : step === 'survey' ? (
        <form onSubmit={next} noValidate className={styles.dialogForm}>
          {start.isError && !flow && (
            <p className="alert alert-bad" role="alert">
              {t('startError')}
            </p>
          )}
          <fieldset className={styles.reasons}>
            <legend className="field-label">{t('surveyTitle')}</legend>
            <p className={styles.sub}>{t('surveyHint')}</p>
            {(flow?.reasons ?? []).map((r) => (
              <label key={r} className={styles.reason}>
                <input type="radio" name={`${id}-reason`} checked={reason === r} onChange={() => setReason(r)} />
                {t(`reasons.${r}`)}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-text`}>
              {t('reasonText')}
            </label>
            <textarea
              id={`${id}-text`}
              className="textarea"
              rows={3}
              maxLength={500}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            {t('continue')}
          </button>
        </form>
      ) : step === 'offers' && flow ? (
        <div className={styles.dialogForm}>
          <div>
            <p className={styles.strong}>{t('offersTitle')}</p>
            <p className={styles.sub}>{t('offersHint')}</p>
          </div>
          <ul className={styles.offers}>
            {flow.offers.map((o) => (
              <li key={o.key} className={styles.offerCard}>
                <p className={styles.strong}>
                  {o.key === 'pause'
                    ? t('offer.pause', { months: o.months })
                    : o.key === 'discount'
                      ? t('offer.discount', { percent: o.percent })
                      : t('offer.downgrade', { plan: o.planName })}
                </p>
                <p className={styles.sub}>
                  {o.key === 'pause'
                    ? t('offer.pauseDetail', { date: f.date(o.resumesAt) })
                    : o.key === 'discount'
                      ? t('offer.discountDetail', { price: f.money(o.price), cycles: o.cycles })
                      : t('offer.downgradeDetail', { price: f.money(o.price), interval: subscription.interval })}
                </p>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  aria-label={t('takeNamed', { name: o.name })}
                  onClick={() => take(o)}
                >
                  {t('take')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="link-btn" disabled={busy} onClick={() => setStep('confirm')}>
            {t('noThanks')}
          </button>
        </div>
      ) : (
        <div className={styles.dialogForm}>
          <p className={styles.strong}>{t('confirmTitle')}</p>
          <p className={styles.sub}>{!endsNow && accessUntil ? t('confirmBody', { date: f.date(accessUntil) }) : t('confirmNow')}</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              aria-busy={cancel.isPending}
              onClick={() => confirm(flow?.id ?? null)}
            >
              {t('confirm')}
            </button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={close}>
              {t('keep')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
      <button type="button" className="btn btn-outline" style={{ marginTop: 12 }} onClick={close}>
        {t('close')}
      </button>
    </dialog>
  );
}
