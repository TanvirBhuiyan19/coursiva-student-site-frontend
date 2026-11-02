'use client';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { ApiError } from '@/lib/api/errors';
import { useFormat } from '@/lib/useFormat';
import { useAskTutor, useTutorThreadAction } from '../api';
import type { TutorState } from '../types';
import styles from './Tutor.module.css';

/**
 * The course's AI tutor (docs/ai-studio.md → learner API). Lazy-loaded when the learner opens it. It answers only from
 * the course material; when it says a question isn't covered and the school takes hand-offs, "Ask the team" sends the
 * thread to the school's inbox. 409 "The tutor is resting for this month." (the school's AI cap) and 429 (30 questions
 * an hour) are shown as they come.
 */
export default function TutorPanel({ courseSlug, lessonId, state }: { courseSlug: string; lessonId: string; state: TutorState }) {
  const t = useTranslations('tutor');
  const f = useFormat();
  const id = useId();
  const ask = useAskTutor(courseSlug);
  const action = useTutorThreadAction(courseSlug);
  const [threadId, setThreadId] = useState<string | null>(state.threads[0]?.id ?? null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Only the ask response says whether the material covered it: remember it for the thread's latest reply.
  const [lastAsk, setLastAsk] = useState<{ threadId: string; replyId: string; covered: boolean; canEscalate: boolean } | null>(null);
  const thread = state.threads.find((x) => x.id === threadId) ?? null;
  const notCovered = !!thread && lastAsk?.threadId === thread.id && !lastAsk.covered && thread.messages.at(-1)?.id === lastAsk.replyId;

  const explain = (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.isRateLimited) return t('rateLimited');
      if (err.isConflict && err.reason === 'tutor_resting') return t('resting');
      if (err.isValidation) return Object.values(err.fieldErrors)[0] ?? err.message;
      if (err.status < 500) return err.message;
    }
    return t('failed');
  };

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setError(null);
    ask.mutate(
      { text, lessonId, threadId },
      {
        onSuccess: (r) => {
          setDraft('');
          setThreadId(r.thread.id);
          setLastAsk({ threadId: r.thread.id, replyId: r.reply.id, covered: r.covered, canEscalate: r.canEscalate });
        },
        onError: (err) => setError(explain(err)),
      },
    );
  };

  const run = (kind: 'resolve' | 'escalate') => {
    if (!thread) return;
    setError(null);
    action.mutate(
      { threadId: thread.id, action: kind, text: kind === 'escalate' ? note.trim() : undefined },
      { onSuccess: () => setNote(''), onError: (err) => setError(explain(err)) },
    );
  };

  return (
    <div className={styles.panel}>
      <div className={styles.threads}>
        <button type="button" className="btn btn-outline btn-sm" aria-pressed={threadId === null} onClick={() => setThreadId(null)}>
          {t('newQuestion')}
        </button>
        {state.threads.length > 0 && (
          <ul className={styles.threadList} aria-label={t('threads')}>
            {state.threads.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  className={styles.threadBtn}
                  aria-current={x.id === threadId ? 'true' : undefined}
                  onClick={() => setThreadId(x.id)}
                >
                  <span className={styles.threadTitle}>{x.title}</span>
                  <span className={styles.threadStatus}>{t(`status.${x.status}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.chat}>
        {thread ? (
          <ol className={styles.messages} aria-live="polite" aria-label={thread.title}>
            {thread.messages.map((m) => (
              <li key={m.id} className={styles.message} data-role={m.role}>
                <span className={styles.who}>{m.role === 'tutor' ? t('tutor') : t('you')}</span>
                <p className={styles.text}>{m.text}</p>
                {m.createdAt && <span className={styles.when}>{f.ago(m.createdAt)}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.intro}>{t('intro')}</p>
        )}

        {thread && notCovered && (
          <div className={styles.handoff} role="status">
            <p>{lastAsk.canEscalate && state.handoff ? t('notCoveredHandoff') : t('notCovered')}</p>
            {lastAsk.canEscalate && state.handoff && thread.status !== 'escalated' && (
              <>
                <label className="field-label" htmlFor={`${id}-note`}>
                  {t('noteLabel')}
                </label>
                <textarea
                  id={`${id}-note`}
                  className="textarea"
                  rows={2}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button type="button" className="btn btn-primary btn-sm" disabled={action.isPending} onClick={() => run('escalate')}>
                  {t('askTeam')}
                </button>
              </>
            )}
          </div>
        )}
        {thread?.status === 'escalated' && (
          <p className="alert alert-ok" role="status">
            {t('escalated')}
          </p>
        )}
        {thread && thread.status === 'open' && (
          <button type="button" className="link-btn" disabled={action.isPending} onClick={() => run('resolve')}>
            {t('resolve')}
          </button>
        )}

        {error && (
          <p className="alert alert-bad" role="alert">
            {error}
          </p>
        )}
        <form className={styles.compose} onSubmit={submit}>
          <label className="sr-only" htmlFor={`${id}-q`}>
            {t('askLabel')}
          </label>
          <textarea
            id={`${id}-q`}
            className="textarea"
            rows={2}
            maxLength={2000}
            placeholder={thread ? t('followUpPlaceholder') : t('askPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={ask.isPending || !draft.trim()}>
            {ask.isPending ? t('thinking') : t('ask')}
          </button>
        </form>
        <p className={styles.disclaimer}>{t('disclaimer')}</p>
      </div>
    </div>
  );
}
