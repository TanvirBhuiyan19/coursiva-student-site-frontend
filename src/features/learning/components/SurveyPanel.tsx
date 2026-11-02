'use client';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { ApiError } from '@/lib/api/errors';
import { useFormat } from '@/lib/useFormat';
import { useSubmitSurvey } from '../api';
import {
  draftFromResponse,
  emptyDraft,
  serverErrors,
  surveyInput,
  validateSurvey,
  type SurveyDraft,
  type SurveyFieldError,
} from '../survey';
import type { Lesson, SurveyBlock, SurveyField, SurveyResponse } from '../types';
import styles from './Survey.module.css';

/**
 * A Survey lesson (docs/api/learning.md → Survey lessons): the school's form under the lesson's intro, one input per
 * question type, and — once sent — the learner's answers. Sending completes the lesson under the `survey` rule; with
 * `allowResubmit` the learner may edit and send again. Lazy-loaded: only survey lessons pay for it.
 */
export default function SurveyPanel({ lesson }: { lesson: Lesson }) {
  const t = useTranslations('survey');
  const id = useId();
  const survey = lesson.survey!;
  const [editing, setEditing] = useState(() => survey.canSubmit && !survey.response);
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Nothing to answer and nothing answered (e.g. not enrolled): no panel.
  if (!survey.response && !survey.canSubmit) return null;
  const showForm = editing && survey.canSubmit;

  return (
    <section className={styles.wrap} aria-labelledby={`${id}-h`}>
      <div className={styles.head}>
        <p className="eyebrow eyebrow-brand">{t('eyebrow')}</p>
        <h2 id={`${id}-h`} ref={headingRef} className={styles.title} tabIndex={-1}>
          {survey.title}
        </h2>
      </div>
      {showForm ? (
        <SurveyForm
          lesson={lesson}
          survey={survey}
          onDone={(message) => {
            setEditing(false);
            setNotice(message);
            headingRef.current?.focus();
          }}
          onCancel={survey.response ? () => setEditing(false) : undefined}
        />
      ) : (
        survey.response && (
          <>
            {notice && (
              <p className="alert alert-ok" role="status">
                {notice}
              </p>
            )}
            <Answers response={survey.response} />
            {survey.allowResubmit && survey.canSubmit && (
              <button
                type="button"
                className="btn btn-outline"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  setNotice(null);
                  setEditing(true);
                }}
              >
                {t('edit')}
              </button>
            )}
          </>
        )
      )}
    </section>
  );
}

