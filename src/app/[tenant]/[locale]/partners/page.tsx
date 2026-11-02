import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PartnersView } from '@/features/partners/components/PartnersView';
import { currentScope, getSite, pageAlternates } from '@/features/tenant/server';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const { tenant, locale } = await currentScope();
  const [site, t, { alternates }] = await Promise.all([
    getSite(tenant, locale),
    getTranslations('partners'),
    pageAlternates(routes.partners),
  ]);
  return { title: t('metaTitle'), description: t('metaDescription', { school: site.name }), alternates };
}

/** The partner program: a static shell; the terms load in the browser so the school's changes show at once. */
export default function PartnersPage() {
  return (
    <div className="container page">
      <PartnersView />
    </div>
  );
}
