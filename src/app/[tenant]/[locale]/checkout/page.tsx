import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CheckoutView } from '@/features/commerce/components/CheckoutView';
import styles from '@/features/commerce/components/Commerce.module.css';
import type { CheckoutTarget } from '@/features/commerce/types';
import { currentScope, getCurrentSite } from '@/features/tenant/server';
import { localizePath } from '@/i18n/locales';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('checkout');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Reads the query string on the server (what is being bought), so it renders per request — it is private anyway. */
export const dynamic = 'force-dynamic';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** What's being bought comes from the URL: ?course= (&payment=installments), ?cart=1, ?bundle=, ?product=, ?plan=&interval=, or
 * ?live= (&series=1, a live class ticket). Prices come from the API. */
export default async function CheckoutPage({ searchParams }: PageProps<'/[tenant]/[locale]/checkout'>) {
  const sp = await searchParams;
  const course = one(sp.course);
  const bundle = one(sp.bundle);
  const product = one(sp.product);
  const plan = one(sp.plan);
  const live = one(sp.live);
  let target: CheckoutTarget | null = null;
  if (course) target = { kind: 'course', courseSlug: course };
  else if (bundle) target = { kind: 'bundle', bundleSlug: bundle };
  else if (product) target = { kind: 'product', productSlug: product };
  else if (live) target = { kind: 'live', liveSessionId: live, series: one(sp.series) === '1' };
  else if (plan) target = { kind: 'membership', planId: plan, interval: one(sp.interval) === 'year' ? 'year' : 'month' };
  else if (one(sp.cart)) target = { kind: 'cart' };
  if (!target) redirect(localizePath(await getCurrentSite(), (await currentScope()).locale, routes.cart));

  return (
    <div className={`container page ${styles.wrap}`}>
      <CheckoutView
        target={target}
        initialPlan={one(sp.payment) === 'installments' ? 'installments' : 'full'}
        initialCoupon={one(sp.coupon) ?? null}
      />
    </div>
  );
}
