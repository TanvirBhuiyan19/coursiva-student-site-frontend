import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { stars } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { CourseDetail, LessonOutline } from '../types';
import { BuyBox, MobileBuyBar } from './BuyBox';
import { CourseMiniCard } from './CourseCard';
import { CourseCover } from './CourseCover';
import { CourseTabs, ExpandAll, PreviewButton, WriteReview } from './CourseDetailClient';
import styles from './CourseDetail.module.css';

/**
 * Course sales page. Every tab's content is in the server HTML (tabs only toggle visibility), so the curriculum and
 * reviews are indexable; the buy box personalises in the browser.
 */
export function CourseDetailView({ course }: { course: CourseDetail }) {
  const t = useTranslations('course');
  const tc = useTranslations('common');
  const f = useFormat();
  const lessonMeta = (l: LessonOutline) =>
    l.type === 'quiz' && l.questionCount
      ? tc('questions', { count: l.questionCount })
      : l.durationSeconds
        ? f.clock(l.durationSeconds)
        : '—';

  const includes = [
    t('includesVideo', { duration: f.duration(course.durationMinutes) }),
    t('includesLessons', { count: course.lessonCount }),
    ...(course.certificate ? [t('includesCertificate')] : []),
    ...(course.community ? [t('includesCommunity')] : []),
    t('includesLifetime'),
  ];

  return (
    <div className={`container page ${styles.page}`}>
      <nav aria-label={t('breadcrumb')}>
        <Link href={routes.courses} className={styles.back}>
          {t('allCourses')}
        </Link>
      </nav>
      <div className={styles.layout}>
        <div className={styles.main}>
          <p className="eyebrow eyebrow-brand" style={{ fontSize: 12.5 }}>
            {course.category.name}
          </p>
          <h1 className={`h1 ${styles.title}`}>{course.title}</h1>
          <p className={styles.desc}>{course.description}</p>
          <p className={styles.stats}>
            <span className="stars" aria-hidden="true">
              {stars(course.rating)}
            </span>
            <span>
              <b>{course.rating.toFixed(1)}</b> {t('reviewCount', { count: course.reviewCount })}
            </span>
            <span aria-hidden="true">·</span>
            <span>{tc('students', { count: course.studentCount })}</span>
            <span aria-hidden="true">·</span>
            <span>{f.duration(course.durationMinutes)}</span>
          </p>
          <div className={styles.instructor}>
            <span
              className="avatar"
              style={{ width: 44, height: 44, fontSize: 15, fontWeight: 800, background: course.instructor.color }}
              aria-hidden="true"
            >
              {course.instructor.initials}
            </span>
            <div>
              <p className={styles.instructorName}>{course.instructor.name}</p>
              <p className={styles.instructorRole}>
                {course.instructorProfile.role} · {t('taught', { count: course.instructorProfile.studentCount })}
              </p>
            </div>
          </div>

          <CourseTabs
            labels={{ overview: t('tabOverview'), curriculum: t('tabCurriculum'), reviews: t('tabReviews', { count: course.reviewCount }) }}
            overview={
              <>
                <h2 className={styles.h2}>{t('learn')}</h2>
                <ul className={`ticks ${styles.two}`}>
                  {course.outcomes.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
                <div className={styles.two} style={{ marginTop: 36 }}>
                  {course.requirements.length > 0 && (
                    <div>
                      <h2 className={styles.h2} style={{ marginTop: 0 }}>
                        {t('requirements')}
                      </h2>
                      <ul className={`dashes ${styles.list}`}>
                        {course.requirements.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {course.audience.length > 0 && (
                    <div>
                      <h2 className={styles.h2} style={{ marginTop: 0 }}>
                        {t('audience')}
                      </h2>
                      <ul className={`ticks ${styles.list}`}>
                        {course.audience.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {course.faqs.length > 0 && (
                  <>
                    <h2 className={styles.h2}>{t('faq')}</h2>
                    <div className="accordion" style={{ marginTop: 14 }}>
                      {course.faqs.map((q) => (
                        <details key={q.question}>
                          <summary>{q.question}</summary>
                          <p className="accordion-body">{q.answer}</p>
                        </details>
                      ))}
                    </div>
                  </>
                )}
              </>
            }
            curriculum={
              <>
                <div className={styles.currHead}>
                  <div>
                    <h2 className={styles.h2} style={{ marginTop: 0 }}>
                      {t('curriculum')}
                    </h2>
                    <p className={styles.currMeta}>
                      {t('curriculumMeta', {
                        modules: course.modules.length,
                        lessons: course.lessonCount,
                        duration: f.duration(course.durationMinutes),
                      })}
                    </p>
                  </div>
                  <ExpandAll targetId="curriculum" />
                </div>
                <div className={`accordion ${styles.modules}`} id="curriculum">
                  {course.modules.map((m, mi) => (
                    <details key={m.id} open={mi === 0}>
                      <summary className={styles.moduleSummary}>
                        <span className={styles.moduleTitle}>{m.title}</span>
                        <span className={styles.moduleMeta}>{tc('lessons', { count: m.lessons.length })}</span>
                      </summary>
                      <ul>
                        {m.lessons.map((l) => (
                          <li key={l.id} className={styles.lesson}>
                            <span className={styles.chip} data-type={l.type}>
                              {tc(`lessonTypes.${l.type}`)}
                            </span>
                            <span className={styles.lessonTitle}>{l.title}</span>
                            {l.freePreview && course.preview?.lessonId === l.id && <PreviewButton course={course} />}
                            <span className={styles.lessonDur}>{lessonMeta(l)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </>
            }
            reviews={
              <>
                <h2 className={styles.h2} style={{ marginTop: 0 }}>
                  {t('studentReviews')}
                </h2>
                <WriteReview courseSlug={course.slug} />
                <div className={styles.revSummary}>
                  <div className={styles.revScore}>
                    <p className="num" style={{ fontSize: 44, lineHeight: 1 }}>
                      {course.rating.toFixed(1)}
                    </p>
                    <p className="stars" aria-hidden="true">
                      {stars(course.rating)}
                    </p>
                    <p className={styles.revCount}>{t('reviewsTotal', { count: course.reviewCount })}</p>
                  </div>
                  <ul className={styles.dist} aria-label={t('distribution')}>
                    {course.ratingDistribution.map((d) => (
                      <li key={d.stars}>
                        <span>{t('starsShort', { count: d.stars })}</span>
                        <span className="progress" aria-hidden="true">
                          <span style={{ width: `${d.percent}%`, background: 'var(--star)' }} />
                        </span>
                        <span>{d.percent}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <ul className={styles.reviews}>
                  {course.reviews.map((r) => (
                    <li key={r.id} className={styles.review}>
                      <div className={styles.reviewHead}>
                        <span
                          className="avatar"
                          style={{ width: 36, height: 36, fontSize: 12.5, background: r.author.color }}
                          aria-hidden="true"
                        >
                          {r.author.initials}
                        </span>
                        <div style={{ flex: 1 }}>
                          <p className={styles.reviewName}>{r.author.name}</p>
                          <p className={styles.reviewWhen}>{f.ago(r.createdAt)}</p>
                        </div>
                        <span className="stars" aria-label={tc('ratingLabel', { rating: r.rating })}>
                          {stars(r.rating)}
                        </span>
                      </div>
                      <p className={styles.reviewBody}>{r.body}</p>
                    </li>
                  ))}
                </ul>
              </>
            }
          />
        </div>

        <aside className={styles.aside} aria-label={t('purchase')}>
          <div className={styles.buyCard}>
            <CourseCover cover={course.cover} height={150} priority sizes="(max-width: 1023px) 100vw, 430px" />
            <div className={styles.buyBody}>
              <BuyBox course={course} />
              <ul className={`ticks ${styles.includes}`} aria-label={t('includes')}>
                {includes.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          </div>
        </aside>
      </div>

      {course.related.length > 0 && (
        <section aria-labelledby="related-title" style={{ marginTop: 56 }}>
          <h2 id="related-title" className="h2" style={{ fontSize: 24 }}>
            {t('related')}
          </h2>
          <ul className="grid-3" style={{ marginTop: 18 }}>
            {course.related.map((c) => (
              <li key={c.id}>
                <CourseMiniCard course={c} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <MobileBuyBar course={course} />
    </div>
  );
}
