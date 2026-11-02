'use client';
import { api } from '@/lib/api/client';
import type { AffiliateClick } from './referral';

/**
 * Records a partner-link visit (`POST /affiliates/{slug}/clicks` → `201 { click_id, cookie_days, attribution }`).
 * Best effort: an unknown or inactive partner (404), a network error or an unexpected answer resolve null.
 */
export async function reportAffiliateClick(slug: string): Promise<AffiliateClick | null> {
  try {
    const click = await api.post<Partial<AffiliateClick> | undefined>(`/affiliates/${encodeURIComponent(slug)}/clicks`);
    if (
      typeof click?.clickId !== 'string' ||
      typeof click.cookieDays !== 'number' ||
      (click.attribution !== 'first_click' && click.attribution !== 'last_click')
    )
      return null;
    return { clickId: click.clickId, cookieDays: click.cookieDays, attribution: click.attribution };
  } catch {
    return null;
  }
}
