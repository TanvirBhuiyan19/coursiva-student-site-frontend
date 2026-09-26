/** Cart, wishlist, checkout and orders. Contract: docs/api/commerce.md */
import type { Cover, Money, Person } from '@/lib/api/types';
import type { CourseSummary } from '@/features/catalog/types';

export interface CartItem {
  courseId: string;
  courseSlug: string;
  title: string;
  cover: Cover;
  price: Money;
  lessonCount: number;
  durationMinutes: number;
}

/** `GET /api/v1/cart` — guests get a cart keyed by an httpOnly cookie; it merges into the account on sign-in. */
export interface Cart {
  items: CartItem[];
  subtotal: Money;
  recommendations: CourseSummary[];
}

export type PaymentMethod = 'card' | 'paypal' | 'bnpl' | 'wallet';
export type BnplProvider = 'klarna' | 'afterpay';

/** What is being bought: one course, the whole cart, a bundle of courses, or a membership plan. */
export type CheckoutTarget =
  | { kind: 'course'; courseSlug: string }
  | { kind: 'cart' }
  | { kind: 'bundle'; bundleSlug: string }
  | { kind: 'membership'; planId: string; interval: 'month' | 'year' };

export interface QuoteInput {
  target: CheckoutTarget;
  plan: 'full' | 'installments';
  couponCode: string | null;
  orderBump: boolean;
  seats: number;
  country: string;
}

/** `POST /api/v1/checkout/quote` — every total on the checkout page comes from here (one owner). */
export interface Quote {
  lines: { title: string; cover: Cover; price: Money; quantity: number }[];
  subtotal: Money;
  discount: Money;
  coupon: { code: string; valid: boolean; message: string } | null;
  orderBump: { title: string; description: string; price: Money; selected: boolean } | null;
  tax: Money;
  taxLabel: string | null;
  total: Money;
  dueToday: Money;
  installments: { count: number; amount: Money } | null;
  /** One-off price after discounts, before add-ons and tax (the "Pay in full" option). */
  fullAmount: Money;
  /** Offered only for single-course purchases with a plan. */
  installmentOption: { count: number; amount: Money } | null;
  bnpl: { count: number; amount: Money };
  countries: string[];
  /** Social proof shown beside the order summary. */
  proof: { quote: string; author: Person; context: string; rating: number } | null;
  /** Students enrolled in the purchased course this year (single-course checkouts only). */
  enrolledCount: number | null;
  guaranteeDays: number;
}

export interface CheckoutInput extends QuoteInput {
  name: string;
  email: string;
  acceptTerms: boolean;
  paymentMethod: PaymentMethod;
  bnplProvider: BnplProvider | null;
  /** Token from the payment provider's hosted fields (Stripe Elements in production; a test token in the mock). */
  paymentToken: string | null;
  gift: { recipientEmail: string; message: string } | null;
}

export interface OrderItem {
  kind: 'course' | 'membership' | 'bundle';
  title: string;
  meta: string;
  cover: Cover;
  unitPrice: Money;
  quantity: number;
  courseSlug: string | null;
}

/** `GET /api/v1/orders/{id}` — also the invoice. */
export interface Order {
  id: string;
  number: string;
  createdAt: string;
  status: 'paid' | 'pending';
  items: OrderItem[];
  subtotal: Money;
  discount: Money;
  couponCode: string | null;
  orderBump: Money | null;
  tax: Money;
  taxLabel: string | null;
  total: Money;
  dueToday: Money;
  installments: { count: number; amount: Money } | null;
  paymentMethod: string;
  gift: { recipientEmail: string; claimUrl: string } | null;
  seats: { quantity: number; claimUrls: string[] } | null;
  billing: { name: string; email: string; country: string };
  seller: { name: string; email: string };
  /** First lesson to start when the order unlocked a single course. */
  startLesson: { courseSlug: string; lessonId: string } | null;
}

export interface WishlistItem {
  course: CourseSummary;
  addedAt: string;
}
