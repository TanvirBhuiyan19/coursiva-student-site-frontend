import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { LegalDocument } from '../types';
import styles from './Support.module.css';

/** Tenant legal page (refund policy, privacy, terms). Content is authored by the tenant in the dashboard. */
export function LegalDocumentView({ doc }: { doc: LegalDocument }) {
  const t = useTranslations('support');
  const f = useFormat();
  return (
    <article className={`container page ${styles.legal}`}>
      {doc.slug === 'refund' && (
        <Link href={routes.help} className={styles.back}>
          {t('backToHelp')}
        </Link>
      )}
      <h1 className="h1-sm" style={{ marginTop: doc.slug === 'refund' ? 10 : 0 }}>
        {doc.title}
      </h1>
      <p className={styles.updated}>
        {t('updated')} <time dateTime={doc.updatedAt}>{f.date(doc.updatedAt)}</time>
      </p>
      {doc.sections.map((s) => (
        <section key={s.heading} className={styles.legalSection}>
          <h2>{s.heading}</h2>
          <p>{s.body}</p>
        </section>
      ))}
      <aside className={styles.legalCta}>
        {doc.slug === 'refund' && (
          <>
            <span>{t('refundCta')}</span>
            <Link href={routes.contact} className="btn btn-primary">
              {t('requestRefund')}
            </Link>
          </>
        )}
        {doc.slug === 'privacy' && (
          <span>
            {t('privacyCta')} <Link href={routes.contact}>{t('contactLink')}</Link>
          </span>
        )}
        {doc.slug === 'terms' && (
          <span>
            {t('seeAlso')} <Link href={routes.privacy}>{t('privacyLink')}</Link> · <Link href={routes.refund}>{t('refundLink')}</Link>
          </span>
        )}
      </aside>
    </article>
  );
}
