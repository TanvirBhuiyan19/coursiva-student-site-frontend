import type { TenantData } from './records';

/** Active partners of the mock (Laravel aff_partners with status Active). */
export const ACTIVE_PARTNERS = new Set(['maya']);

/** The school's partner program rules (Laravel Affiliates::program defaults when the seed sets none). */
export function affiliateProgram(t: TenantData): NonNullable<TenantData['affiliateProgram']> {
  return (
    t.affiliateProgram ?? {
      commissionType: 'percent',
      fixedAmount: 1000,
      cookieDays: 30,
      attribution: 'last_click',
      recurring: false,
      recurringMonths: 12,
    }
  );
}

/**
 * Laravel Referrals::attribute: the order is credited only to an Active partner, for a click of that partner inside
 * the program's cookie window (0 = no expiry). Without a click id nobody is credited.
 */
export function creditedClick(t: TenantData, ref: string | null, click: string | null, now = Date.now()): boolean {
  if (!ref || !click) return false;
  const slug = ref.trim().toLowerCase();
  if (!ACTIVE_PARTNERS.has(slug)) return false;
  const days = affiliateProgram(t).cookieDays;
  return (t.affiliateClicks ?? []).some(
    (c) => c.id === click.trim() && c.partner === slug && (days === 0 || now - c.at <= days * 86_400_000),
  );
}
