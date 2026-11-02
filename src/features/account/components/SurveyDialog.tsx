'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useLocalizedRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useAnswerSurvey, useSurvey } from '../api';
import styles from './Profile.module.css';

/**
 * The school's one-question survey, opened from its e-mail (`/account?survey={id}`): a native modal dialog with an
 * optional 0–10 score and a written answer. Closing it drops the query parameter.
 */
export function SurveyDialog({ surveyId }: { surveyId: string }) {
  const t = useTranslations('account');
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const router = useLocalizedRouter();
  const { data: survey, isError } = useSurvey(surveyId);
  const answer = useAnswerSurvey(surveyId);
  const [score, setScore] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => router.replace(routes.account);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (score === null && !text.trim()) {
      setError(t('surveyEmpty'));
      return;
    }
    setError(null);
    answer.mutate(
      { score, text: text.trim() },
      { onError: (err) => setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : t('surveyError')) },
    );
  };

  const done = answer.isSuccess || survey?.answered;

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={`${id}-t`} onClose={close}>
      <h2 id={`${id}-t`} className={styles.title}>
        {t('surveyTitle')}
      </h2>
      {isError ? (
        <p className="alert alert-bad" role="alert">
          {t('surveyMissing')}
        </p>
      ) : !survey ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : done ? (
        <p className="alert alert-ok" role="status">
          {t('surveyThanks')}
        </p>
      ) : (
        <form onSubmit={submit} noValidate className={styles.dialogForm}>
          <p className={styles.strong}>{survey.question}</p>
          <fieldset className={styles.scores}>
            <legend className="field-label">{t('surveyScore')}</legend>
            {Array.from({ length: 11 }, (_, n) => (
              <label key={n} className={styles.score}>
                <input type="radio" className="sr-only" name={`${id}-score`} checked={score === n} onChange={() => setScore(n)} />
                <span aria-hidden="true">{n}</span>
                <span className="sr-only">{t('surveyScoreLabel', { n })}</span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-text`}>
              {t('surveyAnswer')}
            </label>
            <textarea
              id={`${id}-text`}
              className="textarea"
              rows={3}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={answer.isPending}>
            {t('surveySend')}
          </button>
        </form>
      )}
      <button type="button" className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => ref.current?.close()}>
        {t('surveyClose')}
      </button>
    </dialog>
  );
}
