import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Instrument_Sans } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { HideOnPaths } from '@/components/layout/HideOnPaths';
import { MobileTabBar } from '@/components/layout/MobileTabBar';
import { AnnouncementBar } from '@/components/site/AnnouncementBar';
import { CodeFreeReload } from '@/components/site/CodeFreeReload';
import { CookieBanner } from '@/components/site/CookieBanner';
import { PreviewBanner } from '@/components/site/PreviewBanner';
import { SiteLockScreen } from '@/components/site/SiteLockScreen';
import { titleTemplate } from '@/features/seo/normalize';
import { getSeo } from '@/features/seo/server';
import { hasTags } from '@/features/tracking/ids';
import { TrackingTags } from '@/features/tracking/TrackingTags';
import { VerificationMeta } from '@/features/tracking/VerificationMeta';
import { currentScope, getCurrentSite, siteOrigin } from '@/features/tenant/server';
import { prefixFor, textDirection } from '@/i18n/locales';
import { LocalePrefixProvider } from '@/i18n/navigation';
import { partitionHeadCode } from '@/lib/headCode';
import { EMBED_PREFIXES, PREVIEW_PREFIXES } from '@/lib/routes';
import { siteIcons, siteOpenGraph } from '@/lib/seo';
import { brandCss, themeColor } from '@/lib/theme';
import { Providers } from '../../providers';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/ui.css';

const bricolage = Bricolage_Grotesque({
  // latin-ext covers Central/Eastern European and Turkish; unicode-range means English pages don't download it.
  // Scripts the brand fonts lack (Arabic, Cyrillic, CJK…) fall back to the system stack in tokens.css.
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-bricolage',
  display: 'swap',
});
const instrumentSans = Instrument_Sans({
  // latin-ext covers Central/Eastern European and Turkish; unicode-range means English pages don't download it.
  // Scripts the brand fonts lack (Arabic, Cyrillic, CJK…) fall back to the system stack in tokens.css.
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

/** Tenants and their languages are unknown at build time: pages render on first request, then serve from cache (ISR). */
export function generateStaticParams() {
  return [];
}

export async function generateMetadata(): Promise<Metadata> {
  const [site, scope] = await Promise.all([getCurrentSite(), currentScope()]);
  const { locale } = scope;
  // The school's title template (SEO → Title template), e.g. `{page} — {school}`.
  const seo = await getSeo(scope.tenant);
  return {
    metadataBase: new URL(siteOrigin(site)),
    title: { default: site.seo.title, template: titleTemplate(seo.titleTemplate, site.name) },
    description: site.seo.description,
    applicationName: site.name,
    icons: siteIcons(site),
    openGraph: siteOpenGraph(site, locale),
    twitter: { card: 'summary_large_image', ...(site.seo.twitterHandle ? { site: site.seo.twitterHandle } : {}) },
    robots: site.seo.indexable ? { index: true, follow: true, 'max-image-preview': 'large' } : { index: false, follow: false },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const site = await getCurrentSite();
  return { themeColor: themeColor(site.brand), width: 'device-width', initialScale: 1 };
}

/**
 * `code` is the `@code` slot: the school's custom code for this path (`@code/[[...rest]]`). It is decided on the
 * server from the path, so code-free pages (sign-in, checkout, account…) never receive the code at all — not even as
 * the props of a hidden component in the page's payload — while every page stays as cacheable as before.
 */
export default async function TenantRootLayout({ children, code }: { children: ReactNode; code: ReactNode }) {
  const [site, { locale }, t] = await Promise.all([getCurrentSite(), currentScope(), getTranslations('common')]);
  const fonts = `${bricolage.variable} ${instrumentSans.variable}`;
  // A locked site shows its lock screen instead of every page, until this visitor unlocks it (lib/api/personal.ts).
  const locked = site.siteLock.enabled && !site.siteLock.unlocked;
  const { theme } = site;
  // Whether the school has consent-gated code at all (the code itself comes from the `@code` slot).
  const gatedCode = site.headCode ? partitionHeadCode(site.headCode).gated.length > 0 : false;
  const localePrefix = prefixFor(site, locale) ? `/${prefixFor(site, locale)}` : '';
  return (
    <html
      lang={locale}
      dir={textDirection(locale)}
      className={fonts}
      // Site-builder theme tokens → CSS variables (styles/tokens.css, styles/ui.css).
      data-font={theme.font}
      data-radius={theme.radius}
      data-buttons={theme.buttons}
      data-density={theme.density}
    >
      <head>
        {/* Tenant brand tokens, rendered on the server so the first paint is already on-brand. */}
        <style id="brand-tokens" dangerouslySetInnerHTML={{ __html: brandCss(site.brand) }} />
        {/* Site verification (Search Console, Bing, Yandex, Pinterest): no consent needed (features/tracking). */}
        <VerificationMeta tracking={site.tracking} />
      </head>
      {/* Browser extensions (Grammarly, password managers) add attributes to <body> before React
          loads; this ignores those on <body> only — mismatches inside the app still surface. */}
      <body suppressHydrationWarning>
        <NextIntlClientProvider>
          <LocalePrefixProvider prefix={localePrefix}>
            <Providers timeZone={site.timeZone} consentRequired={site.cookieBanner}>
              <a className="skip-link" href="#main">
                {t('skipToContent')}
              </a>
              <PreviewBanner />
              {gatedCode && <CodeFreeReload />}
              {/* The school's custom code (React hoists its <meta> and <link> tags into <head>). */}
              {code}
              {locked ? (
                <SiteLockScreen site={{ name: site.name, logoUrl: site.logoUrl }} password={site.siteLock.password} />
              ) : (
                <>
                  {site.announcement && (
                    <HideOnPaths prefixes={EMBED_PREFIXES}>
                      <AnnouncementBar text={site.announcement.text} />
                    </HideOnPaths>
                  )}
                  {/* The staff preview (/preview/…) has its own top bar: no account UI, no links out of the preview. */}
                  <HideOnPaths prefixes={[...PREVIEW_PREFIXES, ...EMBED_PREFIXES]}>
                    <SiteHeader site={site} />
                  </HideOnPaths>
                  <main id="main" tabIndex={-1}>
                    {children}
                  </main>
                  {/* The course player is a focused, full-height workspace (its sidebar stays fixed), so no footer there. */}
                  <HideOnPaths prefixes={['/learn/', ...PREVIEW_PREFIXES, ...EMBED_PREFIXES]}>
                    <SiteFooter site={site} />
                  </HideOnPaths>
                  <HideOnPaths prefixes={[...PREVIEW_PREFIXES, ...EMBED_PREFIXES]}>
                    <MobileTabBar features={site.features} />
                    {/* Asks first when the school's banner is on; always reachable from "Cookie settings". */}
                    <CookieBanner />
                    {/* Analytics tags and ad pixels, once the visitor allows their category (docs/consent.md). */}
                    {hasTags(site.tracking) && <TrackingTags tracking={site.tracking} />}
                  </HideOnPaths>
                </>
              )}
            </Providers>
          </LocalePrefixProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
