/** The Discord link round trip, as the API redirects back to `next` (pure, unit-tested). Contract: docs/api/account.md */

/** `?discord=error&reason=…`; anything else reads as the generic message. */
export const DISCORD_REASONS = ['not_available', 'denied', 'expired', 'exchange_failed', 'already_linked'] as const;
export type DiscordReason = (typeof DISCORD_REASONS)[number];

export type DiscordReturn = { kind: 'linked' } | { kind: 'error'; reason: DiscordReason | null };

/** The outcome of a link round trip from the query string, or null when the page wasn't reached that way. */
export function discordReturn(params: URLSearchParams): DiscordReturn | null {
  const status = params.get('discord');
  if (status === 'linked') return { kind: 'linked' };
  if (status !== 'error') return null;
  const reason = params.get('reason');
  return { kind: 'error', reason: (DISCORD_REASONS as readonly (string | null)[]).includes(reason) ? (reason as DiscordReason) : null };
}

/** `search` without the round trip's `discord` and `reason` params (other params kept), `''` when nothing is left. */
export function withoutDiscordParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete('discord');
  params.delete('reason');
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** Full-page start of the link flow (302 to Discord); the API sends the learner back to `next`. */
export const discordLinkUrl = (next: string) => `/api/v1/me/discord/link?next=${encodeURIComponent(next)}`;
