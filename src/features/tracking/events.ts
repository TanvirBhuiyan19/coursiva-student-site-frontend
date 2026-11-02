import type { ConsentChoice } from '@/features/consent/store';
import type { SiteTracking } from './ids';
import { applyTags, isLoaded, tagWindow, type Tool } from './tags';

/**
 * The storefront's standard e-commerce events, sent to the tags the visitor allowed (docs/consent.md,
 * docs/api/tenant.md → tracking): page_view, view_item, begin_checkout, add_payment_info, purchase, sign_up and lead.
 * Browser-only. An event that happens before the tags load (the consent banner is still open) waits on this page and
 * goes to each tag when it loads. A purchase is sent once per order (a marker per order id, written once a tag got it).
 *
 * Meta and TikTok get the same event ids as the server-side conversions of the API (`purchase_{order id}`,
 * `sign_up_{user id}`, `lead_{submission id}`), so each platform counts the browser and server copies once. GA4
 * de-duplicates purchases by `transaction_id`.
 */

export interface TrackItem {
  id: string;
  name: string;
  /** Major units (49.5), as the platforms expect. */
  price?: number;
  quantity?: number;
}

export type TrackEvent =
  | { name: 'view_item'; item: TrackItem; currency?: string; value?: number }
  | { name: 'begin_checkout' | 'add_payment_info'; items: TrackItem[]; currency: string; value: number }
  | { name: 'purchase'; orderId: string; items: TrackItem[]; currency: string; value: number }
  | { name: 'sign_up'; userId: string; method?: string }
  | { name: 'lead'; submissionId: string; formId?: string };

type Sendable = TrackEvent | { name: 'page_view' };

/** The event id shared with the API's server-side copy (null: browser-only event). */
export function eventIdOf(e: Sendable): string | null {
  if (e.name === 'purchase') return `purchase_${e.orderId}`;
  if (e.name === 'sign_up') return `sign_up_${e.userId}`;
  if (e.name === 'lead') return `lead_${e.submissionId}`;
  return null;
}

const MAX_WAITING = 20;
let config: SiteTracking | null = null;
/** Events of this page with the tools that already got them. */
const waiting: { event: TrackEvent; sent: Set<Tool> }[] = [];
let lastPage: string | null = null;

const PURCHASE_KEY = (id: string) => `coursiva:purchase:${id}`;
function purchaseSeen(id: string): boolean {
  try {
    return localStorage.getItem(PURCHASE_KEY(id)) !== null;
  } catch {
    return false;
  }
}
function rememberPurchase(id: string) {
  try {
    localStorage.setItem(PURCHASE_KEY(id), '1');
  } catch {
    // Storage blocked: this page still sends it once.
  }
}

const GA_NAMES: Record<Sendable['name'], string> = {
  page_view: 'page_view',
  view_item: 'view_item',
  begin_checkout: 'begin_checkout',
  add_payment_info: 'add_payment_info',
  purchase: 'purchase',
  sign_up: 'sign_up',
  lead: 'generate_lead',
};
const META_NAMES: Record<Sendable['name'], string> = {
  page_view: 'PageView',
  view_item: 'ViewContent',
  begin_checkout: 'InitiateCheckout',
  add_payment_info: 'AddPaymentInfo',
  purchase: 'Purchase',
  sign_up: 'CompleteRegistration',
  lead: 'Lead',
};
const TIKTOK_NAMES: Record<Exclude<Sendable['name'], 'page_view'>, string> = {
  view_item: 'ViewContent',
  begin_checkout: 'InitiateCheckout',
  add_payment_info: 'AddPaymentInfo',
  purchase: 'CompletePayment',
  sign_up: 'CompleteRegistration',
  lead: 'SubmitForm',
};
/** Yandex Metrica goals (the school creates goals with these identifiers). */
const YANDEX_GOALS: Partial<Record<Sendable['name'], string>> = { purchase: 'purchase', sign_up: 'sign_up', lead: 'lead' };

function itemsOf(e: Sendable): TrackItem[] {
  if (e.name === 'view_item') return [e.item];
  if (e.name === 'begin_checkout' || e.name === 'add_payment_info' || e.name === 'purchase') return e.items;
  return [];
}
function money(e: Sendable): { value: number; currency: string } | null {
  if (e.name === 'view_item') return e.value !== undefined && e.currency ? { value: e.value, currency: e.currency } : null;
  if (e.name === 'begin_checkout' || e.name === 'add_payment_info' || e.name === 'purchase')
    return { value: e.value, currency: e.currency };
  return null;
}

