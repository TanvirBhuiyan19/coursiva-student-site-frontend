import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { getTranslations } from 'next-intl/server';
import { HelpCenter } from '@/features/account/components/Support';
import styles from '@/features/account/components/Support.module.css';
import { getHelp } from '@/features/account/server';
import { currentScope, getSite, pageAlternates } from '@/features/tenant/server';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const { tenant, locale } = await currentScope();
  const [site, t, { alternates }] = await Promise.all([getSite(tenant, locale), getTranslations('support'), pageAlternates(routes.help)]);
  return { title: t('helpMeta'), description: t('helpDescription', { name: site.name }), alternates };
}

export default async function HelpPage() {
  const { tenant, locale } = await currentScope();
  const [categories, t] = await Promise.all([getHelp(tenant, locale), getTranslations('support')]);
  return (
    <div className="container page" style={{ maxWidth: 1016 }}>
      <h1 className="h1" style={{ textAlign: 'center' }}>
        {t('helpTitle')}
      </h1>
      <HelpCenter categories={categories} />
      <section className={styles.stuck} aria-labelledby="stuck-title">
        <h2 id="stuck-title">{t('stuckTitle')}</h2>
        <p>{t('stuckBody')}</p>
        <Link href={routes.contact} className="btn btn-primary btn-lg" style={{ marginTop: 18 }}>
          {t('contactSupport')}
        </Link>
      </section>
    </div>
  );
}
