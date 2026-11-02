'use client';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Icon } from '@/components/icons';
import { useToast } from '@/components/toast/Toaster';
import { useFormat } from '@/lib/useFormat';
import { useCalendarFeed } from '../api';
import type { CalendarFeedLink } from '../types';
import styles from './LiveSchedule.module.css';

/**
 * Subscribe a calendar app to every session the learner RSVPs to (a personal iCal feed). The secret link is shown
 * once, right after it is made; afterwards the panel says it is connected and offers a new link (the old one stops
 * working) or turning it off.
 */
export function CalendarSubscribe() {
  const t = useTranslations('liveSchedule.calendar');
  const f = useFormat();
  const toast = useToast();
  const { status, subscribe, revoke } = useCalendarFeed();
  const [link, setLink] = useState<CalendarFeedLink | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const inputId = useId();

  const make = () =>
    subscribe.mutate(undefined, {
      onSuccess: (l) => {
        setLink(l);
        setConfirmOff(false);
      },
    });
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast(t('copied'));
    } catch {
      document.getElementById(inputId)?.focus();
    }
  };

  return (
    <section className={`card ${styles.calCard}`} aria-labelledby="live-cal-title" data-testid="calendar-subscribe">
      <div className={styles.calHead}>
        <span className={styles.calIcon} aria-hidden="true">
          <Icon name="calendar" size={18} />
        </span>
        <h2 id="live-cal-title" className={styles.sideTitle}>
          {t('title')}
        </h2>
      </div>

      {status.isPending ? (
        <div className="skeleton" style={{ height: 72 }} />
      ) : status.isError ? (
        <p className="muted">{t('error')}</p>
      ) : link ? (
        <>
          <p className={styles.calText}>{t('linkIntro')}</p>
          <div className={styles.calLinks}>
            <a className="btn btn-primary btn-sm" href={link.googleUrl} target="_blank" rel="noopener noreferrer">
              {t('google')}
            </a>
            <a className="btn btn-outline btn-sm" href={link.webcalUrl}>
              {t('apple')}
            </a>
            <a className="btn btn-outline btn-sm" href={link.outlookUrl} target="_blank" rel="noopener noreferrer">
              {t('outlook')}
            </a>
          </div>
          <label htmlFor={inputId} className={styles.calLabel}>
            {t('linkLabel')}
          </label>
          <div className={styles.copyRow}>
            <input
              id={inputId}
              className={`input ${styles.copyInput}`}
              readOnly
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void copy()}>
              <Icon name="copy" size={14} /> {t('copy')}
            </button>
          </div>
          <p className={styles.calNote} role="note">
            <Icon name="lock" size={13} /> {t('private')}
          </p>
        </>
      ) : status.data.active ? (
        <>
          <p className={styles.calText}>
            <span className="tag tag-good">{t('connected')}</span>{' '}
            {status.data.lastUsedAt ? t('lastSynced', { ago: f.ago(status.data.lastUsedAt) }) : t('notSyncedYet')}
          </p>
          <p className={styles.calNote}>{t('lostLink')}</p>
        </>
      ) : (
        <p className={styles.calText}>{t('intro')}</p>
      )}

      {!status.isPending && !status.isError && (
        <div className={styles.calActions}>
          {!status.data.active && !link ? (
            <button type="button" className="btn btn-primary btn-sm btn-block" disabled={subscribe.isPending} onClick={make}>
              {subscribe.isPending ? t('making') : t('make')}
            </button>
          ) : confirmOff ? (
            <div className={styles.confirm} role="group" aria-label={t('offConfirm')}>
              <span>{t('offConfirm')}</span>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                disabled={revoke.isPending}
                onClick={() =>
                  revoke.mutate(undefined, {
                    onSuccess: () => {
                      setLink(null);
                      setConfirmOff(false);
                      toast(t('turnedOff'));
                    },
                  })
                }
              >
                {t('offYes')}
              </button>
              <button type="button" className="link-btn" onClick={() => setConfirmOff(false)}>
                {t('offNo')}
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="btn btn-outline btn-sm" disabled={subscribe.isPending} onClick={make}>
                <Icon name="refresh" size={13} /> {t('newLink')}
              </button>
              <button type="button" className="link-btn" onClick={() => setConfirmOff(true)}>
                {t('turnOff')}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
