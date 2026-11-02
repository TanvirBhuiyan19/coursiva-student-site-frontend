import { DISCORD_REASONS, discordLinkUrl, discordReturn, withoutDiscordParams } from './discord';
import en from '../../../messages/en.json';

describe('Discord link round trip', () => {
  it('reads the outcome the API redirected back with', () => {
    expect(discordReturn(new URLSearchParams('discord=linked'))).toEqual({ kind: 'linked' });
    for (const reason of DISCORD_REASONS)
      expect(discordReturn(new URLSearchParams(`discord=error&reason=${reason}`))).toEqual({ kind: 'error', reason });
    expect(discordReturn(new URLSearchParams('discord=error&reason=something_new'))).toEqual({ kind: 'error', reason: null });
    expect(discordReturn(new URLSearchParams('discord=error'))).toEqual({ kind: 'error', reason: null });
    expect(discordReturn(new URLSearchParams('discord=maybe'))).toBeNull();
    expect(discordReturn(new URLSearchParams('tab=billing'))).toBeNull();
  });
  it('strips only its own params from the URL', () => {
    expect(withoutDiscordParams('?discord=linked')).toBe('');
    expect(withoutDiscordParams('?discord=error&reason=denied')).toBe('');
    expect(withoutDiscordParams('?tab=billing&discord=error&reason=expired')).toBe('?tab=billing');
    expect(withoutDiscordParams('')).toBe('');
  });
  it('starts the link with the page to come back to', () => {
    expect(discordLinkUrl('/account')).toBe('/api/v1/me/discord/link?next=%2Faccount');
    expect(discordLinkUrl('/es/account')).toBe('/api/v1/me/discord/link?next=%2Fes%2Faccount');
  });
  it('has a friendly message for every failure reason', () => {
    for (const reason of [...DISCORD_REASONS, 'generic'] as const) expect(en.account.discord.reasons[reason]).toBeTruthy();
  });
});
