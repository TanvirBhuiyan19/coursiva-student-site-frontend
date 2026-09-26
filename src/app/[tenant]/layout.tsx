import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Instrument_Sans } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { MobileTabBar } from '@/components/layout/MobileTabBar';
import { getCurrentSite, siteOrigin } from '@/features/tenant/server';
import { brandCss, themeColor } from '@/lib/theme';
import { Providers } from '../providers';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/ui.css';

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-bricolage',
  display: 'swap',
});
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

/** Tenants are unknown at build time: every tenant's pages render on first request, then serve from cache (ISR). */
export function generateStaticParams() {
  return [];
}

export async function generateMetadata(): Promise<Metadata> {
  const site = await getCurrentSite();
  return {
    metadataBase: new URL(siteOrigin(site)),
    title: { default: site.seo.title, template: `%s · ${site.name}` },
    description: site.seo.description,
    applicationName: site.name,
    icons: { icon: [{ url: site.logoUrl ?? '/icon.png', type: 'image/png' }], apple: site.logoUrl ?? '/icon.png' },
    openGraph: {
      siteName: site.name,
      type: 'website',
      locale: site.locale.replace('-', '_'),
      ...(site.seo.ogImageUrl ? { images: [{ url: site.seo.ogImageUrl, width: 1200, height: 630 }] } : {}),
    },
    twitter: { card: 'summary_large_image', ...(site.seo.twitterHandle ? { site: site.seo.twitterHandle } : {}) },
    robots: site.seo.indexable ? { index: true, follow: true, 'max-image-preview': 'large' } : { index: false, follow: false },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const site = await getCurrentSite();
  return { themeColor: themeColor(site.brand), width: 'device-width', initialScale: 1 };
}

export default async function TenantRootLayout({ children }: { children: ReactNode }) {
  const site = await getCurrentSite();
  const t = await getTranslations('common');
  const fonts = `${bricolage.variable} ${instrumentSans.variable}`;
  return (
    <html lang={site.locale} className={fonts}>
      <head>
        {/* Tenant brand tokens, rendered on the server so the first paint is already on-brand. */}
        <style id="brand-tokens" dangerouslySetInnerHTML={{ __html: brandCss(site.brand) }} />
      </head>
      <body>
        <NextIntlClientProvider>
          <Providers>
            <a className="skip-link" href="#main">
              {t('skipToContent')}
            </a>
            <SiteHeader site={site} />
            <main id="main" tabIndex={-1}>
              {children}
            </main>
            <SiteFooter site={site} />
            <MobileTabBar features={site.features} />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
