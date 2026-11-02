/** Social (OAuth) and SAML sign-in failures, as the API redirects back to `/sign-in` (pure, unit-tested). */

/** `?error=oauth&reason=…` from Laravel's social sign-in (docs/social-sign-in.md). */
export const OAUTH_REASONS = [
  'not_configured',
  'denied',
  'expired',
  'email_unverified',
  'exchange_failed',
  'signup_closed',
  'signup_failed',
  'suspended',
  'not_a_learner',
] as const;
/**
 * `?sso_error=…` from the SAML ACS, and `logout_incomplete` from single logout (the IdP's LogoutResponse was refused:
 * signed out of the school, the IdP session may live on) (docs/sso.md); anything else reads as the generic message.
 */
export const SSO_ERRORS = ['expired', 'replayed', 'suspended', 'no_email', 'quota', 'idp_unreachable', 'logout_incomplete'] as const;

export const PROVIDER_NAMES: Record<string, string> = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple', linkedin: 'LinkedIn' };

/** The message for a failed social or SSO round-trip, from the query string the API redirected back with. */
export function authFailure(params: URLSearchParams): { kind: 'oauth'; reason: string | null } | { kind: 'sso'; reason: string } | null {
  const sso = params.get('sso_error');
  if (sso) return { kind: 'sso', reason: sso };
  if (params.get('error') === 'oauth') return { kind: 'oauth', reason: params.get('reason') };
  return null;
}
