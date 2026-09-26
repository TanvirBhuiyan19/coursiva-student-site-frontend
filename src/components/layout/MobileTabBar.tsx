'use client';
import { Link, useAppPathname } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Icon, type IconName } from '@/components/icons';
import type { Site } from '@/features/tenant/types';
import { routes } from '@/lib/routes';
import styles from './MobileTabBar.module.css';

/** Phone-only bottom tab bar. Hidden on focused flows (player, checkout, auth, course detail has its own buy bar). */
const HIDDEN = ['/learn/', '/checkout', '/sign-in', '/sign-up', '/forgot-password', '/courses/', '/orders/'];

export function MobileTabBar({ features }: { features: Site['features'] }) {
  const t = useTranslations('nav');
  const pathname = useAppPathname();
  if (HIDDEN.some((p) => pathname.startsWith(p))) return null;

  const tabs: { href: string; label: string; icon: IconName; match: string[] }[] = [
    { href: routes.home, label: t('home'), icon: 'home', match: [] },
    { href: routes.courses, label: t('courses'), icon: 'grid', match: ['/courses'] },
    { href: routes.learning, label: t('learningShort'), icon: 'play', match: ['/learning', '/certificates'] },
    ...(features.community ? [{ href: routes.community, label: t('community'), icon: 'users' as const, match: ['/community'] }] : []),
    { href: routes.account, label: t('profile'), icon: 'user', match: ['/account'] },
  ];

  return (
    <>
      <nav className={styles.bar} aria-label={t('main')}>
        {tabs.map((tab) => {
          const on = tab.href === '/' ? pathname === '/' : tab.match.some((m) => pathname.startsWith(m));
          return (
            <Link key={tab.href} href={tab.href} className={styles.tab} aria-current={on ? 'page' : undefined}>
              <Icon name={tab.icon} size={22} strokeWidth={on ? 2.4 : 1.8} />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className={styles.space} aria-hidden="true" />
    </>
  );
}
