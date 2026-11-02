'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { conversionSignal } from '@/features/consent/tracking';
import { ApiError } from '@/lib/api/errors';
import { recordView, submitForm, usePublicForm } from '../api';
import {
  buildSubmissionBody,
  checkAll,
  checkValue,
  prefillAll,
  safeRedirect,
  visibleKeys,
  wireValues,
  type PrefillContext,
  type Problem,
} from '../logic';
import type { LeadField, LeadValues, PublicForm, SubmissionResult } from '../types';
import { FileField } from './FileField';
import { TurnstileWidget } from './Turnstile';
import styles from './LeadForm.module.css';

/** The browser event other code (ad pixels) listens to: one per stored submission. */
export const LEAD_EVENT = 'coursiva:lead';

/** The hosted page's (and a site-builder section's) context: this page's URL, query and referrer. */
export function pageContext(): PrefillContext {
  return { params: new URLSearchParams(window.location.search), pageUrl: window.location.href, referrer: document.referrer };
}

export interface LeadFormProps {
  formId: string;
  /** `page`: the hosted page (h1) · `section`: inline in a site-builder page · `embed`: the embed frame. */
  variant: 'page' | 'section' | 'embed';
  /** A site-builder section's own title and subtitle, shown instead of the form's (`''` → the form's). */
  heading?: { title: string; subtitle: string };
  /** A site-builder section's alignment (centres the card). */
  align?: 'left' | 'center';
  /** Where hidden fields take their values (default: this page). Called in the browser only. */
  getContext?: () => PrefillContext;
  /** After a stored or honeypot-answered submission. */
  onSubmitted?: (result: SubmissionResult, form: PublicForm) => void;
  /** Follows the form's redirect (http/https only). Default: this window. The embed asks its parent page instead. */
  redirect?: (url: string) => void;
}

/**
 * A school's lead form (docs/api/forms.md): loads the form and its token, counts one view per mount, renders every
 * field type with live conditional logic, checks answers as the API does, uploads files as they are chosen, and
 * submits — then shows the success message or follows the redirect, and tells the page (`coursiva:lead`).
 */
export function LeadForm(props: LeadFormProps) {
  const t = useTranslations('forms');
  const query = usePublicForm(props.formId);
  const viewed = useRef(false);

  const form = query.data;
  useEffect(() => {
    if (!form || viewed.current) return;
    viewed.current = true;
    void recordView(form.id, form.token);
  }, [form]);

  if (query.isPending)
    return (
      <div className={styles.card} data-variant={props.variant} data-align={props.align} aria-busy="true" aria-label={t('loading')}>
        <div className="skeleton" style={{ height: 28, width: '60%' }} />
        <div className="skeleton" style={{ height: 44, marginTop: 22 }} />
        <div className="skeleton" style={{ height: 44, marginTop: 14 }} />
        <div className="skeleton" style={{ height: 44, marginTop: 14 }} />
      </div>
    );

  if (query.isError || !form) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className={styles.card} data-variant={props.variant} data-align={props.align}>
        <p className="alert alert-bad" role="alert">
          {missing ? t('notFound') : t('loadFailed')}
        </p>
        {!missing && (
          <button type="button" className={`btn btn-outline btn-sm ${styles.retry}`} onClick={() => void query.refetch()}>
            {t('retry')}
          </button>
        )}
      </div>
    );
  }

  return <LoadedForm {...props} form={form} />;
}

