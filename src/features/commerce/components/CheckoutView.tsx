'use client';
import { Link, useLocalizedRouter } from '@/i18n/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { useToast } from '@/components/toast/Toaster';
import { useSession } from '@/features/auth/api';
import { useServiceCheckout } from '@/features/bookings/api';
import { HoldNotice } from '@/features/bookings/components/HoldNotice';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import { major, trackEvent, type TrackItem } from '@/features/tracking/events';
import { ApiError } from '@/lib/api/errors';
import { parseMoneyInput, stars, toMoneyInput } from '@/lib/format';
import { markdownToPlain } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { commerceKeys, useCheckout, useQuote, waitForPayment } from '../api';
import { elementsAmount, needsPayment, offeredMethods, type PaymentHandle } from '../payments';
import type { BnplProvider, CheckoutTarget, PaymentMethod, QuoteInput } from '../types';
import styles from './Commerce.module.css';
import { PaymentFields } from './PaymentFields';
import { CrossSellBlock, PriceOfferBanner, SeatTiers, WasPrice } from './CheckoutOffers';
import offerStyles from './Offers.module.css';
import { TaxFields, TaxLine } from './CheckoutTax';

const BNPL_PROVIDERS = ['klarna', 'afterpay'] as const;

type Errors = Partial<
  Record<'name' | 'email' | 'payment' | 'terms' | 'gift' | 'method' | 'giftCard' | 'amount' | 'region' | 'taxId' | 'form', string>
>;

