'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/toast/Toaster';
import { BrandMark } from '@/components/layout/BrandMark';
import { CourseCover } from '@/features/catalog/components/CourseCover';
import type { Site } from '@/features/tenant/types';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import { useOrder } from '../api';
import type { Order } from '../types';
import styles from './Commerce.module.css';

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
export function OrderSuccess({ orderId, community }: { orderId: string; community: boolean }) {
  const t = useTranslations('order');
  const f = useFormat();
  return (
    <OrderState id={orderId}>
      {(o) => {
        const isMembership = o.items.some((i) => i.kind === 'membership');
        const title = o.gift ? t('giftTitle') : o.seats ? t('seatsTitle') : isMembership ? t('memberTitle') : t('title');
        return (
          <div className={styles.success}>
            <span className={styles.tick} aria-hidden="true">
              ✓
            </span>
            <h1 className="h1-sm" style={{ marginTop: 16 }}>
              {title}
            </h1>
            <p className="lead" style={{ marginTop: 8 }}>
              {t('sub', { number: o.number })}
            </p>

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
                  <div>
                    <dt>{o.taxLabel}</dt>
                    <dd>{f.money(o.tax)}</dd>
                  </div>
                )}
                <div className={styles.total}>
                  <dt>{o.installments ? t('paidToday') : t('totalPaid')}</dt>
                  <dd>{f.money(o.dueToday)}</dd>
                </div>
              </dl>
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
                <div>
                  <dt>{t('receipt')}</dt>
                  <dd>
                    <Link href={routes.invoice(o.id)}>{t('viewInvoice')}</Link>
                  </dd>
                </div>
              </dl>
            </section>

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

            {!o.gift && !o.seats && (
              <section className={styles.next} aria-labelledby="next-title">
                <h2 id="next-title" className="eyebrow">
                  {t('nextTitle')}
                </h2>
                <ol>
                  <li>{isMembership ? t('nextExplore') : t('nextStart')}</li>
                  {community && <li>{t('nextIntro')}</li>}
                  {community && <li>{t('nextLive')}</li>}
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
              {t.rich('questions', { link: (c) => <Link href={routes.contact}>{c}</Link> })}
            </p>
          </div>
        );
      }}
    </OrderState>
  );
}

/** Printable invoice ("Download PDF" prints to PDF from the browser; the API can also render a PDF). */
export function Invoice({ orderId, site }: { orderId: string; site: Pick<Site, 'name' | 'logoUrl' | 'primaryHost'> }) {
  const t = useTranslations('order');
  const f = useFormat();
  const toast = useToast();
  return (
    <OrderState id={orderId}>
      {(o) => (
        <div className={styles.invoice}>
          <div className={styles.invoiceBar}>
            <Link href={routes.learning} className={styles.back} style={{ flex: 1 }}>
              {`← ${t('backToLearning')}`}
            </Link>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => window.print()}>
              {t('downloadPdf')}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => toast(t('emailed', { email: o.billing.email }))}>
              {t('emailCopy')}
            </button>
          </div>
          <article className={styles.invoicePaper} aria-label={t('invoiceNumber', { number: o.number })}>
            <div className={styles.invHead}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <BrandMark site={site} size={32} />
                  <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>
                    {o.seller.name}
                  </span>
                </div>
                <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                  {site.primaryHost}
                  <br />
                  {o.seller.email}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <h1 className="eyebrow" style={{ fontSize: 13 }}>
                  {t('invoice')}
                </h1>
                <p className="num" style={{ fontSize: 22 }}>
                  #{o.number}
                </p>
                {o.status === 'paid' && <span className={styles.paid}>{t('paid')}</span>}
              </div>
            </div>
            <dl className={styles.facts} style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 28 }}>
              <div>
                <dt>{t('billedTo')}</dt>
                <dd>
                  {o.billing.name}
                  <br />
                  <span style={{ fontWeight: 400 }}>{o.billing.email}</span>
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
                    <td className={styles.num2}>{f.money({ ...i.unitPrice, amount: i.unitPrice.amount * i.quantity })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className={styles.totals} style={{ maxWidth: 300, marginLeft: 'auto' }}>
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
                <div>
                  <dt>{o.taxLabel}</dt>
                  <dd>{f.money(o.tax)}</dd>
                </div>
              )}
              <div className={styles.total}>
                <dt>{o.installments ? t('paidToday') : t('totalPaid')}</dt>
                <dd>{f.money(o.dueToday)}</dd>
              </div>
            </dl>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 24 }}>
              {t('invoiceFoot', { email: o.seller.email, name: o.seller.name })}
            </p>
          </article>
        </div>
      )}
    </OrderState>
  );
}
