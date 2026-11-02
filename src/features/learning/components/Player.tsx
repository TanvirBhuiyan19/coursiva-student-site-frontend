'use client';
import { Link, useLocalizedRouter } from '@/i18n/navigation';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { ApiError } from '@/lib/api/errors';
import { Markdown } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import {
  useApplyTimeBeat,
  useAskQuestion,
  useLesson,
  usePlayerCourse,
  usePlaybackCompletion,
  useSaveNote,
  useSubmitQuiz,
  useToggleComplete,
  useTutor,
} from '../api';
import { lockFromError, lockOf } from '../availability';
import { useLessonTime } from '../heartbeat';
import type { Lesson, PlayerCourse, QuizAnswer, QuizBlock, QuizQuestion, QuizResult } from '../types';
import { isAnswered, quizAnswers, resultKind } from '../quiz';
import styles from './Player.module.css';
import { LessonBlocks } from './LessonBlocks';
import { CompletionStatus, LiveLesson, LockedLesson, LockIcon, useLockText } from './LessonStatus';
import { VideoPlayer } from './VideoPlayer';

// Lazy: only lessons that need them load the SCORM runtime, the assignment views, the survey form or the tutor.
const loading = () => <div className="skeleton" style={{ height: 240 }} />;
const ScormPlayer = dynamic(() => import('./ScormPlayer'), { ssr: false, loading });
const AssignmentView = dynamic(() => import('./AssignmentView'), { ssr: false, loading });
const SurveyPanel = dynamic(() => import('./SurveyPanel'), { ssr: false, loading });
const TutorPanel = dynamic(() => import('./TutorPanel'), { ssr: false, loading });

/**
 * The course player. The URL holds the lesson (`/learn/<course>/<lesson>`), so a lesson is linkable, reload-safe and
 * works with the back button. Without a lesson id it resumes at the first incomplete lesson.
 */
