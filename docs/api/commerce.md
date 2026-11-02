# Commerce — cart, wishlist, checkout, orders

## Cart (guests and learners)

| Endpoint                           | Result                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /api/v1/cart`                 | `Cart { items[], subtotal, recommendations[] }`                                                       |
| `POST /api/v1/cart/items`          | `{ course_slug }` → `201 Cart`; `422` if already owned, free, or not a one-time / payment-plan course |
| `DELETE /api/v1/cart/items/{slug}` | `Cart`                                                                                                |

Guests: cart keyed by an httpOnly `cart_token` cookie (set on first add), merged into the account on sign-in.

Only `one_time` and `payment_plan` courses go in the cart: a subscription, pay-what-you-want or membership course is
`422 course_slug` "{title} can’t be added to the cart — buy it from its course page.", and a cart holding one (its
pricing changed after it was added) is `422 target` "{title} can’t be bought from the cart — remove it and buy it from
its course page." on the quote and the checkout.

## Wishlist (learners)

`GET /api/v1/me/wishlist` → `WishlistItem[]` · `PUT /api/v1/me/wishlist/{slug}` → `204` · `DELETE …` → `204`.

## `POST /api/v1/checkout/quote` — public

The **only** place checkout figures are computed. The site calls it on every input change.

```jsonc
// QuoteInput
{
  "target": { "kind": "course", "course_slug": "…" }   // or { "kind": "cart" } · { "kind": "bundle", "bundle_slug": "…" }
                                                        // or { "kind": "product", "product_slug": "…" } (a digital download)
                                                        // or { "kind": "membership", "plan_id": "…", "interval": "month" | "year" }
                                                        // or { "kind": "live", "live_session_id": "…", "series": false } (a live class
                                                        //    ticket: one seat, never a gift; community.md → Paid sessions)
  "plan": "full" | "installments",                      // instalments only for single courses
  "coupon_code": "LAUNCH20" | null,
  "order_bump": false,
  "seats": 1,                                            // team purchase: price × seats, issues claim links
  "country": "United Kingdom",                           // drives tax (see "Tax" below)
  "region": "CA" | null,                                 // state/province code from `subdivisions` (≤ 8)
  "tax_id": "DE123456789" | null,                        // buyer's EU VAT number (≤ 32), when `accepts_tax_id`
  "gift_card": "GIFT-AB12-CD34-EF56" | null,             // one gift card per order (a string, ≤ 32)
  "amount": 1500 | null,                                 // pay-what-you-want courses only: per seat, minor units
  "cross_sell": true | null                              // tick "Frequently bought together" (see Offers below)
}
```

→ `Quote { lines[], subtotal, discount, coupon { code, valid, message }, order_bump, tax, tax_label, tax_details,
total, due_today, gift_card, pay_today, installments, full_amount, installment_option, recurring, pay_what_you_want,
bnpl { count, amount }, countries[], subdivisions[], proof, enrolled_count, guarantee_days, payment, savings, price_offer,
quantity_tiers[], cross_sell, save_card, post_purchase }` (offers: see **Offers** below; `lines[]` are `{ title, cover,
price, quantity, compare_at }`).

### Tax

The API's tax engine decides from the school's registrations (Orders → Tax) and the buyer's `country`, `region` and
`tax_id`; the site only prints the result.

- `tax` is **always the tax amount**; `tax_label` is `"VAT (20%)"`, `"Sales tax (7.25%)"`, `"Reverse charge"` or
  `null` (no tax: the school isn't registered there).
- `tax_details { inclusive, rate, reverse_charge, region, provider: 'builtin'|'stripe'|null, note, accepts_tax_id,
region_required, tax_id: { status: 'valid'|'invalid'|'unverified', message } | null }`.
  - Exclusive: `tax` is added to the total (site: "VAT (20%) £20"). Inclusive: prices include it, the total doesn't
    grow (site: "Includes GST (10%) £9.09"). Reverse charge (a VIES-verified EU VAT number where the school's EU
    registration reverse-charges): `tax` 0, `tax_label` "Reverse charge", `note` printed under the totals.
  - `accepts_tax_id`: show "VAT number (optional)"; its check comes back in `tax_id` (`valid` → "VAT number verified —
    reverse charge applies"; otherwise `message` verbatim). A tax ID where it doesn't apply is ignored (`tax_id: null`).
    With Stripe Tax on the same rules hold: only a registration with reverse charge on takes a VAT number, and only one
    VIES confirms is sent to Stripe (`invalid` / `unverified` numbers pay VAT). Greek numbers may start with `EL` or
    `GR`. A VIES outage is remembered for a minute (`unverified`), so quotes never wait on it repeatedly; identical
    re-quotes by the same buyer within 10 minutes reuse one Stripe Tax calculation.
  - `region_required`: the country has states/provinces and the school is registered in one of them; the checkout
    answers `422 region` "Choose your state or province." without one. An unknown code is `422 region` "Choose a
    state or province from the list." (quote too).
- `subdivisions[] { country, code, name }`: US states + DC and Canadian provinces/territories (static); the site
  shows the state select under the country when it has any.
- Instalments carry their share of the added tax (`installments.amount`); `recurring.amount` includes it.

### Pricing models at checkout (`target.kind: course`)

The course's `pricing.model` ([catalog.md](catalog.md)) decides what is charged — never the list price by default:

- **`subscription`** — today's charge is the **monthly price** (coupon, tax and the order bump as usual), and the API
  starts a monthly subscription (the memberships machinery: the card is saved, renewals charge the locked price plus
  the first charge's tax on the same day each month, failed renewals are retried on days 1, 3 and 5 and the fourth
  failure ends it; access lasts while it is live and ends at the end of the paid period after a cancel). `recurring
{ interval: "month", amount, trial_days: 0 }` is each renewal (tax included). Never a gift or team seats (`422
target` "A subscription can’t be bought as a gift or for a team."); a learner with a live subscription to the course
  gets `422 target` "You’re already subscribed to {title}.". The order line keeps `interval` and the learner's order
  shows `meta: "Monthly subscription"`; renewals are course orders titled "{course} subscription".
- **`pay_what_you_want`** — `amount` is the learner's price per seat (minor units, integer 0–100,000,000; no amount =
  the suggested price). `pay_what_you_want { minimum, suggested, amount, message }`: below the minimum the quote still
  answers 200, priced at the minimum, with `message` "Pay at least $10." (the site shows it under the field and
  disables paying), and `POST /checkout` refuses it: `422 amount` with the same message (nothing is booked). A
  non-integer or negative `amount` is `422 amount` "Enter an amount.". Gifts and seats work as for one-time courses.
- **`membership`** — not sold on its own: `422 target` "This course comes with a membership — join a membership plan
  to get it." (quote, checkout and cart). The site links to the membership page instead.
- **`payment_plan`** — the instalment option (`installment_option`, `plan: "installments"`), as before.
- **`free`** — `422 target` "This course is free — enrol from the course page.".

`recurring` is also set for memberships (`{ interval, amount, trial_days }`, each renewal with tax) and `null` for
one-off purchases. The site words the button "Subscribe · $35 today" (memberships: "Start membership"), shows "Renews
at $35 every month until cancelled." and collects a card (saved for renewals) whenever `recurring` is set — even when
nothing is due today.

### Gift cards (`gift_card`)

A gift card is a **tender after the total**, not a discount: `total`, `due_today`, `discount` and `tax` keep their
meaning, and the card applies up to `due_today` (after the coupon and tax; a membership's first charge only).

```jsonc
"gift_card": {                                   // null when no gift_card was sent
  "code": "GIFT-••••-CD34",                      // masked (last 4 only); a malformed code comes back as typed (≤ 32)
  "valid": true,
  "message": "Gift card applied: £20",           // shown verbatim under the field
  "applied": { "amount": 2000, "currency": "GBP" },   // 0 when invalid
  "remaining": { "amount": 3000, "currency": "GBP" }  // left on the card after this order; null when invalid
},
"pay_today": { "amount": 2900, "currency": "GBP" }    // due_today − applied: what the card is charged now
```

- The input is trimmed, upper-cased and stripped of spaces; dashes may be left out (`gift ab12 cd34`). Codes are
  `GIFT-XXXX-XXXX-XXXX` (older cards `GIFT-XXXX-XXXX`).
- A refusal is reported in `gift_card` (never a `422` on the quote), with these exact messages:
  "Too many gift card attempts. Please try again in {n} minutes." · "This gift card isn’t valid." · "Gift cards can’t
  be used with payment plans." · "There’s nothing to pay today, so your gift card wasn’t used." · "This gift card has
  no balance left." · "This gift card’s balance is in use by another checkout. Try again later.".
- A list (or any non-string) is `422 gift_card` "Only one gift card can be used per order.".
- **Throttle:** distinct failed codes (malformed or unknown) are limited per IP and per learner (10 per 15 minutes)
  and per IP across schools (30 per hour); the same wrong code repeated counts once. The site sends a code only after
  **Apply**, and drops a refused code from the next quotes until it is applied again. The code never goes in a URL.
- `bnpl.amount` is based on the total less the gift card's part.

`payment` (Laravel `Commerce\Gateway\PaymentSetup`) tells the site how to collect payment details:

```jsonc
{ "provider": "stripe", "publishable_key": "pk_live_…", "stripe_account": "acct_…", "methods": ["card"] }
// the fake gateway (local development, tests, this mock):
{ "provider": "test", "publishable_key": null, "stripe_account": null, "methods": ["card", "paypal", "bnpl", "wallet"] }
```

- `stripe`: the site mounts Stripe's **Payment Element** (`@stripe/react-stripe-js`, deferred-intent mode:
  `mode`/`amount`/`currency` from `due_today`, `setupFutureUsage: off_session` when `save_card` (instalment plans,
  subscriptions, and a one-click offer after payment; an API without `save_card` → instalments and `recurring` only),
  `mode: setup` for a zero-amount subscription) with `loadStripe(publishable_key, { stripeAccount })` — direct
  charges on the school's connected account. The publishable key is the console's Stripe connection (else
  `STRIPE_KEY`); either value is `null` until Stripe / the school's onboarding is connected, and the site then shows
  "This school can’t take card payments yet." Only card-based methods are offered (`allowedPaymentMethodTypes:
