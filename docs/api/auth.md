# Auth — Laravel Sanctum SPA

All calls come from the browser through the tenant host (same origin), so cookies are first-party.

1. `GET /sanctum/csrf-cookie` → `204`, sets `XSRF-TOKEN` (readable by JS).
2. Mutations send `X-XSRF-TOKEN: <decoded cookie>`; missing/mismatched → `419`.
3. The session cookie is `httpOnly; SameSite=Lax; Secure; Path=/`, **no `Domain`** (bound to the tenant host).
   Sessions are tenant-scoped: a session from tenant A is unauthenticated on tenant B.

| Endpoint                                            | Body                                                 | Result                                                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/me`                                    | —                                                    | `200 User` or `401` for guests                                                                                                                                        |
| `POST /api/v1/auth/login`                           | `{ email, password, remember }`                      | `200 User` + session cookie; `422` on bad credentials; `429` after 5 a minute per email + IP or 20 failures in 15 minutes per account (any IP, app sign-ins included) |
| `POST /api/v1/auth/register`                        | `{ name, email, password (≥ 8), group?, tracking? }` | `201 User` + session; `422` (email taken, `group` full or unknown, …)                                                                                                 |
| `POST /api/v1/auth/logout`                          | —                                                    | `204`, session destroyed; a SAML session: `200 { redirect_url }` (single logout, below)                                                                               |
| `POST /api/v1/auth/forgot-password`                 | `{ email }`                                          | always `200` — never reveal whether an account exists                                                                                                                 |
| `POST /api/v1/auth/reset-password`                  | `{ email, token, password, password_confirmation }`  | `{ reset: true }`; `422 token` "This password reset link is invalid or has expired."                                                                                  |
| `POST /api/v1/auth/email/verify`                    | `{ token }`                                          | `{ verified: true }`; `410 invalid_token` "This confirmation link is invalid or has expired."; a pending new email becomes the email (`409` when taken)               |
| `POST /api/v1/auth/email/verification-notification` | — (learner)                                          | `{ sent }` (`false` when already confirmed and no new email is pending); to the pending address when there is one; throttled                                          |
| `GET /api/v1/auth/oauth/{provider}/redirect?next=`  | —                                                    | `302` to the provider; callback lands on `next` (same-origin path only)                                                                                               |
| `GET /api/v1/auth/saml/login?next=`                 | —                                                    | `302` to the school's IdP (SAML SSO); `404` unless SAML is on                                                                                                         |

`User` includes header counters (`cart_count`, `wishlist_count`, `unread_notifications`), `streak_days` (0 when the
plan lacks streaks) and `membership_plan_id` (the live membership: Active, Trialing or Past due; else null). Laravel
also returns the profile's display fields (additive): `avatar_url` (null until avatars exist), `initials`, `color`,
`bio`, `timezone`, `website` — the same values as `GET /me/profile`.

**Guest cart merge:** guests get a cart keyed by an httpOnly `cart_token` cookie. On login/register the guest cart
merges into the account cart (skipping owned courses) and the cookie is cleared.

The site redirects guests away from private pages in its proxy (optimistic, based on the session cookie's presence);
**the API is the real gate** — every `/me/*` endpoint must return `401` without a valid session.

## Social sign-in and SSO

- One button per `site.oauth_providers[]` entry ("Continue with Google"), a full-page link to
  `/api/v1/auth/oauth/{provider}/redirect?next=<path>`. Failures come back as
  `/sign-in?error=oauth&reason=<reason>&next=…` with `reason` one of `not_configured`, `denied`, `expired`,
  `email_unverified`, `exchange_failed`, `signup_closed`, `signup_failed`, `suspended`, `not_a_learner` — each has its
  own message (`auth.oauthReasons.*`); anything else reads as the generic message.
- "Sign in with your organization (SSO)" when the school has SAML on (`site.sso_enabled`, see tenant.md) → a link to
  `/api/v1/auth/saml/login?next=<path>`, a full-page navigation (it sets the `coursiva_saml_flow` cookie that ties the
  IdP's answer to this browser). The ACS redirects failures to `/sign-in?sso_error=<reason>` (`invalid`,
  `expired`, `replayed`, `unsolicited`, `suspended`, `no_email`, `quota`, `idp_unreachable`, `idp_metadata`); the site
  shows a specific message for the learner-actionable ones and a generic one otherwise.
- **Single logout.** Sign-out always ends the school session. When the session came from SAML and the school's IdP
  has a single logout endpoint, `POST /auth/logout` answers `200 { "data": { "redirect_url": "https://idp…" } }`
  instead of `204`: the site sends the browser there with a full-page navigation (`signOutRedirect`, absolute
  http(s) URLs only), the IdP signs the learner out and comes back through `GET /api/v1/auth/saml/slo`, which lands on
  `/sign-in` — or on `/sign-in?sso_error=logout_incomplete` when the IdP's answer was refused (signed out of the
  school, the IdP session may live on; its own message). Otherwise (`204`) the site goes to `/sign-in` as before.
  The IdP can also start the logout: it redirects the browser to `/api/v1/auth/saml/slo`, which ends the session and
  sends the browser back to the IdP; the site sees the learner signed out on its next request.
- The mock signs in the first learner; `?mock_reason=` / `?mock_error=` simulate failures. A mock SAML session's
  logout answers `200 { redirect_url }` pointing at the mock's own `/api/v1/auth/saml/slo` (standing in for the IdP),
  which redirects to `/sign-in` (`?mock_error=` simulates a refusal).

## Pages the e-mails link to

- `/reset-password?token&email` → `POST /auth/reset-password`; `&invited=1` (an invited learner) reads "Set your
  password". The mock accepts the token `reset-valid`.
- `/verify-email?token` → `POST /auth/email/verify` once on load; without a token (or after a failed one) a signed-in
  learner can ask for a new link. A dead link (unknown, used or expired) is `410` with `code: invalid_token` — never
  `419`, which the client reads as an expired CSRF token — and shows "This confirmation link has expired" with the
  resend button (or "Sign in to get a new link"). The mock accepts `verify-valid`.
- `/join/{token}` → the sign-up form, sending the token as `group` to `/auth/register` (the account takes a seat in the
  group). The token is the group's random 32-character invite secret (the dashboard can rotate it); a group's slug, an
  old token or a full group answer `422` on `group` ("This invite link is full or no longer valid. Ask your manager for
  a seat.").
