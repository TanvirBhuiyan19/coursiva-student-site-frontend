// @vitest-environment jsdom
// A legal page built in the site builder: section bodies are Markdown (the builder's rich text), rendered formatted;
// older plain text keeps its line breaks.
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LegalScreenView } from './components/LegalPage';

vi.mock('@/features/tenant/server', () => ({ currentScope: vi.fn(), getSite: vi.fn(), pageAlternates: vi.fn() }));
vi.mock('./server', () => ({ getLegal: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('builder legal page', () => {
  it('renders each section body as Markdown under its h2', () => {
    const { container } = render(
      <LegalScreenView
        screen={{
          title: 'Privacy policy',
          updated: 'Updated 1 Oct 2026',
          back: '',
          footer: '',
          sections: [
            { heading: 'What we keep', body: 'Only **what we need**:\n\n- your email\n- your [progress](/learning)' },
            { heading: 'Contact', body: 'Write to us.\nWe reply within a day.' },
          ],
        }}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'What we keep' })).toBeInTheDocument();
    expect(screen.getByText('what we need').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'progress' })).toHaveAttribute('href', '/learning');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.textContent).not.toContain('**');
  });
});
