import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LiveSessionView } from '@/features/live/components/LiveViews';
import { currentScope, getSite } from '@/features/tenant/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('live');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** A live class (the session's invite, reminder and recap e-mails link here). Private: the API decides who sees it. */
export default async function LiveSessionPage({ params }: PageProps<'/[tenant]/[locale]/live/[id]'>) {
  const [{ id }, { tenant, locale }] = await Promise.all([params, currentScope()]);
  const site = await getSite(tenant, locale);
  return (
    <div className="container page" style={{ paddingTop: 56, paddingBottom: 90 }}>
      <LiveSessionView id={id} organizer={{ name: site.name, email: site.supportEmail }} />
    </div>
  );
}
