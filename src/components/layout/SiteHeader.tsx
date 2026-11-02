import { useTranslations } from 'next-intl';
import { SiteLink } from '@/features/pages/components/SiteLink';
import { siteAvailable } from '@/features/tenant/normalize';
import type { NavLink, Site } from '@/features/tenant/types';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { BrandMark } from './BrandMark';
import { HeaderActions } from './HeaderActions';
import { NavLinks, type NavItem } from './NavLinks';
import styles from './SiteHeader.module.css';

/** Built-in screens a plan can switch off: a header link to one of them is hidden while the feature is off. */
const GATED: { prefix: string; feature: keyof Site['features'] }[] = [
  { prefix: routes.membership, feature: 'membership' },
  { prefix: routes.community, feature: 'community' },
  { prefix: routes.certificates, feature: 'certificates' },
];

/** The school's header links (site builder → Header), minus screens its plan doesn't include. */
export function headerItems(site: Pick<Site, 'navigation' | 'features' | 'unavailable'>): NavItem[] {
  const under = (href: string, prefix: string) => href === prefix || href.startsWith(`${prefix}/`);
  // Live pages and webinars 404 while live classes are off on the platform: no header link to them either.
  const liveOff = !siteAvailable(site, 'live_classes');
  return site.navigation.header.items
    .filter((l: NavLink) => !GATED.some((g) => !site.features[g.feature] && under(l.href, g.prefix)))
    .filter((l: NavLink) => !(liveOff && (under(l.href, routes.liveSchedule) || under(l.href, '/webinars'))))
    .map((l) => ({
      href: l.href,
      label: l.label,
      exact: l.href === routes.home,
      ...(l.href === routes.learning ? { also: ['/learn/', '/certificates'] } : {}),
    }));
}

/** Tenant chrome. Rendered on the server (static); the learner-specific right-hand side hydrates in HeaderActions. */
export function SiteHeader({ site }: { site: Site }) {
  const t = useTranslations('nav');
  const th = useTranslations('header');
  const h = site.navigation.header;
  const items = headerItems(site);
  return (
    <header className={styles.header} data-sticky={h.sticky}>
      <div className={`container ${styles.inner}`}>
        <Link href={routes.home} className={styles.brand} aria-label={th('homeLink', { name: site.name })}>
          <BrandMark site={{ name: h.logoText, logoUrl: site.logoUrl }} size={30} />
          <span className={styles.brandName}>{h.logoText}</span>
        </Link>
        <NavLinks items={items} label={t('main')} />
        {h.cta && (
          <SiteLink href={h.cta.href} className={`btn btn-primary btn-sm ${styles.cta}`}>
            {h.cta.label}
          </SiteLink>
        )}
        <HeaderActions
          site={{ name: h.logoText, logoUrl: site.logoUrl, features: site.features, unavailable: site.unavailable }}
          navItems={items}
          showCart={h.showCart}
          showNotifications={h.showNotifications}
        />
      </div>
    </header>
  );
}
