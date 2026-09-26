# Auth — Laravel Sanctum SPA

All calls come from the browser through the tenant host (same origin), so cookies are first-party.

1. `GET /sanctum/csrf-cookie` → `204`, sets `XSRF-TOKEN` (readable by JS).
2. Mutations send `X-XSRF-TOKEN: <decoded cookie>`; missing/mismatched → `419`.
3. The session cookie is `httpOnly; SameSite=Lax; Secure; Path=/`, **no `Domain`** (bound to the tenant host).
   Sessions are tenant-scoped: a session from tenant A is unauthenticated on tenant B.

| Endpoint                                           | Body                              | Result                                                                  |
| -------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/v1/me`                                   | —                                 | `200 User` or `401` for guests                                          |
| `POST /api/v1/auth/login`                          | `{ email, password, remember }`   | `200 User` + session cookie; `422` on bad credentials                   |
| `POST /api/v1/auth/register`                       | `{ name, email, password (≥ 8) }` | `201 User` + session; `422` (email taken, …)                            |
| `POST /api/v1/auth/logout`                         | —                                 | `204`, session destroyed                                                |
| `POST /api/v1/auth/forgot-password`                | `{ email }`                       | always `200` — never reveal whether an account exists                   |
| `GET /api/v1/auth/oauth/{provider}/redirect?next=` | —                                 | `302` to the provider; callback lands on `next` (same-origin path only) |

`User` includes header counters (`cart_count`, `wishlist_count`, `unread_notifications`), `streak_days` (0 when the
plan lacks streaks) and `membership_plan_id`.

**Guest cart merge:** guests get a cart keyed by an httpOnly `cart_token` cookie. On login/register the guest cart
merges into the account cart (skipping owned courses) and the cookie is cleared.

The site redirects guests away from private pages in its proxy (optimistic, based on the session cookie's presence);
**the API is the real gate** — every `/me/*` endpoint must return `401` without a valid session.
