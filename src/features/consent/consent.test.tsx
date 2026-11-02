// @vitest-environment jsdom
// Cookie consent (docs/consent.md): nothing non-essential runs or is stored before the visitor allows its category.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import messages from '../../../messages/en.json';
import { ConsentScripts } from '@/components/site/ConsentScripts';
import { CookieBanner } from '@/components/site/CookieBanner';
import { CookieSettingsButton } from '@/components/site/CookieSettingsButton';
import { partitionHeadCode } from '@/lib/headCode';
import { CONSENT_KEY, effective, granted, parseChoice, resetConsentForTests, saveChoice } from './store';
import { checkoutAttribution, configureConsent, rememberPostRead, resetTrackingForTests } from './tracking';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const ACQ = 'coursiva:acquisition';
const requested: string[] = [];
const fetchMock = vi.fn((input: string | URL) => {
  requested.push(input.toString());
  // The partner click answers its id (POST /affiliates/{slug}/clicks → 201); everything else is a 204.
  if (input.toString().includes('/affiliates/'))
    return Promise.resolve(Response.json({ data: { click_id: 'afc_1', cookie_days: 30, attribution: 'last_click' } }, { status: 201 }));
  return Promise.resolve(new Response(null, { status: 204 }));
});
const clicksReported = () => requested.filter((url) => url.includes('/affiliates/')).length;

function setGpc(on: boolean) {
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: on, configurable: true });
}

beforeEach(() => {
  resetConsentForTests();
  resetTrackingForTests();
  localStorage.clear();
  sessionStorage.clear();
  document.head.querySelectorAll('[data-coursiva-consent]').forEach((n) => n.remove());
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
  setGpc(false);
  fetchMock.mockClear();
  requested.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/?utm_source=newsletter&gclid=g-123&fbclid=f-9&ref=maya-k');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('consent rules', () => {
  it('opt-in grants nothing until the visitor chooses; opt-out grants until they decline; GPC blocks marketing', () => {
    expect(effective({ required: true, stored: null, gpc: false })).toEqual({ analytics: false, marketing: false });
    expect(effective({ required: false, stored: null, gpc: false })).toEqual({ analytics: true, marketing: true });
    expect(effective({ required: false, stored: null, gpc: true })).toEqual({ analytics: true, marketing: false });
    expect(effective({ required: true, stored: { analytics: true, marketing: true }, gpc: true })).toEqual({
      analytics: true,
      marketing: false,
    });
    expect(effective({ required: false, stored: { analytics: false, marketing: false }, gpc: false })).toEqual({
      analytics: false,
      marketing: false,
    });
  });

  it('reads the first version’s stored values', () => {
    expect(parseChoice('accepted')).toEqual({ analytics: true, marketing: true });
    expect(parseChoice('declined')).toEqual({ analytics: false, marketing: false });
    expect(parseChoice('{"analytics":true}')).toEqual({ analytics: true, marketing: false });
    expect(parseChoice('nonsense')).toBeNull();
    expect(parseChoice(null)).toBeNull();
  });

  it('grants nothing before the site has set the mode', () => {
    expect(granted('analytics')).toBe(false);
    expect(granted('marketing')).toBe(false);
  });
});