['card', 'link']`; Apple Pay and Google Pay appear inside the Element) because the API confirms without redirects —
  PayPal and pay-later stay hidden.
- `test`: a test-card picker stands in for the Element (no card fields at all) and sends Stripe's test tokens.
- The Element's `amount` and `mode` come from **`pay_today`** (what the card is charged, after the gift card).
- Free orders and orders a gift card fully covers (`pay_today` 0, no `recurring`) skip the payment step entirely. A
  subscription (membership or subscription course) still collects a card (a zero-amount `mode: setup`, as for a
  trial): its renewals need it.

Rules in the mock (Laravel owns the real ones): coupon `LAUNCH20` = 20% off; VAT UK 20%, DE 19%; instalments =
3 × ⌈total/3 + 5⌉ in major units; order bump on every purchase but a membership plan (as the API: courses, cart, bundles, downloads and Services, never
on the product itself); gift cards `GIFT-TEST-0050` ($50),
`GIFT-HALF-0025` ($25) and `GIFT-USED-0000` (nothing left), no throttle; seed courses are one-time (a course row's
optional `pricing` makes it a subscription, pay-what-you-want or membership course, with Laravel's rules and
messages).

### Offers (`savings`, `price_offer`, `quantity_tiers`, `cross_sell`, `order_bump`, `save_card`, `post_purchase`)

The school's offers (dashboard → Offers) are priced, matched and timed **by the API** — the site never applies a
discount itself. An offer is live while it is on, started and not ended **by the server's clock** (at quote, at
checkout and at the one-click accept): a countdown the page still shows is not applied after `ends_at`.

```jsonc
"lines": [{ "title": "…", "cover": {…}, "price": { "amount": 15215 }, "quantity": 1,
            "compare_at": { "amount": 17900 } }],      // list price when an offer lowered the line; else null