/** The learner's stored answers, read-only. */
function Answers({ response }: { response: SurveyResponse }) {
  const t = useTranslations('survey');
  const f = useFormat();
  const shown = (a: SurveyResponse['answers'][number]) =>
    a.value === null || a.value === ''
      ? t('noAnswer')
      : a.type === 'checkbox'
        ? a.value === true
          ? t('yes')
          : t('no')
        : a.type === 'rating' && typeof a.value === 'number'
          ? t('ratingOption', { n: a.value })
          : typeof a.value === 'number'
            ? f.number(a.value)
            : String(a.value);
  return (
    <div className={styles.card}>
      <h3 className={styles.subTitle}>{t('yourAnswers')}</h3>
      <p className={styles.muted}>{t('submittedAt', { when: f.dateTime(response.submittedAt) })}</p>
      <dl className={styles.answers}>
        {/* The stored snapshot, in form order, with the labels as they were when the learner answered. */}
        {response.answers.map((a) => (
          <div key={a.key} className={styles.answer}>
            <dt className={styles.answerLabel}>{a.label}</dt>
            <dd className={styles.answerValue} data-empty={a.value === null || a.value === '' || undefined}>
              {shown(a)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SurveyForm({
  lesson,
  survey,
  onDone,
  onCancel,
}: {
  lesson: Lesson;
  survey: SurveyBlock;
  onDone: (message: string | null) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations('survey');
  const id = useId();
  const toast = useToast();
  const submit = useSubmitSurvey(lesson.courseSlug, lesson.id);
  const [draft, setDraft] = useState<SurveyDraft[]>(() =>
    survey.response ? draftFromResponse(survey.fields, survey.response) : emptyDraft(survey.fields),
  );
  const [errors, setErrors] = useState<(string | null)[]>(() => survey.fields.map(() => null));
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const message = (e: SurveyFieldError) => (e.key === 'tooLong' ? t('errors.tooLong', { max: e.max ?? 0 }) : t(`errors.${e.key}`));

  const focusFirstError = (list: (string | null)[]) => {
    const i = list.findIndex((e) => e !== null);
    if (i < 0) return;
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-q="${i}"] :is(input, textarea)`)?.focus());
  };

  const set = (i: number, value: SurveyDraft) => {
    setDraft((d) => d.map((x, j) => (j === i ? value : x)));
    setErrors((e) => (e[i] ? e.map((x, j) => (j === i ? null : x)) : e));
    setFormError(null);
  };

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    const check = validateSurvey(survey.fields, draft);
    const list = check.errors.map((x) => (x ? message(x) : null));
    setErrors(list);
    if (!check.ok) {
      setFormError(list.some((x) => x !== null) ? t('fixErrors') : t('errors.answerOne'));
      focusFirstError(list);
      return;
    }
    setFormError(null);
    submit.mutate(surveyInput(survey.fields, draft), {
      onSuccess: () => {
        toast(t('sent', { title: survey.title }));
        onDone(t('thanks'));
      },
      onError: (err) => {
        if (err instanceof ApiError && err.isValidation) {
          const mapped = serverErrors(survey.fields, err.fieldErrors);
          setErrors(mapped.perField);
          setFormError(mapped.form ?? (mapped.perField.some((x) => x !== null) ? t('fixErrors') : err.message));
          focusFirstError(mapped.perField);
        } else if (err instanceof ApiError && err.isConflict) {
          // Already answered (another tab): the lesson is reloaded by the mutation — show the stored answers.
          onDone(err.message);
        } else {
          setFormError(err instanceof ApiError && err.status < 500 ? err.message : t('failed'));
        }
      },
    });
  };

  const hasRequired = survey.fields.some((f) => f.required);
  return (
    <form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate aria-describedby={formError ? `${id}-err` : undefined}>
      {hasRequired && (
        <p className={styles.muted} aria-hidden="true">
          {t('requiredHint')}
        </p>
      )}
      {survey.fields.map((f, i) => (
        <div key={f.key} data-q={i}>
          <Question field={f} value={draft[i] ?? null} error={errors[i] ?? null} onChange={(v) => set(i, v)} />
        </div>
      ))}
      {formError && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {formError}
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className="btn btn-primary" disabled={submit.isPending}>
          {submit.isPending ? t('sending') : survey.response ? t('update') : t('send')}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={submit.isPending}>
            {t('cancel')}
          </button>
        )}
      </div>
    </form>
  );
}

/** The question's label with its required marker (a visible "*", read out as "(required)"). */
function Label({ field }: { field: SurveyField }) {
  const t = useTranslations('survey');
  return (
    <>
      {field.label}
      {field.required && (
        <>
          <span className={styles.req} aria-hidden="true">
            {' *'}
          </span>
          <span className="sr-only"> {t('requiredMark')}</span>
        </>
      )}
    </>
  );
}

/** One question's input, by type. */
function Question({
  field: f,
  value,
  error,
  onChange,
}: {
  field: SurveyField;
  value: SurveyDraft;
  error: string | null;
  onChange: (v: SurveyDraft) => void;
}) {
  const t = useTranslations('survey');
  const id = useId();
  const errId = `${id}-err`;
  const err = error && (
    <p id={errId} className="field-error">
      {error}
    </p>
  );
  const invalid = error ? true : undefined;
  const describedBy = error ? errId : undefined;

  if (f.type === 'choice' || f.type === 'rating') {
    const options = f.type === 'rating' ? [1, 2, 3, 4, 5] : f.options;
    return (
      // A native group named by its legend; `radiogroup` so it can carry the required / invalid state.
      <fieldset
        role="radiogroup"
        className={styles.group}
        aria-invalid={invalid}
        aria-describedby={[f.type === 'rating' ? `${id}-scale` : null, describedBy].filter(Boolean).join(' ') || undefined}
        aria-required={f.required || undefined}
      >
        <legend className="field-label">
          <Label field={f} />
        </legend>
        {f.type === 'rating' && (
          <p id={`${id}-scale`} className="field-hint">
            {t('ratingScale')}
          </p>
        )}
        <div className={f.type === 'rating' ? styles.rating : styles.options}>
          {options.map((o, oi) =>
            f.type === 'rating' ? (
              <label key={o} className={styles.star}>
                <input type="radio" className="sr-only" name={id} checked={value === o} onChange={() => onChange(o)} />
                <span aria-hidden="true">{o}</span>
                <span className="sr-only">{t('ratingOption', { n: o as number })}</span>
              </label>
            ) : (
              <label key={`${oi}-${o}`} className="option">
                <input type="radio" className="sr-only" name={id} value={o} checked={value === o} onChange={() => onChange(o)} />
                <span className="radio-dot" aria-hidden="true" />
                <span style={{ fontSize: 14 }}>{o}</span>
              </label>
            ),
          )}
        </div>
        {err}
      </fieldset>
    );
  }

  if (f.type === 'checkbox')
    return (
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={value === true}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            aria-required={f.required || undefined}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>
            <Label field={f} />
          </span>
        </label>
        {err}
      </div>
    );

  const common = {
    id: `${id}-in`,
    value: typeof value === 'string' ? value : '',
    'aria-invalid': invalid,
    'aria-describedby': describedBy,
    'aria-required': f.required || undefined,
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-in`}>
        <Label field={f} />
      </label>
      {f.type === 'long_text' ? (
        <textarea {...common} className="textarea" rows={4} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          {...common}
          className="input"
          type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : 'text'}
          step={f.type === 'number' ? 'any' : undefined}
          autoComplete={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'off'}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {err}
    </div>
  );
}
