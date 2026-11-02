// @vitest-environment jsdom
// Phase 16t real-stack parity: the school's header and footer as the site builder canvas draws them.
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import type { Site } from '@/features/tenant/types';
import { SiteFooter } from './SiteFooter';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useAppPathname: () => '/',
}));

const site = {
  name: 'Amplify Coaching',
  legalName: 'Amplify Coaching LLC',
  logoUrl: null,
  iconUrl: null,
  social: [
    { network: 'instagram', url: 'https://instagram.com/amplify' },
    { network: 'youtube', url: 'https://youtube.com/@amplify' },
  ],
  navigation: {
    header: { logoText: 'Amplify Coaching', cta: null, sticky: true, showCart: false, showNotifications: false, items: [] },
    footer: { tagline: 'Grow', copyright: '© 2026 Amplify', columns: [], showSocial: true, showLegal: true, showPowered: true },
  },
} as unknown as Site;

describe('site chrome matches the builder canvas', () => {
  it('draws social profiles as icons (like the canvas), not two-letter abbreviations', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SiteFooter site={site} />
      </NextIntlClientProvider>,
    );
    const links = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.includes('instagram') || a.getAttribute('href')?.includes('youtube'));
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.querySelector('svg path')).not.toBeNull();
      expect(a.textContent).toBe('');
    }
  });

  it('hides the header button below desktop width even though it is also a global .btn (canvas: desktop only)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/layout/SiteHeader.module.css'), 'utf8');
    const tablet = css.slice(css.indexOf('@media (max-width: 1023px)'));
    expect(tablet).toMatch(/\.inner \.cta\s*\{\s*display:\s*none;/);
  });
});