"savings": { "amount": 2685 },                          // Σ (compare_at − price) × quantity + the bump's saving
"price_offer": {                                        // the one offer that sets the price, or null
  "kind": "countdown" | "quantity" | "trial",
  "headline": "Spring sale",  "body": "",               // the school's copy; '' = the site's default wording
  "discount_percent": 15,     "ends_at": "2026-10-29T12:00:00Z",   // ends_at: countdown only
  "trial_days": 14 | null,                              // trial with a free period (then discount_percent 0)
  "applied": true, "message": null                      // applied false + message when a coupon replaced it
},
"quantity_tiers": [{ "min_seats": 3, "discount_percent": 10 }, { "min_seats": 5, "discount_percent": 25 }],
"cross_sell": {                                         // "Frequently bought together", or null
  "headline": "Frequently bought together", "body": "…", "discount_percent": 30,
  "items": [{ "course_slug": "…", "title": "…", "cover": {…}, "price": { "amount": 6930 }, "compare_at": { "amount": 9900 } }],
  "total": { "amount": 6930 }, "selected": false        // selected = the input's cross_sell
},
"order_bump": { "title": "…", "description": "…", "headline": "", "price": {…}, "compare_at": null, "selected": false },
"save_card": true,                                      // the card is kept: instalments, a subscription, or a one-click offer
"post_purchase": true                                   // a one-click offer follows the payment (thank-you page)
```

- **Price offer** — the single best of a live `countdown` sale (P% off each line of its courses; "all courses" = every
  line), the `quantity` tier reached by `seats` (course and bundle purchases) and, on a subscription course, a `trial`
  (`trial_days` free days: `due_today` 0 for the course, `recurring.trial_days` set, the card saved; or P% off the first
  month). The bigger saving wins (ties: countdown). Never on pay-what-you-want courses or memberships. Sale price =
  `list − round(list × P / 100)`; instalments get the same percent off. A trial is for new subscribers only (one who
  ever subscribed to that course doesn't see it), and a free trial is **once per person**: not again for the same
  mailbox under another account (lower case, no `+tag`, Gmail dots ignored) — the quote then has no `price_offer` — nor
  for the same card (the processor's card fingerprint, known once the card is saved: such a checkout starts the
  subscription without free days and bills the first period at once). A membership plan's `trial_days` follow the same
  rule. A free trial's order carries no tax (`tax` 0); its first renewal is taxed.
- **Coupons and a sale.** A code that stacks applies on the sale price. One that doesn't: if it saves more than the
  sale, it replaces it (lines back to list price, `price_offer.applied: false`, `message` "Your code saves more, so it
  replaces the sale price."); otherwise `coupon.valid: false` "This code can’t be combined with the sale price — you’re
  already getting the better deal.". During a free trial: `coupon.valid: false` "Nothing is charged today during the
  free trial.".
- **Cross-sell** (course, cart and bundle purchases; one seat, paid in full, not subscriptions): companion courses the
  learner doesn't own and isn't buying, at `list − round(list × P / 100)`. With `cross_sell: true` they become extra
  lines of the same order (`compare_at` = list), taxed like the items, never discounted by the coupon.
- **Order bump**: `headline` (the school's copy, '' = default) and `compare_at` when the bump offer discounts it.
  Offered on every checkout but a membership plan (courses, the cart, bundles, digital downloads and Services), never
  on the product being bought; `order_bump: null` otherwise.
- **`post_purchase`**: a live upsell matches this purchase (one seat, not a gift, not a membership): the card is kept
  (`save_card`) so the thank-you page can offer it with one click. The site says so under the card field: the card is
  kept by the processor and charged only if the learner accepts.
- Site: the banner shows `headline` (or "Sale: 15% off" / "Team pricing: 10% off for 3+ seats" / "14-day free trial" /
  "50% off your first month") with a live countdown to `ends_at`; when it reaches 0 the site re-quotes (and again every
  15 s while the API still reports it — a fast device clock). Lines with `compare_at` show it struck through; the
  summary shows "You save {savings}"; tiers are listed beside the seats picker.

Rules in the mock: Amplify's offers are all on **Brand Storytelling Lab** (`crs_b`): a 15% countdown (ends two days
after the seed loads), tiers 3+ seats 10% / 5+ seats 25%, Pricing with Confidence 30% off as the cross-sell, then
Launch Lab 20% off (upsell) and Podcast Launchpad 50% off (downsell); coupons `SAVE10` (10%, doesn't stack) and
`STACK5` (5%, stacks) besides `LAUNCH20` (doesn't stack). `TenantData.orderBump.headline` / `discountPercent` are the
bump offer.

## `POST /api/v1/checkout` — signed in

`CheckoutInput` = `QuoteInput` + `{ name, email, accept_terms: true, payment_method: 'card'|'paypal'|'bnpl'|'wallet',
bnpl_provider, payment_token, gift: { recipient_email, message } | null }` → `201 Order`. `region` and `tax_id` are
stored on the order (`billing.region`, `billing.tax_id`); a missing required state is `422 region`.

- **Card data never reaches the API or the site.** Production: the Payment Element creates a **ConfirmationToken**
  (`stripe.createConfirmationToken`, Stripe's current server-side confirmation) → `payment_token: "ctoken_…"` (a
  PaymentMethod id `pm_…` is accepted too); Laravel creates and confirms the PaymentIntent (or the trial's
  SetupIntent) on the connected account. When the bank wants **3-D Secure** the order stays `pending` and the `201`
  carries `next_action: { client_secret }`: the site runs `stripe.handleNextAction({ clientSecret })`, then reads
  `GET /orders/{id}` until it is `paid` (the `payment_intent.succeeded` webhook completes it) and shows the
  confirmation (a still-pending order shows "Confirming your payment…"). Every `201` has `next_action` (`null` when
  paid at once). The fake gateway and the mock accept Stripe test tokens (`tok_visa`; `tok_threeDSecure` → pending +
  `next_action`, which the mock and Laravel's fake gateway complete on the learner's next order read — local and e2e
  only, a real processor's order waits for its webhook; `tok_chargeDeclined` → `422 { errors: { payment_token } }`).
- **`ref`** (optional, ≤ 60) + **`ref_click`** (optional, ≤ 32): the partner slug from a `?ref=` link and the id of
  its recorded click (`POST /affiliates/{slug}/clicks`, once per session per partner). The site keeps the pair in
  `localStorage` for the program's `cookie_days` (0 = no expiry) by its `attribution` rule (docs/consent.md), and
  sends both only with marketing consent. The API credits an Active partner only for its own click inside the window
  (never the buyer themselves unless the program allows self-referrals); `ref` without `ref_click` credits nobody.
  **`post`** (optional, ≤ 80): the last blog post the buyer read (last-click blog revenue). See
  `src/features/analytics/referral.ts`.
- `422` field errors: `name`, `email`, `accept_terms`, `payment_token`, `gift_recipient_email`, `amount` (a
  pay-what-you-want amount under the minimum), `target` ("You already own …"), and `payment_method` when the school can't charge yet ("This school can’t take card payments
  yet. Please try again later." — Stripe onboarding unfinished; or "Payments are temporarily unavailable…" while the
  platform froze the school's checkout). The site shows `payment_method` under the payment method picker as well as in
  the form alert. The mock simulates it with the tenant's `chargesBlocked` flag. `coupon_code` ("This code has been
  fully redeemed." / "You’ve already used this code.") when the code's last use went to another checkout between the
  quote and the order (the API re-counts under a lock); the site shows it in the form alert and the next quote
  reports the code invalid. A coupon use is held by a pending (3-D Secure) order for an hour.
- **Gift card at checkout.** `gift_card` as in the quote. `422 gift_card` with the quote's messages when it doesn't
  apply (an invalid card is an error at checkout, never silently dropped), and "This gift card’s balance changed.
  Review your order and try again." when another checkout used the card between the quote and the order (the API
  re-checks under a lock; nothing is booked). The site shows it under the gift card field and in the form alert, and
  re-quotes. When `pay_today` is 0 (not a membership) the site sends `payment_method: "card"` without a
  `payment_token`, and the API completes the order without calling the processor (`payment_method: "Gift card"`).
  Otherwise the card is charged `pay_today`. The gift card's value is **held** while a payment is pending (3-D
  Secure; the hold is checked hourly and released only after the processor confirms the payment was cancelled), taken
  when the payment succeeds, and released when it fails. Not usable on payment plans.
- **`acquisition`** (optional): `{ utm_source?, utm_medium?, utm_campaign?, referrer?, gclid?, fbclid?, ttclid?,
li_fat_id?, msclkid?, epik?, twclid?, app? }` — the visit's first-touch hints, which the API turns into the order's
  `source` (Google Ads, Meta Ads, Email campaign, Instagram, YouTube, Organic search, `Referral · host`, … — shown on
  the school's Analytics screen; no hints → "Checkout") and keeps for the channels UTM table (`utm_campaign`, which
  click id the visit carried). The click ids are Google (`gclid`), Meta (`fbclid`), TikTok (`ttclid`), LinkedIn
  (`li_fat_id`), Microsoft (`msclkid`), Pinterest (`epik`) and X (`twclid`). Limits: `utm_source`, `utm_medium` and
  `utm_campaign` ≤ 100 chars, `referrer` ≤ 500, each click id ≤ 200 (`fbclid` ≤ 500: Facebook's are long), `app` boolean (mobile app only); a longer value
  is a `422` on `acquisition.<field>`. The site omits the field when it has no hints.
  - **How the site collects them** (`src/features/analytics/acquisition.ts`, captured via
    `src/features/consent/tracking.ts`): on the first page of a browser session it stores `utm_source`, `utm_medium`,
    `utm_campaign` and the click ids above from the landing URL and, only when `document.referrer` is another host,
    the referrer's **origin** (`https://www.google.com`) in `sessionStorage`. First touch wins (an empty record is
    stored too, so a later page never overwrites it); nothing else is stored (other query params are ignored), no
    cookie is set, values are trimmed and cut to the limits above, and blocked storage just means no hints.
  - **Consent** ([../consent.md](../consent.md)): campaign hints (UTM + referrer) need the visitor's **analytics**
    consent and click ids need **marketing** consent (never under Global Privacy Control). Nothing is stored before;
    a category allowed later on the same visit adds the landing page's hints; withdrawing one deletes its hints. The
    checkout sends only what is allowed at that moment (and `ref` only with marketing, `post` only with analytics).
