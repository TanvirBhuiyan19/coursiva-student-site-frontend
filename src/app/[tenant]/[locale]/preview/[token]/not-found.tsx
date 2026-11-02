import { useTranslations } from 'next-intl';

/** An unknown or expired preview token: the builder makes a fresh one each time it opens the preview. */
export default function PreviewExpired() {
  const t = useTranslations('preview');
  return (
    <div className="container page" style={{ textAlign: 'center', maxWidth: 560 }}>
      <meta name="robots" content="noindex" />
      <h1 className="h1-sm">{t('expiredTitle')}</h1>
      <p className="lead" style={{ marginTop: 10 }}>
        {t('expired')}
      </p>
    </div>
  );
}
