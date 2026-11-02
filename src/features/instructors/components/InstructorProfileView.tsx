import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Rating } from '@/components/Rating';
import { isOptimizableImage } from '@/config/image-hosts';
import { CourseCard } from '@/features/catalog/components/CourseCard';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { InstructorDetail, InstructorPlatform } from '../types';
import { InstructorAvatar } from './InstructorAvatar';
import styles from './Instructors.module.css';

/** Line icons per platform (24×24 stroke paths; the footer's set plus GitHub). */
const PLATFORM_ICON: Record<InstructorPlatform, string> = {
  linkedin: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  x: 'M4 4l16 16M20 4L4 20',
  youtube:
    'M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8zM10 15V9l5 3z',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01',
  facebook: 'M15 3h-2a4 4 0 0 0-4 4v3H7v4h2v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h2z',
  tiktok: 'M16 3a5 5 0 0 0 5 5v4a9 9 0 0 1-5-1.6V16a6 6 0 1 1-6-6v4a2 2 0 1 0 2 2V3z',
  github:
    'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.3 6.4-1.5 6.4-7A5.4 5.4 0 0 0 20 4.8 5 5 0 0 0 19.9 1S18.7.7 16 2.5a13.4 13.4 0 0 0-7 0C6.3.7 5.1 1 5.1 1A5 5 0 0 0 5 4.8a5.4 5.4 0 0 0-1.5 3.7c0 5.4 3.3 6.6 6.4 7a3.4 3.4 0 0 0-.9 2.6V22',
};
const WEBSITE_ICON = 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20';

/** The API only hands out https:// links; anything else is dropped here too (defence in depth). */
export const safeExternalUrl = (url: string | null): string | null => (url && /^https:\/\/[^\s/]/i.test(url) ? url : null);

/** Instructor-entered links point off-site: new tab, no referrer, no endorsement; `me` ties them to this profile. */
const EXTERNAL_REL = 'me nofollow noopener noreferrer';

function LineIcon({ d }: { d: string }) {
  return (
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
      <path d={d} />
    </svg>
  );
}

/**
 * `/instructors/{slug}`: a published instructor profile — cover, photo, headline, links, figures, expertise, bio,
 * credentials and their courses. Everything is in the server HTML (indexable); the course cards hydrate their
 * enrolment state like everywhere else.
 */
