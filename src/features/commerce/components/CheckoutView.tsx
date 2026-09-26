'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import { ApiError } from '@/lib/api/errors';
import { stars } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useCheckout, useQuote } from '../api';
import { createCardToken, formatCardNumber, formatExpiry } from '../payments';
import type { BnplProvider, CheckoutTarget, PaymentMethod, QuoteInput } from '../types';
import styles from './Commerce.module.css';

const METHODS = ['card', 'bnpl', 'paypal'] as const;
const BNPL_PROVIDERS = ['klarna', 'afterpay'] as const;

type Errors = Partial<Record<'name' | 'email' | 'card' | 'expiry' | 'cvc' | 'terms' | 'gift' | 'form', string>>;

/**
 * Checkout. Every figure comes from the quote endpoint (recomputed on each change); the client never adds up prices.
 * Payment details go to the provider boundary in ../payments.ts, never to our API.
 */
export function CheckoutView({
  target,
  initialPlan,
  initialCoupon,
}: {
  target: CheckoutTarget;
  initialPlan: 'full' | 'installments';
  initialCoupon: string | null;
}) {
  const t = useTranslations('checkout');
  const tc = useTranslations('common');
  const f = useFormat();
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const { user } = useSession();
  const checkout = useCheckout();

  const [plan, setPlan] = useState(initialPlan);
  const [gift, setGift] = useState(false);
  const [giftTo, setGiftTo] = useState('');
  const [giftMsg, setGiftMsg] = useState('');
  const [seats, setSeats] = useState(1);
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [bnpl, setBnpl] = useState<BnplProvider>('klarna');
  // null = untouched, so the fields follow the signed-in learner until they type.
  const [nameInput, setName] = useState<string | null>(null);
  const [emailInput, setEmail] = useState<string | null>(null);
  const name = nameInput ?? user?.name ?? '';
  const email = emailInput ?? user?.email ?? '';
  const [card, setCard] = useState({ number: '', expiry: '', cvc: '' });
  const [country, setCountry] = useState('United States');
  const [terms, setTerms] = useState(false);
  const [couponInput, setCouponInput] = useState(initialCoupon ?? '');
  const [coupon, setCoupon] = useState<string | null>(initialCoupon);
  const [bump, setBump] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const isMembership = target.kind === 'membership';
  const quoteInput: QuoteInput = { target, plan, couponCode: coupon, orderBump: bump, seats: gift ? 1 : seats, country };
  const { data: q, isError: quoteError, error: quoteErr } = useQuote(quoteInput);

  const backHref =
    target.kind === 'course'
      ? routes.course(target.courseSlug)
      : target.kind === 'membership'
        ? routes.membership
        : target.kind === 'cart'
          ? routes.cart
          : routes.courses;
  const backLabel =
    target.kind === 'course'
      ? t('backToCourse')
      : target.kind === 'membership'
        ? t('backToMembership')
        : target.kind === 'cart'
          ? t('backToCart')
          : t('backToCourses');

  const pay = (e?: SyntheticEvent, override?: PaymentMethod) => {
    e?.preventDefault();
    const m = override ?? method;
    const found: Errors = {};
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.name = t('errNameEmail');
    if (gift && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(giftTo.trim())) found.gift = t('errGift');
    let paymentToken: string | null = null;
    if (m === 'card') {
      const r = createCardToken(card);
      if ('error' in r) found[r.error === 'number' ? 'card' : r.error] = r.error === 'number' ? t('errCard') : t('errExpiry');
      else paymentToken = r.token;
    }
    if (!terms) found.terms = t('errTerms');
    if (Object.keys(found).length) {
      setErrors({ ...found, form: Object.values(found)[0] });
      return;
    }
    setErrors({});
    checkout.mutate(
      {
        ...quoteInput,
        name: name.trim(),
        email: email.trim(),
        acceptTerms: terms,
        paymentMethod: m,
        bnplProvider: m === 'bnpl' ? bnpl : null,
        paymentToken,
        gift: gift ? { recipientEmail: giftTo.trim(), message: giftMsg.trim() } : null,
      },
      {
        onSuccess: (order) => {
          setCard({ number: '', expiry: '', cvc: '' });
          if (m === 'bnpl') toast(t('bnplApproved', { provider: t(`bnpl.${bnpl}`) }));
          router.push(routes.orderSuccess(order.id));
        },
        onError: (err) => {
          if (err instanceof ApiError && err.isValidation) setErrors({ form: Object.values(err.fieldErrors)[0] ?? err.message });
          else setErrors({ form: t('errGeneric') });
        },
      },
    );
  };

  if (quoteError) {
    return (
      <div className="alert alert-bad" role="alert" style={{ marginTop: 24 }}>
        {quoteErr instanceof ApiError ? (Object.values(quoteErr.fieldErrors)[0] ?? quoteErr.message) : tc('errorBody')}{' '}
        <Link href={backHref}>{backLabel}</Link>
      </div>
    );
  }

  const payLabel = !q
    ? t('pay')
    : gift
      ? t('payGift', { amount: f.money(q.dueToday) })
      : q.installments
        ? t('payPlan', { amount: f.money(q.dueToday) })
        : isMembership
          ? t('payMembership', { amount: f.money(q.dueToday) })
          : t('payAmount', { amount: f.money(q.dueToday) });

  return (
    <>
      <Link href={backHref} className={styles.back}>
        {`← ${backLabel}`}
      </Link>
      <div className={styles.checkoutHead}>
        <h1 className="h1-sm">{t('title')}</h1>
        <span className={styles.secure}>{t('secure')}</span>
      </div>
      <ol className={styles.steps} aria-label={t('progress')}>
        <li data-state="done">
          <span className={styles.stepNum} aria-hidden="true">
            ✓
          </span>
          {t('stepCart')}
        </li>
        <li data-state="current" aria-current="step">
          <span className={styles.stepNum} aria-hidden="true">
            2
          </span>
          {t('stepPayment')}
        </li>
        <li>
          <span className={styles.stepNum} aria-hidden="true">
            3
          </span>
          {t('stepStart')}
        </li>
      </ol>

      <div className={styles.checkoutGrid}>
        <form className={styles.panel} onSubmit={pay} noValidate aria-describedby={errors.form ? `${id}-err` : undefined}>
          {q?.installmentOption && (
            <fieldset className={styles.planGrid}>
              <legend>{t('howToPay')}</legend>
              <label className="option">
                <input type="radio" className="sr-only" name={`${id}-plan`} checked={plan === 'full'} onChange={() => setPlan('full')} />
                <span className="radio-dot" aria-hidden="true" />
                <span>
                  <span className={styles.optTitle} style={{ display: 'block' }}>
                    {t('payInFull', { amount: f.money(q.fullAmount) })}
                  </span>
                  <span className={styles.optSub}>{t('payInFullSub')}</span>
                </span>
              </label>
              <label className="option">
                <input
                  type="radio"
                  className="sr-only"
                  name={`${id}-plan`}
                  checked={plan === 'installments'}
                  onChange={() => setPlan('installments')}
                />
                <span className="radio-dot" aria-hidden="true" />
                <span>
                  <span className={styles.optTitle} style={{ display: 'block' }}>
                    {t('planOption', { count: q.installmentOption.count, amount: f.money(q.installmentOption.amount) })}
                  </span>
                  <span className={styles.optSub}>{t('planOptionSub')}</span>
                </span>
              </label>
            </fieldset>
          )}
          {q?.installments && (
            <p className={styles.planNote}>{t('planNote', { amount: f.money(q.installments.amount), rest: q.installments.count - 1 })}</p>
          )}

          {!isMembership && (
            <div className={styles.extras}>
              <div className={styles.extra}>
                <div className={styles.extraText}>
                  <p className={styles.extraTitle} id={`${id}-gift-l`}>
                    {t('gift')}
                  </p>
                  <p className={styles.extraSub}>{t('giftSub')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  className="switch"
                  aria-checked={gift}
                  aria-labelledby={`${id}-gift-l`}
                  onClick={() => setGift((g) => !g)}
                />
              </div>
              {gift && (
                <div className={styles.extraFields}>
                  <div className="field">
                    <label className="field-label" htmlFor={`${id}-gto`}>
                      {t('giftTo')}
                    </label>
                    <input
                      id={`${id}-gto`}
                      className="input"
                      type="email"
                      value={giftTo}
                      onChange={(e) => setGiftTo(e.target.value)}
                      aria-invalid={!!errors.gift}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor={`${id}-gmsg`}>
                      {t('giftMessage')}
                    </label>
                    <textarea
                      id={`${id}-gmsg`}
                      className="textarea"
                      rows={2}
                      style={{ minHeight: 64 }}
                      value={giftMsg}
                      onChange={(e) => setGiftMsg(e.target.value)}
                    />
                  </div>
                  <p className={styles.extraSub}>{t('giftNote')}</p>
                </div>
              )}
              {!gift && (
                <div className={styles.extra}>
                  <div className={styles.extraText}>
                    <p className={styles.extraTitle}>{t('team')}</p>
                    <p className={styles.extraSub}>{seats > 1 ? t('teamNote', { count: seats }) : t('teamSub')}</p>
                  </div>
                  <label className="sr-only" htmlFor={`${id}-seats`}>
                    {t('seats')}
                  </label>
                  <input
                    id={`${id}-seats`}
                    className={`input ${styles.seats}`}
                    type="number"
                    min={1}
                    max={100}
                    inputMode="numeric"
                    value={seats}
                    onChange={(e) => setSeats(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                  />
                  <span className={styles.extraSub} aria-hidden="true">
                    {t('seats')}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className={styles.express}>
            <button
              type="button"
              className={`btn btn-lg ${styles.apple}`}
              disabled={checkout.isPending}
              onClick={() => pay(undefined, 'wallet')}
            >
              {t('applePay')}
            </button>
            <button type="button" className="btn btn-outline btn-lg" disabled={checkout.isPending} onClick={() => pay(undefined, 'wallet')}>
              {t('googlePay')}
            </button>
          </div>
          <p className={styles.divider}>{t('orPayAnotherWay')}</p>
          <div className={styles.methods} role="group" aria-label={t('method')}>
            {METHODS.map((m) => (
              <button key={m} type="button" className={styles.method} aria-pressed={method === m} onClick={() => setMethod(m)}>
                {t(`methods.${m}`)}
              </button>
            ))}
          </div>

          <div className={styles.fields2}>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-name`}>
                {t('name')}
              </label>
              <input
                id={`${id}-name`}
                className="input"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!errors.name}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-email`}>
                {t('email')}
              </label>
              <input
                id={`${id}-email`}
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!errors.name}
              />
            </div>
          </div>

          {method === 'card' && (
            <>
              <div className="field">
                <label className="field-label" htmlFor={`${id}-cc`}>
                  {t('cardNumber')}
                </label>
                <input
                  id={`${id}-cc`}
                  className="input"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="4242 4242 4242 4242"
                  value={card.number}
                  onChange={(e) => setCard((c) => ({ ...c, number: formatCardNumber(e.target.value) }))}
                  aria-invalid={!!errors.card}
                />
              </div>
              <div className={styles.fields2}>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-exp`}>
                    {t('expiry')}
                  </label>
                  <input
                    id={`${id}-exp`}
                    className="input"
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    placeholder={t('expiryPlaceholder')}
                    value={card.expiry}
                    onChange={(e) => setCard((c) => ({ ...c, expiry: formatExpiry(e.target.value) }))}
                    aria-invalid={!!errors.expiry}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-cvc`}>
                    {t('cvc')}
                  </label>
                  <input
                    id={`${id}-cvc`}
                    className="input"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    placeholder="123"
                    value={card.cvc}
                    onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    aria-invalid={!!errors.cvc}
                  />
                </div>
              </div>
            </>
          )}
          {method === 'bnpl' && q && (
            <>
              <fieldset className={styles.bnplOpts}>
                <legend className="sr-only">{t('bnplProvider')}</legend>
                {BNPL_PROVIDERS.map((p) => (
                  <label key={p} className="option">
                    <input type="radio" className="sr-only" name={`${id}-bnpl`} checked={bnpl === p} onChange={() => setBnpl(p)} />
                    <span className="radio-dot" aria-hidden="true" />
                    <span className={styles.optTitle}>{t(`bnpl.${p}`)}</span>
                  </label>
                ))}
              </fieldset>
              <p className={styles.planNote}>
                <b>{t('bnplSplit', { count: q.bnpl.count, amount: f.money(q.bnpl.amount) })}</b>{' '}
                {t('bnplNote', { provider: t(`bnpl.${bnpl}`) })}
              </p>
            </>
          )}
          {method === 'paypal' && <p className={styles.planNote}>{t('paypalNote')}</p>}

          <div className="field">
            <label className="field-label" htmlFor={`${id}-country`}>
              {t('country')}
            </label>
            <select id={`${id}-country`} className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
              {(q?.countries ?? [country]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <label className="check">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} aria-invalid={!!errors.terms} />
            <span>
              {t.rich('terms', {
                days: q?.guaranteeDays ?? 30,
                terms: (c) => (
                  <Link href={routes.terms} target="_blank">
                    {c}
                  </Link>
                ),
                refund: (c) => (
                  <Link href={routes.refund} target="_blank">
                    {c}
                  </Link>
                ),
              })}
            </span>
          </label>

          {errors.form && (
            <p id={`${id}-err`} className="alert alert-bad" role="alert">
              {errors.form}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={checkout.isPending || !q}>
            {method === 'paypal' ? t('payWithPaypal') : method === 'bnpl' ? t('payWithBnpl', { provider: t(`bnpl.${bnpl}`) }) : payLabel}
          </button>
          <p className={styles.fineprint}>{t('securedBy', { days: q?.guaranteeDays ?? 30 })}</p>
        </form>

        <aside className={styles.orderBox} aria-labelledby={`${id}-sum`}>
          <h2 id={`${id}-sum`} className="sr-only">
            {t('orderSummary')}
          </h2>
          {q ? (
            <>
              {q.lines.map((l) => (
                <div key={l.title} className={styles.line}>
                  <CourseCover cover={l.cover} height={48} radius={10} className={styles.lineCover} sizes="64px" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className={styles.lineTitle}>{l.title}</p>
                    <p className={styles.lineMeta}>
                      {l.quantity > 1 ? t('lineSeats', { count: l.quantity, price: f.money(l.price) }) : f.money(l.price)}
                    </p>
                  </div>
                </div>
              ))}
              <form
                className={styles.coupon}
                onSubmit={(e) => {
                  e.preventDefault();
                  setCoupon(couponInput.trim() || null);
                }}
              >
                <label htmlFor={`${id}-coupon`} className="sr-only">
                  {t('coupon')}
                </label>
                <input
                  id={`${id}-coupon`}
                  className="input"
                  placeholder={t('coupon')}
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                />
                <button type="submit" className="btn btn-outline">
                  {t('apply')}
                </button>
              </form>
              {q.coupon && (
                <p className={q.coupon.valid ? styles.couponOk : styles.couponBad} role="status">
                  {q.coupon.message}
                </p>
              )}
              {q.orderBump && (
                <label className={styles.bump}>
                  <input type="checkbox" checked={bump} onChange={(e) => setBump(e.target.checked)} />
                  <span>
                    <span className={styles.extraTitle} style={{ display: 'block' }}>
                      {q.orderBump.title} · {f.money(q.orderBump.price)}
                    </span>
                    <span className={styles.extraSub}>{q.orderBump.description}</span>
                  </span>
                </label>
              )}
              <dl className={styles.totals} style={{ marginTop: 18 }}>
                <div>
                  <dt>{t('subtotal')}</dt>
                  <dd>{f.money(q.subtotal)}</dd>
                </div>
                {q.discount.amount > 0 && (
                  <div className={styles.discount}>
                    <dt>{t('discount')}</dt>
                    <dd>−{f.money(q.discount)}</dd>
                  </div>
                )}
                {bump && q.orderBump && (
                  <div>
                    <dt>{q.orderBump.title}</dt>
                    <dd>{f.money(q.orderBump.price)}</dd>
                  </div>
                )}
                {q.taxLabel && (
                  <div>
                    <dt>{q.taxLabel}</dt>
                    <dd>{f.money(q.tax)}</dd>
                  </div>
                )}
                <div className={styles.total}>
                  <dt>{q.installments ? t('dueToday') : t('total')}</dt>
                  <dd>{f.money(q.dueToday)}</dd>
                </div>
                {q.installments && (
                  <div>
                    <dt>{t('planTotal')}</dt>
                    <dd>{f.money(q.total)}</dd>
                  </div>
                )}
              </dl>
              {q.proof && (
                <figure className={styles.proof} style={{ margin: 0 }}>
                  <span
                    className="avatar"
                    style={{ width: 32, height: 32, fontSize: 11.5, background: q.proof.author.color }}
                    aria-hidden="true"
                  >
                    {q.proof.author.initials}
                  </span>
                  <div>
                    <p
                      className="stars"
                      style={{ fontSize: 11, letterSpacing: 2 }}
                      aria-label={tc('ratingLabel', { rating: q.proof.rating })}
                    >
                      {stars(q.proof.rating)}
                    </p>
                    <blockquote>{q.proof.quote}</blockquote>
                    <figcaption>
                      {q.proof.author.name} · {q.proof.context}
                    </figcaption>
                  </div>
                </figure>
              )}
              <ul className={`ticks ${styles.trust}`}>
                <li>{t('trustInstant')}</li>
                <li>{t('trustGuarantee', { days: q.guaranteeDays })}</li>
                {q.enrolledCount !== null && <li>{t('trustEnrolled', { count: q.enrolledCount })}</li>}
              </ul>
            </>
          ) : (
            <div className="skeleton" style={{ height: 260 }} />
          )}
        </aside>
      </div>
    </>
  );
}
