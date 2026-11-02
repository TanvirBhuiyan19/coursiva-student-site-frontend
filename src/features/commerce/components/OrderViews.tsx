'use client';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/toast/Toaster';
import { BrandMark } from '@/components/layout/BrandMark';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import type { Site } from '@/features/tenant/types';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { ApiError } from '@/lib/api/errors';
import { useEmailInvoice, useOrder } from '../api';
import type { Order } from '../types';
import styles from './Commerce.module.css';
import { TaxLine } from './CheckoutTax';
import { OrderStatusTag } from './OrdersView';
import { TrackPurchase } from '@/features/tracking/TrackPurchase';
import { PostPurchaseOfferCard } from './PostPurchaseOfferCard';

/** A captured payment: the order has a receipt and an invoice. */
const receipted = (o: Order) => o.status !== 'pending' && o.status !== 'failed';

function OrderState({ id, children }: { id: string; children: (o: Order) => React.ReactNode }) {
  const tc = useTranslations('common');
  const { data, isPending, isError, refetch } = useOrder(id);
  if (isPending) return <div className="skeleton" style={{ height: 320, maxWidth: 600, margin: '0 auto' }} />;
  if (isError)
    return (
      <div className="alert alert-bad" role="alert" style={{ maxWidth: 600, margin: '0 auto' }}>
        {tc('errorBody')}{' '}
        <button type="button" className="link-btn" onClick={() => void refetch()}>
          {tc('retry')}
        </button>
      </div>
    );
  return <>{children(data)}</>;
}

/** Order confirmation: what was bought, what was charged, what to do next. */
export function OrderSuccess({
  orderId,
  community,
  booking = null,
}: {
  orderId: string;
  community: boolean;
  /** A service's checkout (`?booking=`): `slot` = the held time is booked, `package` = sessions to book. */
  booking?: 'slot' | 'package' | null;
}) {
  const t = useTranslations('order');
  const tb = useTranslations('bookings');
  return (
    <OrderState id={orderId}>
      {(o) => {
        const isMembership = o.items.some((i) => i.kind === 'membership');
        // Only digital downloads: nothing to learn, the files wait under Account → Downloads.
        const isBooking = !!booking && o.items.some((i) => i.kind === 'product');
        const isDownload = !isBooking && o.items.length > 0 && o.items.every((i) => i.kind === 'product');
        // A live class ticket: the seat is booked (the confirmation email carries the calendar invite).
        const isLive = o.items.some((i) => i.kind === 'live');
        const liveSessionId = o.items.find((i) => i.kind === 'live')?.liveSessionId ?? null;
        if (o.status === 'failed') return <PaymentFailed o={o} />;
        const title =
          o.status === 'pending'
            ? t('pendingTitle')
            : o.gift
              ? t('giftTitle')
              : o.seats
                ? t('seatsTitle')
                : isMembership
                  ? t('memberTitle')
                  : isBooking
                    ? booking === 'slot'
                      ? tb('successTitle')
                      : tb('successPackageTitle')
                    : isDownload
                      ? t('downloadTitle')
                      : isLive
                        ? t('liveTitle')
                        : t('title');
        return (
          <div className={styles.success}>
            <span className={styles.tick} aria-hidden="true">
              {o.status === 'pending' ? '…' : '✓'}
            </span>
            <h1 className="h1-sm" style={{ marginTop: 16 }}>
              {title}
            </h1>
            <p className="lead" style={{ marginTop: 8 }}>
              {o.status === 'pending' ? t('pendingSub', { number: o.number }) : t('sub', { number: o.number })}
            </p>

            {/* A one-click offer after a paid checkout (the API decides whether there is one). */}
            {o.status === 'paid' && !o.gift && !o.seats && <PostPurchaseOfferCard orderId={o.id} />}

            <Receipt o={o} />
            <ClaimLinks o={o} />
            <TrackPurchase order={o} />

            {!o.gift && !o.seats && (
              <section className={styles.next} aria-labelledby="next-title">
                <h2 id="next-title" className="eyebrow">
                  {t('nextTitle')}
                </h2>
                <ol>
                  <li>
                    {isBooking
                      ? booking === 'slot'
                        ? tb('successNext')
                        : tb('successPackageNext')
                      : isDownload
                        ? t('nextDownload')
                        : isLive
                          ? t('nextLiveTicket')
                          : isMembership
                            ? t('nextExplore')
                            : t('nextStart')}
                  </li>
                  {community && !isDownload && !isBooking && !isLive && <li>{t('nextIntro')}</li>}
                  {community && !isDownload && !isBooking && !isLive && <li>{t('nextLive')}</li>}
                </ol>
              </section>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
              {o.startLesson ? (
                <Link
                  href={`${routes.player(o.startLesson.courseSlug, o.startLesson.lessonId)}?welcome=1`}
                  className="btn btn-primary btn-lg"
                >
                  {t('startLesson')}
                </Link>
              ) : isBooking ? (
                <Link href={routes.accountBookings} className="btn btn-primary btn-lg">
                  {tb('goToBookings')}
                </Link>
              ) : isDownload ? (
                <Link href={routes.accountDownloads} className="btn btn-primary btn-lg">
                  {t('goToDownloads')}
                </Link>
              ) : isLive ? (
                <Link href={liveSessionId ? routes.live(liveSessionId) : routes.liveSchedule} className="btn btn-primary btn-lg">
                  {liveSessionId ? t('goToLiveClass') : t('goToLive')}
                </Link>
              ) : (
                <Link href={routes.learning} className="btn btn-primary btn-lg">
                  {isMembership ? t('exploreCourses') : t('goToLearning')}
                </Link>
              )}
              {o.startLesson && (
                <Link href={routes.learning} className="btn btn-outline btn-lg">
                  {t('goToLearning')}
                </Link>
              )}
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 20 }}>
              {t.rich('questions', {
                link: (c) => (
                  <Link href={routes.contact} style={{ textDecoration: 'underline' }}>
                    {c}
                  </Link>
                ),
              })}
            </p>
          </div>
        );
      }}
    </OrderState>
  );
}

