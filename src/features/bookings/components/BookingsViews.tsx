'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { DailyRoom } from '@/features/live/components/DailyRoom';
import type { RoomToken } from '@/features/live/types';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { bookingCalendarUrl, joinBooking, useBooking, useCancelBooking, useMyBookings, useReschedule } from '../api';
import { formatRange, formatSessionDate, formatWhen } from '../format';
import type { BookingStatus, JoinInfo, LearnerBooking } from '../types';
import styles from './Bookings.module.css';
import { SlotPicker } from './SlotPicker';

const STATUS_TAG: Record<BookingStatus, string> = {
  held: 'tag tag-warn',
  confirmed: 'tag tag-ok',
  completed: 'tag tag-soft',
  cancelled: 'tag tag-bad',
  no_show: 'tag tag-bad',
  expired: 'tag tag-soft',
};

const ONLINE = new Set(['video', 'zoom', 'meet', 'teams']);

/** The API's message for a refused change (first field error, else the message). */
const apiMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : fallback;

function StatusTag({ status }: { status: BookingStatus }) {
  const t = useTranslations('bookings');
  return <span className={STATUS_TAG[status]}>{t(`status.${status}`)}</span>;
}

function Row({ b }: { b: LearnerBooking }) {
  const t = useTranslations('bookings');
  const locale = useLocale();
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <p className={styles.rowTitle}>
          <Link href={routes.accountBooking(b.id)}>{b.product.title}</Link>
        </p>
        <p className={styles.rowMeta}>
          {formatWhen(b.startsAt, locale, b.timezone)} · {t('withHost', { host: b.host.name })}
        </p>
      </div>
      <div className={styles.rowActions}>
        <StatusTag status={b.status} />
        {b.status === 'held' && b.product.slug && (
          <Link href={routes.checkoutProduct(b.product.slug)} className="btn btn-primary btn-sm">
            {t('payHold')}
          </Link>
        )}
      </div>
    </li>
  );
}

