import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LiveRoom } from '@/features/live/components/LiveViews';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('live');
  return { title: t('roomMeta'), robots: { index: false, follow: false } };
}

/** The built-in room (the RSVP's join link): attendance, questions, chat, raised hands and polls. */
export default async function LiveRoomPage({ params }: PageProps<'/[tenant]/[locale]/live/[id]/room'>) {
  const { id } = await params;
  return (
    <div className="container page" style={{ paddingTop: 40, paddingBottom: 90 }}>
      <LiveRoom id={id} />
    </div>
  );
}
