'use client';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { ApiError } from '@/lib/api/errors';
import { useSubmitForm } from '../api';
import type { FormField, FormSection } from '../types';
import styles from './Sections.module.css';

type Values = Record<string, string | boolean>;
type Problem = 'required' | 'email' | 'phone' | 'choice' | 'checkbox' | 'tooLong';

const MAX = { long_text: 5000, email: 254 } as Partial<Record<FormField['type'], number>>;

/** The same checks the API runs (docs/api/pages.md → POST /pages/{slug}/forms/{sectionId}), for instant feedback. */
export function checkField(f: FormField, value: string | boolean | undefined): Problem | null {
  if (f.type === 'checkbox') return f.required && value !== true ? 'checkbox' : null;
  const v = typeof value === 'string' ? value.trim() : '';
  if (v === '') return f.required ? 'required' : null;
  if (v.length > (MAX[f.type] ?? 500)) return 'tooLong';
  if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'email';
  if (f.type === 'phone' && !/^\+?[0-9 ().-]{5,30}$/.test(v)) return 'phone';
  if (f.type === 'choice' && f.options.length > 0 && !f.options.includes(v)) return 'choice';
  return null;
}

/**
 * A site-builder form. Posts `{ values, website }` to the section's `action`; field errors (ours, or the API's
 * `values.fN` 422 messages) appear under each field, and focus moves to the first one. The honeypot (`website`) is
 * hidden from people and assistive tech; bots that fill it get a quiet success.
 */
export function BuilderForm({ s, headingId }: { s: FormSection; headingId: string }) {
  const t = useTranslations('pages');
  const uid = useId();
  const [values, setValues] = useState<Values>({});
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const submit = useSubmitForm(s.action);
  const fieldId = (f: FormField) => `${uid}-${f.id}`;
  const max = (f: FormField) => MAX[f.type] ?? 500;

  const message = (f: FormField, p: Problem) => (p === 'tooLong' ? t('form.tooLong', { max: max(f) }) : t(`form.${p}`));

  const focusFirst = (errs: Record<string, string>) => {
    const first = s.fields.find((f) => errs[f.id]);
    if (first) document.getElementById(fieldId(first))?.focus();
  };

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    setFailure(null);
    const errs: Record<string, string> = {};
    for (const f of s.fields) {
      const p = checkField(f, values[f.id]);
      if (p) errs[f.id] = message(f, p);
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      focusFirst(errs);
      return;
    }
    const payload: Values = {};
    for (const f of s.fields) {
      const v = values[f.id];
      payload[f.id] = f.type === 'checkbox' ? v === true : typeof v === 'string' ? v.trim() : '';
    }
    submit.mutate(
      { values: payload, website: honeypot },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.isValidation) {
            const server: Record<string, string> = {};
            for (const [k, m] of Object.entries(err.fieldErrors)) if (k.startsWith('values.')) server[k.slice(7)] = m;
            setErrors(server);
            if (Object.keys(server).length) focusFirst(server);
            else setFailure(err.message);
          } else if (err instanceof ApiError && err.isRateLimited) setFailure(t('form.rateLimited'));
          else setFailure(t('form.failed'));
        },
      },
    );
  };

  if (submit.isSuccess) {
    return (
      <div className={styles.form}>
        {s.title !== '' && (
          <h2 id={headingId} className="h2" style={{ fontSize: 22 }}>
            {s.title}
          </h2>
        )}
        <p className="alert alert-ok" role="status" style={{ marginTop: 14 }}>
          {t('form.sent')}
        </p>
      </div>
    );
  }

  const set = (f: FormField, v: string | boolean) => {
    setValues((prev) => ({ ...prev, [f.id]: v }));
    if (errors[f.id]) setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== f.id)));
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-labelledby={s.title !== '' ? headingId : undefined}>
      {s.title !== '' && (
        <h2 id={headingId} className="h2" style={{ fontSize: 22 }}>
          {s.title}
        </h2>
      )}
      {s.subtitle !== '' && <p className={styles.formSub}>{s.subtitle}</p>}
      <div className={styles.fields}>
        {s.fields.map((f) => {
          const id = fieldId(f);
          const err = errors[f.id];
          const described = err ? `${id}-err` : undefined;
          const common = {
            id,
            name: f.id,
            required: f.required,
            'aria-invalid': err ? true : undefined,
            'aria-describedby': described,
          };
          const value = typeof values[f.id] === 'string' ? (values[f.id] as string) : '';
          const label = (
            <>
              {f.label}
              {f.required && <span aria-hidden="true"> *</span>}
            </>
          );
          return (
            <div key={f.id} className="field">
              {f.type === 'checkbox' ? (
                <label className="check" htmlFor={id}>
                  <input type="checkbox" {...common} checked={values[f.id] === true} onChange={(e) => set(f, e.target.checked)} />
                  <span>{label}</span>
                </label>
              ) : (
                <>
                  <label className="field-label" htmlFor={id}>
                    {label}
                  </label>
                  {f.type === 'long_text' ? (
                    <textarea className="textarea" {...common} maxLength={max(f)} value={value} onChange={(e) => set(f, e.target.value)} />
                  ) : f.type === 'choice' && f.options.length > 0 ? (
                    <select className="select" {...common} value={value} onChange={(e) => set(f, e.target.value)}>
                      <option value="">{t('form.choose')}</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input"
                      {...common}
                      type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'}
                      autoComplete={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : /\bname\b/i.test(f.label) ? 'name' : 'off'}
                      maxLength={max(f)}
                      value={value}
                      onChange={(e) => set(f, e.target.value)}
                    />
                  )}
                </>
              )}
              {err && (
                <p id={described} className="field-error">
                  {err}
                </p>
              )}
            </div>
          );
        })}
        {/* Honeypot: people never see or reach it; bots that fill it in are dropped by the API. */}
        <div className={styles.honeypot} aria-hidden="true">
          <label htmlFor={`${uid}-website`}>{t('form.honeypot')}</label>
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
      </div>
      {failure && (
        <p className="alert alert-bad" role="alert" style={{ marginTop: 14 }}>
          {failure}
        </p>
      )}
      <button type="submit" className={`btn btn-primary btn-block ${styles.submit}`} disabled={submit.isPending}>
        {submit.isPending ? t('form.sending') : s.submitLabel !== '' ? s.submitLabel : t('form.send')}
      </button>
      {s.note !== '' && <p className={styles.formNote}>{s.note}</p>}
      {s.captcha && <p className={styles.formNote}>{t('form.protected')}</p>}
    </form>
  );
}
