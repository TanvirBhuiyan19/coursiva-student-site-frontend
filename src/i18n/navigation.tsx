'use client';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, use, type ComponentProps, type ReactNode } from 'react';
import { stripPrefix, withPrefix } from './locales';

/**
 * Locale-aware navigation. App code builds locale-less paths with `routes.*`; these helpers add the current locale's
 * URL prefix (`/es`) so links stay in the visitor's language. For the default locale the prefix is empty and they
 * behave exactly like next/link / next/navigation.
 *
 * Switching language must be a full page load (`window.location.assign`) so cached client data is refetched in the
 * new language.
 */
const PrefixContext = createContext('');

export function LocalePrefixProvider({ prefix, children }: { prefix: string; children: ReactNode }) {
  return <PrefixContext value={prefix}>{children}</PrefixContext>;
}

/** Current locale's URL prefix: `''` (default locale) or `/es`. */
export const useLocalePrefix = () => use(PrefixContext);

/** Drop-in for next/link: `href` is a locale-less app path. */
export function Link({ href, ...rest }: Omit<ComponentProps<typeof NextLink>, 'href'> & { href: string }) {
  return <NextLink href={withPrefix(use(PrefixContext), href)} {...rest} />;
}

/** Pathname without the locale prefix — compare against `routes.*` (active nav items, hidden-on paths). */
export function useAppPathname() {
  return stripPrefix(use(PrefixContext), usePathname());
}

/** next/navigation's router, taking locale-less app paths. */
export function useLocalizedRouter() {
  const router = useRouter();
  const prefix = use(PrefixContext);
  return {
    push: (href: string) => router.push(withPrefix(prefix, href)),
    replace: (href: string) => router.replace(withPrefix(prefix, href)),
    refresh: () => router.refresh(),
    back: () => router.back(),
  };
}

/** Full page navigation to a locale-less app path (used after sign-in/out, when cookies change). */
export function useHardNavigate() {
  const prefix = use(PrefixContext);
  return (href: string) => window.location.assign(withPrefix(prefix, href));
}
