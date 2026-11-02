'use client';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Suspense } from 'react';
import { isOptimizableImage } from '@/config/image-hosts';
import { ServiceBooking } from '@/features/bookings/components/ServiceBooking';
import { Link } from '@/i18n/navigation';
import { Markdown } from '@/lib/markdown';
import { routes } from '@/lib/routes';
import { useFormat } from '@/lib/useFormat';
import type { ProductPage } from '../types';
import styles from './Product.module.css';

/**
 * A product's sales page (`/products/{slug}`): what it is, what it costs, how it's delivered, and the buy button.
 * Prices come from the API; downloads check out as `?product=`, bundles as `?bundle=`; a service books a time first
 * (ServiceBooking), then checks out as `?product=` unless the learner has a session credit.
 */
export function ProductView({ product }: { product: ProductPage }) {
  const t = useTranslations('product');
  const tb = useTranslations('bookings');
  const f = useFormat();
  const service = product.kind === 'service' ? product.service : null;
  const buyHref = product.kind === 'download' ? routes.checkoutProduct(product.slug) : routes.checkoutBundle(product.slug);

  return (
    <article className={`container page ${styles.wrap}`}>
      {product.thumbnailUrl && (
        <div className={styles.thumb}>
          <Image
            src={product.thumbnailUrl}
            alt={product.title}
            fill
            priority
            sizes="(max-width: 767px) 100vw, 720px"
            style={{ objectFit: 'cover' }}
            unoptimized={!isOptimizableImage(product.thumbnailUrl)}
          />
        </div>
      )}
      <p className="eyebrow">{product.kind === 'download' ? t('download') : product.kind === 'service' ? t('service') : t('bundle')}</p>
      <h1 className="h1-sm">{product.title}</h1>
      {/* The school's Markdown (dashboard rich text; older descriptions are plain text, so newlines are kept). */}
      {product.description && (
        <Markdown source={product.description} breaks images={false} headingLevel={2} className={`lead rich-text ${styles.description}`} />
      )}

      <div className={styles.price}>
        <span className="num">{f.money(product.price)}</span>
        {product.compareAtPrice && <s className={styles.compare}>{t('compareAt', { price: f.money(product.compareAtPrice) })}</s>}
      </div>

      {service && (
        <ul className={styles.facts}>
          <li>{tb('sessionLength', { minutes: service.sessionMinutes })}</li>
          <li>{tb('package', { count: service.sessions })}</li>
          <li>{tb(`location.${service.locationType}`)}</li>
        </ul>
      )}
      {product.file && <p className={styles.meta}>{t('file', { name: product.file.name, size: product.file.sizeMb })}</p>}
      {product.delivery && (
        <p className={styles.meta}>{t('delivery', { days: product.delivery.linkExpiryDays, limit: product.delivery.downloadLimit })}</p>
      )}

      {product.courses.length > 0 && (
        <section aria-labelledby="product-includes" className={styles.includes}>
          <h2 id="product-includes" className="eyebrow">
            {t('includes')}
          </h2>
          <ul>
            {product.courses.map((c) => (
              <li key={c.slug}>
                <Link href={routes.course(c.slug)}>{c.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {service ? (
        // The booking box reads `?slot=&tz=` (the time picked before signing in) on the client.
        <Suspense fallback={<div className="skeleton" style={{ height: 320, alignSelf: 'stretch' }} />}>
          <ServiceBooking product={product} service={service} />
        </Suspense>
      ) : (
        <Link href={buyHref} className="btn btn-primary btn-lg">
          {t('buy', { price: f.money(product.price) })}
        </Link>
      )}
    </article>
  );
}
