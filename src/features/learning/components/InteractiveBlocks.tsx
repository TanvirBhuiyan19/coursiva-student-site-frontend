'use client';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type DragEvent, type KeyboardEvent, type SyntheticEvent } from 'react';
import { ApiError } from '@/lib/api/errors';
import { useCheckBlock, useContinueBlock, useSortBlock } from '../api';
import type {
  CheckAnswer,
  CheckResult,
  LearnerAccordionBlock,
  LearnerCheckBlock,
  LearnerContinueBlock,
  LearnerFlashcardsBlock,
  LearnerHotspotsBlock,
  LearnerProcessBlock,
  LearnerSortingBlock,
  LearnerTabsBlock,
  LearnerTimelineBlock,
  SortResult,
} from '../types';
import styles from './InteractiveBlocks.module.css';

/** The message for a failed answer: the API's validation message, the enrol prompt when the learner isn't enrolled (403), else `fallback`. */
function answerError(err: unknown, fallback: string, enrol: string): string {
  if (err instanceof ApiError && err.status === 422) return err.message;
  if (err instanceof ApiError && err.status === 403) return enrol;
  return fallback;
}

/**
 * Interactive lesson blocks (course builder v2 O3). Every `html` / `questionHtml` is the API's sanitised Markdown (the
 * `bodyHtml` rules) and the only HTML inserted; titles, card faces, items and feedback are plain text.
 *
 * `lessonId` is null in the guest course preview: checks and sorting can be tried but not checked (answers are graded
 * by the API only), and a continue gate ends the preview.
 */

/** Arrow keys (mirrored in RTL), Home and End → the index to move to, or null for other keys. */
function rovingIndex(e: KeyboardEvent, i: number, count: number): number | null {
  const rtl = typeof document !== 'undefined' && document.dir === 'rtl';
  const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
  if (step !== undefined) return (i + step + count) % count;
  if (e.key === 'Home') return 0;
  if (e.key === 'End') return count - 1;
  return null;
}

/* ── accordion / tabs / process / timeline ─────────────────────────────────────────────────────────────────── */

export function AccordionBlock({ block: b }: { block: LearnerAccordionBlock }) {
  return (
    <div className={`accordion ${styles.accordion}`}>
      {b.items.map((item, i) => (
        <details key={i}>
          <summary>{item.title}</summary>
          {/* Sanitised by the API. */}
          <div className="accordion-body rich-text" dangerouslySetInnerHTML={{ __html: item.html }} />
        </details>
      ))}
    </div>
  );
}

/** WAI-ARIA tabs with automatic activation: arrow keys, Home and End move between tabs. */
export function TabsBlock({ block: b }: { block: LearnerTabsBlock }) {
  const id = useId();
  const [index, setIndex] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const count = b.items.length;
  const active = Math.min(index, count - 1);
  const onKey = (e: KeyboardEvent) => {
    const next = rovingIndex(e, active, count);
    if (next === null) return;
    e.preventDefault();
    setIndex(next);
    tabs.current[next]?.focus();
  };
  return (
    <div className={styles.tabs}>
      <div role="tablist" className={styles.tabList}>
        {b.items.map((item, i) => (
          <button
            key={i}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-t${i}`}
            className={styles.tab}
            aria-selected={i === active}
            aria-controls={`${id}-p${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setIndex(i)}
            onKeyDown={onKey}
          >
            {item.title}
          </button>
        ))}
      </div>
      {b.items.map((item, i) => (
        <div
          key={i}
          role="tabpanel"
          id={`${id}-p${i}`}
          aria-labelledby={`${id}-t${i}`}
          tabIndex={0}
          hidden={i !== active}
          className={`rich-text ${styles.tabPanel}`}
          // Sanitised by the API.
          dangerouslySetInnerHTML={{ __html: item.html }}
        />
      ))}
    </div>
  );
}