export function InstructorProfileView({ instructor: p }: { instructor: InstructorDetail }) {
  const t = useTranslations('instructors');
  const f = useFormat();
  const social = p.socialLinks.flatMap((l) => {
    const url = safeExternalUrl(l.url);
    return url ? [{ platform: l.platform, url }] : [];
  });
  const website = safeExternalUrl(p.website);
  const rating = p.stats.reviewCount > 0 ? p.stats.rating : null;

  return (
    <article className={styles.profile} aria-labelledby="instructor-name">
      <div
        className={styles.cover}
        style={{
          backgroundColor: p.color,
          backgroundImage: p.coverUrl
            ? undefined
            : `radial-gradient(120% 90% at 100% 0%, oklch(1 0 0 / 0.22), transparent 55%), linear-gradient(135deg, ${p.color}, color-mix(in oklch, ${p.color}, black 22%))`,
        }}
      >
        {p.coverUrl && (
          <Image
            src={p.coverUrl}
            alt=""
            fill
            priority
            sizes="(max-width: 1160px) 100vw, 1160px"
            style={{ objectFit: 'cover' }}
            unoptimized={!isOptimizableImage(p.coverUrl)}
          />
        )}
      </div>

      <header className={styles.head}>
        <InstructorAvatar person={p} size={128} fontSize={42} className={styles.headAvatar} priority />
        <div className={styles.headText}>
          <Link href={routes.instructors} className={styles.back}>
            {`← ${t('back')}`}
          </Link>
          <h1 id="instructor-name" className={`h1 ${styles.name}`}>
            {p.name}
          </h1>
          {p.headline !== '' && <p className={styles.headline}>{p.headline}</p>}
          {(social.length > 0 || website) && (
            <ul className={styles.links} aria-label={t('links', { name: p.name })}>
              {social.map((l) => (
                <li key={l.platform}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel={EXTERNAL_REL}
                    className={styles.social}
                    aria-label={t('social', { name: p.name, network: t(`networks.${l.platform}`) })}
                  >
                    <LineIcon d={PLATFORM_ICON[l.platform]} />
                  </a>
                </li>
              ))}
              {website && (
                <li>
                  <a
                    href={website}
                    target="_blank"
                    rel={EXTERNAL_REL}
                    className={styles.website}
                    aria-label={t('websiteLabel', { name: p.name })}
                  >
                    <LineIcon d={WEBSITE_ICON} />
                    <span aria-hidden="true">{t('website')}</span>
                  </a>
                </li>
              )}
            </ul>
          )}
        </div>
      </header>

      <dl className={styles.stats} aria-label={t('stats')}>
        <div>
          <dt>{t('statLearners')}</dt>
          <dd>{f.number(p.stats.learnerCount)}</dd>
        </div>
        <div>
          <dt>{t('statCourses')}</dt>
          <dd>{f.number(p.stats.courseCount)}</dd>
        </div>
        <div>
          <dt>{t('statRating')}</dt>
          {rating !== null ? (
            <dd className={styles.statRating}>
              <span aria-hidden="true">{rating.toFixed(1)}</span>
              <Rating value={rating} label={t('ratingValue', { rating: rating.toFixed(1), count: p.stats.reviewCount })} size={14} />
              <span className={styles.statNote} aria-hidden="true">
                {t('reviews', { count: p.stats.reviewCount })}
              </span>
            </dd>
          ) : (
            <dd className={styles.statNone}>{t('noRating')}</dd>
          )}
        </div>
      </dl>

      <div className={styles.columns}>
        <div className={styles.main}>
          {p.bioHtml !== '' && (
            <section aria-labelledby="about-h">
              <h2 id="about-h" className="h2">
                {t('about', { name: p.name })}
              </h2>
              {/*
               * Safe HTML from the API (instructors.md): rendered from the instructor's Markdown with raw HTML stripped,
               * images removed, unsafe link schemes dropped and rel/target set on absolute links. Nothing else on this
               * page is inserted as HTML.
               */}
              <div className={styles.prose} dangerouslySetInnerHTML={{ __html: p.bioHtml }} />
            </section>
          )}
        </div>
        {(p.expertise.length > 0 || p.credentials.length > 0) && (
          <div className={styles.side}>
            {p.expertise.length > 0 && (
              <section aria-labelledby="expertise-h">
                <h2 id="expertise-h" className={styles.sideTitle}>
                  {t('expertise')}
                </h2>
                <ul className={styles.chips}>
                  {p.expertise.map((tag) => (
                    <li key={tag} className="tag tag-soft">
                      {tag}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {p.credentials.length > 0 && (
              <section aria-labelledby="credentials-h">
                <h2 id="credentials-h" className={styles.sideTitle}>
                  {t('credentials')}
                </h2>
                <ul className={styles.credentials}>
                  {p.credentials.map((c, i) => {
                    const sub =
                      c.issuer !== '' && c.year !== null
                        ? t('credentialIssuerYear', { issuer: c.issuer, year: String(c.year) })
                        : c.issuer || (c.year !== null ? String(c.year) : '');
                    return (
                      <li key={`${i}-${c.title}`}>
                        <span className={styles.credTitle}>{c.title}</span>
                        {sub !== '' && <span className={styles.credSub}>{sub}</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      <section className={styles.courses} aria-labelledby="courses-h">
        <h2 id="courses-h" className="h2">
          {t('coursesBy', { name: p.name })}
        </h2>
        {p.courses.length > 0 ? (
          <ul className="grid-3">
            {p.courses.map((c) => (
              <li key={c.id}>
                <CourseCard course={c} variant="featured" />
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>{t('noCourses', { name: p.name })}</p>
        )}
      </section>
    </article>
  );
}
