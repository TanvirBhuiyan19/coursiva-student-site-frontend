'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import type { ProductPage } from '@/features/commerce/types';
import { useLocalizedRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api/errors';
import { routes } from '@/lib/routes';
import { detectTimeZone, isTimeZone } from '@/lib/timezone';
import { useFormat } from '@/lib/useFormat';
import { useBook, useMyBookings } from '../api';
import { formatWhen } from '../format';
import type { BookInput, ServiceInfo } from '../types';
import styles from './Bookings.module.css';
import { SlotPicker } from './SlotPicker';

const noSubscribe = () => () => undefined;

/** The browser's zone after hydration ('' while server-rendering, so the guest HTML stays cacheable). */
function useBrowserTimeZone() {
  return useSyncExternalStore(
    noSubscribe,
    () => detectTimeZone() ?? 'UTC',
    () => '',
  );
}

/** Laravel's `answers.{key}` comes back camelCased (`answers.goalArea`): find the question it belongs to. */
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

type Errors = Record<string, string>;

/** The phone field's error key (the API's field name). */
const PHONE = 'phone';

/**
 * A service's booking box on its sales page: pick a time in the learner's zone, answer the intake questions, book.
 * With a session credit it books at once; otherwise the slot is held for 15 minutes and the learner pays at checkout.
 * Guests go to sign-in and come back to the same time (`?slot=&tz=`).
 */
export function ServiceBooking({ product, service }: { product: ProductPage; service: ServiceInfo }) {
  const t = useTranslations('bookings');
  const f = useFormat();
  const locale = useLocale();
  const id = useId();
  const sp = useSearchParams();
  const router = useLocalizedRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { isSignedIn, isLoading } = useSession();
  const mine = useMyBookings(isSignedIn);
  const book = useBook(product.slug);
  const browserZone = useBrowserTimeZone();
  const returnedZone = sp.get('tz');
  const [zone, setZone] = useState<string | null>(null);
  const timezone = zone ?? (isTimeZone(returnedZone) ? returnedZone : browserZone);
  // undefined = untouched: the time the learner had picked before signing in.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const selected = picked === undefined ? sp.get('slot') : picked;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const credit = mine.data?.credits.find((c) => c.productSlug === product.slug && c.remaining > 0) ?? null;
  const askPhone = service.locationType === 'phone';
  const returnPath = (slot: string) =>
    `${routes.product(product.slug)}?slot=${encodeURIComponent(slot)}&tz=${encodeURIComponent(timezone)}`;

  const fieldErrors = (err: ApiError): Errors => {
    const found: Errors = {};
    for (const [k, v] of Object.entries(err.fieldErrors)) {
      const q = k.startsWith('answers.')
        ? service.intakeQuestions.find((x) => k === `answers.${x.key}` || k === `answers.${camel(x.key)}`)
        : null;
      if (q) found[`answers.${q.key}`] = v;
      else if (k === 'phone') found.phone = v;
      else if (!found.form) found.form = v;
    }
    return Object.keys(found).length ? found : { form: err.message };
  };

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!selected) {
      setErrors({ form: t('pickFirst') });
      return;
    }
    const found: Errors = {};
    for (const q of service.intakeQuestions)
      if (q.required && !(answers[q.key] ?? '').trim()) found[`answers.${q.key}`] = t('answerRequired', { label: q.label });
    if (askPhone && !phone.trim()) found.phone = t('phoneRequired');
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    if (!isSignedIn) {
      router.push(routes.signIn(returnPath(selected)));
      return;
    }
    setErrors({});
    const input: BookInput = {
      startsAt: selected,
      timezone,
      answers: Object.fromEntries(
        service.intakeQuestions.flatMap((q) => {
          const v = (answers[q.key] ?? '').trim();
          return v ? [[q.key, v]] : [];
        }),
      ),
      ...(askPhone ? { phone: phone.trim() } : {}),
    };
    book.mutate(input, {
      onSuccess: (r) => {
        if (r.next === 'confirmed') {
          toast(t('bookedToast', { title: product.title, when: formatWhen(r.booking.startsAt, locale, timezone) }));
          router.push(routes.accountBooking(r.booking.id));
          return;
        }
        const path = r.checkoutUrlPath;
        router.push(path.startsWith('/') && !path.startsWith('//') ? path : routes.checkoutProduct(product.slug));
      },
      onError: (err) => {
        if (err instanceof ApiError && err.isConflict) {
          // Someone got there first: say so, drop the time and show what is still open.
          setErrors({ form: err.message });
          setPicked(null);
          void qc.invalidateQueries({ queryKey: ['bookings', 'availability', product.slug] });
        } else if (err instanceof ApiError && err.isUnauthenticated) router.push(routes.signIn(returnPath(selected)));
        else if (err instanceof ApiError && err.isValidation) setErrors(fieldErrors(err));
        else setErrors({ form: t('errGeneric') });
      },
    });
  };

  const label = credit
    ? t('bookWithCredit')
    : product.price.amount === 0
      ? t('bookFree')
      : isSignedIn
        ? t('bookAndPay', { price: f.money(product.price) })
        : t('signInToBook', { price: f.money(product.price) });

  const field = (key: string) => ({
    'aria-invalid': !!errors[key],
    'aria-describedby': errors[key] ? `${id}-${key}-err` : undefined,
  });
  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`${id}-${key}-err`} className="field-error">
        {errors[key]}
      </p>
    ) : null;

  return (
    <section aria-labelledby={`${id}-pick`} className={styles.booking}>
      <h2 id={`${id}-pick`} className="h3">
        {t('pickTitle')}
      </h2>
      {credit && (
        <p className="alert alert-ok" role="status">
          <b>{t('credits', { count: credit.remaining })}</b> {t('creditsNote')}
        </p>
      )}
      {browserZone ? (
        <SlotPicker
          slug={product.slug}
          timezone={timezone}
          onTimezoneChange={setZone}
          selected={selected}
          onSelect={(s) => {
            setPicked(s);
            setErrors((x) => ({ ...x, form: '' }));
          }}
        />
      ) : (
        <div className="skeleton" style={{ height: 220 }} />
      )}
      {selected && browserZone && (
        <p className={styles.selected} aria-live="polite">
          {t('selected', { when: formatWhen(selected, locale, timezone) })}
        </p>
      )}

      <form onSubmit={submit} noValidate className={styles.form}>
        {(service.intakeQuestions.length > 0 || askPhone) && (
          <fieldset className={styles.intake}>
            <legend className={styles.legend}>{t('detailsTitle')}</legend>
            {service.intakeQuestions.map((q) => {
              const key = `answers.${q.key}`;
              const props = {
                id: `${id}-${q.key}`,
                value: answers[q.key] ?? '',
                maxLength: 2000,
                required: q.required,
                onChange: (e: { target: { value: string } }) => setAnswers((a) => ({ ...a, [q.key]: e.target.value })),
                ...field(key),
              };
              return (
                <div key={q.key} className="field">
                  <label className="field-label" htmlFor={`${id}-${q.key}`}>
                    {q.label}
                    {!q.required && <span className={styles.optional}> {t('optional')}</span>}
                  </label>
                  {q.type === 'textarea' ? <textarea className="textarea" rows={3} {...props} /> : <input className="input" {...props} />}
                  {fieldError(key)}
                </div>
              );
            })}
            {askPhone && (
              <div className="field">
                <label className="field-label" htmlFor={`${id}-phone`}>
                  {t('phone')}
                </label>
                <input
                  id={`${id}-phone`}
                  className="input"
                  type="tel"
                  autoComplete="tel"
                  maxLength={40}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  {...field(PHONE)}
                />
                {fieldError(PHONE) ?? <p className="field-hint">{t('phoneHint')}</p>}
              </div>
            )}
          </fieldset>
        )}
        {errors.form && (
          <p className="alert alert-bad" role="alert">
            {errors.form}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-lg" disabled={book.isPending || isLoading} aria-busy={book.isPending}>
          {label}
        </button>
        <p className={styles.policy}>
          {service.cancelNoticeHours > 0 ? t('cancelPolicy', { hours: service.cancelNoticeHours }) : t('cancelPolicyNone')}
        </p>
      </form>
    </section>
  );
}
