'use client';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { useNewsletterSignup } from '@/features/account/api';
import { ApiError } from '@/lib/api/errors';
import styles from './Sections.module.css';

export function NewsletterForm() {
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
        {t('newsletterDone')}
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
        placeholder={t('newsletterPlaceholder')}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError(null);
        }}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
      />
      <button type="submit" className="btn btn-primary" disabled={signup.isPending}>
        {t('subscribe')}
      </button>
      {error && (
        <p id={`${id}-err`} className={styles.nlErr}>
          {error}
        </p>
      )}
    </form>
  );
}
