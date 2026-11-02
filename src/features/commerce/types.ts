/** Cart, wishlist, checkout and orders. Contract: docs/api/commerce.md */
import type { Cover, Money, Person } from '@/lib/api/types';
import type { CourseSummary } from '@/features/catalog/types';
import type { ServiceInfo } from '@/features/bookings/types';
import type { PaymentSetup } from './payments';

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

/** What is being bought: one course, the whole cart, a bundle of courses, a digital download, or a membership plan. */
export type CheckoutTarget =
  | { kind: 'course'; courseSlug: string }
  | { kind: 'cart' }
  | { kind: 'bundle'; bundleSlug: string }
  | { kind: 'product'; productSlug: string }
  | { kind: 'membership'; planId: string; interval: 'month' | 'year' }
  /** A paid live session's ticket (`/checkout?live=`); `series`: one ticket for every upcoming session of its series. */
  | { kind: 'live'; liveSessionId: string; series?: boolean };

/**
 * `GET /api/v1/products/{slug}` — a product's sales page (public, cached under `t:<slug>:product:<product>`). Only what
 * the storefront sells: a digital download (buy → `/checkout?product=`), a course bundle (→ `/checkout?bundle=`) or a
 * service (1:1 sessions: pick a time, then book — docs/api/commerce.md → Service products).
 * `404` for drafts, physical products, unfinished products and services without an active host.
 */
export interface ProductPage {
  slug: string;
  kind: 'download' | 'bundle' | 'service';
  title: string;
  /** The school's Markdown (plain text on older products): rendered on the sales page, stripped elsewhere. */
  description: string;
  /** The thumbnail uploaded in the dashboard (absolute public URL), or null. */
  thumbnailUrl: string | null;
  price: Money;
  compareAtPrice: Money | null;
  /** The delivered file (downloads). */
  file: { name: string; sizeMb: number } | null;
  /** How long and how often the buyer may download it after paying (downloads). */
  delivery: { linkExpiryDays: number; downloadLimit: number } | null;
  /** The bundle's courses. */
  courses: { slug: string; title: string }[];
  /** How a session works (services only; null otherwise). */
  service: ServiceInfo | null;
}

export interface QuoteInput {
  target: CheckoutTarget;
  plan: 'full' | 'installments';
  couponCode: string | null;
  orderBump: boolean;
  seats: number;
  country: string;
  /**
   * The buyer's state or province code (`CA`, `ON`) from `Quote.subdivisions` for their country; null = none chosen.
   * Required at checkout when `Quote.taxDetails.regionRequired` (`422 region`).
   */
  region?: string | null;
  /** The buyer's VAT number (EU business buyers, reverse charge); sent when `taxDetails.acceptsTaxId`. ≤ 32 chars. */
  taxId?: string | null;
  /** One gift card per order (a tender after the total); null = none. Sent only after the learner applies it. */
  giftCard: string | null;
  /**
   * A pay-what-you-want course: the learner's amount per seat, minor units (omitted = the suggested price). Under the
   * minimum the quote reports it (`payWhatYouWant.message`) and the checkout refuses it (`422 amount`).
   */
  amount?: number | null;
  /** Tick "Frequently bought together" (`Quote.crossSell`): its courses join the order at the offer price. */
  crossSell?: boolean | null;
}

/**
 * `Quote.priceOffer`: the one offer that sets the price (the API picks the best). `countdown` = a sale until `endsAt`
 * (the API stops applying it then, whatever the page shows); `quantity` = the seat tier reached; `trial` = a free trial
 * (`trialDays`, `discountPercent` 0) or a first-month discount on a subscription course. `applied: false` = a coupon
 * replaced it (`message` says so).
 */
export interface PriceOffer {
  kind: 'countdown' | 'quantity' | 'trial';
  /** The school's copy; '' = the site's default wording. */
  headline: string;
  body: string;
  discountPercent: number;
  endsAt: string | null;
  trialDays: number | null;
  applied: boolean;
  message: string | null;
}

