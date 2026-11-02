import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LiveScheduleView } from '@/features/live/components/LiveSchedule';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('liveSchedule');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** The learner's live classes: upcoming sessions across their courses and spaces, their RSVPs, replays, calendar feed. */
export default async function LiveSchedulePage() {
  const t = await getTranslations('liveSchedule');
  return (
    <div className="container page">
      <p className="eyebrow eyebrow-brand">{t('eyebrow')}</p>
      <h1 className="h1-sm" style={{ marginTop: 6 }}>
        {t('title')}
      </h1>
      <p className="lead" style={{ marginTop: 6, marginBottom: 28, maxWidth: 640 }}>
        {t('subtitle')}
      </p>
      <LiveScheduleView />
    </div>
  );
}