function sendGoogle(e: Sendable) {
  const win = tagWindow();
  const items = itemsOf(e).map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.quantity ?? 1 }));
  const params: Record<string, unknown> = {
    ...(money(e) ?? {}),
    ...(items.length ? { items } : {}),
    ...(e.name === 'purchase' ? { transaction_id: e.orderId } : {}),
    ...(e.name === 'sign_up' ? { method: e.method ?? 'email' } : {}),
    ...(e.name === 'page_view' ? { page_location: window.location.href, page_title: document.title } : {}),
  };
  if (config?.ga4) win.gtag?.('event', GA_NAMES[e.name], params);
  if (config?.gtm) {
    // Tag Manager reads `event` objects; ecommerce is cleared first, as Google recommends.
    if (items.length) win.dataLayer?.push({ ecommerce: null });
    win.dataLayer?.push({ event: GA_NAMES[e.name], ...(items.length || money(e) ? { ecommerce: params } : params) });
  }
}

function sendMeta(e: Sendable) {
  const fbq = tagWindow().fbq;
  if (!fbq) return;
  const items = itemsOf(e);
  const data: Record<string, unknown> = {
    ...(money(e) ?? {}),
    ...(items.length ? { content_ids: items.map((i) => i.id), content_type: 'product', num_items: items.length } : {}),
  };
  const id = eventIdOf(e);
  if (id) fbq('track', META_NAMES[e.name], data, { eventID: id });
  else fbq('track', META_NAMES[e.name], data);
}

function sendTikTok(e: Sendable) {
  const ttq = tagWindow().ttq as (Record<string, (...a: unknown[]) => void> & unknown[]) | undefined;
  if (!ttq) return;
  if (e.name === 'page_view') {
    ttq.page?.();
    return;
  }
  const items = itemsOf(e);
  const data: Record<string, unknown> = {
    ...(money(e) ?? {}),
    ...(items.length
      ? {
          content_type: 'product',
          contents: items.map((i) => ({ content_id: i.id, content_name: i.name, quantity: i.quantity ?? 1, price: i.price })),
        }
      : {}),
  };
  const id = eventIdOf(e);
  ttq.track?.(TIKTOK_NAMES[e.name], data, id ? { event_id: id } : {});
}

function sendYandex(e: Sendable) {
  const ym = tagWindow().ym;
  const counter = Number(config?.yandexMetrica);
  if (!ym || !counter) return;
  if (e.name === 'page_view') ym(counter, 'hit', window.location.href, { title: document.title, referer: document.referrer });
  const goal = YANDEX_GOALS[e.name];
  if (goal) ym(counter, 'reachGoal', goal, money(e) ? { order_price: money(e)!.value, currency: money(e)!.currency } : {});
}

const SENDERS: Partial<Record<Tool, (e: Sendable) => void>> = {
  google: sendGoogle,
  meta: sendMeta,
  tiktok: sendTikTok,
  yandex: sendYandex,
};

function deliver(e: Sendable, tools: Tool[]): Tool[] {
  const got: Tool[] = [];
  for (const tool of tools) {
    const send = SENDERS[tool];
    if (!send || !isLoaded(tool)) continue;
    try {
      send(e);
      got.push(tool);
    } catch {
      // A tag's own error never breaks the page.
    }
  }
  return got;
}

const ALL_TOOLS: Tool[] = ['google', 'meta', 'tiktok', 'yandex', 'clarity', 'linkedin'];

/** Sends an event to the loaded tags now, and to the others as they load on this page. */
export function trackEvent(e: TrackEvent) {
  if (e.name === 'purchase' && purchaseSeen(e.orderId)) return;
  const entry = { event: e, sent: new Set<Tool>() };
  for (const tool of deliver(e, ALL_TOOLS)) entry.sent.add(tool);
  if (e.name === 'purchase' && entry.sent.size) rememberPurchase(e.orderId);
  waiting.push(entry);
  if (waiting.length > MAX_WAITING) waiting.shift();
}

/** A page view for the current address (once per address; client-side navigations included). */
export function trackPageView() {
  const href = window.location.href;
  if (href === lastPage) return;
  lastPage = href;
  // Earlier pages' events stay with their page.
  waiting.length = 0;
  deliver({ name: 'page_view' }, ALL_TOOLS);
}

/** Loads the tags the visitor's choice allows; tags loaded now get this page's view and the events that waited. */
export function applyTracking(t: SiteTracking, choice: ConsentChoice) {
  config = t;
  const fresh = applyTags(t, choice);
  if (!fresh.length) return;
  if (lastPage !== null) deliver({ name: 'page_view' }, fresh);
  for (const entry of waiting) {
    const e = entry.event;
    if (e.name === 'purchase' && purchaseSeen(e.orderId) && entry.sent.size === 0) continue;
    for (const tool of deliver(
      e,
      fresh.filter((f) => !entry.sent.has(f)),
    ))
      entry.sent.add(tool);
    if (e.name === 'purchase' && entry.sent.size) rememberPurchase(e.orderId);
  }
}

/** Major units of a minor-unit amount (zero-decimal currencies as they are). */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);
export function major(m: { amount: number; currency: string }): number {
  return ZERO_DECIMAL.has(m.currency.toUpperCase()) ? m.amount : Math.round(m.amount) / 100;
}

/** Test helper: a fresh page. */
export function resetEventsForTests() {
  config = null;
  waiting.length = 0;
  lastPage = null;
}