- **`tracking`** (optional; also on `POST /auth/register` and `POST /forms/{id}/submissions`): what the API may use
  for **server-side conversions** (Meta Conversions API, GA4 Measurement Protocol, TikTok Events API; dashboard
  integrations contract → Server-side conversions) — `{ analytics: boolean, marketing: boolean, page_url?,
ga_client_id?, fbp?, fbc?, ttp?, gclid?, fbclid?, ttclid? }`. The site sends it only when the visitor allows at least
  one category, and only the fields that category allows (`ga_client_id` from `_ga` with analytics; the `_fbp`, `_fbc`,
  `_ttp` cookies and click ids with marketing; `page_url` without its query string) —
  `conversionSignal()` in `src/features/consent/tracking.ts`. It never fails a request: the API drops any field not
  in its format, keeps only `page_url`'s scheme, host and path (and sends it only when the host is one of the school's
  own domains), treats `marketing` as false when the browser sends `Sec-GPC: 1` (the proxy forwards the request's
  headers), stores the rest with the order (IP and user agent only with marketing), and sends a paid order's
  `purchase` to Meta/TikTok only with marketing and to GA4 only with analytics. Event ids are shared with the
  browser's events for de-duplication: `purchase_{order id}`, `sign_up_{user id}`, `lead_{submission id}`.
