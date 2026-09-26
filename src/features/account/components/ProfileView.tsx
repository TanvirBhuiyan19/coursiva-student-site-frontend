'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { useLogout } from '@/features/auth/api';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useProfile, useUpdatePassword, useUpdatePreferences, useUpdateProfile } from '../api';
import type { Preferences, Profile, ProfileInput } from '../types';
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
  const f = useFormat();
  const logout = useLogout();
  return (
    <>
      <DetailsCard profile={profile} />
      <PasswordCard />
      {profile.card && (
        <section className={styles.card} aria-labelledby="pay-t">
          <h2 id="pay-t" className={styles.title}>
            {t('payment')}
          </h2>
          <div className={styles.row}>
            <span className={styles.brand}>{profile.card.brand.toUpperCase()}</span>
            <div style={{ flex: 1 }}>
              <p className={styles.strong}>•••• {profile.card.last4}</p>
              <p className={styles.sub}>
                {t('cardSub', { exp: `${String(profile.card.expMonth).padStart(2, '0')}/${String(profile.card.expYear).slice(-2)}` })}
              </p>
            </div>
            <a
              href={`/api/v1/me/billing-portal?return=${encodeURIComponent(routes.account)}`}
              className="link-btn"
              style={{ fontSize: 13.5 }}
            >
              {t('updateCard')}
            </a>
          </div>
        </section>
      )}
      <PreferencesCard prefs={profile.preferences} />
      {profile.membership && (
        <section className={styles.card} aria-labelledby="mem-t">
          <div className={styles.row}>
            <div style={{ flex: 1 }}>
              <h2 id="mem-t" className={styles.title}>
                {t('membership')}
              </h2>
              <p className={styles.sub}>
                {t('membershipSub', {
                  plan: profile.membership.planName,
                  price: f.money(profile.membership.price),
                  date: f.date(profile.membership.renewsAt),
                })}
              </p>
            </div>
            <a href={`/api/v1/me/billing-portal?return=${encodeURIComponent(routes.account)}`} className="btn btn-outline">
              {t('managePlan')}
            </a>
          </div>
        </section>
      )}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.signOut}
          disabled={logout.isPending}
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: () => window.location.assign(routes.signIn()),
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = (Object.keys(initial) as (keyof ProfileInput)[]).some((k) => form[k] !== initial[k]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const set = (k: keyof ProfileInput) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: '' }));
  };
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    update.mutate(form, {
      onSuccess: () => toast(t('savedToast')),
      onError: (err) => setErrors(err instanceof ApiError && err.isValidation ? err.fieldErrors : { form: t('saveFailed') }),
    });
  };
  const field = (k: keyof ProfileInput) => ({
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
        </div>
      </div>
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

const PREF_KEYS: (keyof Preferences)[] = ['newLessons', 'communityReplies', 'liveReminders'];

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
        {PREF_KEYS.map((k) => (
          <li key={k}>
            <span id={`pref-${k}`}>{t(`prefs.${k}`)}</span>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={prefs[k]}
              aria-labelledby={`pref-${k}`}
              onClick={() => update.mutate({ ...prefs, [k]: !prefs[k] }, { onError: () => toast(t('saveFailed')) })}
            />
          </li>
        ))}
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
