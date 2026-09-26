/** Cart, wishlist, checkout quote, checkout and orders. All money maths happens here (one owner). */
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Cart, CheckoutInput, CheckoutTarget, Order, Quote, QuoteInput, WishlistItem } from '@/features/commerce/types';
import { type AppContext, type Env, requireUser } from '../lib/db';
import { body, forbidden, id, invalid, isEmail, noContent, notFound, ok, str } from '../lib/http';
import { completedSet, courseSummary, installmentAmount, isEnrolled, money, person, resumeLesson } from '../lib/present';
import type { CourseRow, OrderRow, TenantData, UserRow } from '../lib/records';
import { CART } from './auth';

export const commerceRoutes = new Hono<Env>();

const COUNTRIES = ['United States', 'United Kingdom', 'Germany', 'Canada', 'Australia', 'Other'];
const VAT: Record<string, number> = { 'United Kingdom': 20, Germany: 19 };
const COUPONS: Record<string, number> = { LAUNCH20: 20 };

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

/* ── Quote & checkout ─────────────────────────────────────────────────────── */

interface Priced {
  lines: {
    kind: 'course' | 'membership' | 'bundle';
    refId: string;
    title: string;
    color: string;
    meta: string;
    unit: number;
    qty: number;
  }[];
  subtotal: number;
  discount: number;
  couponPct: number;
  couponCode: string | null;
  couponValid: boolean;
  bump: number;
  taxRate: number;
  tax: number;
  total: number;
  dueToday: number;
  installments: { count: number; amount: number } | null;
  installmentOption: { count: number; amount: number } | null;
}

function parseTarget(v: unknown): CheckoutTarget | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'course' && typeof o.courseSlug === 'string') return { kind: 'course', courseSlug: o.courseSlug };
  if (o.kind === 'cart') return { kind: 'cart' };
  if (o.kind === 'bundle' && typeof o.bundleSlug === 'string') return { kind: 'bundle', bundleSlug: o.bundleSlug };
  if (o.kind === 'membership' && typeof o.planId === 'string')
    return { kind: 'membership', planId: o.planId, interval: o.interval === 'year' ? 'year' : 'month' };
  return null;
}

function price(c: AppContext, b: Partial<QuoteInput>): Priced | { error: Record<string, string> } {
  const t = c.get('t');
  const target = parseTarget(b.target);
  if (!target) return { error: { target: 'Nothing to buy.' } };
  const seats = Math.min(100, Math.max(1, Math.floor(Number(b.seats) || 1)));
  const lines: Priced['lines'] = [];
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
      lines.push({
        kind: 'course',
        refId: row.id,
        title: row.title,
        color: row.coverColor,
        meta: `${lessons} lessons · lifetime access`,
        unit: row.price,
        qty: seats,
      });
    }
    if (!lines.length) return { error: { target: 'Your cart is empty.' } };
  }
  const subtotal = lines.reduce((a, l) => a + l.unit * l.qty, 0);
  const code = str(b.couponCode).toUpperCase() || null;
  const couponPct = code ? (COUPONS[code] ?? 0) : 0;
  const discount = Math.round((subtotal * couponPct) / 100 / 100) * 100;
  const afterDiscount = subtotal - discount;
  const planAllowed = target.kind === 'course';
  const installmentOption = planAllowed ? { count: 3, amount: installmentAmount(afterDiscount) } : null;
  const usePlan = planAllowed && b.plan === 'installments';
  const bump = b.orderBump && t.orderBump && target.kind !== 'membership' ? t.orderBump.price : 0;
  const base = (usePlan ? installmentOption!.amount : afterDiscount) + bump;
  const taxRate = VAT[str(b.country)] ?? 0;
  const tax = Math.round((base * taxRate) / 100 / 100) * 100;
  const dueToday = base + tax;
  const total =
    (usePlan ? installmentOption!.amount * 3 : afterDiscount) +
    bump +
    (usePlan ? Math.round(((installmentOption!.amount * 3 + bump) * taxRate) / 100 / 100) * 100 : tax);
  return {
    lines,
    subtotal,
    discount,
    couponPct,
    couponCode: code,
    couponValid: couponPct > 0,
    bump,
    taxRate,
    tax,
    total,
    dueToday,
    installments: usePlan ? installmentOption : null,
    installmentOption,
  };
}

