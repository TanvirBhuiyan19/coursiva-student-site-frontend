/** Cart, wishlist, checkout quote, checkout and orders. All money maths happens here (one owner). */
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Cart, CheckoutInput, CheckoutTarget, Order, OrderSummary, Quote, QuoteInput, WishlistItem } from '@/features/commerce/types';
import { type AppContext, type Env, requireUser } from '../lib/db';
import { apiError, body, forbidden, id, invalid, isEmail, noContent, notFound, ok, paginate, str } from '../lib/http';
import { completedSet, courseSummary, installmentAmount, isEnrolled, money, person, resumeLesson } from '../lib/present';
import type { CourseRow, GiftCardRedemptionRow, GiftCardRow, OrderRow, TenantData, UserRow } from '../lib/records';
import { buyTicket, findLiveSession, needsTicket, ticketOffer } from '../lib/liveSchedule';
import {
  addedTax,
  COUNTRIES,
  invoiceDisplay,
  issueInvoice,
  REGION_REQUIRED,
  resolveTax,
  spreadTax,
  SUBDIVISIONS,
  type TaxResolution,
  taxOn,
} from '../lib/tax';
import { CART } from './auth';
import { creditedClick } from '../lib/affiliates';
import { fulfilBookings, sellableService, serviceMeta } from '../lib/bookings';
import { recordCourseSubscription } from '../lib/subscriptions';
import {
  chargeOneClick,
  currentOffer,
  hadSubscription,
  liveOffer,
  off,
  type OfferRow,
  presentOffer,
  record,
  sellableCourse,
  unrecord,
  upsellFollows,
} from '../lib/offers';

export const commerceRoutes = new Hono<Env>();

const COUPONS: Record<string, number> = { LAUNCH20: 20, SAVE10: 10, STACK5: 5 };
/** Codes that stack with a sale price (Laravel `coupons.stackable`); the others give whichever saves more. */
const STACKABLE = new Set(['STACK5']);

/* ── Cart ─────────────────────────────────────────────────────────────────── */

function cartOwner(c: AppContext, create: boolean): string | null {
  const user = c.get('user');
  if (user) return user.id;
  let tk = getCookie(c, CART);
  if (!tk && create) {
    tk = randomBytes(18).toString('base64url');
    setCookie(c, CART, tk, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      secure: process.env.NODE_ENV === 'production',
    });
  }
  return tk ? `guest:${tk}` : null;
}

function cartRow(t: TenantData, owner: string | null) {
  if (!owner) return { owner: '', courseIds: [] as string[] };
  let row = t.carts.find((x) => x.owner === owner);
  if (!row) t.carts.push((row = { owner, courseIds: [] }));
  return row;
}

function presentCart(t: TenantData, courseIds: string[], user: UserRow | null): Cart {
  const rows = courseIds.map((cid) => t.courses.find((x) => x.id === cid)).filter((x): x is CourseRow => !!x);
  return {
    items: rows.map((r) => ({
      courseId: r.id,
      courseSlug: r.slug,
      title: r.title,
      cover: { url: null, color: r.coverColor, alt: r.title },
      price: money(t, r.price),
      lessonCount: r.modules.reduce((n, m) => n + m.lessons.length, 0),
      durationMinutes: r.durationMinutes,
    })),
    subtotal: money(
      t,
      rows.reduce((a, r) => a + r.price, 0),
    ),
    recommendations: t.courses
      .filter((x) => !courseIds.includes(x.id) && !isEnrolled(t, user, x.id))
      .slice(0, 3)
      .map((x) => courseSummary(t, x)),
  };
}

commerceRoutes.get('/cart', (c: AppContext) => {
  const t = c.get('t');
  return ok(c, presentCart(t, cartRow(t, cartOwner(c, false)).courseIds, c.get('user')));
});

commerceRoutes.post('/cart/items', async (c: AppContext) => {
  const t = c.get('t');
  const slug = str((await body<{ courseSlug: string }>(c)).courseSlug);
  const course = t.courses.find((x) => x.slug === slug);
  if (!course) return invalid(c, { courseSlug: 'That course no longer exists.' });
  if (isEnrolled(t, c.get('user'), course.id)) return invalid(c, { courseSlug: 'You already own this course.' });
  // Like Laravel: subscription, pay-what-you-want and membership courses sell from their own page only.
  if (course.pricing) return invalid(c, { courseSlug: `${course.title} can’t be added to the cart — buy it from its course page.` });
  const row = cartRow(t, cartOwner(c, true));
  if (!row.courseIds.includes(course.id)) row.courseIds.push(course.id);
  return ok(c, presentCart(t, row.courseIds, c.get('user')), 201);
});

commerceRoutes.delete('/cart/items/:slug', (c: AppContext) => {
  const t = c.get('t');
  const course = t.courses.find((x) => x.slug === c.req.param('slug'));
  const row = cartRow(t, cartOwner(c, false));
  if (course) row.courseIds = row.courseIds.filter((x) => x !== course.id);
  return ok(c, presentCart(t, row.courseIds, c.get('user')));
});

/* ── Wishlist (account only) ──────────────────────────────────────────────── */

commerceRoutes.get('/me/wishlist', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const items: WishlistItem[] = t.wishlist
    .filter((w) => w.userId === user.id)
    .map((w) => t.courses.find((x) => x.id === w.courseId))
    .filter((x): x is CourseRow => !!x)
    .map((x) => ({ course: courseSummary(t, x), addedAt: new Date().toISOString() }));
  return ok(c, items);
});

commerceRoutes.put('/me/wishlist/:slug', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const course = t.courses.find((x) => x.slug === c.req.param('slug'));
  if (!course) return notFound(c, 'Course');
  if (!t.wishlist.some((w) => w.userId === user.id && w.courseId === course.id)) t.wishlist.push({ userId: user.id, courseId: course.id });
  return noContent(c);
});

commerceRoutes.delete('/me/wishlist/:slug', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const course = t.courses.find((x) => x.slug === c.req.param('slug'));
  if (course) t.wishlist = t.wishlist.filter((w) => !(w.userId === user.id && w.courseId === course.id));
  return noContent(c);
});

/* ── Gift cards (Laravel GiftCardRules / GiftCards) ───────────────────────── */

const GIFT_INVALID = 'This gift card isn’t valid.';
const GIFT_PLANS = 'Gift cards can’t be used with payment plans.';
const GIFT_NOTHING_DUE = 'There’s nothing to pay today, so your gift card wasn’t used.';
const GIFT_EMPTY = 'This gift card has no balance left.';
const GIFT_IN_USE = 'This gift card’s balance is in use by another checkout. Try again later.';
const GIFT_ONE = 'Only one gift card can be used per order.';

function giftCards(t: TenantData): GiftCardRow[] {
  t.giftCards ??= [
    { id: 'gft_test0050', code: 'GIFT-TEST-0050', amount: 5000, balance: 5000 },
    { id: 'gft_half0025', code: 'GIFT-HALF-0025', amount: 2500, balance: 2500 },
    { id: 'gft_used0000', code: 'GIFT-USED-0000', amount: 2000, balance: 0 },
  ];
  return t.giftCards;
}

function redemptions(t: TenantData): GiftCardRedemptionRow[] {
  t.giftCardRedemptions ??= [];
  return t.giftCardRedemptions;
}