/**
 * Checkout. Every figure comes from the quote endpoint (recomputed on each change); the client never adds up prices.
 * Card details are entered in the provider's fields (../payments.ts: Stripe's Payment Element, or test cards with the
 * fake gateway); only a token reaches our API. Free orders skip the payment step; 3-D Secure runs in the browser and
 * the order is read until the processor confirms it.
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
  const router = useLocalizedRouter();
  const toast = useToast();
  const { user } = useSession();
  const checkout = useCheckout();
  // A service product: its held time (countdown) and, after paying, the success page links to the bookings.
  const service = useServiceCheckout(target.kind === 'product' ? target.productSlug : null);
  const qc = useQueryClient();

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
  const paymentRef = useRef<PaymentHandle | null>(null);
  const [paying, setPaying] = useState(false);
  const [country, setCountry] = useState('United States');
  // Tax: the state or province (where the country has them) and an EU business's VAT number, typed then sent to the
  // quote after a pause. Both follow the country: changing it clears them.
  const [region, setRegion] = useState<string | null>(null);
  const [taxIdInput, setTaxIdInput] = useState('');
  const [taxId, setTaxId] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setTaxId(taxIdInput.trim() || null), 400);
    return () => clearTimeout(timer);
  }, [taxIdInput]);
  const [terms, setTerms] = useState(false);
  const [couponInput, setCouponInput] = useState(initialCoupon ?? '');
  const [coupon, setCoupon] = useState<string | null>(initialCoupon);
  const [bump, setBump] = useState(false);
  // "Frequently bought together" ticked: the API adds its courses as lines at the offer price.
  const [crossSell, setCrossSell] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  // The gift card has its own field (separate from the coupon). It is sent only after Apply, never kept in the URL.
  const [giftCardOpen, setGiftCardOpen] = useState(false);
  const [giftCardInput, setGiftCardInput] = useState('');
  const [giftCard, setGiftCard] = useState<string | null>(null);
  // A refused code stays on screen with its message but leaves the next quotes until it is applied again (it would
  // only spend the learner's attempts).
  const [refused, setRefused] = useState<{ code: string; message: string } | null>(null);
  // A pay-what-you-want course: the learner's amount as typed (null = untouched: the suggested price). The API checks
  // the minimum; an unreadable entry is never sent.
  const [amountText, setAmountText] = useState<string | null>(null);
  const amountMinor = amountText === null ? null : parseMoneyInput(amountText);

  const isMembership = target.kind === 'membership';
  const sentGiftCard = plan !== 'installments' && giftCard !== null && refused?.code !== giftCard ? giftCard : null;
  const quoteInput: QuoteInput = {
    target,
    plan,
    couponCode: coupon,
    orderBump: bump,
    seats: gift ? 1 : seats,
    country,
    region,
    taxId,
    giftCard: sentGiftCard,
    ...(amountMinor !== null ? { amount: amountMinor } : {}),
    ...(crossSell ? { crossSell: true } : {}),
  };
  const { data: q, isError: quoteError, error: quoteErr, isPlaceholderData } = useQuote(quoteInput);
  // Tags the visitor allowed (docs/consent.md): begin_checkout once the first quote is in, add_payment_info on Pay.
  const tracked = useRef(false);
  const trackItems = (): TrackItem[] =>
    (q?.lines ?? []).map((l) => ({ id: targetItemId(target, l.title), name: l.title, price: major(l.price), quantity: l.quantity }));
  useEffect(() => {
    if (!q || isPlaceholderData || tracked.current) return;
    tracked.current = true;
    trackEvent({ name: 'begin_checkout', items: trackItems(), currency: q.dueToday.currency, value: major(q.dueToday) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per checkout
  }, [q, isPlaceholderData]);
  if (q && !isPlaceholderData && sentGiftCard !== null && q.giftCard && !q.giftCard.valid) {
    setRefused({ code: sentGiftCard, message: q.giftCard.message });
  }
  const giftCardStatus =
    sentGiftCard !== null && q?.giftCard
      ? q.giftCard
      : refused && refused.code === giftCard
        ? { valid: false, message: refused.message }
        : null;
  const applyGiftCard = (code: string | null) => {
    setGiftCard(code);
    setRefused(null);
    setErrors((e) => ({ ...e, giftCard: undefined }));
  };

  // A digital download goes to the buyer's account, a live class ticket is the buyer's seat: no gift or team seats
  // (the API refuses them too).
  const isProduct = target.kind === 'product' || target.kind === 'live';
  const backHref =
    target.kind === 'course'
      ? routes.course(target.courseSlug)
      : target.kind === 'membership'
        ? routes.membership
        : target.kind === 'cart'
          ? routes.cart
          : target.kind === 'product'
            ? routes.product(target.productSlug)
            : target.kind === 'live'
              ? routes.live(target.liveSessionId)
              : routes.courses;
  const backLabel =
    target.kind === 'course'
      ? t('backToCourse')
      : target.kind === 'membership'
        ? t('backToMembership')
        : target.kind === 'cart'
          ? t('backToCart')
          : target.kind === 'product'
            ? t('backToProduct')
            : target.kind === 'live'
              ? t('backToLive')
              : t('backToCourses');

  const methods = offeredMethods(q?.payment);
  const payNeeded = q ? needsPayment(q) : true;
  // A subscription course renews like a membership: one learner's, never a gift or team seats.
  const isSubscription = !!q?.recurring && !isMembership;
  const pwyw = q?.payWhatYouWant ?? null;
  const amountError =
    amountText !== null && amountMinor === null ? t('pwywInvalid') : (errors.amount ?? (pwyw && !isPlaceholderData ? pwyw.message : null));

  const fail = (found: Errors) => {
    setErrors({ ...found, form: Object.values(found).find(Boolean) });
    setPaying(false);
  };

  const pay = async (e?: SyntheticEvent, override?: PaymentMethod) => {
    e?.preventDefault();
    if (paying || !q) return;
    const m = payNeeded ? (override ?? method) : 'card';
    const found: Errors = {};
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.name = t('errNameEmail');
    if (gift && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(giftTo.trim())) found.gift = t('errGift');
    if (!terms) found.terms = t('errTerms');
    if (amountError) found.amount = amountError;
    if (q.taxDetails.regionRequired && !region) found.region = t('errRegion');
    if (Object.keys(found).length) {
      fail(found);
      return;
    }
    setErrors({});
    setPaying(true);
    trackEvent({ name: 'add_payment_info', items: trackItems(), currency: q.dueToday.currency, value: major(q.dueToday) });

    // Card details never reach us: the provider's fields hand back a token.
    let paymentToken: string | null = null;
    if (payNeeded && m === 'card') {
      const handle = paymentRef.current;
      if (!handle) {
        fail({ payment: t('paymentLoading') });
        return;
      }
      const r = await handle.collect({ name: name.trim(), email: email.trim() });
      if ('error' in r) {
        fail({ payment: r.error });
        return;
      }
      paymentToken = r.token;
    }

    let result;
    try {
      result = await checkout.mutateAsync({
        ...quoteInput,
        name: name.trim(),
        email: email.trim(),
        acceptTerms: terms,
        paymentMethod: m,
        bnplProvider: m === 'bnpl' ? bnpl : null,
        paymentToken,
        gift: gift ? { recipientEmail: giftTo.trim(), message: giftMsg.trim() } : null,
      });
    } catch (err) {
      // `payment_method` (e.g. "This school can’t take card payments yet…") belongs to the payment method picker.
      if (err instanceof ApiError && err.isValidation) {
        fail({
          method: err.fieldErrors.paymentMethod,
          payment: err.fieldErrors.paymentToken,
          giftCard: err.fieldErrors.giftCard,
          amount: err.fieldErrors.amount,
          region: err.fieldErrors.region,
          taxId: err.fieldErrors.taxId,
          form: Object.values(err.fieldErrors)[0] ?? err.message,
        });
        // The card's balance changed since the quote (another checkout used it): show the new figures.
        if (err.fieldErrors.giftCard) void qc.invalidateQueries({ queryKey: ['commerce', 'quote'] });
        return;
      }
      fail({ form: t('errGeneric') });
      return;
    }

    if (result.nextAction) {
      // The bank wants the cardholder (3-D Secure); the processor then tells the API, which completes the order.
      const auth = await paymentRef.current?.authenticate(result.nextAction.clientSecret);
      if (!auth || 'error' in auth) {
        fail({ payment: auth?.error ?? t('errAuthentication') });
        return;
      }
      const settled = await waitForPayment(result.id);
      if (settled) qc.setQueryData(commerceKeys.order(result.id), settled);
      // The bank refused it after the challenge: stay here so the learner can try another card.
      if (settled?.status === 'failed') {
        fail({ payment: t('errAuthentication') });
        return;
      }
    }
    if (m === 'bnpl') toast(t('bnplApproved', { provider: t(`bnpl.${bnpl}`) }));
    router.push(routes.orderSuccess(result.id, service.isService ? (service.hold ? 'slot' : 'package') : undefined));
  };

  if (quoteError) {
    return (
      <div className="alert alert-bad" role="alert" style={{ marginTop: 24 }}>
        {quoteErr instanceof ApiError ? (Object.values(quoteErr.fieldErrors)[0] ?? quoteErr.message) : tc('errorBody')}{' '}
        <Link href={backHref}>{backLabel}</Link>
      </div>
    );
  }

  // The card is charged `payToday` (what is due less the gift card's part).
  const covered = !!q?.giftCard?.valid && q.payToday.amount === 0;
  const payLabel = !q
    ? t('pay')
    : !payNeeded
      ? covered
        ? t('payCovered')
        : t('payFree')
      : gift
        ? t('payGift', { amount: f.money(q.payToday) })
        : q.installments
          ? t('payPlan', { amount: f.money(q.payToday) })
          : isMembership
            ? t('payMembership', { amount: f.money(q.payToday) })
            : isSubscription
              ? t('paySubscription', { amount: f.money(q.payToday) })
              : t('payAmount', { amount: f.money(q.payToday) });

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

      {service.hold && <HoldNotice hold={service.hold} />}
      <div className={styles.checkoutGrid}>
        <form className={styles.panel} onSubmit={(e) => void pay(e)} noValidate aria-describedby={errors.form ? `${id}-err` : undefined}>
          {q?.priceOffer && (
            <PriceOfferBanner
              offer={q.priceOffer}
              tiers={q.quantityTiers}
              // The API stops applying a sale at its end: re-quote and show whatever it says now.
              onEnd={() => void qc.invalidateQueries({ queryKey: ['commerce', 'quote'] })}
            />
          )}
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

          {pwyw && (
            <div className="field">
              <label className="field-label" htmlFor={`${id}-amount`}>
                {t('pwywLabel')}
              </label>
              <input
                id={`${id}-amount`}
                className="input"
                inputMode="decimal"
                autoComplete="off"
                value={amountText ?? toMoneyInput(pwyw.suggested)}
                onChange={(e) => {
                  setAmountText(e.target.value);
                  setErrors((x) => ({ ...x, amount: undefined }));
                }}
                aria-invalid={!!amountError}
                aria-describedby={`${id}-amount-hint`}
              />
              <p
                id={`${id}-amount-hint`}
                className={amountError ? 'field-error' : styles.extraSub}
                role={amountError ? 'alert' : undefined}
              >
                {amountError ?? t('pwywHint', { minimum: f.money(pwyw.minimum), suggested: f.money(pwyw.suggested) })}
              </p>
            </div>
          )}

          {!isMembership && !isProduct && !isSubscription && (
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
                <>
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
                  {q?.quantityTiers && q.quantityTiers.length > 0 && <SeatTiers tiers={q.quantityTiers} seats={seats} />}
                </>
              )}
            </div>
          )}

          {payNeeded && methods.includes('wallet') && (
            <>
              <div className={styles.express}>
                <button
                  type="button"
                  className={`btn btn-lg ${styles.apple}`}
                  disabled={paying}
                  onClick={() => void pay(undefined, 'wallet')}
                >
                  {t('applePay')}
                </button>
                <button type="button" className="btn btn-outline btn-lg" disabled={paying} onClick={() => void pay(undefined, 'wallet')}>
                  {t('googlePay')}
                </button>
              </div>
              <p className={styles.divider}>{t('orPayAnotherWay')}</p>
            </>
          )}
          {payNeeded && methods.filter((m) => m !== 'wallet').length > 1 && (
            <div
              className={styles.methods}
              role="group"
              aria-label={t('method')}
              aria-describedby={errors.method ? `${id}-method-err` : undefined}
            >
              {methods
                .filter((m) => m !== 'wallet')
                .map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={styles.method}
                    aria-pressed={method === m}
                    onClick={() => {
                      setMethod(m);
                      setErrors((e) => ({ ...e, method: undefined }));
                    }}
                  >
                    {t(`methods.${m}`)}
                  </button>
                ))}
            </div>
          )}
          {errors.method && (
            <p id={`${id}-method-err`} className="field-error">
              {errors.method}
            </p>
          )}

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

          {!payNeeded && <p className={styles.planNote}>{t('freeNote')}</p>}
          {payNeeded && method === 'card' && q && (
            <div className="field">
              <PaymentFields setup={q.payment} amount={elementsAmount(q)} ref={paymentRef} />
              {errors.payment && (
                <p className="field-error" role="alert">
                  {errors.payment}
                </p>
              )}
              {q.postPurchase && <p className={styles.extraSub}>{t('offers.postPurchaseNote')}</p>}
            </div>
          )}
          {payNeeded && method === 'bnpl' && q && (
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
          {payNeeded && method === 'paypal' && <p className={styles.planNote}>{t('paypalNote')}</p>}

          <TaxFields
            quote={q}
            country={country}
            onCountry={(c) => {
              setCountry(c);
              setRegion(null);
              setTaxIdInput('');
              setTaxId(null);
              setErrors((e) => ({ ...e, region: undefined, taxId: undefined }));
            }}
            region={region}
            onRegion={(r) => {
              setRegion(r);
              setErrors((e) => ({ ...e, region: undefined }));
            }}
            taxId={taxIdInput}
            onTaxId={(v) => {
              setTaxIdInput(v);
              setErrors((e) => ({ ...e, taxId: undefined }));
            }}
            errors={errors}
          />

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
          {q?.recurring && (
            <p className={styles.planNote}>
              {q.recurring.trialDays > 0
                ? t('recurringTrialNote', {
                    days: q.recurring.trialDays,
                    amount: f.money(q.recurring.amount),
                    interval: q.recurring.interval,
                  })
                : t('recurringNote', { amount: f.money(q.recurring.amount), interval: q.recurring.interval })}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={paying || !q || !!amountError} aria-busy={paying}>
            {payNeeded && method === 'paypal'
              ? t('payWithPaypal')
              : payNeeded && method === 'bnpl'
                ? t('payWithBnpl', { provider: t(`bnpl.${bnpl}`) })
                : payLabel}
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
                      <WasPrice price={l.compareAt} />
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
              {plan === 'installments' ? (
                <p className={styles.extraSub}>{t('giftCardPlanNote')}</p>
              ) : !giftCardOpen && giftCard === null ? (
                <button type="button" className={styles.giftCardToggle} aria-expanded={false} onClick={() => setGiftCardOpen(true)}>
                  {t('giftCardToggle')}
                </button>
              ) : (
                <>
                  <form
                    className={styles.coupon}
                    aria-describedby={giftCardStatus || errors.giftCard ? `${id}-gc-status` : undefined}
                    onSubmit={(e) => {
                      e.preventDefault();
                      applyGiftCard(giftCardInput.trim() || null);
                    }}
                  >
                    <label htmlFor={`${id}-gc`} className="sr-only">
                      {t('giftCard')}
                    </label>
                    <input
                      id={`${id}-gc`}
                      className="input"
                      placeholder={t('giftCardPlaceholder')}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={32}
                      value={giftCardInput}
                      onChange={(e) => setGiftCardInput(e.target.value)}
                      aria-invalid={!!errors.giftCard || giftCardStatus?.valid === false}
                    />
                    {giftCard !== null && giftCard === giftCardInput.trim() ? (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => {
                          setGiftCardInput('');
                          applyGiftCard(null);
                        }}
                      >
                        {t('giftCardRemove')}
                      </button>
                    ) : (
                      <button type="submit" className="btn btn-outline">
                        {t('giftCardApply')}
                      </button>
                    )}
                  </form>
                  {(errors.giftCard || giftCardStatus) && (
                    <p
                      id={`${id}-gc-status`}
                      className={!errors.giftCard && giftCardStatus?.valid ? styles.couponOk : styles.couponBad}
                      role="status"
                    >
                      {errors.giftCard ?? giftCardStatus?.message}
                    </p>
                  )}
                </>
              )}
              {q.orderBump && (
                <label className={styles.bump}>
                  <input type="checkbox" checked={bump} onChange={(e) => setBump(e.target.checked)} />
                  <span>
                    {q.orderBump.headline && (
                      <span className={styles.extraTitle} style={{ display: 'block' }}>
                        {q.orderBump.headline}
                      </span>
                    )}
                    <span className={styles.extraTitle} style={{ display: 'block' }}>
                      {q.orderBump.title} · <WasPrice price={q.orderBump.compareAt} />
                      {f.money(q.orderBump.price)}
                    </span>
                    <span className={styles.extraSub}>{markdownToPlain(q.orderBump.description)}</span>
                  </span>
                </label>
              )}
              {q.crossSell && <CrossSellBlock crossSell={q.crossSell} checked={crossSell} onChange={setCrossSell} />}
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
                  <TaxLine
                    label={q.taxLabel}
                    amount={q.tax}
                    inclusive={q.taxDetails.inclusive}
                    reverseCharge={q.taxDetails.reverseCharge}
                  />
                )}
                <div className={styles.total}>
                  <dt>{q.installments || q.recurring ? t('dueToday') : t('total')}</dt>
                  <dd>{f.money(q.dueToday)}</dd>
                </div>
                {q.recurring && (
                  <div>
                    <dt>{t('renewsAt', { interval: q.recurring.interval })}</dt>
                    <dd>{f.money(q.recurring.amount)}</dd>
                  </div>
                )}
                {q.installments && (
                  <div>
                    <dt>{t('planTotal')}</dt>
                    <dd>{f.money(q.total)}</dd>
                  </div>
                )}
                {q.giftCard?.valid && (
                  <>
                    <div className={styles.discount}>
                      <dt>{t('giftCardLine', { code: q.giftCard.code })}</dt>
                      <dd>−{f.money(q.giftCard.applied)}</dd>
                    </div>
                    <div className={styles.total}>
                      <dt>{t('payToday')}</dt>
                      <dd>{f.money(q.payToday)}</dd>
                    </div>
                  </>
                )}
              </dl>
              {q.savings && q.savings.amount > 0 && (
                <p className={offerStyles.savings}>{t('offers.youSave', { amount: f.money(q.savings) })}</p>
              )}
              {q.taxDetails.note && <p className={styles.extraSub}>{q.taxDetails.note}</p>}
              {q.giftCard?.valid && q.giftCard.remaining && q.giftCard.remaining.amount > 0 && (
                <p className={styles.extraSub}>{t('giftCardRemaining', { amount: f.money(q.giftCard.remaining) })}</p>
              )}
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
                {q.guaranteeDays > 0 && <li>{t('trustGuarantee', { days: q.guaranteeDays })}</li>}
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

/** The id the tags get for a checkout line: the course or product slug when the checkout is for one, else its title. */
function targetItemId(target: CheckoutTarget, title: string): string {
  if (target.kind === 'course') return target.courseSlug;
  if (target.kind === 'product') return target.productSlug;
  if (target.kind === 'bundle') return target.bundleSlug;
  if (target.kind === 'membership') return `membership-${target.planId}`;
  if (target.kind === 'live') return `live-${target.liveSessionId}`;
  return title;
}
