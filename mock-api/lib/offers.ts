/**
 * Checkout offers (Laravel Commerce\Coupons\Offers + Checkout\PostPurchase; docs/api/commerce.md → Offers): the
 * school's countdown sales, seat tiers, free trials, cross-sells and the thank-you page's one-click upsell / downsell.
 * The order bump stays `TenantData.orderBump` (its offer copy and discount are optional fields there).
 */
import type { PostPurchaseOffer } from '@/features/commerce/types';
import { isEnrolled, money } from './present';
import type { OrderRow, TenantData, UserRow } from './records';
import { addedTax, resolveTax, taxOn } from './tax';

export type OfferKind = 'upsell' | 'downsell' | 'cross_sell' | 'quantity' | 'countdown' | 'trial';

/** One offer row (Laravel `offers` with its `config`). Ids: course ids, product ids, bundle slugs. */
export interface OfferRow {
  id: string;
  kind: OfferKind;
  title: string;
  enabled: boolean;
  /** Starts at (null = now). */
  startsAt: string | null;
  /** Ends at (countdown: required); the API stops applying it then. */
  endsAt: string | null;
  createdAt: string;
  headline: string;
  body: string;
  discountPercent: number;
  /** upsell / downsell: what is offered (`product` = a download id or a bundle slug). */
  item?: { kind: 'course' | 'product'; id: string } | null;
  /** cross_sell: the companion course ids (1–3). */
  courseIds?: string[];
  /** quantity: seat tiers, ascending. */
  tiers?: { minSeats: number; discountPercent: number }[];
  /** trial: a free trial of `trialDays`, or `discountPercent` off the first month. */
  trialMode?: 'trial' | 'first_period' | null;
  trialDays?: number | null;
  appliesTo: { kind: 'all' | 'courses'; courseIds: string[] };
}

/** `offer_events` (only what the post-purchase flow reads: per checkout order, kind and event). */
export interface OfferEventRow {
  orderId: string;
  kind: 'upsell' | 'downsell';
  event: 'view' | 'take' | 'decline';
  offerId: string | null;
  resultOrderId: string | null;
  amount: number;
}

/** Laravel Offers::WINDOW_MINUTES: the thank-you offer closes 30 minutes after the payment. */
export const WINDOW_MINUTES = 30;

/** Sale price: `list − round(list × P / 100)`. */
export const off = (price: number, percent: number) => price - Math.round((price * percent) / 100);

