'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { addDays, localDate, timeZoneList } from '@/lib/timezone';
import { AVAILABILITY_DAYS, useAvailability } from '../api';
import { formatDay, formatDayLong, formatSlotTime } from '../format';
import styles from './Bookings.module.css';

/**
 * Open times of a service: the learner's time zone (changeable), the days with open times in that zone two weeks at
 * a time, and the times of the chosen day. Times are shown in the chosen zone; the API groups them by its dates.
 * `selected` is a slot's `startsAt` (owned by the parent, which clears it when the zone changes).
 */
export function SlotPicker({
  slug,
  timezone,
  onTimezoneChange,
  selected,
  onSelect,
}: {
  slug: string;
  timezone: string;
  onTimezoneChange: (tz: string) => void;
  selected: string | null;
  onSelect: (startsAt: string | null) => void;
}) {
  const t = useTranslations('bookings');
  const locale = useLocale();
  const id = useId();
  const [now] = useState(() => Date.now());
  const [page, setPage] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  const from = addDays(localDate(now, timezone), page * AVAILABILITY_DAYS);
  const { data, isPending, isError, refetch } = useAvailability(slug, from, timezone);
  const zones = timeZoneList([timezone]);
  const days = data?.days ?? [];
  const current = days.find((d) => d.date === day) ?? days[0];

  const turn = (by: number) => {
    setPage((p) => Math.max(0, p + by));
    setDay(null);
  };

  return (
    <div className={styles.picker}>
      <div className={`field ${styles.tz}`}>
        <label className="field-label" htmlFor={`${id}-tz`}>
          {t('timeZone')}
        </label>
        <select
          id={`${id}-tz`}
          className="select"
          value={timezone}
          onChange={(e) => {
            setDay(null);
            onSelect(null);
            onTimezoneChange(e.target.value);
          }}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.dayNav}>
        <button type="button" className="btn btn-outline btn-sm" disabled={page === 0} onClick={() => turn(-1)}>
          {t('earlier')}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => turn(1)}>
          {t('later')}
        </button>
      </div>

      {isError ? (
        <p className="field-error" role="alert">
          {t('slotsError')}{' '}
          <button type="button" className="link-btn" onClick={() => void refetch()}>
            {t('retry')}
          </button>
        </p>
      ) : isPending ? (
        <div className="skeleton" style={{ height: 150 }} />
      ) : !current ? (
        <p className={styles.empty}>{t('noSlots')}</p>
      ) : (
        <>
          <div role="group" aria-label={t('days')} className={styles.days}>
            {days.map((d) => (
              <button key={d.date} type="button" className="chip" aria-pressed={d.date === current.date} onClick={() => setDay(d.date)}>
                {formatDay(d.date, locale)}
              </button>
            ))}
          </div>
          <div role="group" aria-label={t('timesOn', { date: formatDayLong(current.date, locale) })} className={styles.slots}>
            {current.slots.map((s) => (
              <button
                key={s.startsAt}
                type="button"
                className={styles.slot}
                aria-pressed={selected === s.startsAt}
                onClick={() => onSelect(s.startsAt)}
              >
                {formatSlotTime(s.startsAt, locale, timezone)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
