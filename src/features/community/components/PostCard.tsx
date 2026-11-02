'use client';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { Link, useAppPathname } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useCreateReply, useFlagPost, useReplies, useToggleLike } from '../api';
import { FLAG_REASONS, type FlagReason, type Post } from '../types';
import styles from './Community.module.css';

const messageOf = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : fallback;

/** One post in the feed: like, the reply thread (opened on demand) and "Report" for signed-in members. */
export function PostCard({ post: p }: { post: Post }) {
  const t = useTranslations('community');
  const f = useFormat();
  const toast = useToast();
  const { user } = useSession();
  const like = useToggleLike();
  const threadId = useId();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  return (
    <article className={styles.post} aria-labelledby={`post-${p.id}`}>
      <header className={styles.postHead}>
        <span className="avatar" style={{ width: 36, height: 36, fontSize: 12.5, background: p.author.color }} aria-hidden="true">
          {p.author.initials}
        </span>
        <div>
          <p id={`post-${p.id}`} className={styles.author}>
            {p.author.name} {p.author.isInstructor && <span className={styles.coach}>{t('coach')}</span>}
          </p>
          <p className={styles.postMeta}>
            <time dateTime={p.createdAt}>{f.ago(p.createdAt)}</time> · {p.spaceName}
          </p>
        </div>
      </header>
      <p className={styles.body}>{p.body}</p>
      <footer className={styles.postFoot}>
        <button
          type="button"
          className={styles.like}
          aria-pressed={p.liked}
          aria-label={t('likeLabel', { count: p.likes })}
          onClick={() => (user ? like.mutate({ postId: p.id, liked: !p.liked }) : toast(t('signInToLike')))}
        >
          <span aria-hidden="true">♥</span> {p.likes}
        </button>
        <button type="button" className={styles.replies} aria-expanded={open} aria-controls={threadId} onClick={() => setOpen((o) => !o)}>
          {p.replies === 0 ? t('replyAction') : t('replies', { count: p.replies })}
        </button>
        {user && (
          <button type="button" className={styles.report} disabled={reported} onClick={() => setReporting(true)}>
            {reported ? t('reported') : t('report')}
          </button>
        )}
      </footer>
      <div id={threadId} hidden={!open}>
        {open && <ReplyThread post={p} signedIn={!!user} />}
      </div>
      {reporting && (
        <ReportDialog
          post={p}
          onClose={(sent) => {
            setReporting(false);
            if (sent) {
              setReported(true);
              toast(t('reportDone'));
            }
          }}
        />
      )}
    </article>
  );
}

/** The replies to a post (oldest first) and, for signed-in members, the reply form. */
function ReplyThread({ post, signedIn }: { post: Post; signedIn: boolean }) {
  const t = useTranslations('community');
  const tc = useTranslations('common');
  const f = useFormat();
  const toast = useToast();
  const pathname = useAppPathname();
  const inputId = useId();
  const replies = useReplies(post.id, true);
  const create = useCreateReply(post.id);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    create.mutate(body, {
      onSuccess: () => {
        setDraft('');
        setError(null);
        toast(t('replied', { name: post.author.name }));
      },
      onError: (err) => setError(messageOf(err, t('replyFailed'))),
    });
  };

  return (
    <section className={styles.thread} aria-label={t('repliesLabel', { name: post.author.name })}>
      {replies.isPending ? (
        <div className="skeleton" style={{ height: 64 }} />
      ) : replies.isError ? (
        <p className="alert alert-bad" role="alert">
          {t('repliesError')}{' '}
          <button type="button" className="link-btn" onClick={() => void replies.refetch()}>
            {tc('retry')}
          </button>
        </p>
      ) : replies.data.length === 0 ? (
        <p className={styles.threadEmpty}>{t('repliesEmpty')}</p>
      ) : (
        <ol className={styles.replyList}>
          {replies.data.map((r) => (
            <li key={r.id} className={styles.reply}>
              <span className="avatar" style={{ width: 28, height: 28, fontSize: 10.5, background: r.author.color }} aria-hidden="true">
                {r.author.initials}
              </span>
              <div style={{ minWidth: 0 }}>
                <p className={styles.replyHead}>
                  <b>{r.author.name}</b> {r.author.isInstructor && <span className={styles.coach}>{t('coach')}</span>}{' '}
                  <time dateTime={r.createdAt} className={styles.postMeta}>
                    {f.ago(r.createdAt)}
                  </time>
                </p>
                <p className={styles.replyBody}>{r.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {signedIn ? (
        <form className={styles.replyForm} onSubmit={submit}>
          <label htmlFor={inputId} className="sr-only">
            {t('replyLabel', { name: post.author.name })}
          </label>
          <textarea
            id={inputId}
            className="textarea"
            rows={2}
            maxLength={5000}
            placeholder={t('replyPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-err` : undefined}
          />
          {error && (
            <p id={`${inputId}-err`} className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={create.isPending || !draft.trim()}>
            {t('replySend')}
          </button>
        </form>
      ) : (
        <Link href={routes.signIn(pathname)} className="btn btn-outline btn-sm" style={{ marginTop: 10 }}>
          {t('signInToReply')}
        </Link>
      )}
    </section>
  );
}

/** "Report this post": a native modal dialog with the reason; `onClose(true)` once the report was sent. */
function ReportDialog({ post, onClose }: { post: Post; onClose: (sent: boolean) => void }) {
  const t = useTranslations('community');
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const flag = useFlagPost();
  const sent = useRef(false);
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!reason) {
      setError(t('reportPick'));
      return;
    }
    setError(null);
    flag.mutate(
      { postId: post.id, reason },
      {
        onSuccess: () => {
          sent.current = true;
          ref.current?.close();
        },
        onError: (err) => setError(messageOf(err, t('reportFailed'))),
      },
    );
  };

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      onClose={() => onClose(sent.current)}
    >
      <h2 id={`${id}-t`} className={styles.dialogTitle}>
        {t('reportTitle')}
      </h2>
      <p id={`${id}-d`} className={styles.dialogText}>
        {t('reportIntro', { name: post.author.name })}
      </p>
      <form onSubmit={submit} noValidate className={styles.dialogForm}>
        <fieldset className={styles.reasons} aria-describedby={error ? `${id}-err` : undefined}>
          <legend className="field-label">{t('reportReason')}</legend>
          {FLAG_REASONS.map((r) => (
            <label key={r} className="option">
              <input
                type="radio"
                className="sr-only"
                name={`${id}-reason`}
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
              />
              <span className="radio-dot" aria-hidden="true" />
              {t(`reasons.${r}`)}
            </label>
          ))}
        </fieldset>
        {error && (
          <p id={`${id}-err`} className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className="btn btn-outline" onClick={() => ref.current?.close()}>
            {t('reportCancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={flag.isPending}>
            {t('reportSend')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
