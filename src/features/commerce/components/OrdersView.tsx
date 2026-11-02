'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useOrders } from '../api';
import type { OrderStatus } from '../types';
import styles from './Commerce.module.css';

/** The tag class for an order status (shared by the history, the order page and the invoice). */
export const ORDER_STATUS_TAG: Record<OrderStatus, string> = {
  paid: 'tag-good',
  pending: 'tag-warn',
  failed: 'tag-bad',
  refunded: 'tag-soft',
  partially_refunded: 'tag-soft',
};

export function OrderStatusTag({ status }: { status: OrderStatus }) {
  const t = useTranslations('order');
  return <span className={`tag ${ORDER_STATUS_TAG[status]}`}>{t(`status.${status}`)}</span>;
}

/**
 * `/account/orders`: the learner's order history, newest first, ten per page, with each order's receipt (the order
 * page) and its invoice once the payment went through.
 */
export function OrdersView() {
  const t = useTranslations('orders');
  const tc = useTranslations('common');
  const f = useFormat();
  const [page, setPage] = useState(1);
  const { data, isPending, isError, isFetching, refetch } = useOrders(page);

  if (isPending) return <div className="skeleton" style={{ height: 260, marginTop: 24 }} aria-label={tc('loading')} />;
  if (isError)
    return (
      <div className="alert alert-bad" role="alert" style={{ marginTop: 24 }}>
        {t('error')}{' '}
        <button type="button" className="link-btn" onClick={() => void refetch()}>
          {tc('retry')}
        </button>
      </div>
    );
  if (data.data.length === 0)
    return (
      <div className={styles.ordersEmpty}>
        <p>{t('empty')}</p>
        <Link href={routes.courses} className="btn btn-primary">
          {t('browse')}
        </Link>
      </div>
    );

  const { currentPage, lastPage, total } = data.meta;
  return (
    <section aria-labelledby="orders-t" aria-busy={isFetching} style={{ marginTop: 24 }}>
      <h2 id="orders-t" className="sr-only">
        {t('listLabel', { count: total })}
      </h2>
      <ul className={styles.orderList}>
        {data.data.map((o) => (
          <li key={o.id} className={styles.orderRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className={styles.lineTitle}>{o.itemCount > 1 ? t('titleMore', { title: o.title, count: o.itemCount - 1 }) : o.title}</p>
              <p className={styles.lineMeta}>{t('meta', { number: o.number, date: f.date(o.createdAt) })}</p>
            </div>
            <div className={styles.orderFigures}>
              <span className="num">{f.money(o.total)}</span>
              {o.refunded.amount > 0 && <span className={styles.lineMeta}>{t('refunded', { amount: f.money(o.refunded) })}</span>}
              <OrderStatusTag status={o.status} />
            </div>
            <div className={styles.orderLinks}>
              <Link href={routes.order(o.id)} aria-label={t('receiptFor', { number: o.number })}>
                {t('receipt')}
              </Link>
              {o.hasInvoice && (
                <Link href={routes.invoice(o.id)} aria-label={t('invoiceFor', { number: o.number })}>
                  {t('invoice')}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      {lastPage > 1 && (
        <nav className={styles.pager} aria-label={t('pages')}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={currentPage <= 1 || isFetching}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('previous')}
          </button>
          <span className="muted" aria-live="polite">
            {t('pageOf', { page: currentPage, pages: lastPage })}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={currentPage >= lastPage || isFetching}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('next')}
          </button>
        </nav>
      )}
    </section>
  );
}