/** Trim, upper-case, drop spaces; add the dashes of a code typed without them. Null when it can't be a code. */
export function normaliseGiftCard(raw: string): string | null {
  let code = raw.trim().replace(/\s+/g, '').toUpperCase();
  const bare = /^GIFT([A-Z0-9]{8}|[A-Z0-9]{12})$/.exec(code);
  if (bare) code = `GIFT-${bare[1]!.match(/.{4}/g)!.join('-')}`;
  return /^GIFT-[A-Z0-9]{4}-[A-Z0-9]{4}(-[A-Z0-9]{4})?$/.test(code) ? code : null;
}

const maskGiftCard = (code: string) => `GIFT-••••-${code.slice(-4)}`;

/** Laravel TenantMoney::format: "$49", "$49.50". */
function formatMoney(t: TenantData, minor: number): string {
  const { currency } = money(t, minor);
  const symbol = ({ USD: '$', EUR: '€', GBP: '£' } as Record<string, string>)[currency] ?? `${currency} `;
  const v = minor / 100;
  return (
    symbol +
    (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  );
}

interface GiftCardResult {
  card: GiftCardRow | null;
  code: string;
  valid: boolean;
  message: string;
  applied: number;
  remaining: number;
}

/** GiftCardRules::evaluate (the mock has no throttle): applied up to what is due today, after coupon and tax. */
function evaluateGiftCard(t: TenantData, raw: unknown, dueToday: number, installments: boolean): GiftCardResult | null {
  const typed = str(raw);
  if (!typed) return null;
  const code = normaliseGiftCard(typed);
  const shown = code ? maskGiftCard(code) : typed.slice(0, 32);
  const refuse = (message: string, card: GiftCardRow | null = null): GiftCardResult => ({
    card,
    code: shown,
    valid: false,
    message,
    applied: 0,
    remaining: 0,
  });
  const card = code ? (giftCards(t).find((g) => g.code === code) ?? null) : null;
  if (!card) return refuse(GIFT_INVALID);
  if (installments) return refuse(GIFT_PLANS, card);
  if (dueToday <= 0) return refuse(GIFT_NOTHING_DUE, card);
  if (card.balance <= 0) return refuse(GIFT_EMPTY, card);
  const held = redemptions(t)
    .filter((r) => r.giftCardId === card.id && r.status === 'held')
    .reduce((a, r) => a + r.amount, 0);
  const available = Math.max(0, card.balance - held);
  if (available <= 0) return refuse(GIFT_IN_USE, card);
  const applied = Math.min(available, dueToday);
  return {
    card,
    code: shown,
    valid: true,
    message: `Gift card applied: ${formatMoney(t, applied)}`,
    applied,
    remaining: available - applied,
  };
}

/** Captures an order's hold: the balance goes down once (a redelivery finds it captured). */
function captureGiftCard(t: TenantData, order: OrderRow) {
  const r = order.giftCard ? redemptions(t).find((x) => x.id === order.giftCard!.redemptionId) : undefined;
  const card = r ? giftCards(t).find((g) => g.id === r.giftCardId) : undefined;
  if (!r || !card || r.status !== 'held') return;
  card.balance = Math.max(0, card.balance - r.amount);
  r.status = 'captured';
}

/* ── Quote & checkout ─────────────────────────────────────────────────────── */

interface Priced {
  lines: {
    kind: 'course' | 'membership' | 'bundle' | 'product' | 'live';
    refId: string;
    title: string;
    color: string;
    meta: string;
    unit: number;
    qty: number;
    /** The list price when an offer lowered `unit`; `offer` marks a cross-sell line. */
    compareAt?: number;
    offer?: 'cross_sell';
  }[];
  subtotal: number;
  discount: number;
  couponPct: number;
  couponCode: string | null;
  couponValid: boolean;
  couponMessage: string;
  bump: number;
  /** The bump's list price (its offer may discount it). */
  bumpList: number;
  /** The offer that sets the price (countdown, seat tier, trial). */
  priceOffer: {
    offer: OfferRow;
    kind: 'countdown' | 'quantity' | 'trial';
    percent: number;
    trialDays: number | null;
    saving: number;
    applied: boolean;
    message: string | null;
  } | null;
  quantityTiers: { minSeats: number; discountPercent: number }[];
  crossSell: { offer: OfferRow; lines: Priced['lines']; total: number; selected: boolean } | null;
  savings: number;
  saveCard: boolean;
  postPurchase: boolean;
  /** The tax engine's answer for the buyer's country, state and VAT number. */
  taxRes: TaxResolution;
  /** Always the tax amount (added or included). */
  tax: number;
  /** Each line's share of the items' tax. */
  lineTax: number[];
  total: number;
  dueToday: number;
  installments: { count: number; amount: number } | null;
  installmentOption: { count: number; amount: number } | null;
  /** The gift card's evaluation (null = none sent) and what the card is charged now. */
  giftCard: GiftCardResult | null;
  payToday: number;
  /** What renews after today (a membership or a subscription course), tax included. */
  recurring: { interval: 'month' | 'year'; amount: number; trialDays: number } | null;
  /** A pay-what-you-want course's amount; `message` when it is under the minimum. */
  payWhatYouWant: { minimum: number; suggested: number; amount: number; message: string | null } | null;
}

function parseTarget(v: unknown): CheckoutTarget | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'course' && typeof o.courseSlug === 'string') return { kind: 'course', courseSlug: o.courseSlug };
  if (o.kind === 'cart') return { kind: 'cart' };
  if (o.kind === 'bundle' && typeof o.bundleSlug === 'string') return { kind: 'bundle', bundleSlug: o.bundleSlug };
  if (o.kind === 'product' && typeof o.productSlug === 'string') return { kind: 'product', productSlug: o.productSlug };
  if (o.kind === 'live' && typeof o.liveSessionId === 'string')
    return { kind: 'live', liveSessionId: o.liveSessionId, series: o.series === true };
  if (o.kind === 'membership' && typeof o.planId === 'string')
    return { kind: 'membership', planId: o.planId, interval: o.interval === 'year' ? 'year' : 'month' };
  return null;
}

/** Laravel's message for a target missing its kind's field (other kinds' fields are ignored; a cart needs none). */
function targetError(v: unknown): Record<string, string> {
  const kind = v && typeof v === 'object' ? (v as Record<string, unknown>).kind : undefined;
  if (kind === 'course') return { 'target.courseSlug': 'Choose the course to buy.' };
  if (kind === 'bundle') return { 'target.bundleSlug': 'Choose the bundle to buy.' };
  if (kind === 'product') return { 'target.productSlug': 'Choose the product to buy.' };
  if (kind === 'membership') return { 'target.planId': 'Choose a membership plan.' };
  if (kind === 'live') return { 'target.liveSessionId': 'Choose the live session.' };
  return { target: 'Nothing to buy.' };
}

