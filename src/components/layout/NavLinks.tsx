'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './SiteHeader.module.css';

export interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
  /** Other path prefixes that count as this section (e.g. the player belongs to My learning). */
  also?: string[];
}

export const isActive = (pathname: string, item: NavItem) =>
  item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`) || !!item.also?.some((p) => pathname.startsWith(p));

export function NavLinks({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label={label}>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={isActive(pathname, item) ? 'page' : undefined}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
