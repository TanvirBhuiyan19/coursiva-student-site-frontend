/** The school's partner (affiliate) program. Contract: docs/api/commerce.md → Partner program. */
import type { Money } from '@/lib/api/types';

/**
 * `GET /api/v1/affiliates/program` — public terms. `rate` is what a new partner starts on (%); a fixed-amount program
 * pays `fixedAmount` per sale instead (then `rate` is 0 and `tiers` null).
 */
export interface PartnerProgram {
  school: string;
  rate: number;
  commissionType: 'percent' | 'fixed';
  /** The amount per sale of a fixed program; null for a percentage. */
  fixedAmount: Money | null;
  /** Commission tiers, or null for one flat rate (or a fixed amount). */
  tiers: { name: string; rate: number; rule: string }[] | null;
  /** How long a click counts (the school's cookie window); 0 = no expiry. */
  cookieDays: number;
  recurring: boolean;
  /** With `recurring`: how long renewals earn from the first sale, in months; 0 = as long as the subscription lasts. */
  recurringMonths: number;
  refundHoldDays: number;
  minPayout: Money;
  /** Marketing assets the school hosts for partners; `url` is the public download link (counts a download). */
  assets: PartnerAsset[];
}

export interface PartnerAsset {
  id: string;
  name: string;
  /** e.g. "PNG · 1.2 MB". */
  meta: string;
  url: string;
}

/** `POST /api/v1/affiliates/applications` → `201`. `link` (`/?ref=<slug>`) when the program approves at once. */
export interface PartnerApplicationInput {
  name: string;
  email: string;
  pitch: string;
}

export interface PartnerApplication {
  status: 'pending' | 'active';
  link: string | null;
}
