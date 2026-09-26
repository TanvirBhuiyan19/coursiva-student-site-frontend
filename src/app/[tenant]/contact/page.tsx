import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ContactAside, ContactForm } from '@/features/account/components/Support';
import styles from '@/features/account/components/Support.module.css';
import { getMembership } from '@/features/membership/server';
import { currentTenant, getSite } from '@/features/tenant/server';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await currentTenant();
  const [site, t] = await Promise.all([getSite(tenant), getTranslations('support')]);
  return { title: t('contactTitle'), description: t('contactDescription', { name: site.name }), alternates: { canonical: routes.contact } };
}

export default async function ContactPage() {
  const tenant = await currentTenant();
  const [site, membership, t] = await Promise.all([getSite(tenant), getMembership(tenant), getTranslations('support')]);
  return (
    <div className="container page">
      <div className={styles.contact}>
        <div>
          <h1 className="h1-sm">{t('contactTitle')}</h1>
          <p className="lead" style={{ marginTop: 10 }}>
            {t('contactIntro')}
          </p>
          <ContactForm />
        </div>
        <ContactAside email={site.supportEmail} community={site.features.community} guaranteeDays={membership?.guaranteeDays ?? 30} />
      </div>
    </div>
  );
}
