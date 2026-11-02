'use client';
import { useEffect } from 'react';
import type { Order } from '@/features/commerce/types';
import { major, trackEvent, type TrackItem } from './events';

/**
 * `purchase` for a paid order on its success page: once per order (events.ts keeps a marker), with the order id the
 * API's server-side copy uses (`purchase_{id}`), so Meta and TikTok count it once and GA4 de-duplicates the
 * transaction. Value = what the order charged today (`dueToday`), as the server sends.
 */
export function TrackPurchase({ order }: { order: Order }) {
  const paid = order.status === 'paid';
  useEffect(() => {
    if (!paid) return;
    trackEvent({
      name: 'purchase',
      orderId: order.id,
      currency: order.dueToday.currency,
      value: major(order.dueToday),
      items: purchaseItems(order),
    });
  }, [paid, order]);
  return null;
}

/** The order's items as the purchase event sends them: ids are the lines' `refId`, as in the server-side copy. */
export function purchaseItems(order: Pick<Order, 'items'>): TrackItem[] {
  return order.items.map((i) => ({ id: i.refId ?? i.title, name: i.title, price: major(i.unitPrice), quantity: i.quantity }));
}