/** Offers::live: enabled, started, not ended; for these courses (`applies_to`), chosen courses first, then the oldest. */
export function liveOffer(t: TenantData, kind: OfferKind, courseIds: string[], usable?: (o: OfferRow) => boolean): OfferRow | null {
  const now = Date.now();
  const rows = (t.offers ?? [])
    .filter(
      (o) =>
        o.kind === kind &&
        o.enabled &&
        (o.startsAt === null || Date.parse(o.startsAt) <= now) &&
        (o.endsAt === null || Date.parse(o.endsAt) > now) &&
        (o.appliesTo.kind === 'all' || o.appliesTo.courseIds.some((id) => courseIds.includes(id))),
    )
    .sort(
      (a, b) =>
        Number(b.appliesTo.kind === 'courses') - Number(a.appliesTo.kind === 'courses') ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  return rows.find((o) => !usable || usable(o)) ?? null;
}

/** OfferRules::sellable: a one-time course with a price (subscriptions, PWYW and membership courses aren't). */
export const sellableCourse = (t: TenantData, id: string) => {
  const c = t.courses.find((x) => x.id === id);
  return c && !c.pricing && c.price > 0 ? c : undefined;
};

/** The learner ever subscribed to this course (a trial offer is for new subscribers). */
export const hadSubscription = (t: TenantData, user: UserRow | null, courseId: string) =>
  !!user && (t.subscriptions?.rows ?? []).some((r) => r.userId === user.id && r.kind === 'course' && r.refId === courseId);

export interface OfferItem {
  kind: 'course' | 'bundle' | 'product';
  /** Course id, bundle slug or product id. */
  id: string;
  title: string;
  slug: string;
  color: string;
  description: string;
  price: number;
  courseIds: string[];
}

/** PostPurchase::resolve: the item when it can still be sold to this learner, never part of the purchase it follows. */
export function resolveItem(
  t: TenantData,
  item: OfferRow['item'],
  bought: string[],
  boughtProduct: string | null,
  user: UserRow | null,
): OfferItem | null {
  if (!item) return null;
  if (item.kind === 'course') {
    const c = sellableCourse(t, item.id);
    if (!c || bought.includes(c.id) || isEnrolled(t, user, c.id)) return null;
    return {
      kind: 'course',
      id: c.id,
      title: c.title,
      slug: c.slug,
      color: c.coverColor,
      description: c.excerpt,
      price: c.price,
      courseIds: [c.id],
    };
  }
  if (item.id === boughtProduct) return null;
  const bundle = t.bundles.find((b) => b.slug === item.id);
  if (bundle) {
    const ids = bundle.courseSlugs.map((s) => t.courses.find((c) => c.slug === s)?.id).filter((x): x is string => !!x);
    if (!ids.some((id) => !bought.includes(id) && !isEnrolled(t, user, id))) return null;
    const first = t.courses.find((c) => c.id === ids[0]);
    return {
      kind: 'bundle',
      id: bundle.slug,
      title: bundle.title,
      slug: bundle.slug,
      color: first?.coverColor ?? 'oklch(0.9 0.03 275)',
      description: bundle.description,
      price: bundle.price,
      courseIds: ids,
    };
  }
  const p = (t.products ?? []).find((x) => x.id === item.id);
  if (!p) return null;
  const owned =
    !!user &&
    t.orders.some(
      (o) =>
        o.userId === user.id &&
        o.status !== 'pending' &&
        o.status !== 'failed' &&
        o.items.some((i) => i.kind === 'product' && i.refId === p.id),
    );
  if (owned) return null;
  return {
    kind: 'product',
    id: p.id,
    title: p.title,
    slug: p.slug,
    color: 'oklch(0.9 0.03 275)',
    description: p.description,
    price: p.price,
    courseIds: [],
  };
}

/** CheckoutPricing::upsellFollows: a one-click offer will follow this purchase (so the card is kept for it). */
export function upsellFollows(t: TenantData, kind: string, productId: string | null, courseIds: string[], user: UserRow | null): boolean {
  if (!['course', 'cart', 'bundle', 'product'].includes(kind)) return false;
  const product = productId ? (t.products ?? []).find((p) => p.id === productId) : undefined;
  if (product?.upsellProductId && resolveItem(t, { kind: 'product', id: product.upsellProductId }, courseIds, product.id, user))
    return true;
  return liveOffer(t, 'upsell', courseIds, (o) => resolveItem(t, o.item ?? null, courseIds, productId, user) !== null) !== null;
}

/* ── Post-purchase (thank-you page) ───────────────────────────────────────── */

const events = (t: TenantData) => (t.offerEvents ??= []);
export const recorded = (t: TenantData, orderId: string, kind: OfferEventRow['kind'], event: OfferEventRow['event']) =>
  events(t).some((e) => e.orderId === orderId && e.kind === kind && e.event === event);

/** Offers::record: one event per order, kind and event. */
export function record(t: TenantData, e: OfferEventRow) {
  if (!recorded(t, e.orderId, e.kind, e.event)) events(t).push(e);
}

export function unrecord(t: TenantData, orderId: string, kind: OfferEventRow['kind'], event: OfferEventRow['event']) {
  t.offerEvents = events(t).filter((e) => !(e.orderId === orderId && e.kind === kind && e.event === event));
}

/** The courses an order bought (bundles: their courses). */
export const orderCourseIds = (t: TenantData, o: OrderRow) =>
  o.items.flatMap((i) =>
    i.kind === 'course'
      ? [i.refId]
      : i.kind === 'bundle'
        ? (t.bundles.find((b) => b.slug === i.refId)?.courseSlugs ?? [])
            .map((s) => t.courses.find((c) => c.slug === s)?.id)
            .filter((x): x is string => !!x)
        : [],
  );

const paidAt = (o: OrderRow) => o.paidAt ?? o.createdAt;

export interface CurrentOffer {
  step: 'upsell' | 'downsell';
  key: string;
  offerId: string | null;
  item: OfferItem;
  price: number;
  headline: string;
  body: string;
}

/** PostPurchase::current: the upsell first; the downsell only after the upsell was declined. */
export function currentOffer(t: TenantData, parent: OrderRow, user: UserRow): CurrentOffer | null {
  if (
    parent.userId !== user.id ||
    parent.status !== 'paid' ||
    !parent.offerPaymentReference ||
    parent.seats !== null ||
    parent.gift !== null ||
    Date.parse(paidAt(parent)) < Date.now() - WINDOW_MINUTES * 60_000
  )
    return null;
  const bought = orderCourseIds(t, parent);
  const first = parent.items[0];
  const boughtProduct = first && first.kind === 'product' ? first.refId : null;
  const usable = (o: OfferRow) => resolveItem(t, o.item ?? null, bought, boughtProduct, user) !== null;
  const offered = (step: CurrentOffer['step'], o: OfferRow): CurrentOffer | null => {
    const item = resolveItem(t, o.item ?? null, bought, boughtProduct, user);
    return item
      ? { step, key: o.id, offerId: o.id, item, price: off(item.price, o.discountPercent), headline: o.headline, body: o.body }
      : null;
  };
  if (!recorded(t, parent.id, 'upsell', 'take') && !recorded(t, parent.id, 'upsell', 'decline')) {
    const product = boughtProduct ? (t.products ?? []).find((p) => p.id === boughtProduct) : undefined;
    const own = product?.upsellProductId
      ? resolveItem(t, { kind: 'product', id: product.upsellProductId }, bought, product.id, user)
      : null;
    if (own && product)
      return { step: 'upsell', key: `product:${product.id}`, offerId: null, item: own, price: own.price, headline: '', body: '' };
    const o = liveOffer(t, 'upsell', bought, usable);
    return o ? offered('upsell', o) : null;
  }
  if (
    recorded(t, parent.id, 'upsell', 'decline') &&
    !recorded(t, parent.id, 'downsell', 'take') &&
    !recorded(t, parent.id, 'downsell', 'decline')
  ) {
    const o = liveOffer(t, 'downsell', bought, usable);
    return o ? offered('downsell', o) : null;
  }
  return null;
}

/** The contract's `PostPurchaseOffer`: taxed for the checkout's billing address, charged to its card. */
export function presentOffer(t: TenantData, cur: CurrentOffer, parent: OrderRow): PostPurchaseOffer {
  const tax = resolveTax(t, parent.billing.country, parent.billing.region ?? null, parent.billing.taxId ?? null);
  const m = (n: number) => money(t, n);
  return {
    key: cur.key,
    kind: cur.step,
    headline: cur.headline,
    body: cur.body,
    item: {
      kind: cur.item.kind,
      title: cur.item.title,
      slug: cur.item.slug,
      cover: { url: null, color: cur.item.color, alt: cur.item.title },
      description: cur.item.description,
    },
    price: m(cur.price),
    compareAt: cur.price < cur.item.price ? m(cur.item.price) : null,
    tax: m(taxOn(tax, cur.price)),
    taxLabel: tax.label,
    total: m(cur.price + addedTax(tax, cur.price)),
    card: { brand: parent.cardBrand ?? null, last4: parent.cardLast4 ?? null },
    expiresAt: new Date(Date.parse(paidAt(parent)) + WINDOW_MINUTES * 60_000).toISOString(),
  };
}

/** The fake gateway's one-click charge: `threeDSecure` → requires action; `saved_declined…`/`chargeDeclined` → declined. */
export function chargeOneClick(reference: string): 'succeeded' | 'requires_action' | 'declined' {
  if (reference.includes('threeDSecure')) return 'requires_action';
  if (reference.startsWith('saved_declined') || reference.includes('chargeDeclined')) return 'declined';
  return 'succeeded';
}
