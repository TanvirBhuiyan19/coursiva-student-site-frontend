'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api/errors';
import { useFormat } from '@/lib/useFormat';
import { uploadFile, type UploadTask } from '../api';
import { acceptAttribute, checkFile, type Problem } from '../logic';
import type { LeadField } from '../types';
import styles from './LeadForm.module.css';

type State =
  | { status: 'idle' }
  | { status: 'uploading'; name: string; size: number; progress: number }
  | { status: 'done'; name: string; size: number };

/**
 * A file field: the file uploads as soon as it is chosen (`POST /forms/{id}/uploads`) and the field's value becomes
 * the returned upload id. Shows the name, size and progress, and can remove it (an unused upload is pruned by the
 * API after a day). When the form clears the value (the API asked for the file again) it shows the picker again, and
 * when it unmounts (its `show_if` stopped applying) it drops its upload, so a field shown again starts empty.
 */
export function FileField({
  formId,
  token,
  field,
  id,
  label,
  describedBy,
  invalid,
  value,
  onValue,
  onError,
  onBusy,
  problemText,
}: {
  formId: string;
  token: string;
  field: LeadField;
  id: string;
  label: ReactNode;
  describedBy: string | undefined;
  invalid: boolean;
  /** The field's current value (the upload id), or '' / undefined. */
  value: string | undefined;
  onValue: (uploadId: string) => void;
  onError: (message: string | null) => void;
  onBusy: (busy: boolean) => void;
  problemText: (p: Problem) => string;
}) {
  const t = useTranslations('forms');
  const { bytes } = useFormat();
  const [stored, setState] = useState<State>({ status: 'idle' });
  // The form cleared the value (the API refused the upload): back to the picker, keeping the field's error.
  const state: State = !value && stored.status === 'done' ? { status: 'idle' } : stored;
  const task = useRef<UploadTask | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const latest = useRef({ onValue, onBusy });
  useEffect(() => {
    latest.current = { onValue, onBusy };
  });
  useEffect(
    () => () => {
      task.current?.abort();
      latest.current.onValue('');
      latest.current.onBusy(false);
    },
    [],
  );

  const reset = () => {
    task.current?.abort();
    task.current = null;
    setState({ status: 'idle' });
    onValue('');
    onBusy(false);
    if (input.current) input.current.value = '';
  };

  const choose = (file: File | undefined) => {
    task.current?.abort();
    onValue('');
    if (!file) {
      reset();
      return;
    }
    const problem = checkFile(field, file);
    if (problem) {
      onError(problemText(problem));
      setState({ status: 'idle' });
      if (input.current) input.current.value = '';
      return;
    }
    onError(null);
    onBusy(true);
    setState({ status: 'uploading', name: file.name, size: file.size, progress: 0 });
    const current = uploadFile(formId, { token, field: field.key, file }, (progress) => {
      setState((s) => (s.status === 'uploading' ? { ...s, progress } : s));
    });
    task.current = current;
    current.done.then(
      (upload) => {
        if (task.current !== current) return;
        task.current = null;
        setState({ status: 'done', name: upload.name, size: upload.sizeBytes });
        onValue(upload.id);
        onBusy(false);
      },
      (err: unknown) => {
        if (task.current !== current) return;
        task.current = null;
        onBusy(false);
        setState({ status: 'idle' });
        if (input.current) input.current.value = '';
        if (err instanceof ApiError && err.code === 'aborted') return;
        const message =
          err instanceof ApiError && err.isValidation
            ? (err.fieldErrors.file ?? err.fieldErrors.field ?? err.fieldErrors.token ?? err.message)
            : err instanceof ApiError && err.isRateLimited
              ? t('rateLimited')
              : t('uploadFailed');
        onError(message);
      },
    );
  };

  return (
    <>
      {/* Once a file is chosen the control is its remove button, which keeps its own name: no <label> then. */}
      {state.status === 'idle' ? (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      {state.status === 'idle' ? (
        <input
          ref={input}
          id={id}
          name={`values[${field.key}]`}
          type="file"
          className={`input ${styles.fileInput}`}
          accept={acceptAttribute(field.file?.accept ?? ['pdf', 'image', 'document'])}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => choose(e.target.files?.[0])}
        />
      ) : (
        <div className={styles.file} aria-describedby={describedBy}>
          <div className={styles.fileMeta}>
            <span className={styles.fileName}>{state.name}</span>
            <span className={styles.fileSize}>{bytes(state.size)}</span>
          </div>
          {state.status === 'uploading' ? (
            <div
              className="progress"
              role="progressbar"
              aria-label={t('uploading', { name: state.name })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(state.progress * 100)}
            >
              <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
            </div>
          ) : (
            <span className={styles.fileDone} role="status">
              {t('uploaded')}
            </span>
          )}
          <button type="button" id={id} className="btn btn-outline btn-sm" onClick={reset}>
            {state.status === 'uploading' ? t('cancelUpload', { name: state.name }) : t('removeFile', { name: state.name })}
          </button>
        </div>
      )}
      <p className="field-hint">
        {t('fileHint', {
          types: (field.file?.accept ?? []).map((k) => t(`kinds.${k}`)).join(', '),
          max: field.file?.maxMb ?? 10,
        })}
      </p>
    </>
  );
}