/** `Quote.crossSell`: companion courses at a discount, added as lines of this order when `QuoteInput.crossSell`. */
export interface CrossSell {
  headline: string;
  body: string;
  discountPercent: number;
  items: { courseSlug: string; title: string; cover: Cover; price: Money; compareAt: Money | null }[];
  /** What ticking it adds (before tax). */
  total: Money;
  selected: boolean;
}

/**
 * `GET /api/v1/orders/{id}/offer` — the thank-you page's one-click offer (an upsell, then a downsell after "No thanks"),
 * open for 30 minutes after the payment. Accepting charges the card saved at checkout; nothing is charged otherwise.
 */
export interface PostPurchaseOffer {
  /** Sent back with the decision (an offer id, or `product:{id}` for a product's own upsell). */
  key: string;
  kind: 'upsell' | 'downsell';
  /** The school's copy; '' = the site's default wording. */
  headline: string;
  body: string;
  item: { kind: 'course' | 'bundle' | 'product'; title: string; slug: string; cover: Cover; description: string };
  price: Money;
  compareAt: Money | null;
  tax: Money;
  taxLabel: string | null;
  /** What the card is charged: the price plus any added tax. */
  total: Money;
  card: { brand: string | null; last4: string | null };
  expiresAt: string;
  /** How to run the bank's challenge for the one-click charge (as `Quote.payment`); older APIs omit it. */
  payment?: PaymentSetup;
}

/** `POST /orders/{id}/offer {accept: true}` → `201`: the new order (pending + `nextAction` when the bank wants 3-D Secure). */
export type OfferAcceptResult = Order & { nextAction: { clientSecret: string } | null };

/** `Quote.giftCard`: how the gift card applies (null when none was sent). A refusal is reported here, never a 422. */
export interface QuoteGiftCard {
  /** Masked (`GIFT-••••-AB12`); the code as typed when it is malformed. */
  code: string;
  valid: boolean;
  /** Shown verbatim under the field. */
  message: string;
  /** What the card pays of `dueToday` (0 when invalid). */
  applied: Money;
  /** Left on the card after this order; null when invalid. */
  remaining: Money | null;
}

/** How the quote's tax was worked out: the API decides, the site only prints it. */
export interface TaxDetails {
  /** Prices include the tax: `tax` is extracted and not added (print "Includes {taxLabel}"). */
  inclusive: boolean;
  /** Percent (20, 7.25); null when there is no tax. */
  rate: number | null;
  /** A verified EU VAT number: no VAT charged (`tax` 0, `taxLabel` "Reverse charge", `note` to print). */
  reverseCharge: boolean;
  /** The school's registration that collects it ("United Kingdom", "European Union (OSS)"); null = no tax. */
  region: string | null;
  provider: 'builtin' | 'stripe' | null;
  /** Printed under the totals (the reverse-charge wording). */
  note: string | null;
  /** Show the "VAT number (optional)" field. */
  acceptsTaxId: boolean;
  /** The buyer must choose a state or province (`subdivisions`) before paying. */
  regionRequired: boolean;
  /** The sent `taxId`'s check; null when none was sent or it doesn't apply. `message` is shown under the field. */
  taxId: { status: 'valid' | 'invalid' | 'unverified'; message: string | null } | null;
}

/** A US state or Canadian province/territory (`code` is what `QuoteInput.region` sends). */
export interface Subdivision {
  country: string;
  code: string;
  name: string;
}