/** Numbered steps, one at a time, with Previous/Next and a step indicator. */
export function ProcessBlock({ block: b }: { block: LearnerProcessBlock }) {
  const t = useTranslations('lessonBlocks');
  const id = useId();
  const [index, setIndex] = useState(0);
  const count = b.items.length;
  const i = Math.min(index, count - 1);
  const step = b.items[i]!;
  return (
    <section className={styles.process} aria-label={t('steps')}>
      <ol className={styles.stepDots}>
        {b.items.map((s, n) => (
          <li key={n}>
            <button
              type="button"
              className={styles.stepDot}
              data-done={n < i || undefined}
              aria-current={n === i ? 'step' : undefined}
              aria-label={t('goToStep', { n: n + 1, title: s.title })}
              onClick={() => setIndex(n)}
            >
              {n + 1}
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.step} aria-labelledby={`${id}-s`} role="group">
        <p id={`${id}-s`} className={styles.stepHead} aria-live="polite">
          <span className={styles.stepCount}>{t('stepStatus', { n: i + 1, count })}</span>
          <span className={styles.itemTitle}>{step.title}</span>
        </p>
        {/* Sanitised by the API. */}
        <div className="rich-text" dangerouslySetInnerHTML={{ __html: step.html }} />
      </div>
      <div className={styles.navRow}>
        <button type="button" className="btn btn-outline btn-sm" disabled={i === 0} onClick={() => setIndex(i - 1)}>
          {t('previousStep')}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={i === count - 1} onClick={() => setIndex(i + 1)}>
          {t('nextStep')}
        </button>
      </div>
    </section>
  );
}

export function TimelineBlock({ block: b }: { block: LearnerTimelineBlock }) {
  return (
    <ol className={styles.timeline}>
      {b.items.map((item, i) => (
        <li key={i} className={styles.tlItem}>
          {item.date ? <p className={styles.tlDate}>{item.date}</p> : null}
          <p className={styles.itemTitle}>{item.title}</p>
          {/* Sanitised by the API. */}
          <div className="rich-text" dangerouslySetInnerHTML={{ __html: item.html }} />
        </li>
      ))}
    </ol>
  );
}

/* ── flashcards ─────────────────────────────────────────────────────────────────────────────────────────────── */

type Card = LearnerFlashcardsBlock['cards'][number];

/**
 * A card is a button: click, Enter or Space flips it. Its accessible name is the side showing ("Front: …" / "Back: …"). The flip animates unless the learner prefers reduced motion (CSS).
 */
function Flashcard({ card }: { card: Card }) {
  const t = useTranslations('lessonBlocks');
  const [flipped, setFlipped] = useState(false);
  return (
    <button
      type="button"
      className={styles.card}
      data-flipped={flipped || undefined}
      aria-label={flipped ? t('cardBack', { text: card.back }) : t('cardFront', { text: card.front })}
      onClick={() => setFlipped((f) => !f)}
    >
      <span className={styles.cardInner}>
        <span className={styles.cardFace} data-side="front" aria-hidden={flipped}>
          {card.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed media URL, see ImageBlock
            <img className={styles.cardImg} src={card.imageUrl} alt="" loading="lazy" decoding="async" />
          ) : null}
          <span className={styles.cardText}>{card.front}</span>
        </span>
        <span className={styles.cardFace} data-side="back" aria-hidden={!flipped}>
          <span className={styles.cardText}>{card.back}</span>
        </span>
      </span>
      <span className={styles.flipHint} aria-hidden="true">
        {t('flip')}
      </span>
    </button>
  );
}

export function FlashcardsBlock({ block: b }: { block: LearnerFlashcardsBlock }) {
  const t = useTranslations('lessonBlocks');
  const id = useId();
  const [index, setIndex] = useState(0);
  const count = b.cards.length;
  if (b.style !== 'stack' || count === 1)
    return (
      <ul className={styles.cardGrid} aria-label={t('flashcards')}>
        {b.cards.map((card, i) => (
          <li key={i}>
            <Flashcard card={card} />
          </li>
        ))}
      </ul>
    );
  const i = Math.min(index, count - 1);
  return (
    <section className={styles.cardStack} aria-label={t('flashcards')}>
      {/* Keyed by index: moving to another card shows its front. */}
      <Flashcard key={i} card={b.cards[i]!} />
      <div className={styles.navRow}>
        <button type="button" className="btn btn-outline btn-sm" disabled={i === 0} onClick={() => setIndex(i - 1)}>
          {t('previousCard')}
        </button>
        <p id={`${id}-n`} className={styles.counter} aria-live="polite">
          {t('cardStatus', { n: i + 1, count })}
        </p>
        <button type="button" className="btn btn-outline btn-sm" disabled={i === count - 1} onClick={() => setIndex(i + 1)}>
          {t('nextCard')}
        </button>
      </div>
    </section>
  );
}

/* ── hotspots ───────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Numbered buttons over the image open a panel under it (Escape closes it and returns focus). The same points are
 * listed in a disclosure below, for screen readers and small screens.
 */
export function HotspotsBlock({ block: b }: { block: LearnerHotspotsBlock }) {
  const t = useTranslations('lessonBlocks');
  const id = useId();
  const [open, setOpen] = useState<number | null>(null);
  const spots = useRef<(HTMLButtonElement | null)[]>([]);
  const spot = open === null ? null : b.spots[open];
  const close = () => {
    const was = open;
    setOpen(null);
    if (was !== null) spots.current[was]?.focus();
  };
  const pct = (n: number) => `${Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0}%`;
  const onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open !== null) {
      e.preventDefault();
      close();
    }
  };
  return (
    <figure className={styles.hotspots}>
      <div className={styles.hsStage}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed media URL, see ImageBlock */}
        <img className={styles.hsImg} src={b.url} alt={b.alt} loading="lazy" decoding="async" />
        {b.spots.map((s, i) => (
          <button
            key={i}
            ref={(el) => {
              spots.current[i] = el;
            }}
            type="button"
            className={styles.spot}
            style={{ left: pct(s.x), top: pct(s.y) }}
            aria-label={s.title}
            aria-expanded={open === i}
            aria-controls={`${id}-panel`}
            onClick={() => setOpen(open === i ? null : i)}
            onKeyDown={onEscape}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} className={styles.spotPanel} role="region" aria-label={spot?.title ?? t('hotspots')} hidden={!spot}>
        {spot && (
          <>
            <div className={styles.spotHead}>
              <p className={styles.itemTitle}>{spot.title}</p>
              <button type="button" className={styles.spotClose} onClick={close} onKeyDown={onEscape} aria-label={t('closeSpot')}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {/* Sanitised by the API. */}
            <div className="rich-text" dangerouslySetInnerHTML={{ __html: spot.html }} />
          </>
        )}
      </div>
      <details className={styles.spotList}>
        <summary>{t('hotspotsList', { count: b.spots.length })}</summary>
        <ol>
          {b.spots.map((s, i) => (
            <li key={i}>
              <p className={styles.itemTitle}>{s.title}</p>
              <div className="rich-text" dangerouslySetInnerHTML={{ __html: s.html }} />
            </li>
          ))}
        </ol>
      </details>
    </figure>
  );
}

