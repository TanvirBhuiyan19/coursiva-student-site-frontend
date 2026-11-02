'use client';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useConfirmSubscription } from '@/features/account/api';
import { Link } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useResendVerification, useResetPassword, useSession, useVerifyEmail } from '../api';
import styles from './Auth.module.css';

/**
 * Pages that the school's emails link to (Laravel `TenantUrls::site()`):
 * `/reset-password?token&email[&invited=1]`, `/verify-email?token` and `/subscribe/confirm?token`.
 */

/** Set a new password from the emailed link; `invited=1` is an invited learner choosing a first password. */
export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const id = useId();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const email = params.get('email') ?? '';
  const invited = params.get('invited') === '1';
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError(t('passwordShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('passwordMismatch'));
      return;
    }
    setError(null);
    reset.mutate(
      { email, token, password, passwordConfirmation: confirm },
      {
        onError: (err) => setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : t('genericError')),
      },
    );
  };

  if (!token || !email) {
    return (
      <div className={`${styles.card} ${styles.narrow}`}>
        <h1 className={styles.title}>{t('linkInvalidTitle')}</h1>
        <p className={styles.sub}>{t('resetLinkInvalid')}</p>
        <Link href={routes.forgotPassword} className="btn btn-primary btn-block" style={{ marginTop: 20 }}>
          {t('sendLink')}
        </Link>
      </div>
    );
  }

  return (
    <div className={`${styles.card} ${styles.narrow}`}>
      <span className={styles.lock} aria-hidden="true">
        🔒
      </span>
      {reset.isSuccess ? (
        <div role="status">
          <h1 className={styles.title}>{invited ? t('passwordSetTitle') : t('passwordResetTitle')}</h1>
          <p className={styles.sub}>{t('passwordResetDone')}</p>
          <Link href={routes.signIn()} className="btn btn-primary btn-block" style={{ marginTop: 20 }}>
            {t('signInCta')}
          </Link>
        </div>
      ) : (
        <>
          <h1 className={styles.title}>{invited ? t('setPasswordTitle') : t('newPasswordTitle')}</h1>
          <p className={styles.sub}>{invited ? t('setPasswordSub', { email }) : t('newPasswordSub', { email })}</p>
          <form onSubmit={submit} noValidate className={styles.form}>
            {error && (
              <p id={`${id}-err`} className="alert alert-bad" role="alert">
                {error}
              </p>
            )}
            <div className="field">
              <label className="field-label" htmlFor={`${id}-pw`}>
                {t('newPassword')}
              </label>
              <input
                id={`${id}-pw`}
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-pw2`}>
                {t('confirmPassword')}
              </label>
              <input
                id={`${id}-pw2`}
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={!!error}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={reset.isPending}>
              {invited ? t('setPasswordCta') : t('resetPasswordCta')}
            </button>
          </form>
        </>
      )}
      <Link href={routes.signIn()} className={styles.backLink}>
        {t('backToSignIn')}
      </Link>
    </div>
  );
}

/** Confirms the email from the link (once), or offers a fresh link to a signed-in learner. */
export function VerifyEmailView() {
  const t = useTranslations('auth');
  const token = useSearchParams().get('token') ?? '';
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const { isSignedIn, isLoading } = useSession();
  const started = useRef(false);

  useEffect(() => {
    // Links are single-use: confirm exactly once, even when effects run twice in development.
    if (!token || started.current) return;
    started.current = true;
    verify.mutate(token);
  }, [token, verify]);

  const failed = verify.isError
    ? verify.error instanceof ApiError
      ? (Object.values(verify.error.fieldErrors)[0] ?? verify.error.message)
      : t('genericError')
    : null;
  // Laravel answers a dead (unknown, used or expired) link with 410 `invalid_token`: offer a fresh one.
  const expired = verify.error instanceof ApiError && (verify.error.status === 410 || verify.error.code === 'invalid_token');

  return (
    <div className={`${styles.card} ${styles.narrow}`}>
      <span className={styles.lock} aria-hidden="true">
        ✓
      </span>
      {verify.isSuccess ? (
        <div role="status">
          <h1 className={styles.title}>{t('emailConfirmedTitle')}</h1>
          <p className={styles.sub}>{t('emailConfirmedSub')}</p>
          <Link href={isSignedIn ? routes.learning : routes.signIn()} className="btn btn-primary btn-block" style={{ marginTop: 20 }}>
            {isSignedIn ? t('goToLearning') : t('signInCta')}
          </Link>
        </div>
      ) : token && !failed ? (
        <div role="status">
          <h1 className={styles.title}>{t('confirmingTitle')}</h1>
          <div className="skeleton" style={{ height: 12, marginTop: 16 }} />
        </div>
      ) : (
        <>
          <h1 className={styles.title}>
            {expired ? t('confirmLinkExpiredTitle') : failed ? t('linkInvalidTitle') : t('confirmEmailTitle')}
          </h1>
          {failed && (
            <p className="alert alert-bad" role="alert">
              {failed}
            </p>
          )}
          <p className={styles.sub}>{t('confirmEmailSub')}</p>
          {resend.isSuccess ? (
            <p className="alert alert-ok" role="status">
              {resend.data.sent ? t('confirmationSent') : t('alreadyConfirmed')}
            </p>
          ) : isLoading ? null : isSignedIn ? (
            <button
              type="button"
              className="btn btn-primary btn-block"
              style={{ marginTop: 20 }}
              disabled={resend.isPending}
              onClick={() => resend.mutate()}
            >
              {t('resendConfirmation')}
            </button>
          ) : (
            <Link href={routes.signIn(routes.verifyEmail)} className="btn btn-primary btn-block" style={{ marginTop: 20 }}>
              {t('signInToResend')}
            </Link>
          )}
          {resend.isError && (
            <p className="field-error" role="alert">
              {resend.error instanceof ApiError ? resend.error.message : t('genericError')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * `/subscribe/confirm?token=`: the double opt-in link in a school's "Confirm your subscription" email. The visitor
 * confirms with a button (never on load: mail scanners open links), which posts the token to `POST /forms/confirm`.
 */
export function ConfirmSubscriptionView() {
  const t = useTranslations('auth');
  const token = useSearchParams().get('token') ?? '';
  const confirm = useConfirmSubscription();
  const failed = confirm.isError
    ? confirm.error instanceof ApiError
      ? (confirm.error.fieldErrors.token ?? confirm.error.message)
      : t('genericError')
    : null;

  return (
    <div className={`${styles.card} ${styles.narrow}`}>
      <span className={styles.lock} aria-hidden="true">
        ✓
      </span>
      {confirm.isSuccess ? (
        <div role="status">
          <h1 className={styles.title}>{t('subscriptionConfirmedTitle')}</h1>
          <p className={styles.sub}>{t('subscriptionConfirmedSub')}</p>
          <Link href={routes.home} className="btn btn-primary btn-block" style={{ marginTop: 20 }}>
            {t('backToSite')}
          </Link>
        </div>
      ) : !token || failed ? (
        <>
          <h1 className={styles.title}>{t('linkInvalidTitle')}</h1>
          <p className="alert alert-bad" role="alert">
            {failed ?? t('subscriptionLinkMissing')}
          </p>
          <Link href={routes.home} className="btn btn-block" style={{ marginTop: 20 }}>
            {t('backToSite')}
          </Link>
        </>
      ) : (
        <>
          <h1 className={styles.title}>{t('confirmSubscriptionTitle')}</h1>
          <p className={styles.sub}>{t('confirmSubscriptionSub')}</p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            style={{ marginTop: 20 }}
            disabled={confirm.isPending}
            onClick={() => confirm.mutate(token)}
          >
            {t('confirmSubscription')}
          </button>
        </>
      )}
    </div>
  );
}
