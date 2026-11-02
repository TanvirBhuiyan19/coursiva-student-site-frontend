import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import { isOptimizableImage } from './image-hosts';

describe('uploaded images are never proxied or cached by this server', () => {
  it('optimises only the app’s own assets', () => {
    expect(isOptimizableImage('/icon.png')).toBe(true);
    expect(isOptimizableImage('https://pub-abc.r2.dev/schools/amplify/courses/funnels/cover.png')).toBe(false);
    expect(isOptimizableImage('https://cdn.example.com/a.png')).toBe(false);
    expect(isOptimizableImage('http://localhost:8000/storage/a.png')).toBe(false);
    expect(isOptimizableImage('//evil.example.com/a.png')).toBe(false);
  });

  it('allows no remote hosts in next/image', () => {
    expect(nextConfig.images?.remotePatterns ?? []).toEqual([]);
  });
});
