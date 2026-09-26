import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { routes } from '@/lib/routes';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <div className="container page" style={{ textAlign: 'center', maxWidth: 560 }}>
      <meta name="robots" content="noindex" />
      <h1 className="h1-sm">{t('title')}</h1>
      <p className="lead" style={{ marginTop: 10 }}>
        {t('body')}
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
        <Link href={routes.home} className="btn btn-primary">
          {t('home')}
        </Link>
        <Link href={routes.courses} className="btn btn-outline">
          {t('courses')}
        </Link>
      </div>
    </div>
  );
}
