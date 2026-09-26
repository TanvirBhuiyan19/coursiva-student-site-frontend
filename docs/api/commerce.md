# Commerce — cart, wishlist, checkout, orders

## Cart (guests and learners)

| Endpoint                           | Result                                                 |
| ---------------------------------- | ------------------------------------------------------ |
| `GET /api/v1/cart`                 | `Cart { items[], subtotal, recommendations[] }`        |
| `POST /api/v1/cart/items`          | `{ course_slug }` → `201 Cart`; `422` if already owned |
| `DELETE /api/v1/cart/items/{slug}` | `Cart`                                                 |

Guests: cart keyed by an httpOnly `cart_token` cookie (set on first add), merged into the account on sign-in.

## Wishlist (learners)

`GET /api/v1/me/wishlist` → `WishlistItem[]` · `PUT /api/v1/me/wishlist/{slug}` → `204` · `DELETE …` → `204`.

## `POST /api/v1/checkout/quote` — public

The **only** place checkout figures are computed. The site calls it on every input change.

```jsonc
// QuoteInput
{
  "target": { "kind": "course", "course_slug": "…" }   // or { "kind": "cart" } · { "kind": "bundle", "bundle_slug": "…" }
                                                        // or { "kind": "membership", "plan_id": "…", "interval": "month" | "year" }
  "plan": "full" | "installments",                      // instalments only for single courses
  "coupon_code": "LAUNCH20" | null,
  "order_bump": false,
  "seats": 1,                                            // team purchase: price × seats, issues claim links
  "country": "United Kingdom"                            // drives VAT
}
```

→ `Quote { lines[], subtotal, discount, coupon { code, valid, message }, order_bump, tax, tax_label, total,
due_today, installments, full_amount, installment_option, bnpl { count, amount }, countries[], proof,
enrolled_count, guarantee_days }`.

Rules in the mock (Laravel owns the real ones): coupon `LAUNCH20` = 20% off; VAT UK 20%, DE 19%; instalments =
3 × ⌈total/3 + 5⌉ in major units; order bump only on course/cart/bundle purchases.

## `POST /api/v1/checkout` — signed in

`CheckoutInput` = `QuoteInput` + `{ name, email, accept_terms: true, payment_method: 'card'|'paypal'|'bnpl'|'wallet',
bnpl_provider, payment_token, gift: { recipient_email, message } | null }` → `201 Order`.

- **Card data never reaches the API or the site.** Production: Stripe Payment Element → `payment_token` is a
  PaymentMethod id; confirm the PaymentIntent server-side (3-D Secure via `next_action` when required).
  PayPal/Klarna/Afterpay are hosted redirects started by the API. The mock accepts Stripe test tokens
  (`tok_visa`; `tok_chargeDeclined` → `422 { errors: { payment_token } }`).
- `422` field errors: `name`, `email`, `accept_terms`, `payment_token`, `gift_recipient_email`, `target`
  ("You already own …").
- Fulfilment: courses/bundles enrol the buyer; memberships set the plan; **gifts and team seats issue claim links
  instead of enrolling the buyer**. Items bought are removed from the cart.
- Order numbers are per tenant (`AMP-2026-1147`).

## `GET /api/v1/orders/{id}` — signed in, own orders only

`Order` — also the invoice: items, totals, instalments, payment method, gift/seat claim links, billing, `seller`,
and `start_lesson` (first lesson to open when the order unlocked one course). `403` for other learners' orders.
