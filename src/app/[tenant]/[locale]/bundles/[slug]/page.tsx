import { redirect } from 'next/navigation';
import { currentScope, getCurrentSite } from '@/features/tenant/server';
import { localizePath } from '@/i18n/locales';
import { routes } from '@/lib/routes';

/** A bundle's sales link (`/bundles/{slug}`, from the dashboard's product page): straight to its checkout. */
export default async function Page({ params }: PageProps<'/[tenant]/[locale]/bundles/[slug]'>) {
  const [{ slug }, site, { locale }] = await Promise.all([params, getCurrentSite(), currentScope()]);
  redirect(localizePath(site, locale, routes.checkoutBundle(slug)));
}
