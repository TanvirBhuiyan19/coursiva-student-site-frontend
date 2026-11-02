'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import { useFormat } from '@/lib/useFormat';
import { useDownloadLink, useDownloads } from '../api';
import type { Download } from '../types';
import styles from './Profile.module.css';

/** Starts a plain file download from a signed URL (no navigation away from the page). */
function startDownload(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * The learner's purchased files (digital products). Each click asks the API for a fresh 15-minute link; the expiry,
 * download limit and refunds are enforced there. Hidden when the learner bought no files.
 */
export function DownloadsSection() {
  const t = useTranslations('account');
  const f = useFormat();
  const { data, isError, refetch } = useDownloads();
  const link = useDownloadLink();
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (isError)
    return (
      <section id="downloads" className={styles.card} aria-labelledby="dl-t">
        <h2 id="dl-t" className={styles.title}>
          {t('downloads')}
        </h2>
        <p className="field-error" role="alert">
          {t('downloadsError')}{' '}
          <button type="button" className="link-btn" onClick={() => void refetch()}>
            {t('retry')}
          </button>
        </p>
      </section>
    );
  if (!data?.length) return null;

  const key = (d: Download) => `${d.orderId}:${d.productId}`;
  const get = (d: Download) => {
    setErrors((e) => ({ ...e, [key(d)]: '' }));
    link.mutate(
      { orderId: d.orderId, productId: d.productId },
      {
        onSuccess: (r) => startDownload(r.url, d.fileName),
        onError: (err) => {
          const reason = err instanceof ApiError ? err.reason : null;
          const msg =
            reason === 'download_expired' || reason === 'download_limit' || reason === 'file_unavailable'
              ? t(`downloadReasons.${reason}`)
              : err instanceof ApiError
                ? err.message
                : t('downloadsError');
          setErrors((e) => ({ ...e, [key(d)]: msg }));
        },
      },
    );
  };

  return (
    <section id="downloads" className={styles.card} aria-labelledby="dl-t">
      <h2 id="dl-t" className={styles.title}>
        {t('downloads')}
      </h2>
      <ul className={styles.downloads}>
        {data.map((d) => (
          <li key={key(d)} className={styles.row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className={styles.strong}>{d.name}</p>
              <p className={styles.sub}>
                {[
                  `${d.fileName} · ${t('sizeMb', { size: d.sizeMb })}`,
                  d.downloadsLeft !== null ? t('downloadsLeft', { count: d.downloadsLeft }) : null,
                  d.expiresAt ? t('availableUntil', { date: f.date(d.expiresAt) }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {errors[key(d)] && (
                <p className="field-error" role="alert">
                  {errors[key(d)]}
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={!d.available || link.isPending}
              onClick={() => get(d)}
              aria-label={d.available ? t('downloadNamed', { name: d.name }) : undefined}
            >
              {d.available ? t('download') : t('downloadUnavailable')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
