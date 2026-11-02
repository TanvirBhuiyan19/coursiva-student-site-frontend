import { getTranslations } from 'next-intl/server';
import { BrandMark } from '@/components/layout/BrandMark';
import type { Site } from '@/features/tenant/types';
import { formatDate } from '@/lib/format';
import type { CertificateVerification } from '../types';
import styles from './Certificates.module.css';

/**
 * The public verification page for a certificate code (`/verify/{code}`), in the issuing school's brand. Server-only:
 * no client JS. Shows exactly what the registry publishes — never the holder's email.
 */
export async function CertificateVerify({
  cert,
  site,
  locale,
}: {
  cert: CertificateVerification;
  site: Pick<Site, 'name' | 'logoUrl'>;
  locale: string;
}) {
  const t = await getTranslations('verify');
  const date = (iso: string) => formatDate(iso, locale);
  return (
    <article className={styles.verify} aria-labelledby="verify-title">
      <div className={styles.verifyHead}>
        <BrandMark site={site} size={36} />
        <span className={styles.verifyIssuer}>{cert.issuerName ?? site.name}</span>
      </div>
      <p className={styles.verifyBadge} data-status={cert.status} role="status">
        <span aria-hidden="true">{cert.status === 'valid' ? '✓' : '!'}</span> {t(`status.${cert.status}`)}
      </p>
      <h1 id="verify-title" className="h1-sm">
        {t('title', { name: cert.holderName })}
      </h1>
      <p className="lead">{t('completed', { course: cert.courseTitle })}</p>
      <dl className={styles.verifyFacts}>
        <div>
          <dt>{t('code')}</dt>
          <dd className="num">{cert.code}</dd>
        </div>
        <div>
          <dt>{t('issued')}</dt>
          <dd>{date(cert.issuedAt)}</dd>
        </div>
        {cert.expiresAt && (
          <div>
            <dt>{cert.status === 'expired' ? t('expired') : t('expires')}</dt>
            <dd>{date(cert.expiresAt)}</dd>
          </div>
        )}
        {cert.reissuedAt && (
          <div>
            <dt>{t('reissued')}</dt>
            <dd>{date(cert.reissuedAt)}</dd>
          </div>
        )}
        {cert.revokedAt && (
          <div>
            <dt>{t('revoked')}</dt>
            <dd>{date(cert.revokedAt)}</dd>
          </div>
        )}
        {cert.issuerName && (
          <div>
            <dt>{t('issuer')}</dt>
            <dd>{cert.issuerName}</dd>
          </div>
        )}
      </dl>
      <p className={styles.verifyNote}>{t('note')}</p>
    </article>
  );
}