describe('attribution waits for consent', () => {
  it('stores no click id, campaign hint or partner link until each category is allowed', async () => {
    configureConsent({ required: true });
    expect(sessionStorage.getItem(ACQ)).toBeNull();
    expect(localStorage.getItem('coursiva:ref')).toBeNull();
    expect(clicksReported()).toBe(0);
    expect(checkoutAttribution()).toEqual({ acquisition: null, ref: null, refClick: null, post: null });

    // Analytics only: the campaign hint, never the click ids or the partner link.
    saveChoice({ analytics: true, marketing: false });
    expect(JSON.parse(sessionStorage.getItem(ACQ) ?? '{}')).toMatchObject({ utmSource: 'newsletter' });
    expect(sessionStorage.getItem(ACQ)).not.toContain('g-123');
    expect(localStorage.getItem('coursiva:ref')).toBeNull();
    expect(checkoutAttribution().acquisition).toEqual({ utmSource: 'newsletter' });

    // Marketing later on the same visit: the landing page's click ids and partner link are added.
    saveChoice({ analytics: true, marketing: true });
    expect(checkoutAttribution()).toMatchObject({ acquisition: { utmSource: 'newsletter', gclid: 'g-123', fbclid: 'f-9' } });
    await vi.waitFor(() => expect(clicksReported()).toBe(1));
    // The partner link is kept once the API has recorded the click.
    await vi.waitFor(() => expect(checkoutAttribution()).toMatchObject({ ref: 'maya-k', refClick: 'afc_1' }));
  });

  it('honours a decline: nothing is stored and nothing is sent', () => {
    configureConsent({ required: true });
    saveChoice({ analytics: false, marketing: false });
    rememberPostRead('a-post');
    expect(sessionStorage.getItem(ACQ)).toBeNull();
    expect(localStorage.getItem('coursiva:ref')).toBeNull();
    expect(localStorage.getItem('coursiva:post')).toBeNull();
    expect(clicksReported()).toBe(0);
    expect(localStorage.getItem(CONSENT_KEY)).toContain('"marketing":false');
    expect(document.documentElement.dataset.cookieConsent).toBe('declined');
  });

  it('withdrawing marketing forgets click ids, the partner link and tracker cookies, and keeps essentials', () => {
    configureConsent({ required: true });
    saveChoice({ analytics: true, marketing: true });
    document.cookie = '_fbp=fb.1.2; path=/';
    document.cookie = '_gcl_au=1.1; path=/';
    document.cookie = 'XSRF-TOKEN=keep; path=/';
    saveChoice({ analytics: true, marketing: false });
    const stored = sessionStorage.getItem(ACQ) ?? '';
    expect(stored).toContain('newsletter');
    expect(stored).not.toContain('g-123');
    expect(localStorage.getItem('coursiva:ref')).toBeNull();
    expect(document.cookie).not.toContain('_fbp');
    expect(document.cookie).not.toContain('_gcl_au');
    expect(document.cookie).toContain('XSRF-TOKEN=keep');
  });

  it('Global Privacy Control keeps marketing off even after Accept', () => {
    setGpc(true);
    configureConsent({ required: true });
    saveChoice({ analytics: true, marketing: true });
    expect(granted('marketing')).toBe(false);
    expect(sessionStorage.getItem(ACQ)).not.toContain('g-123');
    expect(clicksReported()).toBe(0);
  });

  it('with the banner off (opt-out) attribution works until the visitor turns it off', () => {
    configureConsent({ required: false });
    expect(checkoutAttribution().acquisition).toMatchObject({ gclid: 'g-123', utmSource: 'newsletter' });
    saveChoice({ analytics: false, marketing: false });
    expect(sessionStorage.getItem(ACQ)).not.toContain('newsletter');
    expect(checkoutAttribution()).toEqual({ acquisition: null, ref: null, refClick: null, post: null });
  });
});