/** The bank refused the payment: nothing was charged, nothing unlocked; try again from checkout. */
function PaymentFailed({ o }: { o: Order }) {
  const t = useTranslations('order');
  const slug = o.items.length === 1 && o.items[0]?.kind === 'course' ? o.items[0].courseSlug : null;
  return (
    <div className={styles.success}>
      <span className={styles.tick} aria-hidden="true">
        !
      </span>
      <h1 className="h1-sm" style={{ marginTop: 16 }}>
        {t('failedTitle')}
      </h1>
      <p className="lead" style={{ marginTop: 8 }} role="status">
        {t('failedSub', { number: o.number })}
      </p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
        <Link href={slug ? routes.checkoutCourse(slug) : routes.cart} className="btn btn-primary btn-lg">
          {t('tryAgain')}
        </Link>
        <Link href={routes.accountOrders} className="btn btn-outline btn-lg">
          {t('orderHistory')}
        </Link>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 20 }}>
        {t.rich('questions', {
          link: (c) => (
            <Link href={routes.contact} style={{ textDecoration: 'underline' }}>
              {c}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}

/** What was refunded, after the total: "Refunded −£10", then each credit note (the invoice and the receipt). */
function RefundLine({ o }: { o: Order }) {
  const t = useTranslations('order');
  const f = useFormat();
  if (o.refunded.amount <= 0) return null;
  return (
    <>
      <div className={styles.discount}>
        <dt>{o.status === 'refunded' ? t('refundedLine') : t('partiallyRefundedLine')}</dt>
        <dd>−{f.money(o.refunded)}</dd>
      </div>
      {o.creditNotes.map((c) => (
        <div key={c.number}>
          <dt>{t('creditNoteLine', { number: c.number })}</dt>
          <dd>−{f.money(c.amount)}</dd>
        </div>
      ))}
    </>
  );
}

/**
 * The gift card's part, after the total (a tender, not a discount): what it paid, what went back to it, and what the
 * card paid — or "Paid with gift card" when it covered everything.
 */
function GiftCardLines({ o }: { o: Order }) {
  const t = useTranslations('order');
  const f = useFormat();
  if (!o.giftCard) return null;
  return (
    <>
      <div className={styles.discount}>
        <dt>{t('giftCardLine', { code: o.giftCard.code })}</dt>
        <dd>−{f.money(o.giftCard.amount)}</dd>
      </div>
      {o.giftCard.refunded.amount > 0 && (
        <div>
          <dt>{t('giftCardReturned')}</dt>
          <dd>{f.money(o.giftCard.refunded)}</dd>
        </div>
      )}
      <div>
        <dt>{o.paidByCard.amount > 0 ? t('paidByCard') : t('paidWithGiftCard')}</dt>
        <dd>{f.money(o.paidByCard.amount > 0 ? o.paidByCard : o.giftCard.amount)}</dd>
      </div>
    </>
  );
}

/** What was bought and charged (success page and order page). */
function Receipt({ o }: { o: Order }) {
  const t = useTranslations('order');
  const f = useFormat();
  return (
    <section className={styles.receipt} aria-label={t('receipt')}>
      {o.items.map((i) => (
        <div key={i.title} className={styles.line}>
          <CourseCover cover={i.cover} height={48} radius={10} className={styles.lineCover} sizes="64px" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className={styles.lineTitle}>{i.title}</p>
            <p className={styles.lineMeta}>{i.quantity > 1 ? t('qty', { count: i.quantity }) : i.meta}</p>
          </div>
          <span className="num">{f.money(i.unitPrice)}</span>
        </div>
      ))}
      <dl className={styles.totals} style={{ marginBottom: 0 }}>
        {o.discount.amount > 0 && (
          <div className={styles.discount}>
            <dt>{t('discount', { code: o.couponCode ?? '' })}</dt>
            <dd>−{f.money(o.discount)}</dd>
          </div>
        )}
        {o.orderBump && (
          <div>
            <dt>{t('bump')}</dt>
            <dd>{f.money(o.orderBump)}</dd>
          </div>
        )}
        {o.taxLabel && (
          <TaxLine label={o.taxLabel} amount={o.tax} inclusive={o.taxDetails.inclusive} reverseCharge={o.taxDetails.reverseCharge} />
        )}
        <div className={styles.total}>
          <dt>{o.installments ? t('paidToday') : t('totalPaid')}</dt>
          <dd>{f.money(o.dueToday)}</dd>
        </div>
        <GiftCardLines o={o} />
        <RefundLine o={o} />
      </dl>
      {o.taxDetails.note && <p className={styles.extraSub}>{o.taxDetails.note}</p>}
      <dl className={styles.facts}>
        <div>
          <dt>{t('order')}</dt>
          <dd>#{o.number}</dd>
        </div>
        <div>
          <dt>{t('date')}</dt>
          <dd>{f.date(o.createdAt)}</dd>
        </div>
        <div>
          <dt>{t('payment')}</dt>
          <dd>{o.paymentMethod}</dd>
        </div>
        {receipted(o) && (
          <div>
            <dt>{t('receipt')}</dt>
            <dd>
              <Link href={routes.invoice(o.id)}>{t('viewInvoice')}</Link>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** Gift and team-seat claim links (`/claim?token=`), to pass on. */
function ClaimLinks({ o }: { o: Order }) {
  const t = useTranslations('order');
  return (
    <>
      {o.gift && (
        <div className={styles.claims}>
          <p>{t('giftSent', { email: o.gift.recipientEmail })}</p>
          <code>{o.gift.claimUrl}</code>
        </div>
      )}
      {o.seats && (
        <div className={styles.claims}>
          <p>{t('seatLinks', { count: o.seats.quantity })}</p>
          {o.seats.claimUrls.map((u) => (
            <code key={u}>{u}</code>
          ))}
        </div>
      )}
    </>
  );
}

/** `/orders/{id}` (the receipt email's link): status, what was bought, the invoice and any claim links. */
export function OrderDetail({ orderId }: { orderId: string }) {
  const t = useTranslations('order');
  return (
    <OrderState id={orderId}>
      {(o) => (
        <div className={styles.success}>
          <p style={{ textAlign: 'start' }}>
            <Link href={routes.accountOrders} className="muted" style={{ fontSize: 13.5 }}>
              {`← ${t('orderHistory')}`}
            </Link>
          </p>
          <h1 className="h1-sm" style={{ marginTop: 8 }}>
            {t('detailTitle', { number: o.number })}
          </h1>
          <p className="lead" style={{ marginTop: 8 }} role="status">
            <OrderStatusTag status={o.status} /> {t(`statusLine.${o.status}`)}
          </p>
          <Receipt o={o} />
          <ClaimLinks o={o} />
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
            {receipted(o) && (
              <Link href={routes.invoice(o.id)} className="btn btn-primary btn-lg">
                {t('viewInvoice')}
              </Link>
            )}
            <Link href={routes.learning} className="btn btn-outline btn-lg">
              {t('goToLearning')}
            </Link>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 20 }}>
            {t.rich('questions', {
              link: (c) => (
                <Link href={routes.contact} style={{ textDecoration: 'underline' }}>
                  {c}
                </Link>
              ),
            })}
          </p>
        </div>
      )}
    </OrderState>
  );
}

/** "Email me a copy": the API sends the invoice to the learner's own address (3 per 10 minutes). */
function EmailCopyButton({ o }: { o: Order }) {
  const t = useTranslations('order');
  const toast = useToast();
  const send = useEmailInvoice();
  const onClick = () =>
    send.mutate(o.id, {
      onSuccess: (r) => toast(t('emailed', { email: r.email })),
      onError: (e) =>
        toast(
          e instanceof ApiError && e.status === 429
            ? t('emailThrottled')
            : e instanceof ApiError && e.status === 409
              ? e.message
              : t('emailFailed'),
        ),
    });
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={send.isPending || !receipted(o)}
      aria-busy={send.isPending}
      onClick={onClick}
    >
      {send.isPending ? t('emailSending') : t('emailCopy')}
    </button>
  );
}

/** The invoice's status stamp: PAID, REFUNDED, PARTIALLY REFUNDED, FAILED or PENDING. */
function Stamp({ o }: { o: Order }) {
  const t = useTranslations('order');
  const cls = o.status === 'paid' ? styles.paid : `${styles.stamp} ${o.status === 'failed' ? styles.stampBad : styles.stampSoft}`;
  return <span className={cls}>{t(`stamp.${o.status}`)}</span>;
}

/** Printable invoice ("Print or save as PDF" uses the browser's print dialog). */
export function Invoice({ orderId, site }: { orderId: string; site: Pick<Site, 'name' | 'logoUrl' | 'primaryHost'> }) {
  const t = useTranslations('order');
  const f = useFormat();
  return (
    <OrderState id={orderId}>
      {(o) => {
        // A tax column only when some line carries tax.
        const lineTax = o.items.some((i) => i.tax.amount > 0);
        return (
          <div className={styles.invoice}>
            <div className={styles.invoiceBar}>
              <Link href={routes.accountOrders} className={styles.back} style={{ flex: 1 }}>
                {`← ${t('orderHistory')}`}
              </Link>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => window.print()}>
                {t('downloadPdf')}
              </button>
              <EmailCopyButton o={o} />
            </div>
            {!receipted(o) && (
              <p className="alert alert-bad" role="status" style={{ marginBottom: 16 }}>
                {o.status === 'failed' ? t('invoiceFailed') : t('invoicePending')}
              </p>
            )}
            <article className={styles.invoicePaper} aria-label={t('invoiceNumber', { number: o.invoiceNumber ?? o.number })}>
              <div className={styles.invHead}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <BrandMark site={site} size={32} />
                    <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>
                      {o.seller.name}
                    </span>
                  </div>
                  <p className={`muted ${styles.seller}`} style={{ fontSize: 13, marginTop: 8 }}>
                    {o.seller.legalName && o.seller.legalName !== o.seller.name && (
                      <>
                        {o.seller.legalName}
                        <br />
                      </>
                    )}
                    {o.seller.address && (
                      <>
                        {o.seller.address}
                        <br />
                      </>
                    )}
                    {o.seller.taxId && (
                      <>
                        {t('taxId', { id: o.seller.taxId })}
                        <br />
                      </>
                    )}
                    {site.primaryHost}
                    {o.seller.email && (
                      <>
                        <br />
                        {o.seller.email}
                      </>
                    )}
                  </p>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <h1 className="eyebrow" style={{ fontSize: 13 }}>
                    {t('invoice')}
                  </h1>
                  {o.invoiceNumber ? (
                    <>
                      <p className="num" style={{ fontSize: 22 }}>
                        {o.invoiceNumber}
                      </p>
                      <p className="muted" style={{ fontSize: 13 }}>
                        {t('orderRef', { number: o.number })}
                      </p>
                    </>
                  ) : (
                    <p className="num" style={{ fontSize: 22 }}>
                      #{o.number}
                    </p>
                  )}
                  <Stamp o={o} />
                </div>
              </div>
              <dl className={styles.facts} style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 28 }}>
                <div>
                  <dt>{t('billedTo')}</dt>
                  <dd>
                    {o.billing.name}
                    <br />
                    <span style={{ fontWeight: 400 }}>{o.billing.email}</span>
                    <br />
                    <span style={{ fontWeight: 400 }}>
                      {o.billing.region ? t('billedPlace', { region: o.billing.region, country: o.billing.country }) : o.billing.country}
                    </span>
                    {o.billing.taxId && (
                      <>
                        <br />
                        <span style={{ fontWeight: 400 }}>{t('buyerTaxId', { id: o.billing.taxId })}</span>
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('dateIssued')}</dt>
                  <dd>{f.date(o.createdAt)}</dd>
                </div>
                <div>
                  <dt>{t('payment')}</dt>
                  <dd>{o.paymentMethod}</dd>
                </div>
              </dl>
              <table className={styles.invTable}>
                <thead>
                  <tr>
                    <th scope="col">{t('description')}</th>
                    <th scope="col" className={styles.num2}>
                      {t('qtyHead')}
                    </th>
                    {lineTax && (
                      <th scope="col" className={styles.num2}>
                        {t('taxHead')}
                      </th>
                    )}
                    <th scope="col" className={styles.num2}>
                      {t('amount')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.title}>
                      <td>
                        <b>{i.title}</b>
                        <br />
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          {i.meta}
                        </span>
                      </td>
                      <td className={styles.num2}>{i.quantity}</td>
                      {lineTax && <td className={styles.num2}>{f.money(i.tax)}</td>}
                      <td className={styles.num2}>{f.money({ ...i.unitPrice, amount: i.unitPrice.amount * i.quantity })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className={styles.totals} style={{ maxWidth: 300, marginInlineStart: 'auto' }}>
                <div>
                  <dt>{t('subtotal')}</dt>
                  <dd>{f.money(o.subtotal)}</dd>
                </div>
                {o.discount.amount > 0 && (
                  <div className={styles.discount}>
                    <dt>{t('discount', { code: o.couponCode ?? '' })}</dt>
                    <dd>−{f.money(o.discount)}</dd>
                  </div>
                )}
                {o.orderBump && (
                  <div>
                    <dt>{t('bump')}</dt>
                    <dd>{f.money(o.orderBump)}</dd>
                  </div>
                )}
                {o.taxLabel && (
                  <TaxLine
                    label={o.taxLabel}
                    amount={o.tax}
                    inclusive={o.taxDetails.inclusive}
                    reverseCharge={o.taxDetails.reverseCharge}
                  />
                )}
                <div className={styles.total}>
                  <dt>{!receipted(o) ? t('totalDue') : o.installments ? t('paidToday') : t('totalPaid')}</dt>
                  <dd>{f.money(o.dueToday)}</dd>
                </div>
                <GiftCardLines o={o} />
                <RefundLine o={o} />
              </dl>
              {o.taxDetails.note && (
                <p className="muted" style={{ fontSize: 12.5, marginTop: 16 }}>
                  {o.taxDetails.note}
                </p>
              )}
              <p className="muted" style={{ fontSize: 12.5, marginTop: 24 }}>
                {t('invoiceFoot', { email: o.seller.email, name: o.seller.legalName ?? o.seller.name })}
              </p>
            </article>
          </div>
        );
      }}
    </OrderState>
  );
}
