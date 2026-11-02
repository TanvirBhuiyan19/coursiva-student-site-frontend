import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BookingsView } from '@/features/bookings/components/BookingsViews';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('bookings');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** The learner's 1:1 sessions: credits to book, upcoming (incl. held times) and past sessions. */
export default async function BookingsPage() {
  const [t, ta] = await Promise.all([getTranslations('bookings'), getTranslations('account')]);
  return (
    <div className="container page" style={{ maxWidth: 'calc(760px + 2 * var(--gutter))' }}>
      <Link href={routes.account} className="muted" style={{ fontSize: 13.5 }}>
        {`← ${ta('title')}`}
      </Link>
      <h1 className="h1-sm" style={{ marginTop: 8 }}>
        {t('title')}
      </h1>
      <BookingsView />
    </div>
  );
}