function price(c: AppContext, b: Partial<QuoteInput>): Priced | { error: Record<string, string> } {
  const t = c.get('t');
  const target = parseTarget(b.target);
  if (!target) return { error: targetError(b.target) };
  const rawGiftCard: unknown = b.giftCard;
  if (rawGiftCard !== undefined && rawGiftCard !== null && typeof rawGiftCard !== 'string') return { error: { giftCard: GIFT_ONE } };
  const seats = Math.min(100, Math.max(1, Math.floor(Number(b.seats) || 1)));
  const lines: Priced['lines'] = [];
  const rawRegion: unknown = b.region;
  const rawTaxId: unknown = b.taxId;
  if (rawRegion !== undefined && rawRegion !== null && (typeof rawRegion !== 'string' || rawRegion.length > 8))
    return { error: { region: 'The region field must not be greater than 8 characters.' } };
  if (rawTaxId !== undefined && rawTaxId !== null && (typeof rawTaxId !== 'string' || rawTaxId.length > 32))
    return { error: { taxId: 'The tax id field must not be greater than 32 characters.' } };
  const taxRes = resolveTax(t, str(b.country), str(rawRegion).toUpperCase() || null, str(rawTaxId) || null);
  if (taxRes.regionError) return { error: { region: taxRes.regionError } };
  let recurring: Priced['recurring'] = null;
  let payWhatYouWant: Priced['payWhatYouWant'] = null;
  const rawAmount: unknown = b.amount;
  if (rawAmount !== undefined && rawAmount !== null && (typeof rawAmount !== 'number' || !Number.isInteger(rawAmount) || rawAmount < 0))
    return { error: { amount: 'Enter an amount.' } };
  if (target.kind === 'membership') {
    const plan = t.membership.plans.find((p) => p.id === target.planId);
    if (!plan || !t.site.features.membership) return { error: { target: 'That plan isn’t available.' } };
    const monthly =
      target.interval === 'year' ? Math.round((plan.monthly * (100 - t.membership.annualDiscountPercent)) / 100 / 100) * 100 : plan.monthly;
    lines.push({
      kind: 'membership',
      refId: plan.id,
      title: `${plan.name} membership`,
      color: t.courses[0]?.coverColor ?? 'oklch(0.9 0.03 275)',
      meta: target.interval === 'year' ? 'Billed annually · cancel anytime' : 'Billed monthly · cancel anytime',
      unit: target.interval === 'year' ? monthly * 12 : monthly,
      qty: 1,
    });
    const unit = target.interval === 'year' ? monthly * 12 : monthly;
    recurring = { interval: target.interval, amount: unit + addedTax(taxRes, unit), trialDays: 0 };
  } else if (target.kind === 'product') {
    // Laravel CheckoutPricing::download(): one copy, never team seats; delivered under Account → Downloads.
    const d = (t.products ?? []).find((x) => x.slug === target.productSlug);
    // A published service sells the same way (its sessions become booking credits; spec W1 §6).
    const service = d ? null : sellableService(t, target.productSlug);
    if (service)
      lines.push({
        kind: 'product',
        refId: service.id,
        title: service.title,
        color: 'oklch(0.9 0.03 275)',
        meta: serviceMeta(service),
        unit: service.price,
        qty: 1,
      });
    else if (!d) return { error: { target: 'This product is not for sale.' } };
    else
      lines.push({
        kind: 'product',
        refId: d.id,
        title: d.title,
        color: 'oklch(0.9 0.03 275)',
        meta: 'Digital download',
        unit: d.price,
        qty: 1,
      });
  } else if (target.kind === 'live') {
    // Track F (Laravel LiveTickets::line): a paid session's ticket at the server's price; one seat, never a gift.
    const s = findLiveSession(t, target.liveSessionId);
    if (!s || s.endedAt || s.access !== 'paid' || !s.price) return { error: { target: 'This session is not for sale.' } };
    if (seats > 1 || (b as Partial<CheckoutInput>).gift)
      return { error: { target: 'A live class ticket is for yourself — it can’t be a gift or bought for a team.' } };
    const buyer = c.get('user');
    if (buyer && !needsTicket(t, buyer, s)) return { error: { target: 'You already have a seat — RSVP from the class page.' } };
    const offer = ticketOffer(t, buyer ?? null, s);
    if (offer?.soldOut) return { error: { target: 'This session is sold out.' } };
    if (target.series && !s.seriesPrice) return { error: { target: 'This series isn’t sold as one ticket.' } };
    lines.push({
      kind: 'live',
      refId: s.id,
      title: target.series ? `${s.title} (series)` : s.title,
      color: 'oklch(0.9 0.03 275)',
      meta: 'Live class ticket',
      unit: target.series ? s.seriesPrice! : s.price,
      qty: 1,
    });
  } else if (target.kind === 'bundle') {
    const b = t.bundles.find((x) => x.slug === target.bundleSlug);
    if (!b) return { error: { target: 'That bundle isn’t available.' } };
    lines.push({
      kind: 'bundle',
      refId: b.slug,
      title: b.title,
      color: t.courses.find((x) => x.slug === b.courseSlugs[0])?.coverColor ?? 'oklch(0.9 0.03 275)',
      meta: `${b.courseSlugs.length} courses · lifetime access`,
      unit: b.price,
      qty: seats,
    });
  } else {
    const ids =
      target.kind === 'cart' ? cartRow(t, cartOwner(c, false)).courseIds : [t.courses.find((x) => x.slug === target.courseSlug)?.id ?? ''];
    for (const cid of ids) {
      const row = t.courses.find((x) => x.id === cid);
      if (!row) return { error: { target: 'That course no longer exists.' } };
      const lessons = row.modules.reduce((n, m) => n + m.lessons.length, 0);
      // Laravel's CheckoutPricing: the course's pricing model decides how it sells.
      const model = row.pricing;
      if (model && target.kind === 'cart')
        return { error: { target: `${row.title} can’t be bought from the cart — remove it and buy it from its course page.` } };
      if (model?.model === 'membership')
        return { error: { target: 'This course comes with a membership — join a membership plan to get it.' } };
      let unit = row.price;
      let meta = `${lessons} lessons · lifetime access`;
      if (model?.model === 'subscription') {
        if (seats > 1 || (b as Partial<CheckoutInput>).gift)
          return { error: { target: 'A subscription can’t be bought as a gift or for a team.' } };
        unit = model.monthlyPrice;
        meta = `${lessons} lessons · billed monthly`;
        recurring = { interval: 'month', amount: unit + addedTax(taxRes, unit), trialDays: 0 };
      } else if (model?.model === 'pay_what_you_want') {
        const suggested = Math.max(row.price, model.minimumPrice);
        const amount = typeof rawAmount === 'number' ? rawAmount : suggested;
        const message = amount < model.minimumPrice ? `Pay at least ${formatMoney(t, model.minimumPrice)}.` : null;
        payWhatYouWant = { minimum: model.minimumPrice, suggested, amount, message };
        unit = Math.max(amount, model.minimumPrice);
      }
      lines.push({
        kind: 'course',
        refId: row.id,
        title: row.title,
        color: row.coverColor,
        meta,
        unit,
        qty: seats,
      });
    }
    if (!lines.length) return { error: { target: 'Your cart is empty.' } };
  }

  // Offers (lib/offers.ts; Laravel CheckoutPricing): a free trial or first-month discount on a subscription course, else
  // the bigger saving of a countdown sale and the seat tier reached (ties: countdown). Never on pay what you want.
  const user = c.get('user');
  const gift = !!(b as Partial<CheckoutInput>).gift;
  const lineCourses = (l: Priced['lines'][number]) =>
    l.kind === 'course'
      ? [l.refId]
      : l.kind === 'bundle'
        ? (t.bundles.find((x) => x.slug === l.refId)?.courseSlugs ?? []).map((s) => t.courses.find((x) => x.slug === s)?.id ?? '')
        : [];
  const courseIds = lines.flatMap(lineCourses).filter(Boolean);
  const single = target.kind === 'course' ? t.courses.find((x) => x.slug === target.courseSlug) : undefined;
  const isSubscription = single?.pricing?.model === 'subscription';
  const trial =
    single && isSubscription && !gift && seats === 1
      ? liveOffer(t, 'trial', [single.id], () => !hadSubscription(t, user, single.id))
      : null;
  const freeTrialDays = trial?.trialMode === 'trial' ? (trial.trialDays ?? 0) : 0;
  const quantity =
    (target.kind === 'course' || target.kind === 'bundle') && !payWhatYouWant && !isSubscription
      ? liveOffer(t, 'quantity', courseIds)
      : null;
  const quantityTiers = quantity?.tiers ?? [];
  type PriceOffer = NonNullable<Priced['priceOffer']>;
  const covers = (o: PriceOffer, l: Priced['lines'][number]) =>
    o.kind !== 'countdown' || o.offer.appliesTo.kind !== 'courses' || o.offer.appliesTo.courseIds.some((x) => lineCourses(l).includes(x));
  const saving = (o: PriceOffer) => lines.reduce((a, l) => a + (covers(o, l) ? (l.unit - off(l.unit, o.percent)) * l.qty : 0), 0);
  let priceOffer: Priced['priceOffer'] = null;
  if (!payWhatYouWant && isSubscription) {
    if (trial) {
      const free = trial.trialMode === 'trial';
      const o: PriceOffer = {
        offer: trial,
        kind: 'trial',
        percent: free ? 0 : trial.discountPercent,
        trialDays: free ? (trial.trialDays ?? 0) : null,
        saving: 0,
        applied: true,
        message: null,
      };
      priceOffer = { ...o, saving: saving(o) };
    }
  } else if (!payWhatYouWant) {
    const countdown = liveOffer(t, 'countdown', courseIds);
    const tier = [...quantityTiers].reverse().find((x) => seats >= x.minSeats);
    const candidates: PriceOffer[] = [
      ...(countdown ? [{ offer: countdown, kind: 'countdown' as const, percent: countdown.discountPercent }] : []),
      ...(quantity && tier ? [{ offer: quantity, kind: 'quantity' as const, percent: tier.discountPercent }] : []),
    ].map((x) => ({ ...x, trialDays: null, saving: 0, applied: true, message: null }));
    for (const x of candidates) {
      const o = { ...x, saving: saving(x) };
      if (o.saving > 0 && (!priceOffer || o.saving > priceOffer.saving)) priceOffer = o;
    }
  }
  const listLines = lines.map((l) => ({ ...l }));
  const discounted = (o: PriceOffer) =>
    listLines.map((l) => (covers(o, l) && off(l.unit, o.percent) < l.unit ? { ...l, unit: off(l.unit, o.percent), compareAt: l.unit } : l));
  if (priceOffer) lines.splice(0, lines.length, ...discounted(priceOffer));

  const code = str(b.couponCode).toUpperCase() || null;
  const couponPct = code ? (COUPONS[code] ?? 0) : 0;
  const couponOn = (amount: number) => Math.round((amount * couponPct) / 100 / 100) * 100;
  const itemsAt = (ls: Priced['lines']) => ls.reduce((a, l) => a + l.unit * l.qty, 0);
  let discount = couponOn(itemsAt(lines));
  let couponValid = couponPct > 0;
  let couponMessage = couponValid ? `${couponPct}% discount applied` : 'That code isn’t valid';
  if (freeTrialDays > 0 && code) {
    [discount, couponValid, couponMessage] = [0, false, 'Nothing is charged today during the free trial.'];
  } else if (priceOffer && couponValid && code && !STACKABLE.has(code)) {
    // A code that doesn't stack with the sale: the buyer gets whichever saves more.
    const listDiscount = couponOn(itemsAt(listLines));
    if (listDiscount > priceOffer.saving) {
      lines.splice(0, lines.length, ...listLines);
      priceOffer = { ...priceOffer, applied: false, message: 'Your code saves more, so it replaces the sale price.' };
      discount = listDiscount;
    } else {
      [discount, couponValid, couponMessage] = [
        0,
        false,
        'This code can’t be combined with the sale price — you’re already getting the better deal.',
      ];
    }
  }
  const planAllowed = target.kind === 'course' && !recurring && !payWhatYouWant;
  const installmentOption = planAllowed ? { count: 3, amount: installmentAmount(itemsAt(lines) - discount) } : null;
  const usePlan = planAllowed && b.plan === 'installments';

  // Frequently bought together: companion courses at the offer's price, as more lines of this order (no coupon on them).
  const companions = (o: OfferRow) =>
    (o.courseIds ?? [])
      .filter((x) => !courseIds.includes(x))
      .map((x) => sellableCourse(t, x))
      .filter((x): x is CourseRow => !!x && !isEnrolled(t, user, x.id));
  const crossOffer =
    ['course', 'cart', 'bundle'].includes(target.kind) && seats === 1 && !usePlan && !isSubscription
      ? liveOffer(t, 'cross_sell', courseIds, (o) => companions(o).length > 0)
      : null;
  const crossSell: Priced['crossSell'] = crossOffer
    ? (() => {
        const cl: Priced['lines'] = companions(crossOffer).map((x) => {
          const sale = off(x.price, crossOffer.discountPercent);
          const lessons = x.modules.reduce((n, m) => n + m.lessons.length, 0);
          return {
            kind: 'course',
            refId: x.id,
            title: x.title,
            color: x.coverColor,
            meta: `${lessons} lessons · lifetime access`,
            unit: sale,
            qty: 1,
            ...(sale < x.price ? { compareAt: x.price } : {}),
            offer: 'cross_sell',
          };
        });
        return { offer: crossOffer, lines: cl, total: itemsAt(cl), selected: (b as { crossSell?: unknown }).crossSell === true };
      })()
    : null;
  if (crossSell?.selected) lines.push(...crossSell.lines);
  const subtotal = itemsAt(lines);
  const afterDiscount = subtotal - discount;
  const bumpList = t.orderBump?.price ?? 0;
  const bump = b.orderBump && t.orderBump && target.kind !== 'membership' ? off(bumpList, t.orderBump.discountPercent ?? 0) : 0;
  // TaxEngine::apply per chunk (the items net after the coupon, then the bump); `tax` is always the tax amount, added
  // to the total only when prices exclude it. A plan's instalment carries its share of the items' added tax.
  const itemsNet = usePlan ? installmentOption!.amount * 3 : afterDiscount;
  const itemsTax = taxOn(taxRes, itemsNet);
  const bumpTax = taxOn(taxRes, bump);
  const itemsAdded = addedTax(taxRes, itemsNet);
  const bumpAdded = addedTax(taxRes, bump);
  const tax = itemsTax + bumpTax;
  const total = itemsNet + bump + itemsAdded + bumpAdded;
  const perInstallment = usePlan ? Math.ceil((itemsNet + itemsAdded) / installmentOption!.count) : 0;
  // A free trial: nothing for the course today (an order bump is still paid now); the card is saved for the first renewal.
  const dueToday = freeTrialDays > 0 && recurring ? bump + bumpAdded : usePlan ? perInstallment + bump + bumpAdded : total;
  if (freeTrialDays > 0 && recurring) recurring = { ...recurring, trialDays: freeTrialDays };
  const giftCard = evaluateGiftCard(t, rawGiftCard, dueToday, usePlan);
  // A one-click offer follows the payment (thank-you page): the card is kept for it.
  const productId = target.kind === 'product' ? (lines[0]?.refId ?? null) : null;
  const postPurchase = !gift && seats === 1 && upsellFollows(t, target.kind, productId, courseIds, user);
  return {
    priceOffer,
    quantityTiers,
    crossSell,
    bumpList,
    couponMessage,
    savings: lines.reduce((a, l) => a + (l.compareAt ? (l.compareAt - l.unit) * l.qty : 0), 0) + (bump ? bumpList - bump : 0),
    saveCard: usePlan || recurring !== null || postPurchase,
    postPurchase,
    giftCard,
    payToday: dueToday - (giftCard?.valid ? giftCard.applied : 0),
    lines,
    subtotal,
    discount,
    couponPct,
    couponCode: code,
    couponValid,
    bump,
    taxRes,
    tax,
    lineTax: spreadTax(
      itemsTax,
      lines.map((l) => l.unit * l.qty),
    ),
    total,
    dueToday,
    installments: usePlan ? { count: installmentOption!.count, amount: perInstallment } : null,
    installmentOption,
    recurring,
    payWhatYouWant,
  };
}

