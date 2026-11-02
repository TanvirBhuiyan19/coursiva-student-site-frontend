'use client';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { useNewsletterSignup } from '@/features/account/api';
import { ApiError } from '@/lib/api/errors';
import styles from './Sections.module.css';

/** Newsletter signup (`POST /newsletter`). Placeholder and button label come from the builder (`''` → defaults). */
export function NewsletterForm({ placeholder, buttonLabel, onColour }: { placeholder: string; buttonLabel: string; onColour: boolean }) {
  const t = useTranslations('home');
  const id = useId();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const signup = useNewsletterSignup();

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('newsletterInvalid'));
      return;
    }
    signup.mutate(email.trim(), {
      onError: (err) => setError(err instanceof ApiError ? (err.fieldErrors.email ?? err.message) : t('newsletterFailed')),
    });
  };

  if (signup.isSuccess) {
    return (
      <p className={styles.nlDone} role="status">
        {signup.data.confirmationRequired ? t('newsletterConfirm') : t('newsletterDone')}
      </p>
    );
  }

  return (
    <form className={styles.nlForm} onSubmit={submit} noValidate>
      <label htmlFor={id} className="sr-only">
        {t('newsletterEmail')}
      </label>
      <input
        id={id}
        type="email"
        autoComplete="email"
        className={styles.nlInput}
        placeholder={placeholder !== '' ? placeholder : t('newsletterPlaceholder')}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(null);
        }}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      <button type="submit" className={`btn ${onColour ? 'btn-white' : 'btn-primary'}`} disabled={signup.isPending}>
        {buttonLabel !== '' ? buttonLabel : t('subscribe')}
      </button>
      {error && (
        <p id={`${id}-err`} className={styles.nlErr}>
          {error}
        </p>
      )}
    </form>
  );
}