- Fulfilment: courses/bundles enrol the buyer (a subscription course: through its subscription, source
  `membership`, so access follows the subscription); memberships set the plan; **gifts and team seats issue claim links
  instead of enrolling the buyer**; a digital download (`product`) is delivered under Account → Downloads
  (`GET /me/downloads`). Items bought are removed from the cart.
- **Digital downloads** (`target.kind: product`): a published "Digital download" product with its file; anything else
  is `422 target` "This product is not for sale.". Always one copy (`seats` is ignored, no instalments) and never a
  gift (`422 target` "Digital downloads can’t be sent as a gift."). The order item is `kind: "product"`,
  `meta: "Digital download"`, `start_lesson: null`; the confirmation page links to `/account#downloads`.
- Order numbers are per tenant (`AMP-2026-1147`).

## `GET /api/v1/orders/{id}` — signed in, own orders only

`Order` — also the invoice: items, totals, instalments, payment method, gift/seat claim links, billing, `seller`,
and `start_lesson` (first lesson to open when the order unlocked one course). `403` for other learners' orders.

- `status`: `pending` (the bank is still confirming; the site re-reads it every 3 s), `failed` (the payment didn't go
  through: nothing charged, no invoice), `paid`, `refunded`, `partially_refunded` (a disputed payment reads `paid`).
  `paid_at` is null while pending or failed. `refunded` (Money) is what was refunded so far, to the card and any gift
  card. The invoice stamps PAID / PARTIALLY REFUNDED / REFUNDED / FAILED / PENDING and prints "Refunded −£10" after
  the total.
- `seller { name, legal_name, email, address, tax_id }`: the school's name and support address, and from Settings →
  General (business details) its legal name, invoice address (multi-line) and tax ID (VAT / GST number); each of the
  last three is null when not set. `tax_id` is the collecting tax registration's number when it has one.