function presentQuote(t: TenantData, p: Priced, orderBumpSelected: boolean, target: CheckoutTarget): Quote {
  const m = (n: number) => money(t, n);
  return {
    lines: p.lines.map((l) => ({
      title: l.title,
      cover: { url: null, color: l.color, alt: l.title },
      price: m(l.unit),
      quantity: l.qty,
      compareAt: l.compareAt ? m(l.compareAt) : null,
    })),
    savings: m(p.savings),
    priceOffer: p.priceOffer
      ? {
          kind: p.priceOffer.kind,
          headline: p.priceOffer.offer.headline,
          body: p.priceOffer.offer.body,
          discountPercent: p.priceOffer.percent,
          endsAt: p.priceOffer.offer.endsAt,
          trialDays: p.priceOffer.trialDays,
          applied: p.priceOffer.applied,
          message: p.priceOffer.message,
        }
      : null,
    quantityTiers: p.quantityTiers,
    crossSell: p.crossSell
      ? {
          headline: p.crossSell.offer.headline,
          body: p.crossSell.offer.body,
          discountPercent: p.crossSell.offer.discountPercent,
          items: p.crossSell.lines.map((l) => ({
            courseSlug: t.courses.find((x) => x.id === l.refId)?.slug ?? '',
            title: l.title,
            cover: { url: null, color: l.color, alt: l.title },
            price: m(l.unit),
            compareAt: l.compareAt ? m(l.compareAt) : null,
          })),
          total: m(p.crossSell.total),
          selected: p.crossSell.selected,
        }
      : null,
    subtotal: m(p.subtotal),
    discount: m(p.discount),
    coupon: p.couponCode ? { code: p.couponCode, valid: p.couponValid, message: p.couponMessage } : null,
    orderBump:
      t.orderBump && target.kind !== 'membership'
        ? {
            title: t.orderBump.title,
            description: t.orderBump.description,
            headline: t.orderBump.headline ?? '',
            price: m(off(t.orderBump.price, t.orderBump.discountPercent ?? 0)),
            compareAt: (t.orderBump.discountPercent ?? 0) > 0 ? m(t.orderBump.price) : null,
            selected: orderBumpSelected,
          }
        : null,
    tax: m(p.tax),
    taxLabel: p.taxRes.label,
    taxDetails: p.taxRes.details,
    total: m(p.total),
    dueToday: m(p.dueToday),
    giftCard: p.giftCard
      ? {
          code: p.giftCard.code,
          valid: p.giftCard.valid,
          message: p.giftCard.message,
          applied: m(p.giftCard.applied),
          remaining: p.giftCard.valid ? m(p.giftCard.remaining) : null,
        }
      : null,
    payToday: m(p.payToday),
    installments: p.installments ? { count: p.installments.count, amount: m(p.installments.amount) } : null,
    fullAmount: m(p.subtotal - p.discount),
    installmentOption: p.installmentOption ? { count: p.installmentOption.count, amount: m(p.installmentOption.amount) } : null,
    recurring: p.recurring ? { interval: p.recurring.interval, amount: m(p.recurring.amount), trialDays: p.recurring.trialDays } : null,
    payWhatYouWant: p.payWhatYouWant
      ? {
          minimum: m(p.payWhatYouWant.minimum),
          suggested: m(p.payWhatYouWant.suggested),
          amount: m(p.payWhatYouWant.amount),
          message: p.payWhatYouWant.message,
        }
      : null,
    bnpl: { count: 4, amount: m(Math.round(p.payToday / 4)) },
    countries: COUNTRIES,
    subdivisions: SUBDIVISIONS,
    proof: (() => {
      const q = t.home.testimonials[0];
      return q ? { quote: q.quote, author: person(q.name, q.color), context: 'verified buyer', rating: q.rating } : null;
    })(),
    enrolledCount: target.kind === 'course' ? (t.courses.find((x) => x.slug === target.courseSlug)?.studentCount ?? null) : null,
    guaranteeDays: t.membership.guaranteeDays,
    // Laravel's fake gateway: the site shows its test-card picker instead of Stripe's Payment Element.
    payment: { provider: 'test', publishableKey: null, stripeAccount: null, methods: ['card', 'paypal', 'bnpl', 'wallet'] },
    saveCard: p.saveCard,
    postPurchase: p.postPurchase,
  };
}

