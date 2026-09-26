/**
 * Locale routing rules, shared by the proxy, Server Components and the browser (no server-only imports).
 *
 * URL strategy (the SEO-standard "subdirectory" model):
 *   - the tenant's default locale is unprefixed:      learn.acme.com/courses
 *   - every other locale gets a path prefix:          learn.acme.com/es/courses, learn.acme.com/pt-br/courses
 *   - `/<default-prefix>/…` 308s to the unprefixed URL, so each page has exactly one URL per language.
 * The prefix is the language subtag (`es`), or the full lowercase tag (`pt-br`) when two locales share a language.
 */

export interface LocaleSettings {
  /** BCP 47 tag of the tenant's main language, e.g. `en-US`. Always the first of `locales`. */
  defaultLocale: string;
  /** Every language the tenant publishes, default first. */
  locales: string[];
}

const lang = (locale: string) => locale.split('-')[0]!.toLowerCase();

/** URL prefix for a locale: `''` for the default locale, otherwise `es` / `pt-br`. */
export function prefixFor(s: LocaleSettings, locale: string): string {
  if (locale === s.defaultLocale) return '';
  const sharesLanguage = s.locales.some((l) => l !== locale && lang(l) === lang(locale));
  return sharesLanguage ? locale.toLowerCase() : lang(locale);
}

/**
 * Split a public pathname into its locale and the locale-less rest.
 * `defaultPrefixed` is true for `/<default prefix>/…` URLs, which should redirect to the unprefixed form.
 */
export function splitLocale(
  s: LocaleSettings,
  pathname: string,
): { locale: string; prefix: string; rest: string; defaultPrefixed: boolean } {
  const first = pathname.split('/')[1]?.toLowerCase() ?? '';
  if (first) {
    for (const locale of s.locales) {
      if (locale === s.defaultLocale) {
        if (first === lang(locale) || first === locale.toLowerCase()) {
          return { locale, prefix: '', rest: pathname.slice(first.length + 1) || '/', defaultPrefixed: true };
        }
        continue;
      }
      if (first === prefixFor(s, locale))
        return { locale, prefix: `/${first}`, rest: pathname.slice(first.length + 1) || '/', defaultPrefixed: false };
    }
  }
  return { locale: s.defaultLocale, prefix: '', rest: pathname || '/', defaultPrefixed: false };
}

/** Public URL of a locale-less app path in a given locale: `/courses` → `/es/courses`. */
export function localizePath(s: LocaleSettings, locale: string, path: string): string {
  const prefix = prefixFor(s, locale);
  if (!prefix) return path;
  return path === '/' ? `/${prefix}` : `/${prefix}${path}`;
}

/** Prefix an href with the current locale prefix, unless it's external, an API/asset path or already prefixed. */
export function withPrefix(prefix: string, href: string): string {
  if (!prefix || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return href;
  if (href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`)) return href;
  return href === '/' ? prefix : `${prefix}${href}`;
}

/** Remove the locale prefix from a public pathname (for active-link matching). */
export function stripPrefix(prefix: string, pathname: string): string {
  if (!prefix) return pathname;
  if (pathname === prefix) return '/';
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}

const RTL_LANGUAGES = new Set(['ar', 'arc', 'dv', 'fa', 'ha', 'he', 'khw', 'ks', 'ku', 'ps', 'sd', 'ug', 'ur', 'yi']);

/** Writing direction for `<html dir>`. */
export function textDirection(locale: string): 'ltr' | 'rtl' {
  return RTL_LANGUAGES.has(lang(locale)) ? 'rtl' : 'ltr';
}