- `invoice_number`: `"INV-0001"` (the school's prefix + a gap-free sequence), assigned when the payment is captured;
  `null` until then. The invoice shows it with the order number.
- `credit_notes[{ number, amount, created_at }]`: one per refund, oldest first — `"CN-0001"` (the school's credit note
  prefix + its own gap-free sequence), `amount` (Money) refunded by it. The invoice lists each under the refund line
  ("Credit note CN-0001 −£10"); the refund email carries the same number.
- Tax: `tax`, `tax_label`, `tax_details { inclusive, rate, reverse_charge, note }` as charged (see Tax above);
  `items[].tax` (Money) is each line's share (the invoice adds a Tax column when any line has tax).
- `items[].ref_id`: the line's item id (course, bundle, product, membership plan or live session; null on a line without
  one). The success page's browser `purchase` event uses it as the item id, as the server-side conversion does, so both
  copies of the de-duplicated event name the same products.
- `items[].live_session_id`: on a `live` line (a live class ticket), the session it seats (a series ticket: the session
  it was bought from); null on every other line. The success page's "Go to your live class" opens `/live/{id}`.
- `billing { name, email, country, region, tax_id }`: `region` is the state/province code, `tax_id` the buyer's VAT
  number as sent (both null when none).

## Post-purchase offers — `/api/v1/orders/{id}/offer` (signed in, own orders only)

The thank-you page's one-click offer, open for **30 minutes after the payment** of a checkout that kept the card for it
(`post_purchase`): first the **upsell** (the bought product's own upsell, else the first live upsell offer), then — only
after "No thanks" — the **downsell**. The item is never one the learner owns or just bought.

`GET /api/v1/orders/{id}/offer` → `{ data: PostPurchaseOffer | null }` (`403` / `404` as `GET /orders/{id}`; each read
records a view):

```jsonc
{
  "key": "ofr_…" | "product:prd_…",       // send it back with the decision
  "kind": "upsell" | "downsell",
  "headline": "Add Launch Lab for 20% off", "body": "…",   // '' = the site's default wording
  "item": { "kind": "course" | "bundle" | "product", "title": "…", "slug": "…", "cover": {…}, "description": "…" },
  "price": { "amount": 11920 }, "compare_at": { "amount": 14900 } | null,
  "tax": { "amount": 0 }, "tax_label": "VAT (20%)" | null, // the checkout's billing address
  "total": { "amount": 11920 },             // what one click charges: price + added tax
  "card": { "brand": "Visa", "last4": "4242" },            // the checkout's card (nulls when unknown)
  "expires_at": "2026-10-27T12:30:00Z",    // paid_at + 30 minutes
  "payment": { … }                         // as Quote.payment: how to run 3-D Secure for the one-click charge
}
```

`POST /api/v1/orders/{id}/offer` `{ key (≤ 64), accept: boolean }` (throttled 10/min):

- `accept: false` → `200 { data: PostPurchaseOffer | null }`: the downsell after a declined upsell, else `null` (the
  flow ends and the saved card reference is dropped).
- `accept: true` → `201 { data: Order + next_action }`: a new order (source "Post-purchase upsell" / "… downsell",
  taxed for the checkout's address) charged on-session to the saved card (the learner asked for it, so it is a
  customer-initiated payment and the bank may ask for 3-D Secure). `next_action: null` = paid (enrolled /
  delivered). `next_action: { client_secret }` = the bank wants 3-D Secure: the order is `pending`; the site runs
  `stripe.handleNextAction` (on the school's connected account, `Quote.payment`) and reads `GET /orders/{new id}` until
  it is paid. Accepting ends the flow.
- `409` "This offer is no longer available." — the key isn't the current offer (window closed, already decided, the
  item became owned or unsellable, the offer was turned off or ended).
- `422 payment_token` with the processor's message ("Your card was declined.": the order is failed, nothing taken, the
  offer stays open — the learner may try again or decline) · `422 payment_method` when the school can't charge
  (checkout's messages).

The site (order confirmation of a paid order, not gifts or team seats) shows the offer card — item, headline/body,
price (struck `compare_at`), tax, total, "One click charges your Visa ending in 4242", a countdown to `expires_at`,
**Add to my order — {total}** and **No thanks** — and announces each step in a live region; a downsell takes focus
when it replaces the upsell. Mock: the card reference is `saved_<checkout token>`, so paying with `tok_threeDSecure`
makes the one-click charge ask for 3-D Secure too (completed on the next order read), and a reference starting
`saved_declined` is refused.

## Order history — `/account/orders` (signed in, own orders only)

| Endpoint                                    | Result                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me/orders?page=&per_page=`     | paginated `OrderSummary[]`, newest first (`per_page` 1–50, default 20; `422` otherwise): `{ id, number, created_at, status, title (first item), item_count, total, refunded, has_invoice }`. `has_invoice`: the payment was captured                                                                           |
| `GET /api/v1/me/orders/{id}`                | `Order` (as `GET /orders/{id}`); `404` for anyone else's order                                                                                                                                                                                                                                                 |
| `POST /api/v1/me/orders/{id}/invoice/email` | `202 { sent: true, email }`: a copy of the invoice ("Your invoice for order #…", with any refund and a link to `/orders/{id}/invoice`) to the learner's **own account address**, whatever the school's receipt setting; `409` without an invoice (pending or failed); `404`; 3 requests per 10 minutes (`429`) |

The page lists each order (title "and N more items", number, date, total, refund, status) with links to its receipt
(`/orders/{id}`) and, once paid, its invoice (`/orders/{id}/invoice`), ten per page. The invoice's "Print or save as
PDF" uses the browser's print dialog; "Email me a copy" calls the endpoint above.

Gift cards: `gift_card { code (masked), amount, refunded } | null` (what the gift card paid of `total`, and what
refunds returned to it; set when the order is booked, so a pending order shows it too) and `paid_by_card` (`total`
less the gift card's part). `payment_method` is `"Gift card"` when the gift card paid everything; a split payment
keeps the card's detail. `total` and `due_today` stay gross. The site shows "Gift card (GIFT-••••-CD34) −£20" after
the total, then "Paid by card" (or "Paid with gift card").

## Gift and team-seat links — `POST /api/v1/me/claims` (signed in)

`{ token }` → `{ claimed: true, course_slug }`; `422 token` "This link is not valid." / "This link has already been
used.". The links are `https://<school>/claim?token=…` (`gift.claim_url`, `seats.claim_urls[]`). The site's `/claim`
page is private (guests sign in first and come back) and claims on a button press, never on page load.

## Links the API sends (all served by the site)

| Link                                                              | Page                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/orders/{id}` (receipt e-mail)                                   | order status, items, invoice and claim links                                       |
| `/checkout?course={slug}` (failed pay)                            | checkout; the old `/checkout/{slug}` form redirects there                          |
| `/bundles/{slug}`                                                 | redirect to `/checkout?bundle={slug}`                                              |
| `/products/{slug}`                                                | the product's sales page (below) → `/checkout?product=` or `?bundle=`              |
| `/account/bookings/{id}` (booking e-mails, the invite's LOCATION) | the session page: time, join, calendar, reschedule, cancel (account.md → Bookings) |
| `/products/{slug}` ("Choose a time" e-mail)                       | a service's sales page: pick a time (sessions left are used first)                 |
| `/account/billing` (dunning, plans)                               | card, membership and the billing portal                                            |
| `/claim?token=` (gifts, seats)                                    | redeem (above)                                                                     |
| `/partners` (partner invite)                                      | program terms and application (below)                                              |

## Product sales page — `GET /api/v1/products/{slug}` (public)

The dashboard's product sales link. `ProductPage { slug, kind: 'download' | 'bundle' | 'service', title, description,
thumbnail_url | null (the dashboard-uploaded thumbnail, absolute, with `?v={unix seconds}`; also the og:image and the checkout/order line
`cover.url`), price, compare_at_price | null, file { name, size_mb } | null, delivery { link_expiry_days, download_limit } | null,
courses [{ slug, title }], service | null }`. Only what the storefront can sell: a published digital download with its
file, a published bundle with published courses, or a published service with at least one active host (`service`
below); drafts, physical products, hostless services and unfinished products are `404`. The
page is server-rendered and cached under `t:<slug>:product:<product-slug>` (Laravel sends it, with `catalog`, on every
product change). Buy → `/checkout?product={slug}` (downloads) or `/checkout?bundle={slug}` (bundles).
`description` is the school's Markdown (the dashboard’s rich text editor, STANDARD features — `##`/`###` headings, `>` quotes,
lists, links, bold/italic; ≤ 6,000 characters; older values are plain text): the sales page renders it (`lib/markdown.tsx`,
newlines kept, no images, its top heading an h2 under the product's h1); the meta description, JSON-LD, the catalog's bundle card
(`bundles[].description`) and the checkout's `order_bump.description` show it as plain text (`markdownToPlain`).

## Service products — 1:1 bookings

A product of kind `service` sells sessions with the school's hosts (`ProductPage.service`, types in
`src/features/bookings/types.ts`). All times on the wire are UTC (`2026-11-02T14:00:00Z`); the site shows them in the
learner's zone.