commerceRoutes.post('/checkout/quote', async (c: AppContext) => {
  const b = await body<QuoteInput>(c);
  const p = price(c, b);
  if ('error' in p) return invalid(c, p.error);
  return ok(c, presentQuote(c.get('t'), p, !!b.orderBump, parseTarget(b.target)!));
});

commerceRoutes.post('/checkout', requireUser, async (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  // `acquisition` (first-touch UTM/referrer/click-id hints) becomes the order's source in Laravel; the mock only
  // validates its lengths like the API and otherwise ignores it.
  const b = await body<CheckoutInput>(c);
  const p = price(c, b);
  if ('error' in p) return invalid(c, p.error);
  const target = parseTarget(b.target)!;
  const name = str(b.name);
  const email = str(b.email).toLowerCase();
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'Add your name and a valid email.';
  if (!isEmail(email)) errors.email = 'Add your name and a valid email.';
  if (b.acceptTerms !== true) errors.acceptTerms = 'Please accept the terms to continue.';
  // Like Laravel: the quote only flags it (`tax_details.region_required`); the checkout refuses without a state.
  if (p.taxRes.details.regionRequired) errors.region = REGION_REQUIRED;
  const method = str(b.paymentMethod);
  // Like Laravel: a gift card that doesn't apply is an error at checkout (the quote only reports it).
  if (p.giftCard && !p.giftCard.valid) return invalid(c, { giftCard: p.giftCard.message });
  // Like Laravel: a pay-what-you-want amount under the minimum is refused (the quote only reports it).
  if (p.payWhatYouWant?.message) return invalid(c, { amount: p.payWhatYouWant.message });
  // Like Laravel: nothing to charge (free, or fully covered by a gift card) and not a membership (whose trial or
  // covered first charge still saves a card) = no payment step at all.
  const covered = !!p.giftCard?.valid && p.payToday === 0 && !p.recurring;
  const free = p.payToday === 0 && !p.recurring;
  if (!['card', 'paypal', 'bnpl', 'wallet'].includes(method)) errors.paymentMethod = 'Choose how to pay.';
  if (!free && method === 'card' && !str(b.paymentToken).startsWith('tok_')) errors.paymentToken = 'Enter your card details.';
  if (!free && method === 'card' && b.paymentToken === 'tok_chargeDeclined') errors.paymentToken = 'Your card was declined.';
  if (b.ref !== undefined && b.ref !== null && (typeof b.ref !== 'string' || b.ref.length > 60))
    errors.ref = 'The ref field must not be greater than 60 characters.';
  if (b.refClick !== undefined && b.refClick !== null && (typeof b.refClick !== 'string' || b.refClick.length > 32))
    errors.refClick = 'The ref click field must not be greater than 32 characters.';
  if (b.post !== undefined && b.post !== null && (typeof b.post !== 'string' || b.post.length > 80))
    errors.post = 'The post field must not be greater than 80 characters.';
  const gift =
    b.gift && typeof b.gift === 'object'
      ? { recipientEmail: str(b.gift.recipientEmail).toLowerCase(), message: str(b.gift.message) }
      : null;
  if (gift && !isEmail(gift.recipientEmail)) errors.giftRecipientEmail = 'Enter the recipient’s email.';
  if (gift && target.kind === 'product')
    errors.target = sellableService(t, target.productSlug)
      ? 'Sessions can’t be sent as a gift.'
      : 'Digital downloads can’t be sent as a gift.';
  Object.assign(errors, acquisitionErrors(b.acquisition));
  if (target.kind !== 'membership' && !gift && (Number(b.seats) || 1) === 1) {
    const owned = p.lines.find((l) => l.kind === 'course' && isEnrolled(t, user, l.refId));
    if (owned) errors.target = `You already own ${owned.title}.`;
  }
  if (Object.keys(errors).length) return invalid(c, errors);
  // Laravel refuses before booking an order when Stripe can't take charges for the school yet (onboarding unfinished).
  if (t.chargesBlocked) return invalid(c, { paymentMethod: 'This school can’t take card payments yet. Please try again later.' });

  const bnpl = b.bnplProvider === 'afterpay' ? 'Afterpay' : 'Klarna';
  // 3-D Secure: the order waits (pending) for the processor; the mock's webhook "arrives" on the next order read.
  const challenge = !free && method === 'card' && b.paymentToken === 'tok_threeDSecure';
  const paymentMethod = covered
    ? 'Gift card'
    : free
      ? 'Free'
      : method === 'card'
        ? `${user.card?.brand ?? 'Card'} •••• ${user.card?.last4 ?? '4242'}`
        : method === 'paypal'
          ? 'PayPal'
          : method === 'bnpl'
            ? `${bnpl} · 4 payments`
            : 'Express pay';
  const seats = p.lines[0]?.qty ?? 1;
  const orderId = id('ord');
  const number = `${t.orderPrefix}-${new Date().getFullYear()}-${1100 + t.orders.length + 47}`;
  const host = t.site.primaryHost;
  const order: OrderRow = {
    id: orderId,
    number,
    userId: user.id,
    createdAt: new Date().toISOString(),
    items: p.lines.map((l, i) => ({
      kind: l.kind,
      refId: l.refId,
      title: l.title,
      coverColor: l.color,
      meta: l.meta,
      unitPrice: l.unit,
      quantity: l.qty,
      tax: p.lineTax[i] ?? 0,
      ...(l.compareAt ? { compareAt: l.compareAt } : {}),
      ...(l.offer ? { offer: l.offer } : {}),
    })),
    subtotal: p.subtotal,
    discount: p.discount,
    couponCode: p.couponValid ? p.couponCode : null,
    orderBump: p.bump,
    tax: p.tax,
    taxRatePercent: p.taxRes.rate ?? 0,
    taxLabel: p.taxRes.label,
    taxInclusive: p.taxRes.inclusive,
    reverseCharge: p.taxRes.reverseCharge,
    taxNote: p.taxRes.details.note,
    sellerTaxId: p.taxRes.registration?.taxId ?? null,
    total: p.total,
    dueToday: p.dueToday,
    plan: p.installments ? { installments: p.installments.count, installmentAmount: p.installments.amount } : null,
    paymentMethod,
    gift: gift ? { ...gift, claimUrl: `https://${host}/claim?token=${randomBytes(9).toString('base64url')}` } : null,
    seats:
      seats > 1
        ? {
            quantity: seats,
            claimUrls: Array.from({ length: seats }, () => `https://${host}/claim?token=${randomBytes(9).toString('base64url')}`),
          }
        : null,
    billing: {
      name,
      email,
      country: str(b.country) || 'United States',
      region: str(b.region).toUpperCase() || null,
      taxId: str(b.taxId) || null,
    },
    status: challenge ? 'pending' : 'paid',
    target,
    ref: typeof b.ref === 'string' ? b.ref : null,
    refClick: typeof b.refClick === 'string' ? b.refClick : null,
    refCredited: creditedClick(t, typeof b.ref === 'string' ? b.ref : null, typeof b.refClick === 'string' ? b.refClick : null),
    post: typeof b.post === 'string' ? b.post : null,
  };
  if (p.giftCard?.valid && p.giftCard.card) {
    // Held with the booking; captured once the payment succeeds (at once here, or after 3-D Secure on the next read).
    const redemption: GiftCardRedemptionRow = {
      id: id('gcr'),
      giftCardId: p.giftCard.card.id,
      orderId,
      amount: p.giftCard.applied,
      status: 'held',
    };
    redemptions(t).push(redemption);
    order.giftCard = { redemptionId: redemption.id, code: p.giftCard.code, amount: p.giftCard.applied, refunded: 0 };
    if (!challenge) captureGiftCard(t, order);
  }
  if (!challenge) issueInvoice(t, order);
  order.paidAt = challenge ? null : order.createdAt;
  if (!free && method === 'card') {
    order.cardBrand = user.card?.brand ?? 'Visa';
    order.cardLast4 = user.card?.last4 ?? '4242';
    // The card is kept for the one-click offer on the thank-you page (Laravel orders.offer_payment_reference).
    if (p.postPurchase) order.offerPaymentReference = `saved_${str(b.paymentToken)}`;
  }
  t.orders.push(order);
  if (challenge) return ok(c, { ...presentOrder(t, user, order), nextAction: { clientSecret: `pi_mock_secret_${orderId}` } }, 201);
  fulfil(t, user, order, target);
  return ok(c, { ...presentOrder(t, user, order), nextAction: null }, 201);
});