/* ── sorting ────────────────────────────────────────────────────────────────────────────────────────────────── */

const DRAG_TYPE = 'application/x-coursiva-sort-item';

const verdictAttr = (v: boolean | undefined) => (v === undefined ? undefined : v ? 'correct' : 'incorrect');

/** ✓ / ✗ (drawn by CSS) with the verdict for screen readers. */
function Mark({ ok, label }: { ok: boolean; label?: string }) {
  const t = useTranslations('lessonBlocks');
  return (
    <span className={styles.mark} data-ok={ok}>
      <span className="sr-only">{label ?? (ok ? t('correctMark') : t('incorrectMark'))}</span>
    </span>
  );
}

/**
 * Items are dragged between the "To sort" pile and the categories — or, without a pointer, each item's menu picks its
 * category. Check sends the placements; the API answers per item. Try again keeps the placements to adjust.
 */
export function SortingBlock({ block: b, lessonId }: { block: LearnerSortingBlock; lessonId: string | null }) {
  const t = useTranslations('lessonBlocks');
  const id = useId();
  const sort = useSortBlock(lessonId ?? '', b.id);
  // The last attempt's placements (state.answer) put the board back as the learner left it.
  const [placements, setPlacements] = useState<Record<string, string>>(b.state?.answer.placements ?? {});
  const [result, setResult] = useState<SortResult | null>(b.state && { correct: b.state.correct, results: b.state.results });
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const done = result !== null;
  const allPlaced = b.items.every((i) => placements[i.id]);

  const place = (itemId: string, categoryId: string) => {
    setPlacements((p) => {
      const rest = Object.fromEntries(Object.entries(p).filter(([k]) => k !== itemId));
      return categoryId ? { ...rest, [itemId]: categoryId } : rest;
    });
    setError(null);
  };
  const onDrop = (categoryId: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const itemId = e.dataTransfer.getData(DRAG_TYPE);
    if (!done && b.items.some((i) => i.id === itemId)) place(itemId, categoryId);
  };
  const onCheck = () => {
    if (!allPlaced) {
      setError(t('placeAll'));
      return;
    }
    sort.mutate(
      { placements },
      {
        onSuccess: setResult,
        onError: (err) => setError(answerError(err, t('checkFailed'), t('signInToCheck'))),
      },
    );
  };
  const right = result ? b.items.filter((i) => result.results[i.id]).length : 0;

  const zone = (categoryId: string, label: string) => {
    const items = b.items.filter((i) => (placements[i.id] ?? '') === categoryId);
    return (
      <div
        key={categoryId || '_'}
        className={styles.zone}
        data-pile={!categoryId || undefined}
        data-over={over === categoryId || undefined}
        onDragOver={(e) => {
          if (done) return;
          e.preventDefault();
          setOver(categoryId);
        }}
        onDragLeave={() => setOver(null)}
        onDrop={onDrop(categoryId)}
      >
        <p className={styles.zoneLabel} id={`${id}-z${categoryId}`}>
          {label}
        </p>
        <ul className={styles.zoneItems} aria-labelledby={`${id}-z${categoryId}`}>
          {items.map((item) => {
            const verdict = result ? result.results[item.id] : undefined;
            return (
              <li
                key={item.id}
                className={styles.sortItem}
                draggable={!done}
                data-result={verdictAttr(verdict)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, item.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
              >
                <span className={styles.sortText}>{item.text}</span>
                {verdict !== undefined && <Mark ok={verdict} />}
                <select
                  className={`select ${styles.sortSelect}`}
                  aria-label={t('categoryFor', { item: item.text })}
                  value={placements[item.id] ?? ''}
                  disabled={done}
                  onChange={(e) => place(item.id, e.target.value)}
                >
                  <option value="">{t('chooseCategory')}</option>
                  {b.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <section className={styles.interactive} aria-labelledby={`${id}-q`}>
      <p id={`${id}-q`} className={styles.prompt}>
        {b.prompt}
      </p>
      {!done && <p className={styles.hint}>{t('sortHint')}</p>}
      <div className={styles.board}>
        {b.items.some((i) => !placements[i.id]) && zone('', t('unsorted'))}
        {b.categories.map((c) => zone(c.id, c.label))}
      </div>
      <div role="status" className={styles.verdict} data-correct={result ? result.correct : undefined}>
        {result && (result.correct ? t('sortAllCorrect') : t('sortSome', { right, count: b.items.length }))}
      </div>
      {error && (
        <p role="alert" className="alert alert-bad">
          {error}
        </p>
      )}
      <Actions
        preview={!lessonId}
        done={done}
        pending={sort.isPending}
        onCheck={onCheck}
        onRetry={() => {
          setResult(null);
          setError(null);
        }}
      />
    </section>
  );
}

function Actions({
  preview,
  done,
  pending,
  onCheck,
  onRetry,
}: {
  preview: boolean;
  done: boolean;
  pending: boolean;
  /** Without it the button submits the block's form. */
  onCheck?: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations('lessonBlocks');
  if (preview) return <p className={styles.previewNote}>{t('signInToCheck')}</p>;
  return (
    <div className={styles.navRow}>
      {done ? (
        <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>
          {t('tryAgain')}
        </button>
      ) : (
        <button type={onCheck ? 'button' : 'submit'} className="btn btn-primary btn-sm" disabled={pending} onClick={onCheck}>
          {pending ? t('checking') : t('check')}
        </button>
      )}
    </div>
  );
}

/* ── knowledge check ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Single choice (radios), multiple choice (checkboxes) or fill in (a text input). Check sends the answer; the API
 * answers with the verdict, the correct options and the feedback, all shown here. Unlimited retries.
 */
export function CheckBlock({ block: b, lessonId }: { block: LearnerCheckBlock; lessonId: string | null }) {
  const t = useTranslations('lessonBlocks');
  const id = useId();
  const check = useCheckBlock(lessonId ?? '', b.id);
  const [answer, setAnswer] = useState<CheckAnswer>(b.state?.answer ?? {});
  const [result, setResult] = useState<CheckResult | null>(b.state);
  const [error, setError] = useState<string | null>(null);
  const done = result !== null;
  const picked = answer.optionIds ?? [];

  const onSubmit = (e?: SyntheticEvent) => {
    e?.preventDefault();
    if (done || !lessonId) return;
    const input: CheckAnswer = b.kind === 'fill' ? { text: (answer.text ?? '').trim() } : { optionIds: picked };
    if (b.kind === 'fill' ? !input.text : !picked.length) {
      setError(b.kind === 'fill' ? t('typeAnswer') : t('chooseAnswer'));
      return;
    }
    check.mutate(input, {
      onSuccess: setResult,
      onError: (err) => setError(answerError(err, t('checkFailed'), t('signInToCheck'))),
    });
  };
  const toggle = (optionId: string, on: boolean) => {
    setAnswer({ optionIds: b.kind === 'single' ? [optionId] : on ? [...picked, optionId] : picked.filter((x) => x !== optionId) });
    setError(null);
  };

  return (
    <form className={styles.interactive} aria-labelledby={`${id}-q`} onSubmit={onSubmit} noValidate>
      {b.required && <span className={styles.required}>{t('required')}</span>}
      {/* Sanitised by the API. */}
      <div id={`${id}-q`} className={`rich-text ${styles.question}`} dangerouslySetInnerHTML={{ __html: b.questionHtml }} />
      {b.kind === 'fill' ? (
        <input
          className={`input ${styles.fill}`}
          aria-labelledby={`${id}-q`}
          data-result={result ? (result.correct ? 'correct' : 'incorrect') : undefined}
          maxLength={200}
          autoComplete="off"
          value={answer.text ?? ''}
          readOnly={done}
          onChange={(e) => {
            setAnswer({ text: e.target.value });
            setError(null);
          }}
        />
      ) : (
        <fieldset className={styles.options} aria-labelledby={`${id}-q`} disabled={done}>
          {(b.options ?? []).map((o) => {
            const chosen = picked.includes(o.id);
            const isRight = !!result?.correctOptionIds.includes(o.id);
            // After an answer: the correct options are marked, and a wrong choice is marked wrong.
            const mark = !result ? undefined : isRight ? true : chosen ? false : undefined;
            return (
              <label key={o.id} className={styles.option} data-result={verdictAttr(mark)}>
                <input
                  type={b.kind === 'single' ? 'radio' : 'checkbox'}
                  name={`${id}-o`}
                  value={o.id}
                  checked={chosen}
                  onChange={(e) => toggle(o.id, e.target.checked)}
                />
                <span className={styles.optionText}>{o.text}</span>
                {mark !== undefined && <Mark ok={mark} label={mark ? t('correctAnswer') : undefined} />}
              </label>
            );
          })}
        </fieldset>
      )}
      <div role="status" className={styles.verdict} data-correct={result ? result.correct : undefined}>
        {result && (
          <>
            <p className={styles.verdictTitle}>{result.correct ? t('correct') : t('incorrect')}</p>
            {result.feedback ? <p className={styles.feedback}>{result.feedback}</p> : null}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="alert alert-bad">
          {error}
        </p>
      )}
      <Actions
        preview={!lessonId}
        done={done}
        pending={check.isPending}
        onRetry={() => {
          setResult(null);
          setAnswer({});
          setError(null);
        }}
      />
    </form>
  );
}

/* ── continue gate ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The first gate the learner hasn't passed (the API sends nothing after it): Continue passes it and reloads the lesson
 * so the next section appears. A passed gate renders nothing. In the guest preview it ends the content.
 */
export function ContinueBlock({ block: b, lessonId, locked }: { block: LearnerContinueBlock; lessonId: string | null; locked: number }) {
  const t = useTranslations('lessonBlocks');
  const go = useContinueBlock(lessonId ?? '', b.id);
  const [error, setError] = useState<string | null>(null);
  if (b.passed) return null;
  const hint = locked > 0 ? <p className={styles.gateHint}>{t('lockedHint', { count: locked })}</p> : null;
  if (!lessonId)
    return (
      <div className={styles.gate}>
        <p className={styles.previewNote}>{t('previewGate')}</p>
        {hint}
      </div>
    );
  return (
    <div className={styles.gate}>
      <button
        type="button"
        className="btn btn-primary"
        disabled={go.isPending}
        aria-describedby={error ? `${b.id}-err` : undefined}
        onClick={() => {
          setError(null);
          go.mutate(undefined, {
            // 422 validation_failed: errors.required carries the message (as does `message`).
            onError: (err) =>
              setError(
                err instanceof ApiError && err.status === 422
                  ? (err.fieldErrors.required ?? err.message)
                  : answerError(err, t('continueFailed'), t('signInToCheck')),
              ),
          });
        }}
      >
        {go.isPending ? t('continuing') : b.label}
      </button>
      {error && (
        <p id={`${b.id}-err`} role="alert" className="alert alert-bad">
          {error}
        </p>
      )}
      {hint}
    </div>
  );
}