/** `POST /api/v1/checkout/quote` — every total on the checkout page comes from here (one owner). */
export interface Quote {
  /** `compareAt` = the list price when an offer lowered this line (shown struck through); null otherwise. */
  lines: { title: string; cover: Cover; price: Money; quantity: number; compareAt?: Money | null }[];
  /** What offers take off the list prices (sale, seat tier, cross-sell, order bump): "You save {savings}". */
  savings?: Money;
  priceOffer?: PriceOffer | null;
  /** The seat tiers of the live team-pricing offer (course and bundle purchases); empty when none. */
  quantityTiers?: { minSeats: number; discountPercent: number }[];
  crossSell?: CrossSell | null;
  subtotal: Money;
  discount: Money;
  coupon: { code: string; valid: boolean; message: string } | null;
  /**
   * `description` is the product's Markdown, shown as plain text. `headline` = the school's copy ('' = default);
   * `compareAt` = the list price when the bump is discounted.
   */
  orderBump: { title: string; description: string; headline?: string; price: Money; compareAt?: Money | null; selected: boolean } | null;
  /** Always the tax amount, whether it is added (exclusive) or included in the prices (`taxDetails.inclusive`). */
  tax: Money;
  /** "VAT (20%)", "Sales tax (7.25%)", "Reverse charge"; null = no tax line. */
  taxLabel: string | null;
  taxDetails: TaxDetails;
  total: Money;
  dueToday: Money;
  /** The gift card's part (a line after the total). */
  giftCard: QuoteGiftCard | null;
  /** What the card is charged now: `dueToday` − the gift card's part. 0 = fully covered (no payment step). */
  payToday: Money;
  installments: { count: number; amount: Money } | null;
  /** One-off price after discounts, before add-ons and tax (the "Pay in full" option). */
  fullAmount: Money;
  /** Offered only for single-course purchases with a plan. */
  installmentOption: { count: number; amount: Money } | null;
  /**
   * What renews after today (a membership, or a subscription course): each period's charge, tax included, until the
   * learner cancels. null = a one-off purchase.
   */
  recurring: { interval: 'month' | 'year'; amount: Money; trialDays: number } | null;
  /** A pay-what-you-want course: the learner's amount (per seat). `message` when it is under the minimum. */
  payWhatYouWant: { minimum: Money; suggested: Money; amount: Money; message: string | null } | null;
  bnpl: { count: number; amount: Money };
  countries: string[];
  /** States and provinces for the countries that have them (static): the state select under the country. */
  subdivisions: Subdivision[];
  /** Social proof shown beside the order summary. */
  proof: { quote: string; author: Person; context: string; rating: number } | null;
  /** Students enrolled in the purchased course this year (single-course checkouts only). */
  enrolledCount: number | null;
  guaranteeDays: number;
  /** How the site collects payment details (Stripe Payment Element, or test cards with the fake gateway). */
  payment: PaymentSetup;
  /**
   * The card is kept for later charges: instalments, a subscription, or the one-click offer after payment. Drives the
   * Payment Element's `setupFutureUsage` (older APIs omit it: then instalments and subscriptions only).
   */
  saveCard?: boolean;
  /** A one-click offer follows the payment on the thank-you page (the card is kept for it). */
  postPurchase?: boolean;
}

export interface CheckoutInput extends QuoteInput {
  name: string;
  email: string;
  acceptTerms: boolean;
  paymentMethod: PaymentMethod;
  bnplProvider: BnplProvider | null;
  /**
   * From the payment boundary (../payments.ts): a Stripe ConfirmationToken (`ctoken_…`) from the Payment Element, or a
   * test token (`tok_visa`) with the fake gateway. Null when nothing is due (free orders, or fully covered by a gift
   * card — a membership still saves a card).
   */
  paymentToken: string | null;
  gift: { recipientEmail: string; message: string } | null;
  /** The referring partner's slug (`?ref=` link, kept for the school's cookie window), for the affiliate program. */
  ref?: string | null;
  /** The partner link's click id (`POST /affiliates/{slug}/clicks`); without it the API credits nobody. */
  refClick?: string | null;
  /** The blog post the buyer last came from (last-click blog revenue). */
  post?: string | null;
  /** First-touch hints for the order's source; the site adds them from the browser session (features/analytics). */
  acquisition?: Acquisition | null;
}

/** `acquisition` on `POST /checkout`: the visit's first touch. Every field is optional; the API labels the source. */
export interface Acquisition {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** Origin of an external referrer (`https://www.google.com`). */
  referrer?: string;
  /** Ad click ids from the landing URL: Google, Meta, TikTok, LinkedIn (`li_fat_id`), Microsoft, Pinterest, X. */
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
  liFatId?: string;
  msclkid?: string;
  epik?: string;
  twclid?: string;
  /** Set by the mobile app, never by the site. */
  app?: boolean;
}