/** Enrols the buyer (or issues claim links), sets the plan, and empties the cart — once the payment succeeded. */
function fulfil(t: TenantData, user: UserRow, order: OrderRow, target: CheckoutTarget) {
  const p = { lines: order.items.map((i) => ({ kind: i.kind, refId: i.refId, qty: i.quantity })) };
  const gift = order.gift;
  const seats = p.lines[0]?.qty ?? 1;
  const orderId = order.id;

  // Fulfilment: gifts and team seats issue claim links instead of enrolling the buyer.
  if (!gift && seats === 1) {
    for (const l of p.lines) {
      if (l.kind === 'course' && !t.enrollments.some((e) => e.userId === user.id && e.courseId === l.refId)) {
        t.enrollments.push({ userId: user.id, courseId: l.refId, enrolledAt: order.createdAt, orderId });
      }
      // A course sold as a subscription renews monthly (and can be cancelled from the billing page).
      const sold = l.kind === 'course' ? t.courses.find((x) => x.id === l.refId) : undefined;
      if (sold?.pricing?.model === 'subscription') recordCourseSubscription(t, user, sold.id, sold.pricing.monthlyPrice);
      if (l.kind === 'bundle') {
        const b = t.bundles.find((x) => x.slug === l.refId);
        for (const slug of b?.courseSlugs ?? []) {
          const cid = t.courses.find((x) => x.slug === slug)?.id;
          if (cid && !t.enrollments.some((e) => e.userId === user.id && e.courseId === cid))
            t.enrollments.push({ userId: user.id, courseId: cid, enrolledAt: order.createdAt, orderId });
        }
      }
      if (l.kind === 'membership') {
        user.membershipPlanId = l.refId;
        const renew = new Date();
        renew.setMonth(renew.getMonth() + (target.kind === 'membership' && target.interval === 'year' ? 12 : 1));
        user.membershipRenewsAt = renew.toISOString();
      }
    }
  }
  // Service lines: a package of session credits, and the held time (if any) confirmed with one of them.
  if (target.kind === 'product') fulfilBookings(t, user, order);
  // Track F: a live class ticket seats the buyer.
  if (target.kind === 'live') buyTicket(t, user, target.liveSessionId);
  if (target.kind === 'cart') {
    const row = cartRow(t, user.id);
    row.courseIds = [];
  } else if (target.kind === 'course') {
    const row = cartRow(t, user.id);
    const bought = p.lines[0]?.refId;
    row.courseIds = row.courseIds.filter((x) => x !== bought);
  }
}

