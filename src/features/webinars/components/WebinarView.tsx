'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useWebinar } from '../api';
import type { PublicWebinar } from '../types';
import { WebinarRegister } from './WebinarRegister';
import styles from './Webinars.module.css';

const noSubscribe = () => () => undefined;
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * A public webinar (`/webinars/{slug}`): what, when (in the visitor's own time zone once the browser is known; the
 * server renders the school's), how long, the course it belongs to and the description — with the registration card
 * beside it (below on phones). Seats and the form token are re-read in the browser.
 */
export function WebinarView({ initial }: { initial: PublicWebinar }) {
  const t = useTranslations('webinars');
  const locale = useLocale();
  const f = useFormat();
  const { data } = useWebinar(initial.slug, initial);
  const w = data ?? initial;
  // The visitor's zone is only known in the browser: the server (and hydration) use the school's.
  const visitorZone = useSyncExternalStore(noSubscribe, browserZone, () => null);
  const zone = visitorZone ?? w.timeZone;
  const start = new Date(w.startsAt);
  const end = new Date(start.getTime() + w.durationMin * 60_000);
  const date = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: zone }).format(
    start,
  );
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short' });
  const range = `${new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(start)} – ${time.format(end)}`;
  const price = w.access === 'paid' && w.price ? f.money(w.price) : w.access === 'free' ? t('free') : t('membersOnly');

  return (
    <div className={styles.layout}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>
          {w.status === 'live' ? (
            <>
              <span className={styles.liveDot} aria-hidden="true" /> {t('liveNow')}
            </>
          ) : (
            t('eyebrow')
          )}
        </p>
        <h1 className="h1">{w.title}</h1>
        <dl className={styles.facts}>
          <div>
            <dt>
              <Icon name="calendar" size={16} />
              <span className="sr-only">{t('dateLabel')}</span>
            </dt>
            <dd>
              <time dateTime={w.startsAt}>{date}</time>
            </dd>
          </div>
          <div>
            <dt>
              <Icon name="clock" size={16} />
              <span className="sr-only">{t('timeLabel')}</span>
            </dt>
            <dd>
              {range} · {t('minutes', { count: w.durationMin })}
            </dd>
          </div>
          <div>
            <dt>
              <Icon name="video" size={16} />
              <span className="sr-only">{t('whereLabel')}</span>
            </dt>
            <dd>{t('online')}</dd>
          </div>
          {w.course && (
            <div>
              <dt>
                <Icon name="play" size={16} />
                <span className="sr-only">{t('courseLabel')}</span>
              </dt>
              <dd>
                {w.course.slug ? (
                  <Link href={routes.course(w.course.slug)} className={styles.inlineLink}>
                    {t('fromCourse', { course: w.course.title })}
                  </Link>
                ) : (
                  t('fromCourse', { course: w.course.title })
                )}
              </dd>
            </div>
          )}
        </dl>
        <p className={styles.zone} data-testid="webinar-timezone">
          {visitorZone && visitorZone !== w.timeZone
            ? t('zoneVisitor', { zone: visitorZone, school: w.timeZone })
            : t('zoneSchool', { zone: w.timeZone })}
        </p>
      </header>

      <aside className={styles.side} aria-labelledby="webinar-register-title">
        <div className={styles.card}>
          <p className={styles.price} data-testid="webinar-price">
            {price}
          </p>
          {w.seatsLeft !== null && w.registrationOpen && (
            <p className={styles.seats} data-low={!w.soldOut && w.seatsLeft <= 10 ? '' : undefined}>
              {w.soldOut ? t('soldOut') : t('seatsLeft', { count: w.seatsLeft })}
            </p>
          )}
          <h2 id="webinar-register-title" className="sr-only">
            {t('registerTitle')}
          </h2>
          <WebinarRegister w={w} />
          <p className={styles.calendar}>
            <Icon name="calendar" size={14} />
            <a href={w.calendar.google} target="_blank" rel="noopener noreferrer" className={styles.inlineLink}>
              {t('googleCalendar')}
            </a>
            <a href={w.calendar.outlook} target="_blank" rel="noopener noreferrer" className={styles.inlineLink}>
              {t('outlookCalendar')}
            </a>
          </p>
        </div>
      </aside>

      {w.description && (
        <section className={styles.about} aria-labelledby="webinar-about">
          <h2 id="webinar-about" className="h3">
            {t('about')}
          </h2>
          <div className={styles.description}>
            {w.description.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