describe('school head code', () => {
  const code = [
    '<meta name="verify" content="v1">',
    '<link rel="me" href="https://social.example/@school">',
    '<link rel="stylesheet" href="https://fonts.example/a.css">',
    '<style>.x{color:red}</style>',
    '<style>.y{background:url(https://px.example/p.gif)}</style>',
    '<script data-consent="analytics">window.__analytics = (window.__analytics || 0) + 1;</script>',
    '<script>window.__pixel = (window.__pixel || 0) + 1;</script>',
    '<noscript><img src="https://px.example/noscript.gif"></noscript>',
  ].join('\n');

  it('keeps only tags that can’t track on the server; scripts and loading tags wait; noscript is dropped', () => {
    const { passive, gated } = partitionHeadCode(code);
    expect(passive.map((e) => e.tag)).toEqual(['meta', 'link', 'style']);
    expect(gated.map((e) => [e.tag, e.consent])).toEqual([
      ['link', 'marketing'],
      ['style', 'marketing'],
      ['script', 'analytics'],
      ['script', 'marketing'],
    ]);
  });

  it('gates meta http-equiv and styles that can fetch (image-set, @font-face, src:)', () => {
    const { passive, gated } = partitionHeadCode(
      [
        '<meta property="og:site_name" content="School">',
        '<meta http-equiv="refresh" content="0;url=https://phish.example">',
        '<meta name="x" http-equiv="set-cookie" content="a=b">',
        '<meta charset="utf-8">',
        '<style>body{background-image:image-set("https://t.example/p.gif" 1x)}</style>',
        '<style>.a{background:-webkit-image-set("https://t.example/p.gif" 1x)}</style>',
        '<style>@font-face{font-family:x;src:local(x)}</style>',
        '<style>.b{color:blue}</style>',
      ].join('\n'),
    );
    expect(passive.map((e) => e.attrs.property ?? e.content)).toEqual(['og:site_name', '.b{color:blue}']);
    expect(gated).toHaveLength(6);
  });

  it('adds each gated tag only once its category is allowed', () => {
    const { gated } = partitionHeadCode(code);
    wrap(
      <>
        <CookieBanner />
        <ConsentScripts elements={gated} />
      </>,
    );
    act(() => configureConsent({ required: true }));
    expect(document.head.querySelectorAll('[data-coursiva-consent]')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Choose cookies' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Analytics/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save choices' }));
    // jsdom doesn't execute scripts: the real browser run is in e2e/consent.spec.ts.
    return vi.waitFor(() => {
      const added = [...document.head.querySelectorAll('[data-coursiva-consent]')];
      expect(added.map((n) => [n.tagName, n.getAttribute('data-coursiva-consent')])).toEqual([['SCRIPT', 'analytics']]);
      expect(added[0]?.textContent).toContain('__analytics');
      expect(added[0]?.hasAttribute('data-consent')).toBe(false);
      expect(screen.queryByRole('region', { name: 'Cookie notice' })).not.toBeInTheDocument();
    });
  });
});

describe('cookie banner', () => {
  it('asks first when the school’s banner is on, and stays closed once decided', () => {
    wrap(<CookieBanner />);
    act(() => configureConsent({ required: true }));
    const banner = screen.getByRole('region', { name: 'Cookie notice' });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(banner).not.toBeInTheDocument();
    expect(granted('analytics')).toBe(false);
  });

  it('reopens from “Cookie settings” to change the choice later', () => {
    wrap(
      <>
        <CookieBanner />
        <CookieSettingsButton />
      </>,
    );
    act(() => configureConsent({ required: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(granted('marketing')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cookie settings' }));
    expect(screen.getByRole('heading', { name: 'Cookie settings' })).toHaveFocus();
    const marketing = screen.getByRole('checkbox', { name: /Marketing/ });
    expect(marketing).toBeChecked();
    fireEvent.click(marketing);
    fireEvent.click(screen.getByRole('button', { name: 'Save choices' }));
    expect(granted('marketing')).toBe(false);
    expect(granted('analytics')).toBe(true);
  });

  it('shows nothing with the banner off until the visitor opens the settings', () => {
    wrap(
      <>
        <CookieBanner />
        <CookieSettingsButton />
      </>,
    );
    act(() => configureConsent({ required: false }));
    expect(screen.queryByRole('region', { name: 'Cookie notice' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cookie settings' }));
    expect(screen.getByRole('region', { name: 'Cookie notice' })).toBeInTheDocument();
  });

  it('under Global Privacy Control, marketing is off and can’t be switched on', () => {
    setGpc(true);
    wrap(<CookieBanner />);
    act(() => configureConsent({ required: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose cookies' }));
    const marketing = screen.getByRole('checkbox', { name: /Marketing/ });
    expect(marketing).toBeDisabled();
    expect(marketing).not.toBeChecked();
    expect(screen.getByText(/Global Privacy Control/)).toBeInTheDocument();
  });
});