export function presentOrder(t: TenantData, user: UserRow, o: OrderRow): Order {
  const m = (n: number) => money(t, n);
  const first = o.items[0];
  const course = first?.kind === 'course' && o.items.length >= 1 ? t.courses.find((x) => x.id === first.refId) : undefined;
  return {
    id: o.id,
    number: o.number,
    invoiceNumber: invoiceDisplay(o.invoicePrefix, o.invoiceNumber),
    createdAt: o.createdAt,
    status: o.status,
    paidAt: o.status === 'pending' || o.status === 'failed' ? null : (o.paidAt ?? o.createdAt),
    items: o.items.map((i) => ({
      kind: i.kind,
      title: i.title,
      meta: i.kind === 'course' ? `Online course · ${i.meta}` : i.kind === 'bundle' ? `Course bundle · ${i.meta}` : i.meta, // product: "Digital download"
      cover: { url: null, color: i.coverColor, alt: i.title },
      unitPrice: m(i.unitPrice),
      quantity: i.quantity,
      tax: m(i.tax ?? 0),
      courseSlug: i.kind === 'course' ? (t.courses.find((x) => x.id === i.refId)?.slug ?? null) : null,
      refId: i.refId,
      liveSessionId: i.kind === 'live' ? i.refId : null,
    })),
    subtotal: m(o.subtotal),
    discount: m(o.discount),
    couponCode: o.couponCode,
    orderBump: o.orderBump ? m(o.orderBump) : null,
    tax: m(o.tax),
    taxLabel: o.taxLabel !== undefined ? o.taxLabel : o.taxRatePercent ? `VAT (${String(o.taxRatePercent)}%)` : null,
    taxDetails: {
      inclusive: !!o.taxInclusive,
      rate: o.taxRatePercent || null,
      reverseCharge: !!o.reverseCharge,
      note: o.taxNote ?? null,
    },
    total: m(o.total),
    dueToday: m(o.dueToday),
    installments: o.plan ? { count: o.plan.installments, amount: m(o.plan.installmentAmount) } : null,
    refunded: m(o.refunded ?? 0),
    creditNotes: (o.creditNotes ?? []).map((c) => ({
      number: invoiceDisplay(c.prefix, c.number) ?? '',
      amount: m(c.amount),
      createdAt: c.createdAt,
    })),
    paymentMethod: o.paymentMethod,
    giftCard: o.giftCard ? { code: o.giftCard.code, amount: m(o.giftCard.amount), refunded: m(o.giftCard.refunded) } : null,
    paidByCard: m(Math.max(0, o.dueToday - (o.giftCard?.amount ?? 0))),
    gift: o.gift ? { recipientEmail: o.gift.recipientEmail, claimUrl: o.gift.claimUrl } : null,
    seats: o.seats,
    billing: { ...o.billing, region: o.billing.region ?? null, taxId: o.billing.taxId ?? null },
    seller: {
      name: t.site.name,
      legalName: t.site.legalName || null,
      email: t.site.supportEmail,
      address: t.business?.address ?? null,
      taxId: o.sellerTaxId ?? t.business?.taxId ?? null,
    },
    startLesson:
      course && !o.gift && !o.seats && isEnrolled(t, user, course.id)
        ? { courseSlug: course.slug, lessonId: resumeLesson(course, completedSet(t, user.id)).id }
        : null,
  };
}

commerceRoutes.get('/orders/:id', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const o = t.orders.find((x) => x.id === c.req.param('id'));
  if (!o) return notFound(c, 'Order');
  if (o.userId !== user.id) return forbidden(c);
  if (o.status === 'pending') {
    // The processor's payment_intent.succeeded webhook, simulated: the order completes after the 3-D Secure step.
    o.status = 'paid';
    o.paidAt = new Date().toISOString();
    issueInvoice(t, o);
    captureGiftCard(t, o);
    fulfil(t, user, o, o.target ?? { kind: 'cart' });
  }
  return ok(c, presentOrder(t, user, o));
});

/* ── Post-purchase one-click offer (Laravel Checkout\PostPurchase) ────────── */

/** `GET /orders/{id}/offer`: the thank-you page's current offer (its view recorded), or null. 403 / 404 as orders. */
commerceRoutes.get('/orders/:id/offer', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const o = t.orders.find((x) => x.id === c.req.param('id'));
  if (!o) return notFound(c, 'Order');
  if (o.userId !== user.id) return forbidden(c, 'This order belongs to someone else.');
  const cur = currentOffer(t, o, user);
  if (!cur) return ok(c, null);
  record(t, { orderId: o.id, kind: cur.step, event: 'view', offerId: cur.offerId, resultOrderId: null, amount: 0 });
  return ok(c, presentOffer(t, cur, o));
});

const OFFER_GONE = 'This offer is no longer available.';

/**
 * `POST /orders/{id}/offer {key, accept}`: decline → 200 the next offer (the downsell) or null; accept → 201 the new
 * order, charged to the card saved at checkout (fake gateway rules: `threeDSecure` → pending + `next_action`,
 * `saved_declined…` → 422 payment_token). A stale key, a closed window or a decided step → 409.
 */