function LoadedForm({
  form,
  variant,
  align,
  heading,
  getContext = pageContext,
  onSubmitted,
  redirect,
}: LeadFormProps & { form: PublicForm }) {
  const t = useTranslations('forms');
  const uid = useId();
  const [values, setValues] = useState<LeadValues>({});
  const [hidden] = useState(() => prefillAll(form.fields, getContext()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [turnstileRun, setTurnstileRun] = useState(0);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const failureRef = useRef<HTMLParagraphElement>(null);

  const all: LeadValues = { ...values, ...hidden };
  const shown = visibleKeys(form.fields, all);
  const fieldId = (i: number) => `${uid}-f${i}`;
  const problemText = (p: Problem) => t(`errors.${p.code}`, p.params);
  const title = heading?.title || form.title;
  const subtitle = heading?.subtitle || form.description;
  const headingId = `${uid}-title`;
  const Heading = variant === 'page' ? 'h1' : 'h2';

  const focusFirst = (errs: Record<string, string>) => {
    const i = form.fields.findIndex((f) => errs[f.key] !== undefined);
    if (i >= 0) document.getElementById(fieldId(i))?.focus();
  };

  const setError = (key: string, message: string | null) =>
    setErrors((prev) =>
      message === null ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)) : { ...prev, [key]: message },
    );

  const set = (f: LeadField, v: string | boolean) => {
    setValues((prev) => ({ ...prev, [f.key]: v }));
    if (errors[f.key] !== undefined) setError(f.key, null);
  };

  /** Re-checks a field when the visitor leaves it (only once it has a value, so tabbing through stays quiet). */
  const blurCheck = (f: LeadField) => {
    const v = all[f.key];
    if (v === undefined || v === '') return;
    const p = checkValue(f, v);
    setError(f.key, p ? problemText(p) : null);
  };

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (pending) return;
    setFailure(null);
    if (Object.values(uploading).some(Boolean)) {
      setFailure(t('waitForUploads'));
      return;
    }
    const errs: Record<string, string> = {};
    for (const [key, p] of checkAll(form.fields, all)) errs[key] = problemText(p);
    setErrors(errs);
    const needsTurnstile = form.turnstileSiteKey !== null && !turnstileToken;
    setTurnstileError(needsTurnstile ? t('errors.turnstile') : null);
    if (Object.keys(errs).length) {
      focusFirst(errs);
      return;
    }
    if (needsTurnstile) return;
    setPending(true);
    const body = buildSubmissionBody({
      token: form.token,
      values: wireValues(form.fields, all),
      website: honeypot,
      turnstileToken: form.turnstileSiteKey ? turnstileToken : null,
      ...submissionPage(getContext()),
    });
    // What the API may use for a server-side lead conversion (docs/consent.md); the browser Lead event follows LEAD_EVENT.
    const tracking = conversionSignal();
    if (tracking) body.tracking = tracking;
    submitForm(form.id, body).then(
      (r) => {
        setPending(false);
        setResult(r);
        // A submission held for double opt-in isn't a lead yet: the server sends its Lead once the contact confirms.
        if (r.submissionId !== null && !r.confirmationRequired)
          window.dispatchEvent(new CustomEvent(LEAD_EVENT, { detail: { form_id: form.id, submission_id: r.submissionId } }));
        onSubmitted?.(r, form);
        const to = safeRedirect(r);
        if (to) (redirect ?? ((url: string) => window.location.assign(url)))(to);
      },
      (err: unknown) => {
        setPending(false);
        showError(err);
      },
    );
  };

  const showError = (err: unknown) => {
    if (!(err instanceof ApiError)) {
      setFailure(t('failed'));
      return;
    }
    if (err.isValidation) {
      const fieldErrs: Record<string, string> = {};
      let general: string | null = null;
      // Only a field the visitor can see shows its error; one on a hidden field (or one the API decided applies when
      // this page doesn't) goes to the alert above the button, so it is never lost.
      const visible = (key: string) => form.fields.some((f) => f.key === key && f.type !== 'hidden' && shown.has(key));
      for (const [k, m] of Object.entries(err.fieldErrors)) {
        if (k.startsWith('values.') && visible(k.slice(7))) fieldErrs[k.slice(7)] = m;
        else if (k === 'turnstile_token') {
          setTurnstileError(m);
          setTurnstileToken(null);
          setTurnstileRun((n) => n + 1);
        } else {
          // Named, so the visitor knows which answer the message is about.
          const label = k.startsWith('values.') ? form.fields.find((f) => f.key === k.slice(7))?.label : undefined;
          general ??= label ? `${label}: ${m}` : m;
        }
      }
      setErrors(fieldErrs);
      // A refused upload ("Upload the file again."): its field goes back to the picker.
      const refused = form.fields.filter((f) => f.type === 'file' && fieldErrs[f.key] !== undefined).map((f) => f.key);
      if (refused.length) setValues((prev) => ({ ...prev, ...Object.fromEntries(refused.map((k) => [k, ''])) }));
      if (Object.keys(fieldErrs).length) focusFirst(fieldErrs);
      if (general !== null || (!Object.keys(fieldErrs).length && err.fieldErrors.turnstile_token === undefined))
        // Focus stays on the first invalid field: moving it to the alert would blur that field, whose local re-check
        // would clear the server's error for it.
        reportFailure(general ?? err.message, Object.keys(fieldErrs).length === 0);
      // A failed submission spends the Turnstile token either way: get a fresh one.
      if (form.turnstileSiteKey && err.fieldErrors.turnstile_token === undefined) {
        setTurnstileToken(null);
        setTurnstileRun((n) => n + 1);
      }
      return;
    }
    if (err.isRateLimited) reportFailure(t('rateLimited'));
    else if (err.status === 404) reportFailure(err.message);
    else reportFailure(t('failed'));
  };

  const reportFailure = (message: string, focus = true) => {
    setFailure(message);
    if (focus) requestAnimationFrame(() => failureRef.current?.focus());
  };

  const headingEl = title !== '' && (
    <Heading id={headingId} className={`h2 ${styles.title}`}>
      {title}
    </Heading>
  );

  if (result) {
    return (
      <div className={styles.card} data-variant={variant} data-align={align}>
        {headingEl}
        <p className={`alert alert-ok ${styles.success}`} role="status">
          {result.successMessage || t('success')}
        </p>
      </div>
    );
  }

  return (
    <form
      className={styles.card}
      data-variant={variant}
      data-align={align}
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={title !== '' ? headingId : undefined}
      aria-label={title === '' ? form.name || t('formLabel') : undefined}
    >
      {headingEl}
      {subtitle !== '' && <p className={styles.subtitle}>{subtitle}</p>}
      <div className={styles.fields}>
        {form.fields.map((f, i) => {
          if (f.type === 'hidden' || !shown.has(f.key)) return null;
          const id = fieldId(i);
          const err = errors[f.key];
          const helpId = f.help !== '' ? `${id}-help` : undefined;
          const errId = err !== undefined ? `${id}-err` : undefined;
          const describedBy = [helpId, errId].filter(Boolean).join(' ') || undefined;
          return (
            <div key={f.key} className="field" data-field={f.key}>
              <FieldControl
                form={form}
                field={f}
                id={id}
                value={values[f.key]}
                invalid={err !== undefined}
                describedBy={describedBy}
                onChange={(v) => set(f, v)}
                onBlur={() => blurCheck(f)}
                onFileError={(m) => setError(f.key, m)}
                onFileBusy={(busy) => setUploading((prev) => ({ ...prev, [f.key]: busy }))}
                problemText={problemText}
              />
              {helpId && (
                <p id={helpId} className="field-hint">
                  {f.help}
                </p>
              )}
              {errId && (
                <p id={errId} className="field-error">
                  {err}
                </p>
              )}
            </div>
          );
        })}
        {/* Honeypot: people never see or reach it; the API quietly drops submissions that fill it in. */}
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
        {form.turnstileSiteKey && (
          <TurnstileWidget
            key={turnstileRun}
            siteKey={form.turnstileSiteKey}
            errorId={`${uid}-turnstile-err`}
            error={turnstileError ?? undefined}
            onToken={(token) => {
              setTurnstileToken(token);
              if (token) setTurnstileError(null);
            }}
          />
        )}
      </div>
      {failure && (
        <p ref={failureRef} tabIndex={-1} className={`alert alert-bad ${styles.failure}`} role="alert">
          {failure}
        </p>
      )}
      <button type="submit" className={`btn btn-primary btn-block ${styles.submit}`} disabled={pending} aria-busy={pending || undefined}>
        {pending ? t('sending') : form.submitLabel || t('submit')}
      </button>
    </form>
  );
}

