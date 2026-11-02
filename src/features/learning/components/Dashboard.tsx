'use client';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Icon } from '@/components/icons';
import { useCertificates } from '@/features/account/api';
import { useSession } from '@/features/auth/api';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import { useToggleWishlist, useWishlist } from '@/features/commerce/api';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useDashboard, useEnrollments, useSetWeeklyGoal } from '../api';
import type { Enrollment } from '../types';
import styles from './Dashboard.module.css';
import type { Organizer } from '../calendar';
import { UpcomingLive } from '@/features/live/components/UpcomingLive';
import { LiveBanner } from './LiveBanner';

type Filter = 'all' | 'progress' | 'completed';
const GOALS = [3, 5, 7, 10];
const FILTERS: Filter[] = ['all', 'progress', 'completed'];
const ACHIEVEMENT_GLYPH = { streak: '★', certificate: '✦', lessons: '▶' } as const;

/** "My learning" — the signed-in home. Every number here comes from the API (dashboard + enrolments). */
export function Dashboard({ organizer, showCertificates }: { organizer: Organizer; showCertificates: boolean }) {
  const t = useTranslations('learning');
  const tc = useTranslations('common');
  const f = useFormat();
  const goalId = useId();
  const { user } = useSession();
  const dash = useDashboard();
  const enrollments = useEnrollments();
  const wishlist = useWishlist();
  const certificates = useCertificates();
  const unsave = useToggleWishlist();
  const setGoal = useSetWeeklyGoal();
  const [filter, setFilter] = useState<Filter>('all');

  if (dash.isPending || enrollments.isPending) return <DashboardSkeleton />;
  if (dash.isError || enrollments.isError)
    return (
      <div className="container page">
        <div className="alert alert-bad" role="alert">
          {tc('errorBody')}{' '}
          <button type="button" className="link-btn" onClick={() => void dash.refetch()}>
            {tc('retry')}
          </button>
        </div>
      </div>
    );

  const d = dash.data;
  const mine = enrollments.data ?? [];
  const current = mine.find((e) => e.progress.percent < 100) ?? mine[0];
  const certCount = certificates.data?.length ?? 0;
  const goalMet = d.weekLessons >= d.weeklyGoal;
  const maxDay = Math.max(2, ...d.activity.map((a) => a.lessons));
  const shown = mine.filter((e) => filter === 'all' || (filter === 'completed' ? e.progress.percent === 100 : e.progress.percent < 100));
  const first = user?.name.split(' ')[0] ?? '';

  return (
    <>
      <section className={styles.hero}>
        <div className={`container ${styles.heroInner}`}>
          <span className="avatar" style={{ width: 52, height: 52, fontSize: 17, background: user?.color }} aria-hidden="true">
            {user?.initials}
          </span>
          <div className={styles.heroText}>
            <h1 className="h1-sm" style={{ fontSize: 30 }}>
              {t('welcome', { name: first })}
            </h1>
            <p className={styles.heroSub}>
              {current && current.progress.percent < 100
                ? t.rich('heroSub', {
                    percent: current.progress.percent,
                    course: current.courseTitle,
                    streak: d.streakDays,
                    b: (c) => <b>{c}</b>,
                  })
                : mine.length
                  ? t('heroAllDone')
                  : t('heroEmpty')}
            </p>
          </div>
          <dl className={styles.heroStats}>
            <div>
              <dt>{t('statCourses')}</dt>
              <dd className="num">{mine.length}</dd>
            </div>
            {showCertificates && (
              <div>
                <dt>{t('statCertificates')}</dt>
                <dd className="num">{certCount}</dd>
              </div>
            )}
            {d.streakDays > 0 && (
              <div>
                <dt>{t('statStreak')}</dt>
                <dd className="num">{d.streakDays}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <div className="container" style={{ paddingBottom: 80 }}>
        {d.nextEvent && <LiveBanner event={d.nextEvent} organizer={organizer} />}

        {mine.length === 0 ? (
          <div className={styles.emptyCard}>
            <h2 className="h2">{t('emptyTitle')}</h2>
            <p>{t('emptyBody')}</p>
            <Link href={routes.courses} className="btn btn-primary btn-lg" style={{ marginTop: 16 }}>
              {t('browse')}
            </Link>
          </div>
        ) : (
          <>
            <div className={styles.topGrid}>
              {current && (
                <Link href={routes.player(current.courseSlug, current.resumeLesson.id)} className={styles.continue}>
                  <span className={styles.play} aria-hidden="true">
                    <Icon name="play" size={22} />
                  </span>
                  <span className={styles.continueBody}>
                    <span className="eyebrow eyebrow-brand">{t('continueEyebrow', { course: current.courseTitle })}</span>
                    <span className={styles.continueTitle}>{current.resumeLesson.title}</span>
                    <span className={styles.progressRow}>
                      <span className="progress" aria-hidden="true">
                        <span style={{ width: `${current.progress.percent}%` }} />
                      </span>
                      <span className={styles.pct}>{current.progress.percent}%</span>
                    </span>
                  </span>
                </Link>
              )}
              <section className={`card ${styles.goal}`} aria-labelledby={`${goalId}-t`}>
                <div className={styles.goalHead}>
                  <h2 id={`${goalId}-t`} className={styles.cardTitle}>
                    {t('weeklyGoal')}
                  </h2>
                  <label htmlFor={goalId} className="sr-only">
                    {t('goalLabel')}
                  </label>
                  <select
                    id={goalId}
                    className={`select ${styles.goalSelect}`}
                    value={d.weeklyGoal}
                    disabled={setGoal.isPending}
                    onChange={(e) => setGoal.mutate(Number(e.target.value))}
                  >
                    {GOALS.map((g) => (
                      <option key={g} value={g}>
                        {tc('lessons', { count: g })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.progressRow} style={{ marginTop: 14 }}>
                  <div
                    className="progress"
                    role="progressbar"
                    aria-valuenow={Math.min(d.weekLessons, d.weeklyGoal)}
                    aria-valuemin={0}
                    aria-valuemax={d.weeklyGoal}
                    aria-label={t('weeklyGoal')}
                  >
                    <span style={{ width: `${Math.min(100, Math.round((d.weekLessons / d.weeklyGoal) * 100))}%` }} />
                  </div>
                  <span className={styles.pct}>{t('goalOf', { done: d.weekLessons, goal: d.weeklyGoal })}</span>
                </div>
                <p className={goalMet ? styles.goalMet : styles.goalLeft}>
                  {goalMet ? t('goalMet') : t('goalLeft', { count: d.weeklyGoal - d.weekLessons })}
                </p>
                <dl className={styles.facts}>
                  {d.streakDays > 0 && (
                    <div>
                      <dt>{t('factStreak')}</dt>
                      <dd>{t('days', { count: d.streakDays })}</dd>
                    </div>
                  )}
                  {showCertificates && (
                    <div>
                      <dt>{t('factCertificates')}</dt>
                      <dd>{certCount}</dd>
                    </div>
                  )}
                  {d.nextEvent && (
                    <div>
                      <dt>{t('factLive')}</dt>
                      <dd>
                        {new Intl.DateTimeFormat(f.locale, {
                          weekday: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone: user?.timezone,
                        }).format(new Date(d.nextEvent.startsAt))}
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
            </div>

            <div className={styles.midGrid}>
              <section className={`card ${styles.activity}`} aria-labelledby="act-t">
                <h2 id="act-t" className={styles.cardTitle}>
                  {t('activity')}
                </h2>
                <ul className={styles.bars}>
                  {d.activity.map((a, i) => {
                    const date = new Date(`${a.day}T12:00:00Z`);
                    const today = i === d.activity.length - 1;
                    return (
                      <li key={a.day}>
                        <span
                          className={styles.bar}
                          data-today={today}
                          data-empty={a.lessons === 0}
                          style={{ height: a.lessons === 0 ? 6 : Math.round((a.lessons / maxDay) * 68) }}
                          aria-hidden="true"
                        />
                        <span className={styles.barDay} aria-hidden="true">
                          {new Intl.DateTimeFormat(f.locale, { weekday: 'narrow', timeZone: 'UTC' }).format(date)}
                        </span>
                        <span className="sr-only">
                          {new Intl.DateTimeFormat(f.locale, { weekday: 'long', timeZone: 'UTC' }).format(date)}:{' '}
                          {tc('lessons', { count: a.lessons })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className={styles.actFoot}>{t('weekDone', { count: d.weekLessons })}</p>
              </section>
              <section className={`card ${styles.upNext}`} aria-labelledby="up-t">
                <h2 id="up-t" className={styles.cardTitle}>
                  {t('upNext')}
                </h2>
                {d.upNext.length === 0 ? (
                  <p className={styles.muted}>{t('upNextEmpty')}</p>
                ) : (
                  <ul>
                    {d.upNext.map((l) => (
                      <li key={l.id}>
                        <Link href={routes.player(l.courseSlug, l.id)} className={styles.upRow}>
                          <span className={styles.chip} data-type={l.type}>
                            {tc(`lessonTypes.${l.type}`)}
                          </span>
                          <span className={styles.upText}>
                            <span className={styles.upTitle}>{l.title}</span>
                            <span className={styles.upCourse}>{l.courseTitle}</span>
                          </span>
                          <span className={styles.upDur}>
                            {l.durationSeconds
                              ? f.clock(l.durationSeconds)
                              : l.questionCount
                                ? tc('questions', { count: l.questionCount })
                                : '—'}
                          </span>
                          <span aria-hidden="true" className={styles.upArrow}>
                            →
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <UpcomingLive className={styles.block} />

            <section aria-labelledby="mine-t" className={styles.block}>
              <div className={styles.blockHead}>
                <h2 id="mine-t" className="h2" style={{ fontSize: 22 }}>
                  {t('myCourses')}
                </h2>
                <div className={styles.filters} role="group" aria-label={t('filterLabel')}>
                  {FILTERS.map((k) => (
                    <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                      {t(`filter.${k}`)}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="grid-3" style={{ marginTop: 16 }}>
                {shown.map((e) => (
                  <li key={e.courseId}>
                    <MyCourseCard e={e} />
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {(wishlist.data?.length ?? 0) > 0 && (
          <section aria-labelledby="saved-t" className={styles.block}>
            <h2 id="saved-t" className="h2" style={{ fontSize: 22 }}>
              {t('saved')}
            </h2>
            <ul className={styles.chipsRow}>
              {wishlist.data!.map(({ course: c }) => (
                <li key={c.id} className={styles.savedChip}>
                  <span className={styles.swatch} style={{ background: c.cover.color }} aria-hidden="true" />
                  <Link href={routes.course(c.slug)} className={styles.savedText}>
                    <span className={styles.savedTitle}>{c.title}</span>
                    <span className={styles.savedPrice}>{f.coursePrice(c.price, c.pricing)}</span>
                  </Link>
                  <button
                    type="button"
                    className={styles.x}
                    aria-label={t('unsave', { title: c.title })}
                    onClick={() => unsave.mutate({ slug: c.slug, saved: false })}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {d.recommendation && (
          <section aria-labelledby="rec-t" className={styles.block}>
            <h2 id="rec-t" className="h2" style={{ fontSize: 22 }}>
              {t('recommended')}
            </h2>
            <article className={styles.rec}>
              <CourseCover cover={d.recommendation.course.cover} height={72} radius={10} className={styles.recCover} sizes="120px" />
              <div className={styles.recBody}>
                <p className="eyebrow eyebrow-brand" style={{ fontSize: 10.5 }}>
                  {d.recommendation.reason}
                </p>
                <h3 className={styles.recTitle}>
                  <Link href={routes.course(d.recommendation.course.slug)} className={styles.stretched}>
                    {d.recommendation.course.title}
                  </Link>
                </h3>
                <p className={styles.muted}>
                  <span aria-hidden="true">★</span> {d.recommendation.course.rating.toFixed(1)} ·{' '}
                  {tc('lessons', { count: d.recommendation.course.lessonCount })} · {f.duration(d.recommendation.course.durationMinutes)}
                </p>
              </div>
              <div className={styles.recPrice}>
                <span className="num" style={{ fontSize: 17 }}>
                  {f.money(d.recommendation.course.price)}
                </span>
                <span className={styles.recView} aria-hidden="true">
                  {tc('view')}
                </span>
              </div>
            </article>
          </section>
        )}

        {showCertificates && certCount > 0 && (
          <section aria-labelledby="cert-t" className={styles.block}>
            <div className={styles.blockHead}>
              <h2 id="cert-t" className="h2" style={{ fontSize: 22 }}>
                {t('certificates')}
              </h2>
              <Link href={routes.certificates} className={styles.viewAll}>
                {tc('viewAll')}
              </Link>
            </div>
            <ul className={styles.chipsRow}>
              {certificates.data!.map((c) => (
                <li key={c.id} className={styles.certChip}>
                  <span className={styles.badge} aria-hidden="true">
                    ✦
                  </span>
                  <span>
                    <span className={styles.savedTitle}>{c.courseTitle}</span>
                    <span className={styles.savedPrice}>{t('earned', { date: f.date(c.issuedAt) })}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {d.achievements.length > 0 && (
          <section aria-labelledby="ach-t" className={styles.block}>
            <h2 id="ach-t" className="h2" style={{ fontSize: 22 }}>
              {t('achievements')}
            </h2>
            <ul className={styles.chipsRow}>
              {d.achievements.map((a) => (
                <li key={a.id} className={styles.certChip}>
                  <span className={styles.badge} aria-hidden="true">
                    {ACHIEVEMENT_GLYPH[a.kind]}
                  </span>
                  <span>
                    <span className={styles.savedTitle}>{a.title}</span>
                    <span className={styles.savedPrice}>{a.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {d.purchases.length > 0 && (
          <section aria-labelledby="buy-t" className={styles.block}>
            <h2 id="buy-t" className="h2" style={{ fontSize: 22 }}>
              {t('purchases')}
            </h2>
            <div className={`card ${styles.tableWrap}`} tabIndex={0} role="region" aria-labelledby="buy-t">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('colItem')}</th>
                    <th scope="col">{t('colDate')}</th>
                    <th scope="col">{t('colAmount')}</th>
                    <th scope="col">
                      <span className="sr-only">{t('colInvoice')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.purchases.map((p) => (
                    <tr key={p.orderId}>
                      <td className={styles.strong}>{p.title}</td>
                      <td>{f.date(p.createdAt)}</td>
                      <td className={styles.strong}>{f.money(p.total)}</td>
                      <td style={{ textAlign: 'end' }}>
                        <Link href={routes.invoice(p.orderId)} aria-label={t('invoiceFor', { title: p.title })} className={styles.invLink}>
                          {t('invoice')}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 12 }}>
              <Link href={routes.accountOrders}>{t('allOrders')}</Link>
            </p>
          </section>
        )}
      </div>
    </>
  );
}

function MyCourseCard({ e }: { e: Enrollment }) {
  const t = useTranslations('learning');
  const done = e.progress.percent === 100;
  return (
    <article className={styles.myCard}>
      <CourseCover cover={e.cover} height={92}>
        {done && <span className={`tag tag-ok ${styles.doneTag}`}>{t('completed')}</span>}
      </CourseCover>
      <div className={styles.myBody}>
        <h3 className={styles.myTitle}>
          <Link href={routes.player(e.courseSlug, e.resumeLesson.id)} className={styles.stretched}>
            {e.courseTitle}
          </Link>
        </h3>
        <p className={styles.muted}>{t('lessonsDone', { done: e.progress.completed, total: e.progress.total })}</p>
        <div className={styles.progressRow} style={{ marginTop: 12 }}>
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${e.progress.percent}%` }} />
          </span>
          <span className={styles.pct}>{e.progress.percent}%</span>
        </div>
      </div>
    </article>
  );
}

function DashboardSkeleton() {
  return (
    <div className="container page" aria-busy="true">
      <div className="skeleton" style={{ height: 70, width: '60%' }} />
      <div className="skeleton" style={{ height: 56, marginTop: 24 }} />
      <div className={styles.topGrid}>
        <div className="skeleton" style={{ height: 200 }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    </div>
  );
}
