// @vitest-environment jsdom
// A page or site payload cached by an older API (before the 16t site builder fields) must render, never 500.
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { normalizeSite } from '../tenant/normalize';
import { Sections } from './components/Sections';
import { normalizePage } from './normalize';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useAppPathname: () => '/',
}));

/** The home page as the API returned it before the common section frame existed (the real stale-cache 500). */
const oldPage = {
  slug: 'home',
  title: 'Home',
  seo: { title: null, description: null },
  sections: [
    {
      id: 's3',
      kind: 'hero',
      eyebrow: 'Now enrolling',
      title: 'Learn with Amplify',
      subtitle: 'Practical courses',
      primaryCta: { label: 'Browse courses', href: '/courses' },
      secondaryCta: null,
      stats: [{ value: '0', label: 'courses' }],
      spotlight: null,
    },
    { id: 's6', kind: 'value_props', items: [{ icon: 'check', title: 'Learn at your pace', body: 'Lifetime access.' }] },
    {
      id: 's7',
      kind: 'testimonials',
      title: 'Students say',
      items: [{ quote: 'Great', author: { name: 'Ada', initials: 'A', avatarUrl: null, color: '#000' } }],
    },
    { kind: 'text' },
    null,
  ],
  updatedAt: '2026-10-03T19:54:53Z',
};

describe('older payloads render safely', () => {
  it('gives every section the frame defaults and the fields added since', () => {
    const page = normalizePage(oldPage);
    expect(page.sections.map((s) => s.id)).toEqual(['s3', 's6', 's7']);
    expect(page.sections[0]).toMatchObject({
      anchor: null,
      style: { bg: 'white', pad: 'm', align: 'left', width: 'contained', divider: false, variant: 'course' },
      visibility: { desktop: true, mobile: true },
      animation: null,
      compact: false,
      side: 'none',
      video: null,
    });
    expect(page.sections[1]).toMatchObject({ title: '', items: [{ glyph: '', title: 'Learn at your pace' }] });
    expect(page.sections[2]).toMatchObject({ items: [{ rating: null, context: '' }] });
    expect(page.seo).toEqual({ title: null, description: null, ogImageUrl: null, noindex: false });
  });

  it('renders the old home page without throwing', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Sections sections={normalizePage(oldPage).sections} title="Home" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Learn with Amplify' })).toBeInTheDocument();
    expect(screen.getByText('Learn at your pace')).toBeInTheDocument();
  });

  it('defaults every site builder field of /site', () => {
    const site = normalizeSite({ slug: 'amplify', name: 'Amplify Coaching', social: null });
    expect(site.siteLock).toEqual({ enabled: false, unlocked: false, password: false });
    expect(site.theme).toEqual({ font: 'bricolage_instrument', radius: 'soft', buttons: 'filled', density: 'comfortable' });
    expect(site.navigation.header).toMatchObject({ logoText: 'Amplify Coaching', cta: null, sticky: true, items: [] });
    expect(site.navigation.footer).toMatchObject({ columns: [], showLegal: true, showPowered: true });
    expect(site).toMatchObject({ announcement: null, faviconUrl: null, headCode: null, cookieBanner: true, pages: [], social: [] });
    expect(site.iconUrl).toBeNull(); // cached before Branding's icon was sent
    expect(site.screens).toEqual({ auth: null, legal: { privacy: null, terms: null, refundPolicy: null } });
  });

  it('keeps a current payload as it is', () => {
    const site = normalizeSite({
      name: 'A',
      iconUrl: 'https://cdn.example.com/a/icon.png',
      theme: { font: 'editorial_serif', radius: 'round', buttons: 'outline', density: 'compact' },
      siteLock: { enabled: true, unlocked: false, password: true },
      navigation: {
        header: {
          logoText: 'A!',
          cta: { label: 'Go', href: '/sign-up' },
          sticky: false,
          showCart: true,
          showNotifications: true,
          items: [{ label: 'FAQ', href: '/#faq' }],
        },
      },
    });
    expect(site.theme.font).toBe('editorial_serif');
    expect(site.iconUrl).toBe('https://cdn.example.com/a/icon.png');
    expect(site.siteLock.enabled).toBe(true);
    expect(site.navigation.header).toEqual({
      logoText: 'A!',
      cta: { label: 'Go', href: '/sign-up' },
      sticky: false,
      showCart: true,
      showNotifications: true,
      items: [{ label: 'FAQ', href: '/#faq' }],
    });
  });
});
