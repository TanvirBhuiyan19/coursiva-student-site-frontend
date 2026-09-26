'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useAskQuestion, useLesson, usePlayerCourse, useSaveNote, useSubmitQuiz, useToggleComplete } from '../api';
import type { Lesson, PlayerCourse, QuizResult } from '../types';
import styles from './Player.module.css';
import { VideoPlayer } from './VideoPlayer';

/**
 * The course player. The URL holds the lesson (`/learn/<course>/<lesson>`), so a lesson is linkable, reload-safe and
 * works with the back button. Without a lesson id it resumes at the first incomplete lesson.
 */
export function Player({ courseSlug, lessonId }: { courseSlug: string; lessonId: string | null }) {
  const t = useTranslations('player');
  const tc = useTranslations('common');
  const router = useRouter();
  const welcome = useSearchParams().get('welcome') === '1';
  const course = usePlayerCourse(courseSlug);
  const lesson = useLesson(lessonId);
  const mainRef = useRef<HTMLDivElement>(null);

  // No lesson in the URL → resume where the learner left off.
  useEffect(() => {
    if (lessonId || !course.data) return;
    const all = course.data.modules.flatMap((m) => m.lessons);
    const next = all.find((l) => !l.completed) ?? all[0];
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
        {lesson.isPending || !lesson.data ? (
          <div className="skeleton" style={{ aspectRatio: '16 / 9', maxWidth: 860 }} />
        ) : (
          <LessonView key={lesson.data.id} lesson={lesson.data} course={course.data} />
        )}
      </div>
    </div>
  );
}

function Sidebar({ course, currentId }: { course: PlayerCourse; currentId: string | null }) {
  const t = useTranslations('player');
  const tc = useTranslations('common');
  const f = useFormat();
  return (
    <aside className={styles.aside} aria-label={t('contents')}>
      <div className={styles.asideHead}>
        <Link href={routes.course(course.slug)} className={styles.back}>
          {t('coursePage')}
        </Link>
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
                return (
                  <li key={l.id}>
                    {/* No prefetch: lesson content loads through the API; prefetching every lesson page would be wasted requests. */}
                    <Link
                      prefetch={false}
                      href={routes.player(course.slug, l.id)}
                      className={styles.lessonLink}
                      aria-current={current ? 'page' : undefined}
                      data-done={l.completed}
                    >
                      <span className={styles.dot} data-done={l.completed} data-current={current} aria-hidden="true">
                        {l.completed ? '✓' : l.type === 'quiz' ? '?' : ''}
                      </span>
                      <span className={styles.lessonName}>
                        {l.title}
                        {l.completed && <span className="sr-only"> ({t('completed')})</span>}
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

function LessonView({ lesson, course }: { lesson: Lesson; course: PlayerCourse }) {
  const t = useTranslations('player');
  const f = useFormat();
  const router = useRouter();
  const toast = useToast();
  const toggle = useToggleComplete(course.slug);
  const next = () => router.push(lesson.nextLessonId ? routes.player(course.slug, lesson.nextLessonId) : routes.learning);

  return (
    <article className={styles.lesson}>
      {lesson.video && <VideoPlayer lesson={lesson} />}
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

      <div className={styles.titleRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className={styles.module}>{lesson.moduleTitle}</p>
          <h1 className={styles.title} tabIndex={-1}>
            {lesson.title}
          </h1>
        </div>
        {lesson.type !== 'quiz' && (
          <button
            type="button"
            className={`btn btn-lg ${lesson.completed ? 'btn-success' : 'btn-primary'}`}
            aria-pressed={lesson.completed}
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate(
                { lessonId: lesson.id, completed: !lesson.completed },
                { onSuccess: (r) => r.progress.percent === 100 && r.completed && toast(t('courseComplete', { title: course.title })) },
              )
            }
          >
            {lesson.completed ? t('completedBtn') : t('markComplete')}
          </button>
        )}
        <button type="button" className="btn btn-outline btn-lg" onClick={next}>
          {lesson.nextLessonId ? t('next') : t('finish')}
        </button>
      </div>
      <p className={styles.desc}>{lesson.description}</p>

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

      <Notes lesson={lesson} />
      <QA lesson={lesson} course={course} />
    </article>
  );
}

function Quiz({ lesson, courseSlug, onContinue }: { lesson: Lesson; courseSlug: string; onContinue: () => void }) {
  const t = useTranslations('player');
  const id = useId();
  const quiz = lesson.quiz!;
  const submit = useSubmitQuiz(courseSlug, lesson.id);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (Object.keys(answers).length < quiz.questions.length) {
      setError(t('answerAll', { count: quiz.questions.length }));
      return;
    }
    submit.mutate(
      { answers: Object.entries(answers).map(([questionId, optionId]) => ({ questionId, optionId })) },
      { onSuccess: setResult, onError: (err) => setError(err instanceof ApiError ? err.message : t('quizFailed')) },
    );
  };

  return (
    <section className={styles.quiz} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="eyebrow eyebrow-brand">
        {t('quizEyebrow', { pass: quiz.passPercent })}
      </h2>
      {result ? (
        <div className={styles.result} data-pass={result.passed} role="status">
          <p className={styles.score}>{result.scorePercent}%</p>
          <p className={styles.resultMsg}>{result.passed ? t('passed') : t('failed', { correct: result.correct, total: result.total })}</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            {result.passed ? (
              <button type="button" className="btn btn-primary" onClick={onContinue}>
                {t('continue')}
              </button>
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
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className={styles.quizForm} noValidate>
          {quiz.questions.map((q, qi) => (
            <fieldset key={q.id} className={styles.question}>
              <legend className={styles.prompt}>
                {qi + 1}. {q.prompt}
              </legend>
              <div className={styles.options}>
                {q.options.map((o) => (
                  <label key={o.id} className="option">
                    <input
                      type="radio"
                      className="sr-only"
                      name={q.id}
                      value={o.id}
                      checked={answers[q.id] === o.id}
                      onChange={() => {
                        setAnswers((a) => ({ ...a, [q.id]: o.id }));
                        setError(null);
                      }}
                    />
                    <span className="radio-dot" aria-hidden="true" />
                    <span style={{ fontSize: 14 }}>{o.label}</span>
                  </label>
                ))}
              </div>
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
          ask.mutate(draft.trim(), {
            onSuccess: () => {
              setDraft('');
              toast(t('asked'));
            },
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
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={ask.isPending || !draft.trim()}>
          {t('ask')}
        </button>
      </form>
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
