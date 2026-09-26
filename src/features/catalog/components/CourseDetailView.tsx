import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Icon, type IconName } from '@/components/icons';
import { Rating } from '@/components/Rating';
import { stars } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { CourseDetail, LessonOutline, LessonType } from '../types';
import { CourseCard } from './CourseCard';
import { ExpandAll, MobileBuyBar, PurchaseCard, SectionNav, WriteReview, PreviewButton } from './CourseDetailClient';
import styles from './CourseDetail.module.css';

const LESSON_ICON: Record<LessonType, IconName> = { video: 'play', pdf: 'file', quiz: 'help', text: 'file', live: 'users' };

/**
 * Course sales page, laid out like the best-performing course marketplaces: a dark hero with the essentials
 * (breadcrumb, rating, instructor, freshness), a purchase card that overlaps the hero and stays in view, then one
 * long, scannable page with a sticky section nav. Everything is in the server HTML (indexable); only the purchase
 * card, the review form and the nav's scroll-spy hydrate.
 */
export function CourseDetailView({ course }: { course: CourseDetail }) {
  const t = useTranslations('course');
  const tc = useTranslations('common');
  const tn = useTranslations('nav');
  const f = useFormat();
  const locale = useLocale();
  const language =
    new Intl.DisplayNames([locale], { type: 'language' }).of(course.language.split('-')[0] ?? course.language) ?? course.language;
  const updated = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(course.updatedAt));
  const lessonMeta = (l: LessonOutline) =>
    l.type === 'quiz' && l.questionCount
      ? tc('questions', { count: l.questionCount })
      : l.durationSeconds
        ? f.clock(l.durationSeconds)
        : null;
  const moduleMinutes = (lessons: LessonOutline[]) => Math.round(lessons.reduce((s, l) => s + (l.durationSeconds ?? 0), 0) / 60);

  const sections = [
    { id: 'overview', label: t('navOverview') },
    { id: 'curriculum', label: t('navCurriculum') },
    { id: 'instructor', label: t('navInstructor') },
    { id: 'reviews', label: t('navReviews') },
    ...(course.faqs.length ? [{ id: 'faq', label: t('navFaq') }] : []),
  ];

  const includes: { icon: IconName; text: string }[] = [
    { icon: 'play', text: t('includesVideo', { duration: f.duration(course.durationMinutes) }) },
    { icon: 'file', text: t('includesLessons', { count: course.lessonCount }) },
    ...(course.certificate ? [{ icon: 'award' as const, text: t('includesCertificate') }] : []),
    ...(course.community ? [{ icon: 'users' as const, text: t('includesCommunity') }] : []),
    { icon: 'refresh', text: t('includesLifetime') },
  ];

  return (
    <div className={styles.page}>
      <div className={`container ${styles.layout}`}>
        {/* ── Hero ─────────────────────────────────────────────── */}
        <header className={styles.hero}>
          <nav aria-label={t('breadcrumb')}>
            <ol className={styles.crumbs}>
              <li>
                <Link href={routes.home}>{tn('home')}</Link>
              </li>
              <li>
                <Link href={routes.courses}>{tn('courses')}</Link>
              </li>
              <li>
                <Link href={routes.category(course.category.slug)}>{course.category.name}</Link>
              </li>
            </ol>
          </nav>
          <div className={styles.badges}>
            {course.featured && <span className={styles.badgeHot}>{t('mostPopular')}</span>}
            <span className={styles.badge}>
              <Icon name="bars" size={12} />
              {tc(`levels.${course.level}`)}
            </span>
          </div>
          <h1 className={styles.title}>{course.title}</h1>
          <p className={styles.subtitle}>{course.excerpt}</p>
          <div className={styles.ratingRow}>
            <span className={styles.score}>{course.rating.toFixed(1)}</span>
            <Rating value={course.rating} label={tc('ratingLabel', { rating: course.rating.toFixed(1) })} size={15} />
            <a href="#reviews" className={styles.heroLink}>
              {t('ratingsCount', { count: course.reviewCount })}
            </a>
            <span className={styles.dot} aria-hidden="true" />
            <span>{t('learners', { count: course.studentCount })}</span>
          </div>
          <p className={styles.byline}>
            <span
              className="avatar"
              style={{ width: 28, height: 28, fontSize: 11, background: course.instructor.color }}
              aria-hidden="true"
            >
              {course.instructor.initials}
            </span>
            {t.rich('createdBy', {
              name: course.instructor.name,
              link: (c) => (
                <a href="#instructor" className={styles.heroLink}>
                  {c}
                </a>
              ),
            })}
          </p>
          <ul className={styles.meta}>
            <li>
              <Icon name="refresh" size={14} />
              {t('lastUpdated', { date: updated })}
            </li>
            <li>
              <Icon name="globe" size={14} />
              {language}
            </li>
            <li>
              <Icon name="clock" size={14} />
              {t('metaLength', { duration: f.duration(course.durationMinutes), count: course.lessonCount })}
            </li>
          </ul>
        </header>

        {/* ── Purchase card (sticky on desktop, right under the hero on smaller screens) ── */}
        <aside className={styles.aside} aria-label={t('purchase')}>
          <PurchaseCard course={course} includes={includes} />
        </aside>

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className={styles.main}>
          <SectionNav sections={sections} />

          <section id="overview" className={styles.section} aria-labelledby="overview-h">
            <div className={styles.learnBox}>
              <h2 id="overview-h" className={styles.h2}>
                {t('learn')}
              </h2>
              <ul className={styles.learnList}>
                {course.outcomes.map((o) => (
                  <li key={o}>
                    <Icon name="check" size={16} strokeWidth={2.4} />
                    {o}
                  </li>
                ))}
              </ul>
            </div>
            {course.description !== course.excerpt && <p className={styles.description}>{course.description}</p>}
          </section>

          <section id="curriculum" className={styles.section} aria-labelledby="curriculum-h">
            <h2 id="curriculum-h" className={styles.h2}>
              {t('curriculum')}
            </h2>
            <div className={styles.currHead}>
              <p className={styles.currMeta}>
                {t('curriculumMeta', {
                  modules: course.modules.length,
                  lessons: course.lessonCount,
                  duration: f.duration(course.durationMinutes),
                })}
              </p>
              <ExpandAll targetId="curriculum-list" />
            </div>
            <div className={styles.modules} id="curriculum-list">
              {course.modules.map((m, mi) => {
                const mins = moduleMinutes(m.lessons);
                return (
                  <details key={m.id} open={mi === 0} className={styles.module}>
                    <summary className={styles.moduleSummary}>
                      <Icon name="chevronRight" size={16} className={styles.chev} />
                      <span className={styles.moduleTitle}>{m.title}</span>
                      <span className={styles.moduleMeta}>
                        {tc('lessons', { count: m.lessons.length })}
                        {mins > 0 && ` · ${f.duration(mins)}`}
                      </span>
                    </summary>
                    <ul className={styles.lessons}>
                      {m.lessons.map((l) => {
                        const meta = lessonMeta(l);
                        return (
                          <li key={l.id} className={styles.lesson}>
                            <Icon name={LESSON_ICON[l.type]} size={15} className={styles.lessonIcon} />
                            <span className={styles.lessonTitle}>
                              {l.title}
                              <span className="sr-only"> ({tc(`lessonTypes.${l.type}`)})</span>
                            </span>
                            {l.freePreview && course.preview?.lessonId === l.id && <PreviewButton course={course} variant="chip" />}
                            {meta && <span className={styles.lessonDur}>{meta}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                );
              })}
            </div>
          </section>

          {(course.requirements.length > 0 || course.audience.length > 0) && (
            <section className={`${styles.section} ${styles.twoCol}`} aria-label={t('requirementsAndAudience')}>
              {course.requirements.length > 0 && (
                <div>
                  <h2 className={styles.h3}>{t('requirements')}</h2>
                  <ul className={styles.bullets}>
                    {course.requirements.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {course.audience.length > 0 && (
                <div>
                  <h2 className={styles.h3}>{t('audience')}</h2>
                  <ul className={styles.bullets}>
                    {course.audience.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <section id="instructor" className={styles.section} aria-labelledby="instructor-h">
            <h2 id="instructor-h" className={styles.h2}>
              {t('instructorTitle')}
            </h2>
            <div className={styles.instructor}>
              <span
                className="avatar"
                style={{ width: 72, height: 72, fontSize: 24, fontWeight: 800, background: course.instructor.color }}
                aria-hidden="true"
              >
                {course.instructor.initials}
              </span>
              <div className={styles.instructorBody}>
                <h3 className={styles.instructorName}>{course.instructor.name}</h3>
                <p className={styles.instructorRole}>{course.instructorProfile.role}</p>
                <ul className={styles.instructorStats}>
                  <li>
                    <Icon name="users" size={14} />
                    {t('learners', { count: course.instructorProfile.studentCount })}
                  </li>
                  <li>
                    <span aria-hidden="true" className={styles.starInline}>
                      ★
                    </span>
                    {t('instructorRating', { rating: course.rating.toFixed(1) })}
                  </li>
                </ul>
              </div>
            </div>
            <p className={styles.bio}>{course.instructorProfile.bio}</p>
          </section>

          <section id="reviews" className={styles.section} aria-labelledby="reviews-h">
            <h2 id="reviews-h" className={styles.h2}>
              {t('studentReviews')}
            </h2>
            <div className={styles.revSummary}>
              <div className={styles.revScore}>
                <p className={styles.revBig}>{course.rating.toFixed(1)}</p>
                <Rating value={course.rating} label={tc('ratingLabel', { rating: course.rating.toFixed(1) })} size={16} />
                <p className={styles.revCount}>{t('courseRating', { count: course.reviewCount })}</p>
              </div>
              <ul className={styles.dist} aria-label={t('distribution')}>
                {course.ratingDistribution.map((d) => (
                  <li key={d.stars}>
                    <span className={styles.distBar} aria-hidden="true">
                      <span style={{ width: `${d.percent}%` }} />
                    </span>
                    <span className={styles.distStars} aria-hidden="true">
                      {stars(d.stars)}
                    </span>
                    <span className="sr-only">{t('starsShort', { count: d.stars })}</span>
                    <span className={styles.distPct}>{d.percent}%</span>
                  </li>
                ))}
              </ul>
            </div>
            <WriteReview courseSlug={course.slug} />
            <ul className={styles.reviews}>
              {course.reviews.map((r) => (
                <li key={r.id} className={styles.review}>
                  <div className={styles.reviewHead}>
                    <span
                      className="avatar"
                      style={{ width: 40, height: 40, fontSize: 13.5, background: r.author.color }}
                      aria-hidden="true"
                    >
                      {r.author.initials}
                    </span>
                    <div>
                      <p className={styles.reviewName}>{r.author.name}</p>
                      <p className={styles.reviewMeta}>
                        <Rating value={r.rating} label={tc('ratingLabel', { rating: r.rating })} size={12} />
                        <time dateTime={r.createdAt}>{f.ago(r.createdAt)}</time>
                      </p>
                    </div>
                  </div>
                  <p className={styles.reviewBody}>{r.body}</p>
                </li>
              ))}
            </ul>
          </section>

          {course.faqs.length > 0 && (
            <section id="faq" className={styles.section} aria-labelledby="faq-h">
              <h2 id="faq-h" className={styles.h2}>
                {t('faq')}
              </h2>
              <div className={`accordion ${styles.faq}`}>
                {course.faqs.map((q) => (
                  <details key={q.question}>
                    <summary>{q.question}</summary>
                    <p className="accordion-body">{q.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {course.related.length > 0 && (
        <section className={`container ${styles.related}`} aria-labelledby="related-h">
          <div className={styles.relatedHead}>
            <h2 id="related-h" className={styles.h2}>
              {t('related')}
            </h2>
            <Link href={routes.courses} className={styles.relatedAll}>
              {tc('seeAll')}
            </Link>
          </div>
          <ul className="grid-3">
            {course.related.map((c) => (
              <li key={c.id}>
                <CourseCard course={c} variant="featured" />
              </li>
            ))}
          </ul>
        </section>
      )}
      <MobileBuyBar course={course} />
    </div>
  );
}
