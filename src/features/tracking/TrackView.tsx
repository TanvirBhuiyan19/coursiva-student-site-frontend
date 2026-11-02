'use client';
import { useEffect } from 'react';
import type { Money } from '@/lib/api/types';
import { major, trackEvent } from './events';

/** `view_item` for a course or product page (sent to the tags the visitor allowed, once per page view). */
export function TrackView({ id, name, price }: { id: string; name: string; price: Money }) {
  useEffect(() => {
    const value = major(price);
    trackEvent({ name: 'view_item', item: { id, name, price: value, quantity: 1 }, currency: price.currency, value });
  }, [id, name, price]);
  return null;
}
