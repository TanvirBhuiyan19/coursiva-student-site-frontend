// @vitest-environment jsdom
// Phase 17c: dashboard-uploaded course covers and product thumbnails reach the storefront.
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../messages/en.json';
import { isOptimizableImage } from '@/config/image-hosts';
import { productJsonLd } from '@/lib/seo';
import type { Site } from '@/features/tenant/types';
import { CourseCover } from './catalog/components/CourseCover';
import { ProductView } from './commerce/components/ProductView';
import type { ProductPage } from './commerce/types';

const withIntl = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const product: ProductPage = {
  slug: 'swipe-file',
  kind: 'download',
  title: 'Swipe file',
  description: 'Fifty proven emails',
  thumbnailUrl: 'https://media.example.com/schools/tn_1/products/pr_1-abc.png',
  price: { amount: 1900, currency: 'USD' },
  compareAtPrice: null,
  file: { name: 'swipe.pdf', sizeMb: 2 },
  delivery: { linkExpiryDays: 7, downloadLimit: 5 },
  courses: [],
  service: null,
};

describe('course cover', () => {
  it('renders the uploaded image straight from storage (never proxied through /_next/image)', () => {
    render(
      <CourseCover cover={{ url: 'https://media.example.com/c.png', color: 'oklch(0.5 0.1 200)', alt: 'Funnels 101' }} height={100} />,
    );
    const img = screen.getByRole('img', { name: 'Funnels 101' });
    expect(img.getAttribute('src')).toBe('https://media.example.com/c.png');
  });

  it('serves a local-API (http) image as-is, and falls back to the colour gradient without one', () => {
    const { container, rerender } = render(
      <CourseCover cover={{ url: 'http://localhost:8000/storage/c.png', color: 'red', alt: 'Local' }} height={100} />,
    );
    expect(screen.getByRole('img', { name: 'Local' }).getAttribute('src')).toBe('http://localhost:8000/storage/c.png');
    rerender(<CourseCover cover={{ url: null, color: 'red', alt: 'None' }} height={100} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect((container.firstChild as HTMLElement).style.backgroundImage).toContain('linear-gradient');
  });

  it('optimises only the app’s own assets, never an uploaded image', () => {
    expect(isOptimizableImage('/icon.png')).toBe(true);
    expect(isOptimizableImage('https://pub-abc.r2.dev/schools/amplify/courses/funnels/cover.png')).toBe(false);
  });
});

describe('product thumbnail', () => {
  it('shows the thumbnail on the sales page and uses it as the JSON-LD image', () => {
    render(withIntl(<ProductView product={product} />));
    expect(screen.getByRole('img', { name: 'Swipe file' }).getAttribute('src')).toBe(product.thumbnailUrl);
    const ld = productJsonLd({ name: 'Amplify' } as Site, 'https://amplify.example.com', product);
    expect(ld).toMatchObject({ image: product.thumbnailUrl });
  });

  it('has no image without a thumbnail', () => {
    render(withIntl(<ProductView product={{ ...product, thumbnailUrl: null }} />));
    expect(screen.queryByRole('img')).toBeNull();
    expect(
      productJsonLd({ name: 'Amplify' } as Site, 'https://amplify.example.com', { ...product, thumbnailUrl: null }),
    ).not.toHaveProperty('image');
  });
});