/** `page_url` and `referrer` of the submission: the page the visitor is on (in the embed, the embedding page). */
function submissionPage(ctx: PrefillContext): { pageUrl: string; referrer: string } {
  return { pageUrl: ctx.pageUrl.slice(0, 500), referrer: ctx.referrer.slice(0, 500) };
}

function FieldControl({
  form,
  field: f,
  id,
  value,
  invalid,
  describedBy,
  onChange,
  onBlur,
  onFileError,
  onFileBusy,
  problemText,
}: {
  form: PublicForm;
  field: LeadField;
  id: string;
  value: LeadValues[string];
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (v: string | boolean) => void;
  onBlur: () => void;
  onFileError: (message: string | null) => void;
  onFileBusy: (busy: boolean) => void;
  problemText: (p: Problem) => string;
}) {
  const t = useTranslations('forms');
  const text = typeof value === 'string' ? value : '';
  const label: ReactNode = (
    <>
      {f.label}
      {f.required && <span aria-hidden="true"> *</span>}
    </>
  );
  const common = {
    id,
    // Namespaced: a field may be keyed `website`, the honeypot's name.
    name: `values[${f.key}]`,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    'aria-required': f.required || undefined,
    onBlur,
  };

  switch (f.type) {
    case 'checkbox':
    case 'consent':
      return (
        <label className="check" htmlFor={id}>
          <input type="checkbox" {...common} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span>
            {f.type === 'consent' && f.consent && f.consent.text !== '' ? f.consent.text : f.label}
            {f.required && <span aria-hidden="true"> *</span>}
          </span>
        </label>
      );
    case 'rating':
      return (
        <fieldset className={styles.rating} aria-describedby={describedBy}>
          <legend className="field-label">{label}</legend>
          <div className={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={styles.star} data-on={Number(text) >= n || undefined}>
                <input
                  type="radio"
                  id={n === 1 ? id : `${id}-${n}`}
                  name={`values[${f.key}]`}
                  value={String(n)}
                  checked={text === String(n)}
                  onChange={() => onChange(String(n))}
                  className="sr-only"
                />
                <span aria-hidden="true">★</span>
                <span className="sr-only">{t('ratingOption', { n })}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    case 'file':
      return (
        <FileField
          formId={form.id}
          token={form.token}
          field={f}
          id={id}
          label={label}
          describedBy={describedBy}
          invalid={invalid}
          value={typeof value === 'string' ? value : undefined}
          onValue={onChange}
          onError={onFileError}
          onBusy={onFileBusy}
          problemText={problemText}
        />
      );
    default:
      break;
  }

  return (
    <>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {f.type === 'long_text' ? (
        <textarea
          className="textarea"
          {...common}
          placeholder={f.placeholder || undefined}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : f.type === 'choice' ? (
        <select className="select" {...common} value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.placeholder || t('choose')}</option>
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
          type={INPUT_TYPES[f.type] ?? 'text'}
          inputMode={f.type === 'number' ? 'decimal' : undefined}
          autoComplete={autoComplete(f)}
          placeholder={f.placeholder || undefined}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </>
  );
}

const INPUT_TYPES: Partial<Record<LeadField['type'], string>> = { email: 'email', phone: 'tel', url: 'url', date: 'date' };

function autoComplete(f: LeadField): string {
  if (f.type === 'email') return 'email';
  if (f.type === 'phone') return 'tel';
  if (f.type === 'url') return 'url';
  if (/^(full_?)?name$/i.test(f.key)) return 'name';
  if (/^first_?name$/i.test(f.key)) return 'given-name';
  if (/^last_?name$/i.test(f.key)) return 'family-name';
  return 'off';
}