/** `/account/bookings`: sessions left to book, upcoming sessions (incl. held times) and past ones. */
export function BookingsView() {
  const t = useTranslations('bookings');
  const { data, isPending, isError, refetch } = useMyBookings();
  if (isPending) return <div className="skeleton" style={{ height: 320, marginTop: 24 }} />;
  if (isError)
    return (
      <div className="alert alert-bad" role="alert" style={{ marginTop: 24 }}>
        {t('error')}{' '}
        <button type="button" className="link-btn" onClick={() => void refetch()}>
          {t('retry')}
        </button>
      </div>
    );
  return (
    <>
      {data.credits.length > 0 && (
        <section className={styles.section} aria-labelledby="bk-credits">
          <h2 id="bk-credits" className="h3">
            {t('creditsTitle')}
          </h2>
          <ul className={styles.list}>
            {data.credits.map((c) => (
              <li key={c.packageId} className={styles.row}>
                <div className={styles.rowMain}>
                  <p className={styles.rowTitle}>{c.productTitle}</p>
                  <p className={styles.rowMeta}>{t('creditRow', { remaining: c.remaining, total: c.total })}</p>
                </div>
                <Link href={routes.product(c.productSlug)} className="btn btn-primary btn-sm">
                  {t('bookSession')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={styles.section} aria-labelledby="bk-upcoming">
        <h2 id="bk-upcoming" className="h3">
          {t('upcoming')}
        </h2>
        {data.upcoming.length ? (
          <ul className={styles.list}>
            {data.upcoming.map((b) => (
              <Row key={b.id} b={b} />
            ))}
          </ul>
        ) : (
          <p className="muted">{t('noUpcoming')}</p>
        )}
      </section>
      <section className={styles.section} aria-labelledby="bk-past">
        <h2 id="bk-past" className="h3">
          {t('past')}
        </h2>
        {data.past.length ? (
          <ul className={styles.list}>
            {data.past.map((b) => (
              <Row key={b.id} b={b} />
            ))}
          </ul>
        ) : (
          <p className="muted">{t('noPast')}</p>
        )}
      </section>
    </>
  );
}

/** The account page's bookings card (hidden for learners who never booked or bought sessions). */
export function BookingsCard({ className }: { className?: string }) {
  const t = useTranslations('bookings');
  const { data } = useMyBookings();
  if (!data || (!data.upcoming.length && !data.past.length && !data.credits.length)) return null;
  return (
    <section className={className} aria-labelledby="bk-card">
      <h2 id="bk-card" className={styles.panelTitle}>
        {t('title')}
      </h2>
      <p className="muted">{t('accountCardSub', { count: data.upcoming.length })}</p>
      <Link href={routes.accountBookings}>{t('viewBookings')}</Link>
    </section>
  );
}

/**
 * `/account/bookings/{id}` — the session page the booking emails and calendar invites link to: when (in the zone the
 * learner booked in), where, join, add to calendar, reschedule and cancel within the school's policy.
 */
export function BookingDetailView({ id }: { id: string }) {
  const t = useTranslations('bookings');
  const { data, isPending, isError, error, refetch } = useBooking(id);
  if (isPending) return <div className="skeleton" style={{ height: 360, marginTop: 24 }} />;
  if (isError)
    return error instanceof ApiError && error.status === 404 ? (
      <p className="alert alert-bad" role="alert" style={{ marginTop: 24 }}>
        {t('notFound')}
      </p>
    ) : (
      <div className="alert alert-bad" role="alert" style={{ marginTop: 24 }}>
        {t('error')}{' '}
        <button type="button" className="link-btn" onClick={() => void refetch()}>
          {t('retry')}
        </button>
      </div>
    );
  return <BookingDetail b={data} />;
}

function BookingDetail({ b }: { b: LearnerBooking }) {
  const t = useTranslations('bookings');
  const locale = useLocale();
  const id = useId();
  const [panel, setPanel] = useState<'reschedule' | 'cancel' | null>(null);
  const online = ONLINE.has(b.location.type);
  const upcoming = b.status === 'confirmed' || b.status === 'held';
  const policy = b.cancelNoticeHours > 0 ? t('cancelPolicy', { hours: b.cancelNoticeHours }) : t('cancelPolicyNone');

  return (
    <div className={styles.detail}>
      <div className={styles.actions} style={{ alignItems: 'center' }}>
        <h1 className="h1-sm">{b.product.title}</h1>
        <StatusTag status={b.status} />
      </div>
      <dl className={styles.facts}>
        <dt>{t('when')}</dt>
        <dd>
          {t('whenValue', {
            date: formatSessionDate(b.startsAt, locale, b.timezone),
            time: formatRange(b.startsAt, b.endsAt, locale, b.timezone),
            zone: b.timezone.replace(/_/g, ' '),
          })}
        </dd>
        <dt>{t('where')}</dt>
        <dd>
          {t(`location.${b.location.type}`)}
          {b.location.detail && <span style={{ display: 'block', whiteSpace: 'pre-line' }}>{b.location.detail}</span>}
        </dd>
        <dt>{t('host')}</dt>
        <dd>{b.host.name}</dd>
      </dl>

      {b.status === 'held' && b.holdExpiresAt && (
        <p className="alert alert-ok">
          {t('holdUntil', { time: formatWhen(b.holdExpiresAt, locale, b.timezone) })}{' '}
          {b.product.slug && <Link href={routes.checkoutProduct(b.product.slug)}>{t('payHold')}</Link>}
        </p>
      )}
      {b.status === 'cancelled' && b.cancelReason && <p className="muted">{t('cancelledReason', { reason: b.cancelReason })}</p>}

      {b.status === 'confirmed' && <JoinBox b={b} online={online} />}

      {upcoming && (
        <div className={styles.actions}>
          {b.status === 'confirmed' && (
            <a href={bookingCalendarUrl(b.id)} className="btn btn-outline" download>
              {t('addToCalendar')}
            </a>
          )}
          {b.canReschedule && (
            <button
              type="button"
              className="btn btn-outline"
              aria-expanded={panel === 'reschedule'}
              aria-controls={`${id}-panel`}
              onClick={() => setPanel((p) => (p === 'reschedule' ? null : 'reschedule'))}
            >
              {t('reschedule')}
            </button>
          )}
          {b.canCancel && (
            <button
              type="button"
              className="btn btn-outline"
              aria-expanded={panel === 'cancel'}
              aria-controls={`${id}-panel`}
              onClick={() => setPanel((p) => (p === 'cancel' ? null : 'cancel'))}
            >
              {t('cancel')}
            </button>
          )}
        </div>
      )}
      {b.status === 'confirmed' && <p className={styles.policy}>{b.canCancel ? policy : t('tooLate', { hours: b.cancelNoticeHours })}</p>}

      <div id={`${id}-panel`}>
        {panel === 'reschedule' && <ReschedulePanel b={b} onDone={() => setPanel(null)} />}
        {panel === 'cancel' && <CancelPanel b={b} policy={policy} onDone={() => setPanel(null)} />}
      </div>

      {b.answers.length > 0 && (
        <section aria-labelledby={`${id}-answers`}>
          <h2 id={`${id}-answers`} className={styles.panelTitle}>
            {t('yourAnswers')}
          </h2>
          <dl className={styles.facts} style={{ marginTop: 8 }}>
            {b.answers.map((a) => (
              <div key={a.key} style={{ display: 'contents' }}>
                <dt>{a.label}</dt>
                <dd style={{ whiteSpace: 'pre-line' }}>{a.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

/** Join: the built-in room opens here (Daily, a fresh token per join); a provider's meeting opens in a new tab. */
function JoinBox({ b, online }: { b: LearnerBooking; online: boolean }) {
  const t = useTranslations('bookings');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [room, setRoom] = useState(false);
  // The first join's token is used by the room; a rejoin asks for a fresh one.
  const first = useRef<JoinInfo | null>(null);
  if (!online) return null;

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const j = await joinBooking(b.id);
      if (j.kind === 'link') {
        setLink(j.joinUrl);
        window.open(j.joinUrl, '_blank', 'noopener,noreferrer');
      } else {
        first.current = j;
        setRoom(true);
      }
    } catch (err) {
      setError(apiMessage(err, t('joinError')));
    } finally {
      setBusy(false);
    }
  };

  const getToken = async (): Promise<RoomToken> => {
    const j = first.current ?? (await joinBooking(b.id));
    first.current = null;
    if (j.kind !== 'room') throw new ApiError(409, t('joinError'));
    return { roomUrl: j.roomUrl, token: j.token, expiresAt: j.expiresAt, isOwner: false, canRecord: false };
  };

  return (
    <div className={styles.panel}>
      <div className={styles.actions} style={{ alignItems: 'center' }}>
        {room ? (
          <button type="button" className="btn btn-outline" onClick={() => setRoom(false)}>
            {t('leaveRoom')}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={() => void join()}>
            {t('join')}
          </button>
        )}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer">
            {t('joinLink')}
          </a>
        )}
      </div>
      {!b.joinAvailable && !room && <p className={styles.policy}>{t('joinSoon')}</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {room && (
        <div className={styles.room}>
          <DailyRoom title={b.product.title} getToken={getToken} />
        </div>
      )}
    </div>
  );
}

function ReschedulePanel({ b, onDone }: { b: LearnerBooking; onDone: () => void }) {
  const t = useTranslations('bookings');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const reschedule = useReschedule(b.id);
  const [timezone, setTimezone] = useState(b.timezone);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!b.product.slug) return null;
  const slug = b.product.slug;

  const confirm = () => {
    if (!selected) {
      setError(t('pickFirst'));
      return;
    }
    setError(null);
    reschedule.mutate(
      { startsAt: selected, timezone },
      {
        onSuccess: (nb) => {
          toast(t('rescheduledToast', { when: formatWhen(nb.startsAt, locale, nb.timezone) }));
          onDone();
        },
        onError: (err) => {
          setError(apiMessage(err, t('errGeneric')));
          if (err instanceof ApiError && err.isConflict) {
            setSelected(null);
            void qc.invalidateQueries({ queryKey: ['bookings', 'availability', slug] });
          }
        },
      },
    );
  };

  return (
    <section className={styles.panel} aria-labelledby="bk-resched">
      <h2 id="bk-resched" className={styles.panelTitle}>
        {t('rescheduleTitle')}
      </h2>
      <SlotPicker slug={slug} timezone={timezone} onTimezoneChange={setTimezone} selected={selected} onSelect={setSelected} />
      {selected && <p className={styles.selected}>{t('selected', { when: formatWhen(selected, locale, timezone) })}</p>}
      {error && (
        <p className="alert alert-bad" role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={reschedule.isPending}
          aria-busy={reschedule.isPending}
          onClick={confirm}
        >
          {t('rescheduleConfirm')}
        </button>
        <button type="button" className="btn btn-outline" onClick={onDone}>
          {t('keep')}
        </button>
      </div>
    </section>
  );
}

function CancelPanel({ b, policy, onDone }: { b: LearnerBooking; policy: string; onDone: () => void }) {
  const t = useTranslations('bookings');
  const id = useId();
  const toast = useToast();
  const cancel = useCancelBooking(b.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    setError(null);
    cancel.mutate(reason.trim(), {
      onSuccess: () => {
        toast(t('cancelledToast'));
        onDone();
      },
      onError: (err) => setError(apiMessage(err, t('errGeneric'))),
    });
  };

  return (
    <section className={styles.panel} aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className={styles.panelTitle}>
        {t('cancelTitle')}
      </h2>
      {b.status === 'confirmed' && <p className={styles.policy}>{policy}</p>}
      <div className="field">
        <label className="field-label" htmlFor={`${id}-reason`}>
          {t('cancelReason')}
        </label>
        <textarea
          id={`${id}-reason`}
          className="textarea"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {error && (
        <p className="alert alert-bad" role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" disabled={cancel.isPending} aria-busy={cancel.isPending} onClick={confirm}>
          {t('cancelConfirm')}
        </button>
        <button type="button" className="btn btn-outline" onClick={onDone}>
          {t('keep')}
        </button>
      </div>
    </section>
  );
}
