import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Site, SocialNetwork } from '@/features/tenant/types';
import { routes } from '@/lib/routes';
import { BrandMark } from './BrandMark';
import styles from './SiteFooter.module.css';

const SOCIAL_ABBR: Record<SocialNetwork, string> = { linkedin: 'in', instagram: 'ig', youtube: 'yt', x: 'x', facebook: 'fb', tiktok: 'tt' };

export function SiteFooter({ site }: { site: Site }) {
  const t = useTranslations('footer');
  const tn = useTranslations('nav');
  const tc = useTranslations('common');
  const columns = [
    {
      title: t('learn'),
      links: [
        { href: routes.courses, label: t('allCourses') },
        ...(site.features.membership ? [{ href: routes.membership, label: tn('membership') }] : []),
        { href: routes.learning, label: tn('learning') },
        ...(site.features.certificates ? [{ href: routes.certificates, label: t('certificates') }] : []),
      ],
    },
    ...(site.features.community
      ? [
          {
            title: t('community'),
            links: [
              { href: routes.community, label: t('spaces') },
              { href: `${routes.community}?space=sp_wins`, label: t('wins') },
              { href: `${routes.community}?space=sp_q`, label: t('questions') },
            ],
          },
        ]
      : []),
    {
      title: t('support'),
      links: [
        { href: routes.help, label: t('help') },
        { href: routes.contact, label: t('contact') },
        { href: routes.refund, label: t('refund') },
      ],
    },
  ];

  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.grid}`} data-cols={columns.length}>
        <div className={styles.about}>
          <div className={styles.brand}>
            <BrandMark site={site} size={26} />
            <span>{site.name}</span>
          </div>
          <p>{site.tagline}</p>
          {site.social.length > 0 && (
            <ul className={styles.social}>
              {site.social.map((s) => (
                <li key={s.network}>
                  <a
                    href={s.url}
                    rel="noopener noreferrer me"
                    target="_blank"
                    aria-label={t('social', { name: site.name, network: t(`networks.${s.network}`) })}
                  >
                    <span aria-hidden="true">{SOCIAL_ABBR[s.network]}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className={styles.colTitle}>{col.title}</h2>
            <ul className={styles.links}>
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className={`container ${styles.bottomWrap}`}>
        <div className={styles.bottom}>
          <span className={styles.copy}>{t('copyright', { year: new Date().getFullYear(), name: site.legalName })}</span>
          <div className={styles.legal}>
            <Link href={routes.privacy}>{t('privacy')}</Link>
            <span className={styles.dot} aria-hidden="true">
              ·
            </span>
            <Link href={routes.terms}>{t('terms')}</Link>
            {!site.whiteLabel && (
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
