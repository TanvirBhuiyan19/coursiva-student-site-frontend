'use client';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { useHardNavigate } from '@/i18n/navigation';
import { signOutRedirect, useLogout } from '@/features/auth/api';
import { BookingsCard } from '@/features/bookings/components/BookingsViews';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useProfile, useUpdatePassword, useUpdatePreferences, useUpdateProfile } from '../api';
import type { Preferences, Profile, ProfileInput } from '../types';
import { BillingSection } from './BillingSection';
import { DiscordCard } from './DiscordCard';
import { DownloadsSection } from './DownloadsSection';
import { SurveyDialog } from './SurveyDialog';
import styles from './Profile.module.css';

export function ProfileView() {
  const tc = useTranslations('common');
  const { data, isPending, isError, refetch } = useProfile();
  if (isPending) return <div className="skeleton" style={{ height: 520, marginTop: 24 }} />;
  if (isError)
    return (
      <div className="alert alert-bad" role="alert" style={{ marginTop: 24 }}>
        {tc('errorBody')}{' '}
        <button type="button" className="link-btn" onClick={() => void refetch()}>
          {tc('retry')}
        </button>
      </div>
    );
  return <ProfileForms profile={data} />;
}

function ProfileForms({ profile }: { profile: Profile }) {
  const t = useTranslations('account');
  const logout = useLogout();
  const hardNavigate = useHardNavigate();
  // An e-mailed survey link: `/account?survey={id}`.
  const survey = useSearchParams().get('survey');
  return (
    <>
      {survey && <SurveyDialog surveyId={survey} />}
      <DetailsCard profile={profile} />
      <PasswordCard />
      <PreferencesCard prefs={profile.preferences} />
      <DiscordCard />
      <BillingSection profile={profile} />
      <DownloadsSection />
      <BookingsCard className={styles.card} />
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.signOut}
          disabled={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: (result) => {
                const idp = signOutRedirect(result);
                if (idp) window.location.assign(idp);
                else hardNavigate(routes.signIn());
              },
            })
          }
        >
          {t('signOut')}
        </button>
        <a href="/api/v1/me/export" className={styles.export} download>
          {t('export')}
        </a>
      </div>
    </>
  );
}

function DetailsCard({ profile }: { profile: Profile }) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const id = useId();
  const toast = useToast();
  const update = useUpdateProfile();
  const initial: ProfileInput = {
    name: profile.name,
    email: profile.email,
    bio: profile.bio,
    timezone: profile.timezone,
    website: profile.website,
  };
  const [form, setForm] = useState(initial);
  const [currentPassword, setCurrentPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = (Object.keys(initial) as (keyof ProfileInput)[]).some((k) => form[k] !== initial[k]);
  // A new address needs the current password, and stays pending until the link sent to it is opened.
  const emailChanged = form.email.trim().toLowerCase() !== profile.email.toLowerCase();

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const set = (k: Exclude<keyof ProfileInput, 'currentPassword'>) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: '' }));
  };
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    update.mutate(emailChanged ? { ...form, currentPassword } : form, {
      onSuccess: (saved) => {
        setForm({ name: saved.name, email: saved.email, bio: saved.bio, timezone: saved.timezone, website: saved.website });
        setCurrentPassword('');
        toast(emailChanged && saved.pendingEmail ? t('emailPendingToast', { email: saved.pendingEmail }) : t('savedToast'));
      },
      onError: (err) => setErrors(err instanceof ApiError && err.isValidation ? err.fieldErrors : { form: t('saveFailed') }),
    });
  };
  const field = (k: Exclude<keyof ProfileInput, 'currentPassword'>) => ({
    id: `${id}-${k}`,
    value: form[k],
    onChange: set(k),
    'aria-invalid': !!errors[k],
    'aria-describedby': errors[k] ? `${id}-${k}-err` : undefined,
  });

  return (
    <form className={styles.card} onSubmit={submit} noValidate aria-label={t('details')}>
      <div className={styles.identity}>
        <span className="avatar" style={{ width: 64, height: 64, fontSize: 21, background: profile.color }} aria-hidden="true">
          {profile.initials}
        </span>
        <p className={styles.strong} style={{ fontSize: 16 }}>
          {profile.name}
        </p>
      </div>
      {errors.form && (
        <p className="alert alert-bad" role="alert">
          {errors.form}
        </p>
      )}
      <div className={styles.grid}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-name`}>
            {t('name')}
          </label>
          <input className="input" autoComplete="name" {...field('name')} />
          <FieldError id={`${id}-name-err`} message={errors.name} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-email`}>
            {t('email')}
          </label>
          <input className="input" type="email" autoComplete="email" {...field('email')} />
          <FieldError id={`${id}-email-err`} message={errors.email} />
          {!emailChanged && profile.pendingEmail && <p className="field-hint">{t('emailPending', { email: profile.pendingEmail })}</p>}
        </div>
      </div>
      {emailChanged && (
        <div className="field">
          <label className="field-label" htmlFor={`${id}-email-password`}>
            {t('currentPassword')}
          </label>
          <input
            id={`${id}-email-password`}
            className="input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setErrors((er) => ({ ...er, currentPassword: '' }));
            }}
            aria-invalid={!!errors.currentPassword}
            aria-describedby={errors.currentPassword ? `${id}-email-password-err` : undefined}
          />
          <FieldError id={`${id}-email-password-err`} message={errors.currentPassword} />
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor={`${id}-bio`}>
          {t('bio')}
        </label>
        <textarea
          className="textarea"
          rows={3}
          style={{ minHeight: 72 }}
          placeholder={t('bioPlaceholder')}
          maxLength={500}
          {...field('bio')}
        />
        <FieldError id={`${id}-bio-err`} message={errors.bio} />
      </div>
      <div className={styles.grid}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-timezone`}>
            {t('timezone')}
          </label>
          <select className="select" {...field('timezone')}>
            {profile.timezones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
          <FieldError id={`${id}-timezone-err`} message={errors.timezone} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-website`}>
            {t('website')}
          </label>
          <input className="input" type="url" inputMode="url" placeholder={t('websitePlaceholder')} {...field('website')} />
          <FieldError id={`${id}-website-err`} message={errors.website} />
        </div>
      </div>
      <div className={styles.actions}>
        <button type="submit" className="btn btn-primary" disabled={!dirty || update.isPending}>
          {tc('save')}
        </button>
        {dirty && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setForm(initial);
              setCurrentPassword('');
              setErrors({});
            }}
          >
            {t('discard')}
          </button>
        )}
      </div>
    </form>
  );
}

