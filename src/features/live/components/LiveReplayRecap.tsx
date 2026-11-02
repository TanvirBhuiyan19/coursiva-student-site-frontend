'use client';
import { useTranslations } from 'next-intl';
import { clock, replayRecapOf, seekReplay } from '../recap';
import styles from './LiveReplayRecap.module.css';

/**
 * The AI recap beside a session's replay (`/live/{id}`): a short summary, chapters that jump the replay, and the
 * next steps. Renders nothing until the school published a recap.
 */
export function LiveReplayRecap({ session, onSeek = seekReplay }: { session: unknown; onSeek?: (seconds: number) => void }) {
  const t = useTranslations('liveRecap');
  const recap = replayRecapOf(session);
  if (!recap) return null;
  return (
    <section className={styles.recap} aria-labelledby="live-recap-title">
      <h2 id="live-recap-title" className={styles.title}>
        {t('title')}
      </h2>
      <p className={styles.summary}>{recap.summary}</p>
      {recap.chapters.length > 0 && (
        <>
          <h3 className={styles.heading}>{t('chapters')}</h3>
          <ol className={styles.chapters}>
            {recap.chapters.map((c) => (
              <li key={c.startSec}>
                <button
                  type="button"
                  className={styles.chapter}
                  aria-label={t('jump', { time: clock(c.startSec), title: c.title })}
                  onClick={() => onSeek(c.startSec)}
                >
                  <span className={styles.time}>{clock(c.startSec)}</span>
                  <span>{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {recap.actionItems.length > 0 && (
        <>
          <h3 className={styles.heading}>{t('actionItems')}</h3>
          <ul className={styles.items}>
            {recap.actionItems.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </>
      )}
      <p className={styles.note}>{t('note')}</p>
    </section>
  );
}
