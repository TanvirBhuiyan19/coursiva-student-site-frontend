'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Link, useHardNavigate } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { joinWebinar } from '../api';
import styles from './Webinars.module.css';

type State =
  { kind: 'joining' } | { kind: 'sign_in'; sessionId: string | null } | { kind: 'not_yours' } | { kind: 'invalid' } | { kind: 'failed' };

/**
 * `/webinars/join?t=` — the personal join link of a webinar registration email. A guest account is signed in on this
 * browser and the visitor lands on the session page; the signed-in owner goes straight there; an account with a
 * password signs in first (then the session page); someone else's link or a dead one says so.
 */
/** What a refused join link means for the page. */
function joinFailure(err: unknown): State {
  if (!(err instanceof ApiError)) return { kind: 'failed' };
  if (err.status === 401) {
    const id = err.details.sessionId;
    return { kind: 'sign_in', sessionId: typeof id === 'string' ? id : null };
  }
  if (err.status === 403) return { kind: 'not_yours' };
  if (err.status === 410 || err.status === 422 || err.status === 404) return { kind: 'invalid' };
  return { kind: 'failed' };
}

export function WebinarJoin({ token }: { token: string | null }) {
  const t = useTranslations('webinars.join');
  const navigate = useHardNavigate();
  const [state, setState] = useState<State>(token ? { kind: 'joining' } : { kind: 'invalid' });
  const started = useRef(false);

  useEffect(() => {
    // Once: the link signs in, so a second request (Strict Mode, a re-render) must not race it.
    if (!token || started.current) return;
    started.current = true;
    joinWebinar(token).then(
      // A full navigation: the session cookie (and the header's account state) changed.
      (r) => {
        navigate(routes.live(r.sessionId));
      },
      (err: unknown) => {
        setState(joinFailure(err));
      },
    );
  }, [token, navigate]);

  if (state.kind === 'joining')
    return (
      <div className={styles.joinCard} role="status" data-testid="webinar-join" data-state="joining">
        <span className={styles.spinner} aria-hidden="true" />
        <p className={styles.joinTitle}>{t('joining')}</p>
      </div>
    );

  const next = state.kind === 'sign_in' && state.sessionId ? routes.live(state.sessionId) : routes.liveSchedule;
  return (
    <div className={styles.joinCard} data-testid="webinar-join" data-state={state.kind}>
      <Icon name={state.kind === 'sign_in' ? 'lock' : 'video'} size={22} />
      <h1 className={styles.joinTitle}>{t(`${state.kind}.title`)}</h1>
      <p className={styles.note}>{t(`${state.kind}.body`)}</p>
      <div className={styles.joinActions}>
        {state.kind === 'sign_in' || state.kind === 'not_yours' ? (
          <Link href={routes.signIn(next)} className="btn btn-primary btn-lg">
            {t('signIn')}
          </Link>
        ) : (
          <Link href={routes.liveSchedule} className="btn btn-primary btn-lg">
            {t('toSchedule')}
          </Link>
        )}
      </div>
    </div>
  );
}