function PasswordCard() {
  const t = useTranslations('account');
  const id = useId();
  const toast = useToast();
  const update = useUpdatePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (next.length < 8) {
      setErrors({ password: t('passwordShort') });
      return;
    }
    update.mutate(
      { currentPassword: current, password: next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          setErrors({});
          toast(t('passwordUpdated'));
        },
        onError: (err) => setErrors(err instanceof ApiError && err.isValidation ? err.fieldErrors : { password: t('saveFailed') }),
      },
    );
  };
  return (
    <form className={styles.card} onSubmit={submit} noValidate aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className={styles.title}>
        {t('security')}
      </h2>
      <div className={styles.grid}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-cur`}>
            {t('currentPassword')}
          </label>
          <input
            id={`${id}-cur`}
            className="input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            aria-invalid={!!errors.currentPassword}
          />
          {errors.currentPassword && <p className="field-error">{errors.currentPassword}</p>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-new`}>
            {t('newPassword')}
          </label>
          <input
            id={`${id}-new`}
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={t('newPasswordPlaceholder')}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-invalid={!!errors.password}
          />
          {errors.password && <p className="field-error">{errors.password}</p>}
        </div>
      </div>
      <div className={styles.actions}>
        <button type="submit" className="btn btn-outline" disabled={update.isPending || !current || !next}>
          {t('updatePassword')}
        </button>
      </div>
    </form>
  );
}

const PREF_KEYS: (keyof Preferences)[] = ['newLessons', 'communityReplies', 'liveReminders', 'certificateReminders'];

function PreferencesCard({ prefs }: { prefs: Preferences }) {
  const t = useTranslations('account');
  const toast = useToast();
  const update = useUpdatePreferences();
  return (
    <section className={styles.card} aria-labelledby="prefs-t">
      <h2 id="prefs-t" className={styles.title}>
        {t('notifications')}
      </h2>
      <ul className={styles.prefs}>
        {PREF_KEYS.map((k) => {
          // A switch an older API doesn't send yet reads as on (every email switch defaults to on).
          const on = Object.hasOwn(prefs, k) ? prefs[k] : true;
          return (
            <li key={k}>
              <span id={`pref-${k}`}>{t(`prefs.${k}`)}</span>
              <button
                type="button"
                role="switch"
                className="switch"
                aria-checked={on}
                aria-labelledby={`pref-${k}`}
                onClick={() => update.mutate({ ...prefs, [k]: !on }, { onError: () => toast(t('saveFailed')) })}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null;
}
