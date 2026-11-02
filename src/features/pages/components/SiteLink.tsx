import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

/**
 * A link the school set in the site builder, already resolved by the API: a site path (client-side navigation in the
 * visitor's language), an `#anchor` on this page, or an `https://` address (a plain link).
 */
export function SiteLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  if (/^https:\/\//.test(href)) {
    return (
      <a href={href} className={className} rel="noopener">
        {children}
      </a>
    );
  }
  return (
    <a href={href.startsWith('#') ? href : '#'} className={className}>
      {children}
    </a>
  );
}
