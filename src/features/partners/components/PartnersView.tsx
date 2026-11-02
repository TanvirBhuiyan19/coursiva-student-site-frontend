'use client';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { ApiError } from '@/lib/api/errors';
import { useFormat } from '@/lib/useFormat';
import { useApplyAsPartner, usePartnerProgram } from '../api';
import styles from './Partners.module.css';

/**
 * `/partners` (the partner invite e-mail's "Apply now"): the program's terms from the API and the application form.
 * Approved partners share `/?ref=<slug>` links; the site credits them at checkout (features/analytics/referral).
 */
export function PartnersView() {
  const t = useTranslations('partners');
  const tc = useTranslations('common');
  const f = useFormat();
  const id = useId();
  const { data: p, isPending, isError, refetch } = usePartnerProgram();
  const apply = useApplyAsPartner();
  const [form, setForm] = useState({ name: '', email: '', pitch: '' });
  const [errors, setErrors] = useState<Partial<Record<'name' | 'email' | 'pitch' | 'form', string>>>({});

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const found: typeof errors = {};
    if (form.name.trim().length < 2) found.name = t('errName');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) found.email = t('errEmail');
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setErrors({});
    apply.mutate(
      { name: form.name.trim(), email: form.email.trim(), pitch: form.pitch.trim() },
      {
        onError: (err) =>
          setErrors(
            err instanceof ApiError && err.isValidation
              ? { ...err.fieldErrors, form: Object.values(err.fieldErrors)[0] }
              : { form: t('errGeneric') },
          ),
      },
    );
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.hero}>
        <h1 className="h1">{t('title')}</h1>
        <p className="lead">
          {!p
            ? t('leadLoading')
            : p.commissionType === 'fixed' && p.fixedAmount
              ? t('leadFixed', { school: p.school, amount: f.money(p.fixedAmount) })
              : t('lead', { school: p.school, rate: p.rate })}
        </p>
      </header>
      {isPending ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : isError ? (
        <div className="alert alert-bad" role="alert">
          {tc('errorBody')}{' '}
          <button type="button" className="link-btn" onClick={() => void refetch()}>
            {tc('retry')}
          </button>
        </div>
      ) : (
        <dl className={styles.terms}>
          <div>
            <dt>{t('commission')}</dt>
            <dd>
              {p.commissionType === 'fixed' && p.fixedAmount
                ? t('fixedRate', { amount: f.money(p.fixedAmount) })
                : t('rate', { rate: p.rate })}
            </dd>
          </div>
          <div>
            <dt>{t('cookie')}</dt>
            <dd>{p.cookieDays > 0 ? t('days', { days: p.cookieDays }) : t('daysForever')}</dd>
          </div>
          <div>
            <dt>{t('payout')}</dt>
            <dd>{t('minPayout', { amount: f.money(p.minPayout), days: p.refundHoldDays })}</dd>
          </div>
          <div>
            <dt>{t('recurringTitle')}</dt>
            <dd>
              {!p.recurring
                ? t('recurringNo')
                : p.recurringMonths > 0
                  ? t('recurringYes', { months: p.recurringMonths })
                  : t('recurringForever')}
            </dd>
          </div>
        </dl>
      )}
      {p?.tiers && p.commissionType !== 'fixed' && (
        <section aria-labelledby={`${id}-tiers`}>
          <h2 id={`${id}-tiers`} className="h3">
            {t('tiers')}
          </h2>
          <ul className={styles.tiers}>
            {p.tiers.map((tier) => (
              <li key={tier.name}>
                <b>{tier.name}</b> · {t('rate', { rate: tier.rate })}
                <span className={styles.rule}>{tier.rule}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {p && p.assets.length > 0 && (
        <section aria-labelledby={`${id}-assets`}>
          <h2 id={`${id}-assets`} className="h3">
            {t('assetsTitle')}
          </h2>
          <p className="muted">{t('assetsLead')}</p>
          <ul className={styles.tiers}>
            {p.assets.map((a) => (
              <li key={a.id}>
                <a href={a.url} aria-label={t('download', { name: a.name })} rel="nofollow">
                  <b>{a.name}</b>
                </a>
                <span className={styles.rule}>{a.meta}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={styles.apply} aria-labelledby={`${id}-apply`}>
        <h2 id={`${id}-apply`} className="h3">
          {t('applyTitle')}
        </h2>
        {apply.isSuccess ? (
          <p className="alert alert-ok" role="status">
            {apply.data.status === 'active' ? t('approved', { link: `${window.location.origin}${apply.data.link ?? '/'}` }) : t('received')}
          </p>
        ) : (
          <form onSubmit={submit} noValidate className={styles.form}>
            {errors.form && (
              <p className="alert alert-bad" role="alert">
                {errors.form}
              </p>
            )}
            <div className="field">
              <label className="field-label" htmlFor={`${id}-name`}>
                {t('name')}
              </label>
              <input
                id={`${id}-name`}
                className="input"
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                aria-invalid={!!errors.name}
              />
              {errors.name && <p className="field-error">{errors.name}</p>}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-email`}>
                {t('email')}
              </label>
              <input
                id={`${id}-email`}
                className="input"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                aria-invalid={!!errors.email}
              />
              {errors.email && <p className="field-error">{errors.email}</p>}
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-pitch`}>
                {t('pitch')}
              </label>
              <textarea
                id={`${id}-pitch`}
                className="textarea"
                rows={3}
                maxLength={1000}
                value={form.pitch}
                onChange={(e) => setForm({ ...form, pitch: e.target.value })}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg" disabled={apply.isPending}>
              {t('applyCta')}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