export interface OrderItem {
  /** `product` = a digital download (delivered under Account → Downloads); `live` = a live class ticket. */
  kind: 'course' | 'membership' | 'bundle' | 'product' | 'live';
  title: string;
  meta: string;
  cover: Cover;
  unitPrice: Money;
  quantity: number;
  /** This line's share of the order's tax (0 without tax). */
  tax: Money;
  courseSlug: string | null;
  /** The item's id (course, bundle, product, plan or session), as the server-side purchase conversion sends it. */
  refId: string | null;
  /** A live ticket's session (a series ticket: the session it was bought from); null on other lines. */
  liveSessionId: string | null;
}

/**
 * An order's status on the site: `pending` (the bank is still confirming), `failed` (the payment didn't go through),
 * `paid`, `refunded` or `partially_refunded` (a disputed payment still reads `paid`).
 */
export type OrderStatus = 'paid' | 'pending' | 'failed' | 'refunded' | 'partially_refunded';

/** `GET /api/v1/me/orders` — one row of the learner's order history (paginated, newest first). */
export interface OrderSummary {
  id: string;
  number: string;
  createdAt: string;
  status: OrderStatus;
  /** The first item's title; `itemCount` says how many items the order has. */
  title: string;
  itemCount: number;
  total: Money;
  refunded: Money;
  /** The payment was captured, so the order has a receipt and an invoice (not pending or failed). */
  hasInvoice: boolean;
}

/** `GET /api/v1/orders/{id}` (and `GET /api/v1/me/orders/{id}`) — also the invoice. */
export interface Order {
  id: string;
  number: string;
  /** "INV-0001": assigned when the payment is captured (null until paid). */
  invoiceNumber: string | null;
  createdAt: string;
  status: OrderStatus;
  /** When the payment was captured (null while pending or failed). */
  paidAt: string | null;
  items: OrderItem[];
  subtotal: Money;
  discount: Money;
  couponCode: string | null;
  orderBump: Money | null;
  /** Always the tax amount (included or added, see `taxDetails`). */
  tax: Money;
  taxLabel: string | null;
  taxDetails: { inclusive: boolean; rate: number | null; reverseCharge: boolean; note: string | null };
  total: Money;
  dueToday: Money;
  installments: { count: number; amount: Money } | null;
  /** What was refunded so far (to the card and any gift card). */
  refunded: Money;
  /** One credit note per refund, oldest first ("CN-0001": the school's prefix + a gap-free sequence). */
  creditNotes: { number: string; amount: Money; createdAt: string }[];
  /** The card brand and last digits, or `Gift card` when the gift card paid everything. */
  paymentMethod: string;
  /** What a gift card paid of `total` and what was returned to it; null when none was used. */
  giftCard: { code: string; amount: Money; refunded: Money } | null;
  /** `total` less the gift card's part: what the card was charged. */
  paidByCard: Money;
  gift: { recipientEmail: string; claimUrl: string } | null;
  seats: { quantity: number; claimUrls: string[] } | null;
  /** `region` = the state/province code; `taxId` = the buyer's VAT number as sent (null when none). */
  billing: { name: string; email: string; country: string; region: string | null; taxId: string | null };
  /**
   * The school as the seller, from its business details: `legalName`, `address` (multi-line) and `taxId` are null when
   * the school hasn't set them. `taxId` = the collecting registration's number when set, else the business tax ID.
   */
  seller: { name: string; legalName: string | null; email: string; address: string | null; taxId: string | null };
  /** First lesson to start when the order unlocked a single course. */
  startLesson: { courseSlug: string; lessonId: string } | null;
}

/** `POST /checkout` → `201`: the order, plus the bank's challenge when the card needs 3-D Secure (order stays pending). */
export type CheckoutResult = Order & { nextAction: { clientSecret: string } | null };

export interface WishlistItem {
  course: CourseSummary;
  addedAt: string;
}
