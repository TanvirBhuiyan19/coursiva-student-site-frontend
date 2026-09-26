import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/layout/BrandMark';
import type { Site } from '@/features/tenant/types';
import { stars } from '@/lib/format';
import styles from './Auth.module.css';

/** Two-column auth page: the tenant's pitch on the left, the form on the right (stacks on tablet and phone). */
export function AuthLayout({ site, children }: { site: Site; children: ReactNode }) {
  const tc = useTranslations('common');
  const p = site.authPitch;
  return (
    <div className={`container page ${styles.wrap}`}>
      <div className={styles.grid}>
        <section className={styles.pitch} aria-label={site.name}>
          <div className={styles.brand}>
            <BrandMark site={site} size={34} />
            <span>{site.name}</span>
          </div>
          <p className={styles.pitchTitle}>{p.title}</p>
          <ul className={`ticks ${styles.bullets}`}>
            {p.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          {p.quote && (
            <figure className={styles.quote}>
              <p className="stars" aria-label={tc('ratingLabel', { rating: p.quote.rating })}>
                {stars(p.quote.rating)}
              </p>
              <blockquote>{p.quote.text}</blockquote>
              <figcaption>{p.quote.author}</figcaption>
            </figure>
          )}
        </section>
        <div className={styles.formCol}>{children}</div>
      </div>
    </div>
  );
}
