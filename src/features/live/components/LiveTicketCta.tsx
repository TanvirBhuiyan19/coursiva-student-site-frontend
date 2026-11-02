'use client';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/icons';
import type { LiveTicketOffer } from '@/features/learning/types';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import styles from './LiveTicketCta.module.css';

/**
 * Track F: the way in to a paid or members-only live session for a learner without a seat (`ticket.hasAccess` false;
 * the RSVP endpoint answers 402 for them). A paid session sells a ticket through the normal checkout (and, when the
 * school sells one, a ticket for the whole series); a members-only session points to the membership page. Sold out:
 * nothing to buy. The price is the API's.
 */
export function LiveTicketCta({ sessionId, ticket }: { sessionId: string; ticket: LiveTicketOffer }) {
  const t = useTranslations('liveTickets');
  const f = useFormat();

  if (ticket.access === 'members')
    return (
      <div className={styles.cta} data-testid="live-ticket-cta" data-access="members">
        <p className={styles.note}>
          <Icon name="lock" size={15} /> {t('membersNote')}
        </p>
        <div className={styles.row}>
          <Link href={routes.membership} className="btn btn-primary btn-lg">
            {t('joinMembership')}
          </Link>
        </div>
      </div>
    );

  if (ticket.soldOut)
    return (
      <div className={styles.cta} data-testid="live-ticket-cta" data-access="sold-out">
        <div className={styles.row}>
          <button type="button" className="btn btn-primary btn-lg" disabled>
            {t('soldOut')}
          </button>
        </div>
        <p className={styles.note}>{t('soldOutNote')}</p>
      </div>
    );

  return (
    <div className={styles.cta} data-testid="live-ticket-cta" data-access="paid">
      <div className={styles.row}>
        {ticket.price && (
          <Link href={routes.checkoutLive(sessionId)} className="btn btn-primary btn-lg">
            {t('buy', { price: f.money(ticket.price) })}
          </Link>
        )}
        {ticket.seriesPrice && (
          <Link href={routes.checkoutLive(sessionId, true)} className="btn btn-outline btn-lg">
            {t('buySeries', { price: f.money(ticket.seriesPrice) })}
          </Link>
        )}
      </div>
      <p className={styles.note}>{t('paidNote')}</p>
    </div>
  );
}
