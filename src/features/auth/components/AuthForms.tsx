'use client';
import { Link, useHardNavigate } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useForgotPassword, useLogin, useRegister, useSession } from '../api';
import { OAUTH_REASONS, PROVIDER_NAMES, SSO_ERRORS, authFailure } from '../failures';
import { SESSION_EXPIRED } from '../sessionExpiry';
import type { AuthScreen } from '@/features/tenant/types';
import styles from './Auth.module.css';

/** The school's own text when it typed some, else ours. */
const or = (custom: string | undefined, fallback: string) => (custom !== undefined && custom !== '' ? custom : fallback);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only same-origin paths are allowed as a post-login destination (no open redirects). */
export function safeNext(next: string | null, fallback: string = routes.learning) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/sign-') ? next : fallback;
}

function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) s++;
  if (pw.length >= 12 || /[^A-Za-z0-9]/.test(pw)) s++;
  return s as 0 | 1 | 2 | 3;
}

type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>;

export function AuthForm({
  mode,
  oauth: providers,
  sso = false,
  screen = null,
  group,
}: {
  mode: 'signin' | 'signup';
  oauth: string[];
  sso?: boolean;
  /** The group invite link's token (`/join/{token}`): the new account takes a seat in that group. */
  group?: string;
  /** The sign-in screen as the school configured it in the site builder (`GET /site` → `screens.auth`). */
  screen?: AuthScreen | null;
}) {
  const t = useTranslations('auth');
  const id = useId();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const login = useLogin();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<Errors>(() => {
    const failure = authFailure(params);
    if (!failure) return {};
    if (failure.kind === 'sso')
      return {
        form: (SSO_ERRORS as readonly string[]).includes(failure.reason)
          ? t(`ssoErrors.${failure.reason as (typeof SSO_ERRORS)[number]}`)
          : t('ssoErrors.generic'),
      };
    return {
      form:
        failure.reason && (OAUTH_REASONS as readonly string[]).includes(failure.reason)
          ? t(`oauthReasons.${failure.reason as (typeof OAUTH_REASONS)[number]}`)
          : t('oauthFailed'),
    };
  });
  const isUp = mode === 'signup';
  // Sent here by an expired session (features/auth/sessionExpiry): say so, then bring them back to `next`.
  const expired = !isUp && params.get('reason') === SESSION_EXPIRED;
  // Builder switches: the create-account tab, "Continue with Google" and the forgot-password link.
  const showSignup = screen?.signup !== false;
  const oauth = screen?.google === false ? providers.filter((p) => p !== 'google') : providers;
  const custom = !isUp && screen ? screen : null;
  const pending = login.isPending || register.isPending;
  const strength = passwordStrength(password);
  const { isSignedIn } = useSession();
  const hardNavigate = useHardNavigate();

  // Already signed in (e.g. back button after login): skip the form.
  useEffect(() => {
    if (isSignedIn && !pending && !login.isSuccess && !register.isSuccess) hardNavigate(next);
  }, [isSignedIn, pending, next, login.isSuccess, register.isSuccess, hardNavigate]);

  const clear = (k: keyof Errors) => setErrors((e) => ({ ...e, [k]: undefined, form: undefined }));
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.isValidation) setErrors({ ...err.fieldErrors, form: Object.values(err.fieldErrors)[0] });
    else setErrors({ form: t('genericError') });
  };
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const found: Errors = {};
    if (isUp && !name.trim()) found.name = t('nameRequired');
    if (!EMAIL.test(email.trim())) found.email = t('emailInvalid');
    if (password.length < 8) found.password = t('passwordShort');
    if (Object.keys(found).length) {
      setErrors({ ...found, form: Object.values(found)[0] });
      return;
    }
    // Full navigation: the session cookie just changed, and the client router may hold prefetched guest responses
    // (e.g. the proxy redirect from /learning to sign-in). Nothing cached for the guest should survive sign-in.
    const done = () => hardNavigate(next);
    if (isUp)
      register.mutate({ name: name.trim(), email: email.trim(), password, ...(group ? { group } : {}) }, { onSuccess: done, onError });
    else login.mutate({ email: email.trim(), password, remember }, { onSuccess: done, onError });
  };

  return (
    <>
      {(showSignup || isUp) && (
        <nav className={styles.switch} aria-label={t('switchLabel')}>
          <Link href={routes.signIn(params.get('next') ?? undefined)} aria-current={!isUp ? 'page' : undefined}>
            {t('signInTab')}
          </Link>
          <Link href={routes.signUp(params.get('next') ?? undefined)} aria-current={isUp ? 'page' : undefined}>
            {t('signUpTab')}
          </Link>
        </nav>
      )}
      <div className={styles.card}>
        <h1 className={styles.title}>{or(custom?.title, isUp ? t('signUpTitle') : t('signInTitle'))}</h1>
        <p className={styles.sub}>{or(custom?.subtitle, isUp ? t('signUpSub') : t('signInSub'))}</p>
        <form onSubmit={submit} noValidate className={styles.form}>
          {errors.form && (
            <p className="alert alert-bad" role="alert">
              {errors.form}
            </p>
          )}
          {expired && !errors.form && (
            <p className={`alert ${styles.notice}`} role="status">
              {t('sessionExpired')}
            </p>
          )}
          {isUp && (
            <div className="field">
              <label className="field-label" htmlFor={`${id}-name`}>
                {t('name')}
              </label>
              <input
                id={`${id}-name`}
                className="input"
                autoComplete="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clear('name');
                }}
                aria-invalid={!!errors.name}
              />
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor={`${id}-email`}>
              {t('email')}
            </label>
            <input
              id={`${id}-email`}
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clear('email');
              }}
              aria-invalid={!!errors.email}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-password`}>
              {t('password')}
            </label>
            <input
              id={`${id}-password`}
              className="input"
              type="password"
              autoComplete={isUp ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clear('password');
              }}
              aria-invalid={!!errors.password}
              aria-describedby={isUp ? `${id}-strength` : undefined}
            />
            {isUp && (
              <div className={styles.strength} id={`${id}-strength`}>
                <span className={styles.bars} data-level={password ? strength : 0} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>{password ? t(`strength${strength}`) : t('strengthHint')}</span>
              </div>
            )}
          </div>
          {!isUp && (
            <div className={styles.row}>
              <label className="check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                {t('remember')}
              </label>
              {screen?.forgot !== false && (
                <Link href={routes.forgotPassword} className={styles.forgot}>
                  {t('forgot')}
                </Link>
              )}
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={pending}>
            {or(custom?.button, isUp ? t('signUpCta') : t('signInCta'))}
          </button>
        </form>
        {(oauth.length > 0 || sso) && (
          <>
            <div className={styles.or}>
              <span>{t('or')}</span>
            </div>
            <div className={styles.providers}>
              {/* Full-page navigations: the OAuth / SAML round-trip happens on the API and lands back on `next`. */}
              {oauth.map((p) => (
                <a
                  key={p}
                  href={`/api/v1/auth/oauth/${encodeURIComponent(p)}/redirect?next=${encodeURIComponent(next)}`}
                  className="btn btn-outline btn-block btn-lg"
                >
                  {p === 'google' ? t('google') : t('oauthWith', { provider: PROVIDER_NAMES[p] ?? p })}
                </a>
              ))}
              {sso && (
                <a href={`/api/v1/auth/saml/login?next=${encodeURIComponent(next)}`} className="btn btn-outline btn-block btn-lg">
                  {t('sso')}
                </a>
              )}
            </div>
          </>
        )}
      </div>
      <p className={styles.foot}>{isUp ? t('signUpFoot') : t('signInFoot')}</p>
    </>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const id = useId();
  const forgot = useForgotPassword();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) {
      setError(t('emailInvalid'));
      return;
    }
    forgot.mutate({ email: email.trim() }, { onError: (err) => setError(err instanceof ApiError ? err.message : t('genericError')) });
  };

  return (
    <div className={`${styles.card} ${styles.narrow}`}>
      <span className={styles.lock} aria-hidden="true">
        🔒
      </span>
      {forgot.isSuccess ? (
        <div role="status">
          <h1 className={styles.title}>{t('checkInbox')}</h1>
          <p className={styles.sub}>{t('resetSent', { email: email.trim() })}</p>
          <button
            type="button"
            className="btn btn-outline btn-block"
            style={{ marginTop: 20 }}
            onClick={() => forgot.mutate({ email: email.trim() })}
          >
            {t('resend')}
          </button>
        </div>
      ) : (
        <>
          <h1 className={styles.title}>{t('resetTitle')}</h1>
          <p className={styles.sub}>{t('resetSub')}</p>
          <form onSubmit={submit} noValidate className={styles.form}>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-email`}>
                {t('email')}
              </label>
              <input
                id={`${id}-email`}
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-err` : undefined}
              />
              {error && (
                <p id={`${id}-err`} className="field-error">
                  {error}
                </p>
              )}
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={forgot.isPending}>
              {t('sendLink')}
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
