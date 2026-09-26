/**
 * Payment-provider boundary.
 *
 * Production: card entry is Stripe's Payment Element (an iframe), so card numbers never touch our servers, our React
 * state, or our logs (PCI SAQ-A). `createCardToken` becomes `stripe.createPaymentMethod(...)` and returns its id.
 * PayPal / Klarna / Afterpay are hosted redirects started by the API.
 *
 * Development (mock API): the design's plain card fields stand in for the Element and this function returns Stripe's
 * well-known test tokens: `tok_visa`, or `tok_chargeDeclined` for the 4000 0000 0000 0002 test card.
 */
export type CardInput = { number: string; expiry: string; cvc: string };
export type CardTokenResult = { token: string } | { error: 'number' | 'expiry' | 'cvc' };

export function createCardToken(card: CardInput): CardTokenResult {
  const digits = card.number.replace(/\s/g, '');
  if (!/^\d{16}$/.test(digits)) return { error: 'number' };
  const m = /^(\d{2})\/(\d{2})$/.exec(card.expiry.trim());
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return { error: 'expiry' };
  if (!/^\d{3,4}$/.test(card.cvc.trim())) return { error: 'cvc' };
  return { token: digits === '4000000000000002' ? 'tok_chargeDeclined' : 'tok_visa' };
}

/** `4242424242424242` → `4242 4242 4242 4242` while typing. */
export const formatCardNumber = (v: string) =>
  v
    .replace(/\D/g, '')
    .slice(0, 16)
    .replace(/(.{4})/g, '$1 ')
    .trim();

/** `0428` → `04/28` while typing. */
export function formatExpiry(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}
