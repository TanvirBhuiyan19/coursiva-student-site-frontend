'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type SyntheticEvent, useId, useState } from 'react';
import { Icon } from '@/components/icons';
import { useSession } from '@/features/auth/api';
import { TurnstileWidget } from '@/features/forms/components/Turnstile';
import { useLiveSession, useSessionRsvp } from '@/features/live/api';
import { LiveTicketCta } from '@/features/live/components/LiveTicketCta';
import { Link, useLocalizedRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useRegisterWebinar, webinarKeys } from '../api';
import type { PublicWebinar, WebinarRegistration } from '../types';
import styles from './Webinars.module.css';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The registration card's body. Signed-in learners act on their own account (RSVP a free seat, buy a ticket, or see
 * they're registered); visitors register with a name and email — every visitor becomes a lead — then a free webinar
 * says "check your email" (the personal join link is there), a paid one continues to checkout and a members-only one
 * to the membership page.
 */
export function WebinarRegister({ w }: { w: PublicWebinar }) {
  const { isSignedIn, isLoading } = useSession();
  const t = useTranslations('webinars');
  if (!w.registrationOpen) return <p className={styles.closed}>{t('ended')}</p>;
  if (isLoading) return <div className="skeleton" style={{ height: 120 }} aria-hidden="true" />;
  return isSignedIn ? <LearnerRegister w={w} /> : <GuestRegister w={w} />;
}

function LearnerRegister({ w }: { w: PublicWebinar }) {
  const t = useTranslations('webinars');
  const { data: s, isPending, isError, refetch } = useLiveSession(w.id);
  const rsvp = useSessionRsvp(w.id);

  if (isPending) return <div className="skeleton" style={{ height: 96 }} aria-hidden="true" />;
  if (isError)
    return (
      <div className={styles.stack}>
        <p className={styles.note}>{t('loadFailed')}</p>
        <button type="button" className="link-btn" onClick={() => void refetch()}>
          {t('retry')}
        </button>
      </div>
    );
  if (s.going || s.waitlisted)
    return (
      <div className={styles.done} data-testid="webinar-registered">
        <p className={styles.doneTitle}>
          <Icon name="check" size={16} /> {s.waitlisted ? t('waitlistedTitle') : t('registeredTitle')}
        </p>
        <Link href={routes.live(w.id)} className="btn btn-primary btn-lg btn-block">
          {t('toSession')}
        </Link>
      </div>
    );
  if (s.ticket && !s.ticket.hasAccess) return <LiveTicketCta sessionId={w.id} ticket={s.ticket} />;
  return (
    <button type="button" className="btn btn-primary btn-lg btn-block" disabled={rsvp.isPending} onClick={() => rsvp.mutate(true)}>
      {w.soldOut ? t('joinWaitlist') : t('registerFree')}
    </button>
  );
}

function GuestRegister({ w }: { w: PublicWebinar }) {
  const t = useTranslations('webinars');
  const f = useFormat();
  const uid = useId();
  const qc = useQueryClient();
  const router = useLocalizedRouter();
  const register = useRegisterWebinar(w.slug);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileRun, setTurnstileRun] = useState(0);
  const [errors, setErrors] = useState<{ name?: string; email?: string; turnstile?: string; form?: string }>({});
  const [done, setDone] = useState<WebinarRegistration | null>(null);
  const siteKey = w.form.turnstileSiteKey;
  const busy = register.isPending || (done !== null && done.next !== 'check_email');

  if (done?.next === 'check_email')
    return (
      <div className={styles.done} role="status" data-testid="webinar-check-email">
        <p className={styles.doneTitle}>
          <Icon name="check" size={16} /> {done.status === 'waitlisted' ? t('waitlistedTitle') : t('registeredTitle')}
        </p>
        <p className={styles.note}>{done.status === 'waitlisted' ? t('waitlistedBody', { email }) : t('checkEmail', { email })}</p>
      </div>
    );

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    // Double-submit guard: one registration in flight (the API also answers a repeat from the first).
    if (busy) return;
    const errs: typeof errors = {};
    if (name.trim().length < 2) errs.name = t('errors.name');
    if (!EMAIL.test(email.trim())) errs.email = t('errors.email');
    if (siteKey && !turnstileToken) errs.turnstile = t('errors.turnstile');
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(errs.name ? `${uid}-name` : `${uid}-email`)?.focus();
      return;
    }
    register.mutate(
      { name: name.trim(), email: email.trim(), token: w.form.token, website: honeypot, turnstileToken: siteKey ? turnstileToken : null },
      {
        onSuccess: (r) => {
          setDone(r);
          if (r.next === 'checkout') router.push(routes.checkoutLive(w.id));
          else if (r.next === 'membership') router.push(routes.membership);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.isValidation) {
            const fe = err.fieldErrors;
            // An expired or too-quick form token: a fresh one is fetched, the visitor just submits again.
            if (fe.token) void qc.invalidateQueries({ queryKey: webinarKeys.page(w.slug) });
            if (fe.turnstileToken) {
              setTurnstileToken(null);
              setTurnstileRun((n) => n + 1);
            }
            setErrors({
              name: fe.name,
              email: fe.email,
              turnstile: fe.turnstileToken,
              form: fe.token ?? (!fe.name && !fe.email && !fe.turnstileToken ? err.message : undefined),
            });
          } else if (err instanceof ApiError && err.isRateLimited) setErrors({ form: t('errors.rateLimited') });
          else if (err instanceof ApiError && err.status === 409) setErrors({ form: err.message });
          else setErrors({ form: t('errors.failed') });
        },
      },
    );
  };

  const cta =
    w.access === 'paid' && w.price
      ? t('continueToCheckout', { price: f.money(w.price) })
      : w.access === 'members'
        ? t('continueMembers')
        : w.soldOut
          ? t('joinWaitlist')
          : t('registerFree');

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-describedby={errors.form ? `${uid}-form-err` : undefined}>
      <div className="field">
        <label htmlFor={`${uid}-name`} className="field-label">
          {t('name')}
        </label>
        <input
          id={`${uid}-name`}
          className="input"
          autoComplete="name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? `${uid}-name-err` : undefined}
        />
        {errors.name && (
          <p id={`${uid}-name-err`} className="field-error">
            {errors.name}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor={`${uid}-email`} className="field-label">
          {t('email')}
        </label>
        <input
          id={`${uid}-email`}
          className="input"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          maxLength={254}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? `${uid}-email-err` : undefined}
        />
        {errors.email && (
          <p id={`${uid}-email-err`} className="field-error">
            {errors.email}
          </p>
        )}
      </div>
      {/* Honeypot: people never see or reach it; the API quietly drops registrations that fill it in. */}
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor={`${uid}-website`}>{t('honeypot')}</label>
        <input
          id={`${uid}-website`}
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>
      {siteKey && (
        <TurnstileWidget
          key={turnstileRun}
          siteKey={siteKey}
          errorId={`${uid}-turnstile-err`}
          error={errors.turnstile}
          onToken={(token) => setTurnstileToken(token)}
        />
      )}
      {errors.form && (
        <p id={`${uid}-form-err`} className="field-error" role="alert">
          {errors.form}
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
        {busy ? t('sending') : cta}
      </button>
      <p className={styles.fine}>
        {t.rich(w.access === 'paid' ? 'finePaid' : 'fine', {
          link: (c) => (
            <Link href={routes.privacy} className={styles.inlineLink}>
              {c}
            </Link>
          ),
        })}
      </p>
    </form>
  );
}
