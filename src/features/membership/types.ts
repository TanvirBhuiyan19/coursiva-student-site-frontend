/** Membership plans. Contract: docs/api/membership.md */
import type { Money } from '@/lib/api/types';

export type BillingInterval = 'month' | 'year';

export interface MembershipPlan {
  id: string;
  name: string;
  /** Short line used on the storefront home cards. */
  summary: string;
  features: string[];
  popular: boolean;
  /** Price per month for each interval (annual is shown per month, billed yearly). Computed by the API. */
  prices: { interval: BillingInterval; perMonth: Money; billed: Money }[];
}

export interface PlanComparisonRow {
  label: string;
  /** One cell per plan, in `plans` order. `true` = included, `false` = not included, string = a value. */
  values: (boolean | string)[];
}

/** `GET /api/v1/membership` */
export interface Membership {
  title: string;
  subtitle: string;
  annualDiscountPercent: number;
  guaranteeDays: number;
  plans: MembershipPlan[];
  comparison: PlanComparisonRow[];
  testimonial: { quote: string; author: string; context: string; initials: string; color: string; rating: number } | null;
  faqs: { question: string; answer: string }[];
}
