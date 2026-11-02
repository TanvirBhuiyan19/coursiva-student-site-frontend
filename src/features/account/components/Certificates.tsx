'use client';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { BrandMark } from '@/components/layout/BrandMark';
import { useToast } from '@/components/toast/Toaster';
import type { Site } from '@/features/tenant/types';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useCertificates } from '../api';
import styles from './Certificates.module.css';

/**
 * Earned certificates. Credentials live in the platform registry, so they stay verifiable even if this school closes or
 * rebrands; the verify link opens the school's own `/verify/{code}` page.
 */
export function Certificates({ site }: { site: Pick<Site, 'name' | 'logoUrl'> }) {
  const t = useTranslations('certificates');
  const tc = useTranslations('common');
  const f = useFormat();
  const toast = useToast();
  const { data, isPending, isError, refetch } = useCertificates();

  if (isPending) return <div className="skeleton" style={{ height: 360, marginTop: 24 }} />;
  if (isError)
    return (
      <div className="alert alert-bad" role="alert" style={{ marginTop: 24 }}>
        {tc('errorBody')}{' '}
        <button type="button" className="link-btn" onClick={() => void refetch()}>
          {tc('retry')}
        </button>
      </div>
    );
  if (data.length === 0)
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>{t('emptyTitle')}</p>
        <p>{t('emptyBody')}</p>
        <Link href={routes.learning} className="btn btn-primary" style={{ marginTop: 16 }}>
          {t('continueLearning')}
        </Link>
      </div>
    );

  return (
    <ul className={styles.list}>
      {data.map((c) => (
        <li key={c.id} className={styles.card}>
          <article className={styles.cert} aria-label={t('certificateFor', { course: c.courseTitle })}>
            <BrandMark site={site} size={40} />
            <p className={styles.kicker}>{t('kicker')}</p>
            <p className={styles.name}>{c.learnerName}</p>
            <p className={styles.completed}>{t('completed')}</p>
            <p className={styles.course}>{c.courseTitle}</p>
            <dl className={styles.meta}>
              <div>
                <dt>{t('dateIssued')}</dt>
                <dd>{f.date(c.issuedAt)}</dd>
              </div>
              <div>
                <dt>{t('instructor')}</dt>
                <dd>{c.instructorName}</dd>
              </div>
              <div>
                <dt>{t('credentialId')}</dt>
                <dd>{c.id}</dd>
              </div>
            </dl>
          </article>
          <div className={styles.actions}>
            <p className={styles.badge}>
              <span className={styles.badgeIcon} aria-hidden="true">
                ✦
              </span>
              {t('badge')}
            </p>
            <a href={c.linkedInUrl} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
              {t('linkedin')}
            </a>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() =>
                void navigator.clipboard.writeText(c.verifyUrl).then(
                  () => toast(t('copied', { url: c.verifyUrl.replace(/^https?:\/\//, '') })),
                  () => toast(c.verifyUrl),
                )
              }
            >
              {t('copyVerify')}
            </button>
            <a href={c.pdfUrl} className="btn btn-primary btn-sm" download>
              {t('downloadPdf')}
            </a>
            {/* Open Badges 3.0: the signed credential (.jwt) through the site's /api proxy, and the registry URL wallets fetch. */}
            {c.credentialUrl && (
              <a href={c.credentialUrl} className="btn btn-outline btn-sm" download={`certificate-${c.id}.jwt`}>
                {t('openBadge')}
              </a>
            )}
            {c.credentialPublicUrl && (
              <a href={c.credentialPublicUrl} target="_blank" rel="noopener noreferrer" className="link-btn">
                {t('openBadgeLink')}
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