function presentQuote(t: TenantData, p: Priced, orderBumpSelected: boolean, target: CheckoutTarget): Quote {
  const m = (n: number) => money(t, n);
  return {
    lines: p.lines.map((l) => ({ title: l.title, cover: { url: null, color: l.color, alt: l.title }, price: m(l.unit), quantity: l.qty })),
    subtotal: m(p.subtotal),
    discount: m(p.discount),
    coupon: p.couponCode
      ? { code: p.couponCode, valid: p.couponValid, message: p.couponValid ? `${p.couponPct}% discount applied` : 'That code isn’t valid' }
      : null,
    orderBump:
      t.orderBump && target.kind !== 'membership'
        ? { title: t.orderBump.title, description: t.orderBump.description, price: m(t.orderBump.price), selected: orderBumpSelected }
        : null,
    tax: m(p.tax),
    taxLabel: p.taxRate ? `VAT ${p.taxRate}%` : null,
    total: m(p.total),
    dueToday: m(p.dueToday),
    installments: p.installments ? { count: p.installments.count, amount: m(p.installments.amount) } : null,
    fullAmount: m(p.subtotal - p.discount),
    installmentOption: p.installmentOption ? { count: p.installmentOption.count, amount: m(p.installmentOption.amount) } : null,
    bnpl: { count: 4, amount: m(Math.round(p.dueToday / 4)) },
    countries: COUNTRIES,
    proof: (() => {
      const q = t.home.testimonials[0];
      return q ? { quote: q.quote, author: person(q.name, q.color), context: 'verified buyer', rating: q.rating } : null;
    })(),
    enrolledCount: target.kind === 'course' ? (t.courses.find((x) => x.slug === target.courseSlug)?.studentCount ?? null) : null,
    guaranteeDays: t.membership.guaranteeDays,
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
  const method = str(b.paymentMethod);
  if (!['card', 'paypal', 'bnpl', 'wallet'].includes(method)) errors.paymentMethod = 'Choose how to pay.';
  if (method === 'card' && !str(b.paymentToken).startsWith('tok_'))
    errors.paymentToken = 'Your card couldn’t be verified — check the details and try again.';
  if (method === 'card' && b.paymentToken === 'tok_chargeDeclined')
    errors.paymentToken = 'Your card was declined. Try another card or PayPal.';
  const gift =
    b.gift && typeof b.gift === 'object'
      ? { recipientEmail: str(b.gift.recipientEmail).toLowerCase(), message: str(b.gift.message) }
      : null;
  if (gift && !isEmail(gift.recipientEmail)) errors.giftRecipientEmail = 'Enter the recipient’s email.';
  if (target.kind !== 'membership' && !gift && (Number(b.seats) || 1) === 1) {
    const owned = p.lines.find((l) => l.kind === 'course' && isEnrolled(t, user, l.refId));
    if (owned) errors.target = `You already own ${owned.title}.`;
  }
  if (Object.keys(errors).length) return invalid(c, errors);

  const bnpl = b.bnplProvider === 'afterpay' ? 'Afterpay' : 'Klarna';
  const paymentMethod =
    method === 'card'
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
    items: p.lines.map((l) => ({
      kind: l.kind,
      refId: l.refId,
      title: l.title,
      coverColor: l.color,
      meta: l.meta,
      unitPrice: l.unit,
      quantity: l.qty,
    })),
    subtotal: p.subtotal,
    discount: p.discount,
    couponCode: p.couponValid ? p.couponCode : null,
    orderBump: p.bump,
    tax: p.tax,
    taxRatePercent: p.taxRate,
    total: p.total,
    dueToday: p.dueToday,
    plan: p.installments ? { installments: p.installments.count, installmentAmount: p.installments.amount } : null,
    paymentMethod,
    gift: gift ? { ...gift, claimUrl: `https://${host}/claim/${randomBytes(9).toString('base64url')}` } : null,
    seats:
      seats > 1
        ? {
            quantity: seats,
            claimUrls: Array.from({ length: seats }, () => `https://${host}/claim/${randomBytes(9).toString('base64url')}`),
          }
        : null,
    billing: { name, email, country: str(b.country) || 'United States' },
    status: 'paid',
  };
  t.orders.push(order);

  // Fulfilment: gifts and team seats issue claim links instead of enrolling the buyer.
  if (!gift && seats === 1) {
    for (const l of p.lines) {
      if (l.kind === 'course' && !t.enrollments.some((e) => e.userId === user.id && e.courseId === l.refId)) {
        t.enrollments.push({ userId: user.id, courseId: l.refId, enrolledAt: order.createdAt, orderId });
      }
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
  if (target.kind === 'cart') {
    const row = cartRow(t, user.id);
    row.courseIds = [];
  } else if (target.kind === 'course') {
    const row = cartRow(t, user.id);
    const bought = p.lines[0]?.refId;
    row.courseIds = row.courseIds.filter((x) => x !== bought);
  }
  return ok(c, presentOrder(t, user, order), 201);
});

export function presentOrder(t: TenantData, user: UserRow, o: OrderRow): Order {
  const m = (n: number) => money(t, n);
  const first = o.items[0];
  const course = first?.kind === 'course' && o.items.length >= 1 ? t.courses.find((x) => x.id === first.refId) : undefined;
  return {
    id: o.id,
    number: o.number,
    createdAt: o.createdAt,
    status: o.status,
    items: o.items.map((i) => ({
      kind: i.kind,
      title: i.title,
      meta: i.kind === 'course' ? `Online course · ${i.meta}` : i.kind === 'bundle' ? `Course bundle · ${i.meta}` : i.meta,
      cover: { url: null, color: i.coverColor, alt: i.title },
      unitPrice: m(i.unitPrice),
      quantity: i.quantity,
      courseSlug: i.kind === 'course' ? (t.courses.find((x) => x.id === i.refId)?.slug ?? null) : null,
    })),
    subtotal: m(o.subtotal),
    discount: m(o.discount),
    couponCode: o.couponCode,
    orderBump: o.orderBump ? m(o.orderBump) : null,
    tax: m(o.tax),
    taxLabel: o.taxRatePercent ? `VAT ${o.taxRatePercent}%` : null,
    total: m(o.total),
    dueToday: m(o.dueToday),
    installments: o.plan ? { count: o.plan.installments, amount: m(o.plan.installmentAmount) } : null,
    paymentMethod: o.paymentMethod,
    gift: o.gift ? { recipientEmail: o.gift.recipientEmail, claimUrl: o.gift.claimUrl } : null,
    seats: o.seats,
    billing: o.billing,
    seller: { name: t.site.legalName, email: t.site.supportEmail },
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
  return ok(c, presentOrder(t, user, o));
});