commerceRoutes.post('/orders/:id/offer', requireUser, async (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const b = await body<{ key: unknown; accept: unknown }>(c);
  const errors: Record<string, string> = {};
  if (typeof b.key !== 'string' || !b.key) errors.key = 'The key field is required.';
  else if (b.key.length > 64) errors.key = 'The key field must not be greater than 64 characters.';
  if (b.accept === undefined || b.accept === null) errors.accept = 'The accept field is required.';
  else if (typeof b.accept !== 'boolean') errors.accept = 'The accept field must be true or false.';
  // Laravel validates before it looks the order up.
  if (Object.keys(errors).length) return invalid(c, errors);
  const parent = t.orders.find((x) => x.id === c.req.param('id'));
  if (!parent) return notFound(c, 'Order');
  if (parent.userId !== user.id) return forbidden(c, 'This order belongs to someone else.');
  const cur = currentOffer(t, parent, user);
  if (!cur || cur.key !== b.key) return apiError(c, 409, OFFER_GONE, 'conflict');

  if (b.accept === false) {
    record(t, { orderId: parent.id, kind: cur.step, event: 'decline', offerId: cur.offerId, resultOrderId: null, amount: 0 });
    const next = currentOffer(t, parent, user);
    if (!next) {
      parent.offerPaymentReference = null;
      return ok(c, null);
    }
    record(t, { orderId: parent.id, kind: next.step, event: 'view', offerId: next.offerId, resultOrderId: null, amount: 0 });
    return ok(c, presentOffer(t, next, parent));
  }

  if (t.chargesBlocked) return invalid(c, { paymentMethod: 'This school can’t take card payments yet. Please try again later.' });
  const tax = resolveTax(t, parent.billing.country, parent.billing.region ?? null, parent.billing.taxId ?? null);
  const price = cur.price;
  const lineTax = taxOn(tax, price);
  const due = price + addedTax(tax, price);
  const item = cur.item;
  const orderId = id('ord');
  const createdAt = new Date().toISOString();
  const order: OrderRow = {
    id: orderId,
    number: `${t.orderPrefix}-${new Date().getFullYear()}-${1100 + t.orders.length + 47}`,
    userId: user.id,
    createdAt,
    items: [
      {
        kind: item.kind,
        refId: item.id,
        title: item.title,
        coverColor: item.color,
        meta:
          item.kind === 'product'
            ? 'Digital download'
            : `${item.courseIds.length > 1 ? `${item.courseIds.length} courses · ` : ''}lifetime access`,
        unitPrice: price,
        quantity: 1,
        tax: lineTax,
        ...(price < item.price ? { compareAt: item.price } : {}),
      },
    ],
    subtotal: price,
    discount: 0,
    couponCode: null,
    orderBump: 0,
    tax: lineTax,
    taxRatePercent: tax.rate ?? 0,
    taxLabel: tax.label,
    taxInclusive: tax.inclusive,
    reverseCharge: tax.reverseCharge,
    taxNote: tax.details.note,
    sellerTaxId: tax.registration?.taxId ?? null,
    total: due,
    dueToday: due,
    plan: null,
    paymentMethod: parent.paymentMethod,
    gift: null,
    seats: null,
    billing: { ...parent.billing },
    status: 'pending',
    target:
      item.kind === 'course'
        ? { kind: 'course', courseSlug: item.slug }
        : item.kind === 'bundle'
          ? { kind: 'bundle', bundleSlug: item.slug }
          : { kind: 'product', productSlug: item.slug },
    cardBrand: parent.cardBrand ?? null,
    cardLast4: parent.cardLast4 ?? null,
    source: cur.step === 'upsell' ? 'Post-purchase upsell' : 'Post-purchase downsell',
  };
  t.orders.push(order);
  record(t, { orderId: parent.id, kind: cur.step, event: 'take', offerId: cur.offerId, resultOrderId: orderId, amount: price });
  const saved = parent.offerPaymentReference ?? '';
  // One offer accepted ends the flow: the saved reference is not kept for anything else.
  parent.offerPaymentReference = null;

  const charge = chargeOneClick(saved);
  if (charge === 'declined') {
    order.status = 'failed';
    // Not taken after all: the learner may try again or decline (the saved card comes back for it).
    unrecord(t, parent.id, cur.step, 'take');
    parent.offerPaymentReference = saved;
    return invalid(c, { paymentToken: 'Your card was declined.' });
  }
  if (charge === 'requires_action')
    // The mock's webhook "arrives" on the next order read (GET /orders/{id}), like checkout's 3-D Secure.
    return ok(c, { ...presentOrder(t, user, order), nextAction: { clientSecret: `fake_secret_${orderId}` } }, 201);
  order.status = 'paid';
  order.paidAt = createdAt;
  issueInvoice(t, order);
  fulfil(t, user, order, order.target!);
  return ok(c, { ...presentOrder(t, user, order), nextAction: null }, 201);
});

/** Captured payments: the orders with a receipt and an invoice (LearnerOrders::RECEIPTED). */
export const receipted = (o: OrderRow) => o.status !== 'pending' && o.status !== 'failed';

const newestFirst = (a: OrderRow, b: OrderRow) => b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number);

/** The learner's order history (`GET /me/orders`, paginated, newest first; per_page ≤ 50). */
commerceRoutes.get('/me/orders', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const perPage = Number(c.req.query('per_page') ?? 20);
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 50)
    return invalid(c, { perPage: 'The per page field must be between 1 and 50.' });
  const rows: OrderSummary[] = t.orders
    .filter((o) => o.userId === user.id)
    .sort(newestFirst)
    .map((o) => ({
      id: o.id,
      number: o.number,
      createdAt: o.createdAt,
      status: o.status,
      title: o.items[0]?.title ?? '',
      itemCount: Math.max(1, o.items.length),
      total: money(t, o.total),
      refunded: money(t, o.refunded ?? 0),
      hasInvoice: receipted(o),
    }));
  return paginate(c, rows, perPage);
});

commerceRoutes.get('/me/orders/:id', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const o = t.orders.find((x) => x.id === c.req.param('id') && x.userId === user.id);
  return o ? ok(c, presentOrder(t, user, o)) : notFound(c, 'Order');
});

/** A copy of the invoice to the learner's own address: 3 requests per 10 minutes (every request counts), 409 without one. */
commerceRoutes.post('/me/orders/:id/invoice/email', requireUser, (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  t.invoiceEmails ??= {};
  const now = Date.now();
  const recent = (t.invoiceEmails[user.id] ?? []).filter((at) => now - at < 10 * 60_000);
  t.invoiceEmails[user.id] = [...recent, now];
  if (recent.length >= 3) return apiError(c, 429, 'Too Many Attempts.', 'too_many_requests');
  const o = t.orders.find((x) => x.id === c.req.param('id') && x.userId === user.id);
  if (!o) return notFound(c, 'Order');
  if (!receipted(o)) return apiError(c, 409, 'This order has no invoice yet: the payment hasn’t gone through.', 'conflict');
  return c.json({ data: { sent: true, email: user.email } }, 202);
});

/**
 * Redeems a gift or team-seat link (`/claim?token=`): enrols the signed-in learner in what the order bought. Unknown
 * tokens and used ones fail like Laravel (`422 token`).
 */
commerceRoutes.post('/me/claims', requireUser, async (c: AppContext) => {
  const t = c.get('t');
  const user = c.get('user')!;
  const tk = str((await body<{ token: string }>(c)).token);
  if (!tk) return invalid(c, { token: 'The token field is required.' });
  const order = t.orders.find((o) => [o.gift?.claimUrl ?? '', ...(o.seats?.claimUrls ?? [])].some((u) => u.endsWith(`token=${tk}`)));
  if (!order) return invalid(c, { token: 'This link is not valid.' });
  t.claimedTokens ??= [];
  if (t.claimedTokens.includes(tk)) return invalid(c, { token: 'This link has already been used.' });
  t.claimedTokens.push(tk);
  const courseIds = order.items.flatMap((i) =>
    i.kind === 'course'
      ? [i.refId]
      : i.kind === 'bundle'
        ? (t.bundles.find((b) => b.slug === i.refId)?.courseSlugs ?? []).map((s) => t.courses.find((x) => x.slug === s)?.id ?? '')
        : [],
  );
  for (const cid of courseIds.filter(Boolean))
    if (!t.enrollments.some((e) => e.userId === user.id && e.courseId === cid))
      t.enrollments.push({ userId: user.id, courseId: cid, enrolledAt: new Date().toISOString(), orderId: order.id });
  return ok(c, { claimed: true, courseSlug: t.courses.find((x) => x.id === courseIds[0])?.slug ?? null });
});

/** Max length per `acquisition` field, as the API validates them (`app` is a boolean; unknown keys are ignored). */
const ACQUISITION_MAX: Record<string, number> = {
  utmSource: 100,
  utmMedium: 100,
  utmCampaign: 100,
  referrer: 500,
  gclid: 200,
  fbclid: 500,
  ttclid: 200,
  liFatId: 200,
  msclkid: 200,
  epik: 200,
  twclid: 200,
};

function acquisitionErrors(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return { acquisition: 'The acquisition field must be an array.' };
  const a = raw as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const [key, max] of Object.entries(ACQUISITION_MAX)) {
    const v = a[key];
    if (v === undefined || v === null) continue;
    const wire = key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
    if (typeof v !== 'string' || v.length > max)
      errors[`acquisition.${key}`] = `The acquisition.${wire} field must not be greater than ${max} characters.`;
  }
  if (a.app !== undefined && a.app !== null && typeof a.app !== 'boolean')
    errors['acquisition.app'] = 'The acquisition.app field must be true or false.';
  return errors;
}
