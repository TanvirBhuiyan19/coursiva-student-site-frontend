import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BookingDetailView } from '@/features/bookings/components/BookingsViews';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('bookings');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * One booked session — also the join page: the booking emails' calendar invites put this URL in LOCATION, so it must
 * keep working for online sessions (join opens from 15 minutes before the start).
 */
export default async function BookingPage({ params }: PageProps<'/[tenant]/[locale]/account/bookings/[id]'>) {
  const [{ id }, t] = await Promise.all([params, getTranslations('bookings')]);
  return (
    <div className="container page" style={{ maxWidth: 'calc(760px + 2 * var(--gutter))' }}>
      <Link href={routes.accountBookings} className="muted" style={{ fontSize: 13.5 }}>
        {`← ${t('allBookings')}`}
      </Link>
      <BookingDetailView id={id} />
    </div>
  );
}