export function Player({
  courseSlug,
  lessonId,
  tutor = true,
}: {
  courseSlug: string;
  lessonId: string | null;
  /** false: the platform switched AI off (`unavailable` has `ai`) — no tutor section, no tutor request. */
  tutor?: boolean;
}) {
  const t = useTranslations('player');
  const tc = useTranslations('common');
  const router = useLocalizedRouter();
  const welcome = useSearchParams().get('welcome') === '1';
  const course = usePlayerCourse(courseSlug);
  const lesson = useLesson(lessonId);
  const mainRef = useRef<HTMLDivElement>(null);

  // No lesson in the URL → resume where the learner left off.
  useEffect(() => {
    if (lessonId || !course.data) return;
    const all = course.data.modules.flatMap((m) => m.lessons);
    const next = all.find((l) => !l.completed && !l.locked) ?? all.find((l) => !l.locked) ?? all[0];
    if (next) router.replace(routes.player(courseSlug, next.id));
  }, [lessonId, course.data, courseSlug, router]);

  // Move focus to the lesson heading on lesson change (client navigation), as a screen reader would expect.
  useEffect(() => {
    if (lesson.data) mainRef.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [lesson.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only on lesson change

  if (course.isError) {
    const forbidden = course.error instanceof ApiError && course.error.status === 403;
    return (
      <div className="container page">
        <div className="alert alert-bad" role="alert">
          {forbidden ? t('notEnrolled') : tc('errorBody')} <Link href={routes.course(courseSlug)}>{t('toCoursePage')}</Link>
        </div>
      </div>
    );
  }
  if (!course.data) return <div className="skeleton" style={{ height: '70vh', margin: 24 }} />;

  return (
    <div className={styles.wrap}>
      <Sidebar course={course.data} currentId={lessonId} />
      <div className={styles.main} ref={mainRef}>
        {welcome && (
          <p className="alert alert-ok" role="status" style={{ marginBottom: 18, padding: '14px 18px', fontSize: 14 }}>
            {t('welcome')}
          </p>
        )}
        {lesson.isError ? (
          <LessonError error={lesson.error} course={course.data} lessonId={lessonId} retry={() => void lesson.refetch()} />
        ) : lesson.isPending ? (
          <div className="skeleton" style={{ aspectRatio: '16 / 9', maxWidth: 860 }} />
        ) : (
          <LessonView key={lesson.data.id} lesson={lesson.data} course={course.data} tutor={tutor} />
        )}
      </div>
    </div>
  );
}

/** A lesson the API refused: its lock (the `403 lesson_locked` body, else the outline's), or an error with a retry. */
function LessonError({
  error,
  course,
  lessonId,
  retry,
}: {
  error: unknown;
  course: PlayerCourse;
  lessonId: string | null;
  retry: () => void;
}) {
  const t = useTranslations('player');
  const entry = course.modules.flatMap((m) => m.lessons).find((l) => l.id === lessonId) ?? null;
  const lock = lockFromError(error) ?? (entry && error instanceof ApiError && error.status === 403 ? lockOf(entry) : null);
  if (lock) return <LockedLesson lock={lock} course={course} title={entry?.title ?? null} />;
  return (
    <div className="alert alert-bad" role="alert">
      {error instanceof ApiError && error.status < 500 ? error.message : t('lessonFailed')}{' '}
      <button type="button" className="btn btn-outline btn-sm" onClick={retry}>
        {t('retry')}
      </button>
    </div>
  );
}

/** The staff preview's sidebar: its links stay in the preview, locks read as of the simulated now, drafts are badged. */
export interface SidebarPreview {
  href: (lessonId: string) => string;
  /** The simulated now (ms); undefined = the real now. */
  now: number | undefined;
}

/** The course outline (exported for the staff preview, which passes `preview`). */
export function Sidebar({ course, currentId, preview }: { course: PlayerCourse; currentId: string | null; preview?: SidebarPreview }) {
  const t = useTranslations('player');
  const tc = useTranslations('common');
  const f = useFormat();
  const lockText = useLockText();
  return (
    <aside className={styles.aside} aria-label={t('contents')}>
      <div className={styles.asideHead}>
        {!preview && (
          <Link href={routes.course(course.slug)} className={styles.back}>
            {t('coursePage')}
          </Link>
        )}
        <p className={styles.courseTitle}>{course.title}</p>
        <div className={styles.progressRow}>
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={course.progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('courseProgress')}
          >
            <span style={{ width: `${course.progress.percent}%` }} />
          </div>
          <span className={styles.pct}>{course.progress.percent}%</span>
        </div>
      </div>
      <nav className={styles.modules} aria-label={t('lessons')}>
        {course.modules.map((m) => (
          <div key={m.id}>
            <h2 className={styles.moduleTitle}>{m.title}</h2>
            <ol className={styles.lessonList}>
              {m.lessons.map((l) => {
                const current = l.id === currentId;
                const lock = lockOf(l);
                const draft = 'draft' in l && l.draft === true;
                return (
                  <li key={l.id}>
                    {/* No prefetch: lesson content loads through the API; prefetching every lesson page would be wasted requests. */}
                    <Link
                      prefetch={false}
                      href={preview ? preview.href(l.id) : routes.player(course.slug, l.id)}
                      className={styles.lessonLink}
                      aria-current={current ? 'page' : undefined}
                      data-done={l.completed}
                      data-locked={!!lock}
                    >
                      <span className={styles.dot} data-done={l.completed} data-current={current} aria-hidden="true">
                        {l.completed ? '✓' : lock ? <LockIcon className={styles.dotLock} /> : l.type === 'quiz' ? '?' : ''}
                      </span>
                      <span className={styles.lessonName}>
                        {l.title}
                        {draft && <span className={`tag tag-soft ${styles.draft}`}>{t('draft')}</span>}
                        {l.completed && <span className="sr-only"> ({t('completed')})</span>}
                        {lock && <span className={styles.lockWhy}>{lockText(lock, preview?.now)}</span>}
                      </span>
                      <span className={styles.lessonDur}>
                        {l.type === 'quiz' && l.questionCount
                          ? tc('questions', { count: l.questionCount })
                          : l.durationSeconds
                            ? f.clock(l.durationSeconds)
                            : '—'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function LessonView({ lesson, course, tutor }: { lesson: Lesson; course: PlayerCourse; tutor: boolean }) {
  const t = useTranslations('player');
  const f = useFormat();
  const router = useLocalizedRouter();
  const toast = useToast();
  const toggle = useToggleComplete(course.slug);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const next = () => router.push(lesson.nextLessonId ? routes.player(course.slug, lesson.nextLessonId) : routes.learning);
  const completion = lesson.completion;
  // Only the `manual` rule completes by a click. Older APIs (no `completion`): quizzes, SCORM packages, assignments and
  // surveys complete by passing, finishing or submitting them.
  const manual = completion
    ? completion.rule === 'manual'
    : !(lesson.type === 'quiz' || !!lesson.scorm || !!lesson.assignment || !!lesson.survey);
  const pending = completion && !completion.done ? completion.rule : null;
  // `time`: beats while the page is visible; `video`: each playback report answers with the completion.
  useLessonTime(pending === 'time' ? lesson.id : null, useApplyTimeBeat(lesson.id, course.slug));
  const playbackCompletion = usePlaybackCompletion(lesson.id, course.slug);

  return (
    <article className={styles.lesson}>
      {lesson.video && (
        <VideoPlayer
          video={lesson.video}
          title={lesson.title}
          durationSeconds={lesson.durationSeconds}
          completed={lesson.completed}
          reportLessonId={lesson.type === 'video' ? lesson.id : null}
          onReported={pending === 'video' ? playbackCompletion : undefined}
        />
      )}
      {lesson.live && <LiveLesson lessonId={lesson.id} live={lesson.live} />}
      {lesson.pdf && (
        <div className={styles.pdf}>
          <span className={styles.pdfIcon} aria-hidden="true">
            PDF
          </span>
          <div style={{ flex: 1 }}>
            <p className={styles.pdfTitle}>{lesson.title}</p>
            <p className={styles.pdfMeta}>{t('pdfMeta', { size: f.bytes(lesson.pdf.sizeBytes) })}</p>
          </div>
          <a href={lesson.pdf.url} className="btn btn-primary" download>
            {t('download')}
          </a>
        </div>
      )}
      {lesson.quiz && <Quiz lesson={lesson} courseSlug={course.slug} onContinue={next} />}
      {lesson.scorm && <ScormPlayer lesson={lesson} />}

      <div className={styles.titleRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className={styles.module}>{lesson.moduleTitle}</p>
          <h1 className={styles.title} tabIndex={-1}>
            {lesson.title}
          </h1>
        </div>
        {manual ? (
          <button
            type="button"
            className={`btn btn-lg ${lesson.completed ? 'btn-success' : 'btn-primary'}`}
            aria-pressed={lesson.completed}
            aria-describedby={toggleError ? 'complete-err' : undefined}
            disabled={toggle.isPending}
            onClick={() => {
              setToggleError(null);
              toggle.mutate(
                { lessonId: lesson.id, completed: !lesson.completed },
                {
                  onSuccess: (r) => r.progress.percent === 100 && r.completed && toast(t('courseComplete', { title: course.title })),
                  // 422 when the lesson completes by its own rule: the API's sentence says how.
                  onError: (err) => setToggleError(err instanceof ApiError && err.status < 500 ? err.message : t('completion.failed')),
                },
              );
            }}
          >
            {lesson.completed ? t('completedBtn') : t('markComplete')}
          </button>
        ) : (
          completion && <CompletionStatus completion={completion} lesson={lesson} />
        )}
        <button type="button" className="btn btn-outline btn-lg" onClick={next}>
          {lesson.nextLessonId ? t('next') : t('finish')}
        </button>
      </div>
      {toggleError && (
        <p id="complete-err" className="field-error" role="alert">
          {toggleError}
        </p>
      )}
      {lesson.blocks ? (
        <LessonBlocks blocks={lesson.blocks} lessonTitle={lesson.title} lessonId={lesson.id} blocksLocked={lesson.blocksLocked ?? 0} />
      ) : lesson.bodyHtml ? (
        // Rendered from Markdown by the API with raw HTML stripped and unsafe links dropped (LessonContent::html).
        <div className={`rich-text ${styles.desc}`} dangerouslySetInnerHTML={{ __html: lesson.bodyHtml }} />
      ) : (
        <p className={styles.desc}>{lesson.description}</p>
      )}
      {lesson.link && (
        <p>
          <a
            href={lesson.link.url}
            className="btn btn-primary"
            target={lesson.link.newTab ? '_blank' : undefined}
            rel="noopener noreferrer"
          >
            {t('openLink', { title: lesson.title })}
          </a>
        </p>
      )}
      {lesson.scorm?.state?.completed && <p className="alert alert-ok">{t('scormDone')}</p>}
      {lesson.assignment && <AssignmentView lesson={lesson} />}
      {lesson.survey && <SurveyPanel lesson={lesson} />}

      {lesson.resources.length > 0 && (
        <section className={styles.section} aria-labelledby="res-t">
          <h2 id="res-t" className={styles.sectionTitle}>
            {t('resources', { count: lesson.resources.length })}
          </h2>
          <ul className={styles.resources}>
            {lesson.resources.map((r) => (
              <li key={r.id}>
                <a href={r.url} className={styles.resource} download>
                  <span className={styles.resKind} data-kind={r.kind}>
                    {t(`resourceKinds.${r.kind}`)}
                  </span>
                  {r.name} · {f.bytes(r.sizeBytes)}
                  <span aria-hidden="true">↓</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tutor && <Tutor course={course} lessonId={lesson.id} />}
      <Notes lesson={lesson} />
      <QA lesson={lesson} course={course} />
    </article>
  );
}

/** A quiz lesson's questions, attempt and result (exported for tests). */
export function Quiz({ lesson, courseSlug, onContinue }: { lesson: Lesson; courseSlug: string; onContinue: () => void }) {
  const t = useTranslations('player');
  const f = useFormat();
  const id = useId();
  const quiz = lesson.quiz!;
  const submit = useSubmitQuiz(courseSlug, lesson.id);
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  // An attempt awaiting the instructor's review is shown instead of the form (a new attempt would be 409).
  const [result, setResult] = useState<QuizResult | null>(quiz.lastResult?.reviewStatus === 'pending' ? quiz.lastResult : null);
  const [error, setError] = useState<string | null>(null);
  const exhausted = quiz.attemptsAllowed !== null && quiz.attemptsUsed >= quiz.attemptsAllowed;
  const reviewed = quiz.lastResult?.reviewStatus === 'reviewed' ? quiz.lastResult : null;

  const answer = (q: QuizQuestion, patch: Partial<QuizAnswer>) => {
    setAnswers((a) => ({ ...a, [q.id]: { ...a[q.id], ...patch, questionId: q.id } }));
    setError(null);
  };

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (quiz.questions.some((q) => !isAnswered(q, answers[q.id]))) {
      setError(t('answerAll', { count: quiz.questions.length }));
      return;
    }
    submit.mutate(
      { answers: quizAnswers(quiz.questions, answers) },
      { onSuccess: setResult, onError: (err) => setError(err instanceof ApiError ? err.message : t('quizFailed')) },
    );
  };

  const kind = result ? resultKind(result) : null;
  return (
    <section className={styles.quiz} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="eyebrow eyebrow-brand">
        {t('quizEyebrow', { pass: quiz.passPercent })}
      </h2>
      {(quiz.timeLimitMinutes !== null || quiz.attemptsAllowed !== null) && (
        <p className={styles.quizMeta}>
          {quiz.timeLimitMinutes !== null &&
            (quiz.expiresAt
              ? t('timeLimitEnds', { minutes: quiz.timeLimitMinutes, when: f.dateTime(quiz.expiresAt) })
              : t('timeLimit', { minutes: quiz.timeLimitMinutes }))}
          {quiz.timeLimitMinutes !== null && quiz.attemptsAllowed !== null && ' · '}
          {quiz.attemptsAllowed !== null && t('attempts', { used: quiz.attemptsUsed, allowed: quiz.attemptsAllowed })}
        </p>
      )}
      {result && kind ? (
        <div className={styles.result} data-pass={kind === 'passed' ? true : kind === 'failed' ? false : undefined} role="status">
          <p className={styles.score}>
            {kind === 'pending' ? t('awaitingReview') : result.scorePercent !== null ? `${result.scorePercent}%` : t('submittedQuiz')}
          </p>
          <p className={styles.resultMsg}>
            {kind === 'pending'
              ? result.provisionalPercent !== null
                ? t('pendingProvisional', { percent: result.provisionalPercent })
                : t('pendingBody')
              : kind === 'passed'
                ? t('passed')
                : kind === 'failed'
                  ? t('failed', { correct: result.correct, total: result.total })
                  : t('submittedBody')}
          </p>
          {result.feedback && (
            <div className={styles.feedback}>
              <p className={styles.resultMsg}>{t('instructorFeedback')}</p>
              <Markdown source={result.feedback} breaks images={false} headingLevel={3} className="rich-text" />
            </div>
          )}
          <RevealedAnswers quiz={quiz} result={result} />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            {kind === 'failed' ? (
              result.attemptsLeft === 0 ? (
                <p className={styles.resultMsg}>{t('noAttemptsLeft')}</p>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setResult(null);
                    setAnswers({});
                  }}
                >
                  {t('retake')}
                </button>
              )
            ) : (
              <button type="button" className="btn btn-primary" onClick={onContinue}>
                {t('continue')}
              </button>
            )}
          </div>
        </div>
      ) : exhausted ? (
        <p className="alert">{t('noAttemptsLeft')}</p>
      ) : (
        <form onSubmit={onSubmit} className={styles.quizForm} noValidate>
          {reviewed && (
            <div className="alert" role="note">
              {t('lastReviewed', {
                percent: reviewed.scorePercent ?? 0,
                when: reviewed.reviewedAt ? f.date(reviewed.reviewedAt) : '',
              })}
              {reviewed.feedback && (
                <div className={styles.feedback}>
                  <p className={styles.resultMsg}>{t('instructorFeedback')}</p>
                  <Markdown source={reviewed.feedback} breaks images={false} headingLevel={3} className="rich-text" />
                </div>
              )}
            </div>
          )}
          {quiz.questions.map((q, qi) => (
            // The question is Markdown (dashboard rich text): block content can't sit in a <legend>, so the group is
            // named by the rendered prompt instead.
            <fieldset key={q.id} className={styles.question} aria-labelledby={`${id}-q${qi}`}>
              <div id={`${id}-q${qi}`} className={styles.prompt}>
                <span className={styles.promptN}>{qi + 1}.</span>
                <Markdown source={q.prompt} breaks images={false} headingLevel={3} className={`rich-text ${styles.promptText}`} />
              </div>
              <QuestionInput q={q} value={answers[q.id]} onChange={(patch) => answer(q, patch)} />
            </fieldset>
          ))}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-lg" disabled={submit.isPending} style={{ alignSelf: 'flex-start' }}>
            {t('submit')}
          </button>
        </form>
      )}
    </section>
  );
}

/**
 * When the school reveals answers, the attempt response carries each question's verdict and the author's explanation
 * (Markdown): listed under the score, question by question. Never the correct options themselves.
 */
function RevealedAnswers({ quiz, result }: { quiz: QuizBlock; result: QuizResult }) {
  const t = useTranslations('player');
  const rows = (result.results ?? []).flatMap((r) => {
    const q = quiz.questions.find((x) => x.id === r.questionId);
    return q ? [{ ...r, q, n: quiz.questions.indexOf(q) + 1 }] : [];
  });
  if (!rows.length) return null;
  const verdict = (v: string) => (v === 'correct' || v === 'incorrect' || v === 'pending' ? t(`verdicts.${v}`) : v);
  return (
    <div className={styles.answers}>
      <p className={styles.resultMsg}>{t('answersTitle')}</p>
      <ol className={styles.answerList}>
        {rows.map((r) => (
          <li key={r.questionId} className={styles.answer} data-verdict={r.verdict}>
            <div className={styles.prompt}>
              <span className={styles.promptN}>{r.n}.</span>
              <Markdown source={r.q.prompt} breaks images={false} headingLevel={3} className={`rich-text ${styles.promptText}`} />
            </div>
            <p className={styles.verdict}>{verdict(r.verdict)}</p>
            {r.explanation !== '' && <Markdown source={r.explanation} breaks images={false} headingLevel={4} className="rich-text" />}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One question's input, by type. Option ids are the API's (`o0`, `o1`…). */
function QuestionInput({
  q,
  value,
  onChange,
}: {
  q: QuizQuestion;
  value: QuizAnswer | undefined;
  onChange: (patch: Partial<QuizAnswer>) => void;
}) {
  const t = useTranslations('player');
  const id = useId();
  if (q.type === 'free_text')
    return (
      <div className="field">
        <label className="sr-only" htmlFor={`${id}-text`}>
          {t('yourAnswer')}
        </label>
        <textarea
          id={`${id}-text`}
          className="textarea"
          rows={4}
          maxLength={10_000}
          value={value?.text ?? ''}
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange({ text: e.target.value })}
        />
        <p id={`${id}-hint`} className="field-hint">
          {t('freeTextHint')}
        </p>
      </div>
    );
  if (q.type === 'fill_blanks')
    return (
      <div className={styles.options}>
        {Array.from({ length: q.blankCount }, (_, i) => (
          <div key={i} className="field">
            <label className="field-label" htmlFor={`${id}-b${i}`}>
              {t('blank', { n: i + 1 })}
            </label>
            <input
              id={`${id}-b${i}`}
              className="input"
              value={value?.blanks?.[i] ?? ''}
              onChange={(e) => {
                const blanks = Array.from({ length: q.blankCount }, (_, j) => value?.blanks?.[j] ?? '');
                blanks[i] = e.target.value;
                onChange({ blanks });
              }}
            />
          </div>
        ))}
      </div>
    );
  if (q.type === 'matching')
    return (
      <div className={styles.options}>
        {q.prompts.map((p, i) => (
          <div key={p} className="field">
            <label className="field-label" htmlFor={`${id}-m${i}`}>
              {p}
            </label>
            <select
              id={`${id}-m${i}`}
              className="select"
              value={value?.matches?.[i] ?? ''}
              onChange={(e) => {
                const matches = q.prompts.map((_, j) => value?.matches?.[j] ?? '');
                matches[i] = e.target.value;
                onChange({ matches });
              }}
            >
              <option value="">{t('chooseMatch')}</option>
              {q.matches.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    );
  const multiple = q.type === 'multi_select';
  return (
    <div className={styles.options}>
      {multiple && <p className="field-hint">{t('pickAll')}</p>}
      {q.options.map((o) => {
        const checked = multiple ? (value?.optionIds ?? []).includes(o.id) : value?.optionId === o.id;
        return (
          <label key={o.id} className="option">
            <input
              type={multiple ? 'checkbox' : 'radio'}
              className="sr-only"
              name={q.id}
              value={o.id}
              checked={checked}
              onChange={() => {
                if (!multiple) onChange({ optionId: o.id });
                else
                  onChange({
                    optionIds: checked ? (value?.optionIds ?? []).filter((x) => x !== o.id) : [...(value?.optionIds ?? []), o.id],
                  });
              }}
            />
            <span className="radio-dot" aria-hidden="true" />
            <span style={{ fontSize: 14 }}>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/** The course AI tutor, when the school has it on (`GET …/tutor` → `enabled`). The panel itself is lazy-loaded. */
function Tutor({ course, lessonId }: { course: PlayerCourse; lessonId: string }) {
  const t = useTranslations('tutor');
  const { data } = useTutor(course.slug);
  const [open, setOpen] = useState(false);
  if (!data?.enabled) return null;
  return (
    <section className={styles.section} aria-labelledby="tutor-h">
      <div className={styles.sectionHead}>
        <h2 id="tutor-h" className={styles.sectionTitle}>
          {t('title')}
        </h2>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          aria-expanded={open}
          aria-controls="tutor-panel"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? t('hide') : t('open')}
        </button>
      </div>
      {open && (
        <div id="tutor-panel">
          <TutorPanel courseSlug={course.slug} lessonId={lessonId} state={data} />
        </div>
      )}
    </section>
  );
}

/** Notes autosave (debounced) — they belong to the learner and sync across devices. */
function Notes({ lesson }: { lesson: Lesson }) {
  const t = useTranslations('player');
  const id = useId();
  const save = useSaveNote(lesson.id);
  const [text, setText] = useState(lesson.note);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    if (text === lesson.note) return;
    const timer = setTimeout(() => save.mutate(text, { onSuccess: () => setStatus('saved') }), 800);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps -- debounce on text only

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <label htmlFor={id} className={styles.sectionTitle}>
          {t('notes')}
        </label>
        <span className={styles.saveState} aria-live="polite">
          {status === 'saving' ? t('saving') : status === 'saved' ? t('saved') : ''}
        </span>
      </div>
      <textarea
        id={id}
        className={`textarea ${styles.notes}`}
        rows={4}
        placeholder={t('notesPlaceholder')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStatus('saving');
        }}
      />
    </section>
  );
}

function QA({ lesson, course }: { lesson: Lesson; course: PlayerCourse }) {
  const t = useTranslations('player');
  const f = useFormat();
  const id = useId();
  const toast = useToast();
  const ask = useAskQuestion(lesson.id);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <section className={styles.section} aria-labelledby={`${id}-h`}>
      <div className={styles.sectionHead}>
        <h2 id={`${id}-h`} className={styles.sectionTitle}>
          {t('qa', { count: lesson.questions.length })}
        </h2>
        {course.communitySpace && (
          <Link href={`${routes.community}?space=${course.communitySpace.id}`} className={styles.spaceLink}>
            {t('discussIn', { space: course.communitySpace.name })}
          </Link>
        )}
      </div>
      {course.communitySpace && <p className={styles.qaNote}>{t('qaNote')}</p>}
      <form
        className={styles.ask}
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          setError(null);
          ask.mutate(draft.trim(), {
            onSuccess: () => {
              setDraft('');
              toast(t('asked'));
            },
            // 422 (length), 403 discussion_off / muted / free preview: the API's message is written for learners.
            onError: (err) =>
              setError(
                err instanceof ApiError
                  ? err.isValidation
                    ? (Object.values(err.fieldErrors)[0] ?? err.message)
                    : err.status < 500
                      ? err.message
                      : t('askFailed')
                  : t('askFailed'),
              ),
          });
        }}
      >
        <label htmlFor={`${id}-q`} className="sr-only">
          {t('askLabel')}
        </label>
        <input
          id={`${id}-q`}
          className="input"
          placeholder={t('askPlaceholder')}
          value={draft}
          maxLength={2000}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={ask.isPending || !draft.trim()}>
          {t('ask')}
        </button>
      </form>
      {error && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {error}
        </p>
      )}
      <ul className={styles.questions}>
        {lesson.questions.map((q) => (
          <li key={q.id} className={styles.q} data-coach={q.author.isInstructor}>
            <div className={styles.qHead}>
              <span className="avatar" style={{ width: 26, height: 26, fontSize: 10, background: q.author.color }} aria-hidden="true">
                {q.author.initials}
              </span>
              <span className={styles.qName}>{q.author.name}</span>
              {q.author.isInstructor && <span className={styles.coach}>{t('coach')}</span>}
              <span className={styles.qWhen}>{f.ago(q.createdAt)}</span>
            </div>
            <p className={styles.qBody}>{q.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