`service { session_minutes, sessions, location_type, intake_questions [{ key, label, type: 'text'|'textarea', required }],
cancel_notice_hours }` — `sessions` is the package size (one purchase = that many session credits: "Package of 5
sessions"); `location_type` is `video` (the built-in room) | `zoom` | `meet` | `teams` | `phone` | `in_person`;
`file`, `delivery` are null and `courses` is `[]`. The price is the product's (for the whole package).

### `GET /api/v1/products/{slug}/availability?from=&days=&timezone=` (public)

`Cache-Control: no-store` (never cached — the site reads it in the browser on every visit and after a refused booking),
throttled 30/min. `timezone` is the learner's IANA zone (`422 timezone` "Choose a valid time zone."), `from` a
`YYYY-MM-DD` in that zone (default today), `days` 1–31 (default 14; the site asks for 14). The window is
[`from` 00:00, + `days`) in `timezone`. `404` when the product isn't a sellable service.

→ `Availability { timezone, slot_minutes, days: [{ date: 'YYYY-MM-DD', slots: [{ starts_at, ends_at }] }] }` — only
days with slots, grouped by the learner's local date, sorted. The algorithm (the same in Laravel and Go): step =
min(`session_minutes`, 30); per active host of the product, its weekly hours (or the date's override) in the host's
zone converted to UTC per date (DST-correct: a host's 09:00 New York Sunday is 13:00 London on 2026-10-25 and 14:00 on
2026-11-01), from now + the host's minimum notice to now + min(host `max_days_ahead`, product `booking_window_days`)
days, minus time off, minus active bookings (confirmed, no-show, unexpired holds) with the host's buffers, minus
calendar busy blocks, within the daily cap; the union over hosts, deduped by start. Hosts' calendars are read in fixed
28-day blocks cached a few minutes (so the request's window and zone never trigger extra reads), and a calendar that
can't be read counts as busy for that block (no open times rather than double bookings).

The site's picker: a time-zone select (detected with `Intl`, changeable — a change refetches), the days with open
times two weeks at a time (Earlier / Later dates) and the chosen day's starts as buttons, formatted in the chosen zone.

### `POST /api/v1/products/{slug}/bookings` (signed in; throttled 10/min)

`{ starts_at, timezone, answers?: { [question key]: string }, phone? }` (question keys are `[a-z0-9_]`, so they cross
the snake/camel conversion unchanged). Validation (`422`): `starts_at` a date; `timezone` "Choose a valid time zone.";
each required question `answers.{key}` "Answer “{label}”." (answers ≤ 2000 chars); `phone` "Add the phone number we
should call." when `location_type` is `phone` (≤ 40 chars).

- Sessions left on an active package of this product → one is used and the time is confirmed:
  `201 { data: { booking: LearnerBooking, next: 'confirmed' } }` (the site opens `/account/bookings/{id}`).
- A free product → confirmed (no package); one upcoming free session per product (`422 starts_at` "You already have
  an upcoming session booked.").
- Otherwise the time is **held for 15 minutes** (replacing the learner's other holds of this product):
  `201 { data: { booking (status held, hold_expires_at), next: 'checkout', checkout_url_path: '/checkout?product={slug}' } }`.
  Holds are capped: at most 3 active holds per learner across services, and 5 holds started from one IP address per 15
  minutes → `422 starts_at` "You have too many times on hold. Finish a checkout or let a hold lapse first." A hold is
  never written to the host's calendar.
- The one-free-session rule and the hold cap are checked under the learner's lock inside the reservation, so parallel
  requests can't get round them.
- Taken meanwhile (another learner's hold or booking, or off the grid): `409 { message: "That time was just taken.
Pick another time.", code: 'conflict' }` — the site shows the message, clears the time and reloads the open times.
- `401` for guests: the site sends them to `/sign-in?next=/products/{slug}?slot={starts_at}&tz={zone}` and comes back
  with that time selected (intake answers are typed again).

### Checkout of a service (`target: { kind: 'product', product_slug }`)

The `?product=` checkout sells a published service like a download (one line of kind `product`, meta "1:1 session ·
60 min" / "Package of 5 sessions · 45 min each"; no gift — `422 target` "Sessions can’t be sent as a gift."; no team
seats). The checkout page shows the learner's hold ("Slot held for 15 min", with a countdown from `hold_expires_at`,
read from `GET /me/bookings`); once it lapses it says so and links back to the sales page. Paying fulfils (idempotent
per order): a package of `sessions` credits, then the learner's latest held (or just-lapsed) time of that product from
the last 24 h is re-reserved and confirmed with one credit — a hold still live keeps its host and only needs the time
free of other sessions; a lapsed one goes through every schedule rule again (working hours, notice, buffers, time off,
daily cap, calendar); a hold the learner (or the school) cancelled is never re-booked. If the time can't be booked the
booking expires, the credit stays and the learner gets the "Choose a time" e-mail. The site then opens `/checkout/success/{order}?booking=slot` (or
`?booking=package` without a held time), whose button goes to **Your bookings** (`/account/bookings`). A full refund
cancels the package's upcoming sessions.

## Partner program (public)

- `GET /api/v1/affiliates/program` → `PartnerProgram { school, rate, commission_type: percent | fixed,
fixed_amount: Money | null, tiers[{ name, rate, rule }] | null, cookie_days, recurring, recurring_months,
refund_hold_days, min_payout, assets[{ id, name, meta, url }] }`. A `fixed` program pays `fixed_amount` per sale
  (`rate` 0, `tiers` null). `cookie_days` 0 = clicks never expire. With `recurring`, renewals earn for
  `recurring_months` from the first sale (0 = for as long as the subscription lasts); `/partners` shows "for 12
  months" / "for as long as they stay subscribed". `assets` are the marketing files the school hosts for
  partners (only those with a file); `/partners` lists them as download links.
- `GET /api/v1/affiliates/assets/{id}` → `302` to a short-lived signed file URL (counts a download in the dashboard);
  `404` unknown, `409 { reason: file_unavailable }` when the file was removed. Public, throttled 60/min. The site only
  links to it (the `url` above).
- `POST /api/v1/affiliates/applications` `{ name, email, pitch? }` → `201 { status: pending | active, link }` (`link`
  = `/?ref=<slug>` when the program auto-approves); `422 email` "You’ve already applied with this email.". Throttled
  5 per 10 minutes.
- `POST /api/v1/affiliates/{slug}/clicks` → `201 { click_id, cookie_days, attribution: first_click | last_click }`
  (the click is recorded, nothing about the visitor); `404` for an unknown or inactive partner. The site keeps the
  click only after this answer (src/features/analytics/referral.ts).
