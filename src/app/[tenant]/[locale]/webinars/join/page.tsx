import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WebinarJoin } from '@/features/webinars/components/WebinarJoin';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('webinars.join');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Reads the link's token from the URL on the server, so it renders per request — it is private anyway. */
export const dynamic = 'force-dynamic';

/** The personal join link of a webinar registration email (`?t=`): signs a guest in and opens the session. */
export default async function WebinarJoinPage({ searchParams }: PageProps<'/[tenant]/[locale]/webinars/join'>) {
  const t = (await searchParams).t;
  const token = typeof t === 'string' && t.length > 0 && t.length <= 64 ? t : null;
  return (
    <div className="container page" style={{ paddingTop: 72, paddingBottom: 90 }}>
      <WebinarJoin token={token} />
    </div>
  );
}
