'use client';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { ApiError } from '@/lib/api/errors';
import { Markdown } from '@/lib/markdown';
import { useFormat } from '@/lib/useFormat';
import { usePeerReview, usePeerReviews, useSubmitAssignment, useSubmitPeerReview } from '../api';
import type { AssignmentBlock, Lesson, PeerReview, SubmissionFile } from '../types';
import styles from './Assignment.module.css';

/**
 * An assignment lesson (docs/assessments.md): the brief and rubric, the learner's own deadline, their submission
 * (files with their virus-scan state, the grade, classmates' anonymous feedback) and, in peer mode, the classmates'
 * work they were given to review. Lazy-loaded: only assignment lessons pay for it. Every decision (can submit, late,
 * completion, allocation) is the API's.
 */
export default function AssignmentView({ lesson }: { lesson: Lesson }) {
  const t = useTranslations('assignment');
  const f = useFormat();
  const a = lesson.assignment!;
  const s = a.submission;
  const overdue = !s && a.dueAt !== null && new Date(a.dueAt) < new Date();

  return (
    <section className={styles.wrap} aria-labelledby="asg-h">
      <div className={styles.head}>
        <h2 id="asg-h" className="eyebrow eyebrow-brand">
          {a.points !== null ? t('eyebrowPoints', { points: a.points }) : t('eyebrow')}
        </h2>
        {overdue && <span className="tag tag-soft">{t('overdue')}</span>}
      </div>
      {/* The lesson's text is shown above; the brief only when it says something else. */}
      {a.brief && a.brief !== lesson.description && (
        <Markdown source={a.brief} breaks images={false} headingLevel={3} className={`rich-text ${styles.rich}`} />
      )}
      <Deadline a={a} />
      {a.rubric.length > 0 && (
        <div>
          <h3 className={styles.subTitle}>{t('rubric')}</h3>
          <ul className={styles.rubric}>
            {a.rubric.map((c) => (
              <li key={c.label}>
                <span className={styles.rubricLabel}>{c.label}</span>
                {c.hint && <span className={styles.muted}> — {c.hint}</span>}
                <span className={styles.rubricMax}>{t('points', { points: c.max })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {s && (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <h3 className={styles.subTitle}>{t('yourSubmission', { attempt: s.attempt })}</h3>
            <span className="tag tag-soft">{t(`status.${s.status}`)}</span>
          </div>
          <p className={styles.muted}>
            {t('submittedAt', { when: f.dateTime(s.submittedAt) })}
            {s.lateByDays > 0 && ` · ${t('late', { days: s.lateByDays })}`}
          </p>
          {s.text && <p className={styles.body}>{s.text}</p>}
          <Files
            files={s.files}
            href={(file) => `/api/v1/me/submissions/${encodeURIComponent(s.id)}/files/${encodeURIComponent(file.id)}`}
          />
          {s.status === 'resubmit' && s.resubmitFeedback && (
            <div className="alert" role="note">
              <p>{t('resubmitFeedback')}</p>
              <Markdown source={s.resubmitFeedback} breaks images={false} headingLevel={4} className={`rich-text ${styles.rich}`} />
            </div>
          )}
          {s.grade && (
            <div className={styles.grade}>
              <p className={styles.score}>{t('grade', { points: s.grade.points, max: s.grade.maxPoints, percent: s.grade.percent })}</p>
              {s.grade.feedback && (
                <Markdown source={s.grade.feedback} breaks images={false} headingLevel={4} className={`rich-text ${styles.rich}`} />
              )}
              <p className={styles.muted}>{t('gradedAt', { when: f.date(s.grade.gradedAt) })}</p>
            </div>
          )}
          {s.peerFeedback.length > 0 && (
            <div>
              <h4 className={styles.subTitle}>{t('peerFeedback')}</h4>
              <ul className={styles.feedbackList}>
                {s.peerFeedback.map((p, i) => (
                  <li key={`${p.submittedAt ?? ''}-${i}`} className={styles.feedback}>
                    <p className={styles.feedbackHead}>
                      {t('classmate', { n: i + 1 })}
                      {p.percent !== null && ` · ${p.percent}%`}
                    </p>
                    <ul className={styles.scores}>
                      {p.scores.map((x) => (
                        <li key={x.label}>{t('scoreLine', { label: x.label, score: x.score, max: x.max })}</li>
                      ))}
                    </ul>
                    {p.comment && <p className={styles.body}>{p.comment}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {a.canSubmit ? <SubmitForm lesson={lesson} a={a} /> : !s && <p className="alert">{t('closed')}</p>}
      {a.peerReview && <PeerReviews lesson={lesson} a={a} />}
    </section>
  );
}

function Deadline({ a }: { a: AssignmentBlock }) {
  const t = useTranslations('assignment');
  const f = useFormat();
  const rolling = a.dueKind === 'weekly' && a.dueWeekday !== null;
  return (
    <div className={styles.deadline}>
      <p>
        {a.dueAt ? t('due', { when: f.dateTime(a.dueAt) }) : t('noDeadline')}
        {rolling && ` · ${t('weekly', { weekday: f.weekday(a.dueWeekday!) })}`}
      </p>
      {a.dueAt && <p className={styles.muted}>{t(`latePolicy.${a.latePolicy}`)}</p>}
    </div>
  );
}

/** Files with their scan state: a quarantined (infected) file can't be downloaded. */
function Files({ files, href }: { files: SubmissionFile[]; href: (f: SubmissionFile) => string }) {
  const t = useTranslations('assignment');
  if (files.length === 0) return null;
  return (
    <ul className={styles.files}>
      {files.map((file) => (
        <li key={file.id} className={styles.file}>
          {file.scanStatus === 'infected' ? (
            <span className={styles.quarantined} aria-disabled="true">
              {file.name} · {t('quarantined')}
            </span>
          ) : (
            <a href={href(file)} download>
              {file.name}
            </a>
          )}
          <span className={styles.muted}>
            {' '}
            {file.ext} · {t('sizeKb', { kb: file.sizeKb })}
            {file.scanStatus === 'pending' && ` · ${t('scanning')}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SubmitForm({ lesson, a }: { lesson: Lesson; a: AssignmentBlock }) {
  const t = useTranslations('assignment');
  const id = useId();
  const toast = useToast();
  const submit = useSubmitAssignment(lesson.courseSlug, lesson.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!text.trim() && files.length === 0) {
      setError(t('empty'));
      return;
    }
    if (files.length > a.maxFiles) {
      setError(t('tooManyFiles', { max: a.maxFiles }));
      return;
    }
    setError(null);
    submit.mutate(
      { text, files },
      {
        onSuccess: () => {
          setText('');
          setFiles([]);
          if (fileInput.current) fileInput.current.value = '';
          toast(t('submitted', { title: a.title }));
        },
        onError: (err) =>
          setError(
            err instanceof ApiError ? (err.isValidation ? (Object.values(err.fieldErrors)[0] ?? err.message) : err.message) : t('failed'),
          ),
      },
    );
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-describedby={error ? `${id}-err` : undefined}>
      <h3 className={styles.subTitle}>{a.submission ? t('resubmitTitle') : t('submitTitle')}</h3>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-text`}>
          {t('answer')}
        </label>
        <textarea id={`${id}-text`} className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-files`}>
          {t('files')}
        </label>
        <input
          id={`${id}-files`}
          ref={fileInput}
          type="file"
          multiple
          accept={a.fileTypes.map((x) => `.${x}`).join(',')}
          aria-describedby={`${id}-hint`}
          onChange={(e) => setFiles([...(e.target.files ?? [])])}
        />
        <p id={`${id}-hint`} className="field-hint">
          {t('filesHint', { max: a.maxFiles, types: a.fileTypes.map((x) => x.toUpperCase()).join(', '), mb: a.maxFileMb })}
        </p>
      </div>
      {error && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={submit.isPending} style={{ alignSelf: 'flex-start' }}>
        {t('submit')}
      </button>
    </form>
  );
}

/** Peer review (anonymous both ways): the classmates' work this learner was given, with the rubric to score it. */
function PeerReviews({ lesson, a }: { lesson: Lesson; a: AssignmentBlock }) {
  const t = useTranslations('assignment');
  const f = useFormat();
  const p = a.peerReview!;
  const list = usePeerReviews(a.id, p.assigned > 0);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className={styles.card}>
      <h3 className={styles.subTitle}>{t('peerTitle')}</h3>
      <p className={styles.muted}>
        {p.assigned === 0
          ? t('peerNoneYet', { required: p.required })
          : t('peerProgress', { completed: p.completed, required: Math.max(p.required, p.assigned) })}
        {p.nextDueAt && ` · ${t('peerNextDue', { when: f.dateTime(p.nextDueAt) })}`}
      </p>
      {list.isError && <p className="alert alert-bad">{t('peerLoadFailed')}</p>}
      {list.isPending && p.assigned > 0 && <div className="skeleton" style={{ height: 60 }} />}
      {list.data && (
        <ul className={styles.reviewList}>
          {list.data.reviews.map((r, i) => (
            <li key={r.id} className={styles.reviewItem}>
              <div className={styles.cardHead}>
                <span>
                  {t('classmateWork', { n: i + 1 })} · {t(`peerStatus.${r.status}`)}
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  aria-expanded={open === r.id}
                  aria-controls={`review-${r.id}`}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  {open === r.id ? t('close') : r.status === 'assigned' ? t('review') : t('view')}
                </button>
              </div>
              <p className={styles.muted}>{t('dueOn', { when: f.dateTime(r.dueAt) })}</p>
              {open === r.id && (
                <div id={`review-${r.id}`}>
                  <PeerReviewForm assignmentId={a.id} reviewId={r.id} lessonId={lesson.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PeerReviewForm({ assignmentId, reviewId, lessonId }: { assignmentId: string; reviewId: string; lessonId: string }) {
  const t = useTranslations('assignment');
  const { data, isPending, isError } = usePeerReview(assignmentId, reviewId);
  if (isPending) return <div className="skeleton" style={{ height: 120 }} />;
  if (isError) return <p className="alert alert-bad">{t('peerLoadFailed')}</p>;
  return <PeerReviewEditor review={data} assignmentId={assignmentId} lessonId={lessonId} />;
}

function PeerReviewEditor({ review, assignmentId, lessonId }: { review: PeerReview; assignmentId: string; lessonId: string }) {
  const t = useTranslations('assignment');
  const f = useFormat();
  const id = useId();
  const toast = useToast();
  const save = useSubmitPeerReview(assignmentId, review.id, lessonId);
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(review.scores.map((s) => [s.criterionId, s.score])),
  );
  const [comment, setComment] = useState(review.comment);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !review.canSubmit;

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (review.rubric.some((c) => scores[c.id] === undefined)) {
      setError(t('scoreEveryRow'));
      return;
    }
    setError(null);
    save.mutate(
      { scores: review.rubric.map((c) => ({ criterionId: c.id, score: scores[c.id]! })), comment: comment.trim() },
      {
        onSuccess: () => toast(t('reviewSaved')),
        onError: (err) => setError(err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : t('failed')),
      },
    );
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div className={styles.work}>
        <p className={styles.muted}>{t('workSubmitted', { when: f.dateTime(review.work.submittedAt) })}</p>
        {review.work.text && <p className={styles.body}>{review.work.text}</p>}
        <Files
          files={review.work.files}
          href={(file) =>
            `/api/v1/me/assignments/${encodeURIComponent(assignmentId)}/peer-reviews/${encodeURIComponent(review.id)}/files/${encodeURIComponent(file.id)}`
          }
        />
      </div>
      {review.status === 'missed' && <p className="alert">{t('missed')}</p>}
      {review.rubric.map((c) => (
        <fieldset key={c.id} className={styles.criterion} disabled={readOnly}>
          <legend className={styles.rubricLabel}>
            {c.label} <span className={styles.muted}>({t('points', { points: c.max })})</span>
          </legend>
          {c.hint && <p className={styles.muted}>{c.hint}</p>}
          <div className={styles.scale}>
            {Array.from({ length: c.max + 1 }, (_, n) => (
              <label key={n} className="option">
                <input
                  type="radio"
                  className="sr-only"
                  name={`${id}-${c.id}`}
                  checked={scores[c.id] === n}
                  onChange={() => setScores((s) => ({ ...s, [c.id]: n }))}
                />
                <span className="radio-dot" aria-hidden="true" />
                <span>{n}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="field">
        <label className="field-label" htmlFor={`${id}-comment`}>
          {t('comment')}
        </label>
        <textarea
          id={`${id}-comment`}
          className="textarea"
          rows={3}
          maxLength={5000}
          value={comment}
          disabled={readOnly}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!readOnly && (
        <button type="submit" className="btn btn-primary btn-sm" disabled={save.isPending} style={{ alignSelf: 'flex-start' }}>
          {review.status === 'submitted' ? t('updateReview') : t('submitReview')}
        </button>
      )}
    </form>
  );
}
