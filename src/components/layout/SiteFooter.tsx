import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { SiteLink } from '@/features/pages/components/SiteLink';
import type { Site, SocialNetwork } from '@/features/tenant/types';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { CookieSettingsButton } from '@/components/site/CookieSettingsButton';
import { BrandMark } from './BrandMark';
import styles from './SiteFooter.module.css';

/** Line icons per network (24×24 stroke paths), the same set the site builder's canvas draws. */
const SOCIAL_ICON: Record<SocialNetwork, string> = {
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01',
  facebook: 'M15 3h-2a4 4 0 0 0-4 4v3H7v4h2v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h2z',
  youtube:
    'M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8zM10 15V9l5 3z',
  linkedin: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  x: 'M4 4l16 16M20 4L4 20',
  tiktok: 'M16 3a5 5 0 0 0 5 5v4a9 9 0 0 1-5-1.6V16a6 6 0 1 1-6-6v4a2 2 0 1 0 2 2V3z',
  threads:
    'M16.5 11.5c-.4-3-2.5-4.5-5-4.5-3 0-5 2.5-5 5.5s2 5.5 5.5 5.5c3 0 5.5-2 5.5-5 0-2-1.5-3-3.5-3-2.5 0-4 1.2-4 3 0 1.5 1.2 2.5 2.8 2.5 2.2 0 3.7-1.8 3.7-4',
  pinterest:
    'M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.3-5.4s-.3-.7-.3-1.6c0-1.5.9-2.6 2-2.6.9 0 1.4.7 1.4 1.5 0 .9-.6 2.3-.9 3.6-.3 1.1.5 2 1.6 2 1.9 0 3.4-2 3.4-5 0-2.6-1.9-4.4-4.5-4.4-3.1 0-4.9 2.3-4.9 4.7 0 .9.4 1.9.8 2.5',
  spotify: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM7 9.5c3.5-1 7-.7 10 1M7.5 12.8c2.8-.8 5.6-.5 8 .8M8 16c2.2-.6 4.3-.4 6 .6',
  website: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
};

/** The school's footer (site builder → Footer): tagline, link columns, social profiles, legal links, credit. */
export function SiteFooter({ site }: { site: Site }) {
  const t = useTranslations('footer');
  const tc = useTranslations('common');
  const f = site.navigation.footer;
  const name = site.navigation.header.logoText;
  const social = f.showSocial ? site.social : [];

  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.grid}`} style={{ '--cols': Math.max(1, f.columns.length) } as CSSProperties}>
        <div className={styles.about}>
          <div className={styles.brand}>
            <BrandMark site={{ name, logoUrl: site.logoUrl }} size={26} />
            <span>{name}</span>
          </div>
          {f.tagline !== '' && <p>{f.tagline}</p>}
          {social.length > 0 && (
            <ul className={styles.social}>
              {social.map((s, i) => (
                <li key={`${i}-${s.url}`}>
                  <a
                    href={s.url}
                    rel="noopener noreferrer me"
                    target="_blank"
                    aria-label={t('social', { name: site.name, network: t(`networks.${s.network}`) })}
                  >
                    <svg
                      width={16}
                      height={16}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d={SOCIAL_ICON[s.network]} />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {f.columns.map((col, i) => (
          <nav key={`${i}-${col.title}`} aria-label={col.title}>
            <h2 className={styles.colTitle}>{col.title}</h2>
            <ul className={styles.links}>
              {col.links.map((l, j) => (
                <li key={`${j}-${l.href}`}>
                  <SiteLink href={l.href}>{l.label}</SiteLink>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className={`container ${styles.bottomWrap}`}>
        <div className={styles.bottom}>
          <span className={styles.copy}>
            {f.copyright !== '' ? f.copyright : t('copyright', { year: new Date().getFullYear(), name: site.legalName })}
          </span>
          {/* Cookie settings are always reachable (docs/consent.md), whatever the footer shows. */}
          <div className={styles.legal}>
            {f.showLegal && (
              <>
                <Link href={routes.privacy}>{t('privacy')}</Link>
                <span className={styles.dot} aria-hidden="true">
                  ·
                </span>
                <Link href={routes.terms}>{t('terms')}</Link>
                <span className={styles.dot} aria-hidden="true">
                  ·
                </span>
              </>
            )}
            <CookieSettingsButton className={styles.cookieSettings} />
            {f.showPowered && (
              <>
                <span className={styles.dot} aria-hidden="true">
                  ·
                </span>
                <span className={styles.powered}>{tc('poweredBy')}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
