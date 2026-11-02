import fs from 'node:fs';
import path from 'node:path';
import { IntlMessageFormat } from 'intl-messageformat';
import { localizePath, prefixFor, splitLocale, stripPrefix, textDirection, withPrefix, type LocaleSettings } from './locales';
import { loadMessages } from './messages';

const multi: LocaleSettings = { defaultLocale: 'en-US', locales: ['en-US', 'es-ES', 'pt-BR', 'pt-PT', 'ar'] };
const single: LocaleSettings = { defaultLocale: 'en-GB', locales: ['en-GB'] };

describe('locale routing', () => {
  it('leaves the default locale unprefixed and uses short prefixes for the rest', () => {
    expect(prefixFor(multi, 'en-US')).toBe('');
    expect(prefixFor(multi, 'es-ES')).toBe('es');
    expect(prefixFor(multi, 'ar')).toBe('ar');
    // Two Portuguese variants: the full tag disambiguates.
    expect(prefixFor(multi, 'pt-BR')).toBe('pt-br');
    expect(prefixFor(multi, 'pt-PT')).toBe('pt-pt');
  });

  it('splits public paths into locale and app path', () => {
    expect(splitLocale(multi, '/es/courses/x')).toEqual({ locale: 'es-ES', prefix: '/es', rest: '/courses/x', defaultPrefixed: false });
    expect(splitLocale(multi, '/es')).toEqual({ locale: 'es-ES', prefix: '/es', rest: '/', defaultPrefixed: false });
    expect(splitLocale(multi, '/pt-br/help')).toMatchObject({ locale: 'pt-BR', rest: '/help' });
    expect(splitLocale(multi, '/courses')).toEqual({ locale: 'en-US', prefix: '', rest: '/courses', defaultPrefixed: false });
    // `/en/…` duplicates the unprefixed URL → the proxy redirects it.
    expect(splitLocale(multi, '/en/courses')).toMatchObject({ locale: 'en-US', rest: '/courses', defaultPrefixed: true });
    // Unknown prefixes are ordinary paths (and 404 as such).
    expect(splitLocale(multi, '/fr/courses')).toMatchObject({ locale: 'en-US', rest: '/fr/courses' });
    // A path that merely starts like a prefix is not one.
    expect(splitLocale(multi, '/espresso')).toMatchObject({ locale: 'en-US', rest: '/espresso' });
    expect(splitLocale(single, '/courses')).toMatchObject({ locale: 'en-GB', rest: '/courses' });
  });

  it('builds localized hrefs without double-prefixing or touching API/external links', () => {
    expect(localizePath(multi, 'es-ES', '/')).toBe('/es');
    expect(localizePath(multi, 'es-ES', '/courses')).toBe('/es/courses');
    expect(localizePath(multi, 'en-US', '/courses')).toBe('/courses');
    expect(withPrefix('/es', '/courses?q=1')).toBe('/es/courses?q=1');
    expect(withPrefix('/es', '/es/courses')).toBe('/es/courses');
    expect(withPrefix('/es', '/api/v1/me/export')).toBe('/api/v1/me/export');
    expect(withPrefix('/es', 'https://example.com')).toBe('https://example.com');
    expect(withPrefix('', '/courses')).toBe('/courses');
    expect(stripPrefix('/es', '/es/learn/a')).toBe('/learn/a');
    expect(stripPrefix('/es', '/es')).toBe('/');
  });

  it('knows right-to-left scripts', () => {
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('he-IL')).toBe('rtl');
    expect(textDirection('fa')).toBe('rtl');
    expect(textDirection('es-ES')).toBe('ltr');
  });
});

describe('message catalogues', () => {
  const dir = path.join(process.cwd(), 'messages');
  const flatten = (o: Record<string, unknown>, pre = ''): [string, string][] =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'string' ? [[`${pre}${k}`, v] as [string, string]] : flatten(v as Record<string, unknown>, `${pre}${k}.`),
    );
  const en = new Map(flatten(JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8')) as Record<string, unknown>));

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    it(`${file}: every message is valid ICU, and only uses keys and placeholders that exist in en.json`, () => {
      const lang = file.replace('.json', '');
      const messages = flatten(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Record<string, unknown>);
      for (const [key, msg] of messages) {
        expect(() => new IntlMessageFormat(msg, lang, undefined, { ignoreTag: false }), `${file} → ${key}`).not.toThrow();
        if (lang === 'en') continue;
        expect(en.has(key), `${file} has a key en.json doesn't: ${key}`).toBe(true);
        const vars = (s: string) => new Set([...s.matchAll(/\{(\w+)/g)].map((m) => m[1]));
        for (const v of vars(msg)) expect(vars(en.get(key)!).has(v), `${file} → ${key} uses {${v}}`).toBe(true);
      }
    });
  }

  it('falls back to English for languages without a catalogue', async () => {
    const es = await loadMessages('es-ES');
    const en2 = await loadMessages('en-US');
    expect(es.common.skipToContent).toBe(en2.common.skipToContent);
  });
});

// Courses made in the dashboard default to `guarantee_days: 0`: no "0-day money-back guarantee" anywhere.
describe('guarantee copy', () => {
  const en = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages/en.json'), 'utf8')) as {
    course: { guarantee: string };
    checkout: { securedBy: string; terms: string };
    cart: { trustGuarantee: string };
    order: { invoiceFoot: string };
  };
  const fmt = (msg: string, values: Record<string, unknown>) =>
    String(new IntlMessageFormat(msg, 'en').format({ terms: (c: unknown) => c, refund: (c: unknown) => c, ...values } as never));

  it('drops the money-back promise when the course has none, and keeps it when it has one', () => {
    expect(fmt(en.course.guarantee, { days: 0 })).toBe('Instant access after purchase');
    expect(fmt(en.course.guarantee, { days: 14 })).toBe('14-day money-back guarantee');
    expect(fmt(en.checkout.securedBy, { days: 0 })).toBe('Secured by Stripe');
    expect(fmt(en.checkout.securedBy, { days: 30 })).toBe('Secured by Stripe · 30-day money-back guarantee');
    expect(fmt(en.checkout.terms, { days: 0 })).not.toContain('0-day');
    expect(fmt(en.checkout.terms, { days: 7 })).toContain('7-day refund policy');
  });

  it('makes no fixed 30-day promise on the cart or invoice', () => {
    expect(en.cart.trustGuarantee).not.toMatch(/\d+-day/);
    expect(en.order.invoiceFoot).not.toMatch(/\d+-day/);
  });
});
