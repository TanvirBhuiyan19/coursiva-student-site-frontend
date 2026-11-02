import { redirect } from 'next/navigation';
import { currentScope, getCurrentSite } from '@/features/tenant/server';
import { localizePath } from '@/i18n/locales';
import { routes } from '@/lib/routes';

/** An old checkout link (`/checkout/{course}`, e.g. the abandoned-cart email): the checkout for that course. */
export default async function Page({ params }: PageProps<'/[tenant]/[locale]/checkout/[slug]'>) {
  const [{ slug }, site, { locale }] = await Promise.all([params, getCurrentSite(), currentScope()]);
  redirect(localizePath(site, locale, routes.checkoutCourse(slug)));
}
