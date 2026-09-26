import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Site } from '@/features/tenant/types';
import { routes } from '@/lib/routes';
import { BrandMark } from './BrandMark';
import { HeaderActions } from './HeaderActions';
import { NavLinks, type NavItem } from './NavLinks';
import styles from './SiteHeader.module.css';

/** Tenant chrome. Rendered on the server (static); the learner-specific right-hand side hydrates in HeaderActions. */
export function SiteHeader({ site }: { site: Site }) {
  const t = useTranslations('nav');
  const th = useTranslations('header');
  const items: NavItem[] = [
    { href: routes.home, label: t('home'), exact: true },
    { href: routes.courses, label: t('courses') },
    ...(site.features.membership ? [{ href: routes.membership, label: t('membership') }] : []),
    ...(site.features.community ? [{ href: routes.community, label: t('community') }] : []),
    { href: routes.learning, label: t('learning'), also: ['/learn/', '/certificates'] },
  ];
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href={routes.home} className={styles.brand} aria-label={th('homeLink', { name: site.name })}>
          <BrandMark site={site} size={30} />
          <span className={styles.brandName}>{site.name}</span>
        </Link>
        <NavLinks items={items} label={t('main')} />
        <HeaderActions site={{ name: site.name, logoUrl: site.logoUrl, features: site.features }} navItems={items} />
      </div>
    </header>
  );
}
