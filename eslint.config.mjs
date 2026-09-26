import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import i18next from 'eslint-plugin-i18next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // eslint-config-next already registers the jsx-a11y plugin; turn on its full recommended rule set.
      ...jsxA11y.flatConfigs.recommended.rules,
      // Option cards nest the visible text two spans deep inside the <label>.
      'jsx-a11y/label-has-associated-control': ['error', { depth: 4 }],
      // Horizontally scrollable tables are labelled regions that must be keyboard-focusable (axe: scrollable-region-focusable).
      'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['tabpanel', 'region'] }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      // noUncheckedIndexedAccess makes `!` necessary after explicit length/lookup checks.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Typed fetch helpers (`apiGet<T>()`) intentionally use a single type parameter.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/components/*/**'],
              message: 'Import feature components by file (@/features/<name>/components/<File>), not from nested folders.',
            },
            { group: ['**/mock-api/**'], message: 'App code must not import the mock backend.' },
          ],
        },
      ],
    },
  },
  {
    // i18n: user-facing text in JSX comes from messages/*.json via next-intl. Tenant content comes from the API.
    files: ['src/**/*.tsx'],
    ignores: ['**/*.test.tsx', 'src/test/**'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': { include: ['title', 'label', 'placeholder', 'alt', 'aria-label', 'aria-description'] },
          words: { exclude: ['[0-9!-/:-@[-`{-~\\s·—–−…×→←↑↓✓•★☆♡♥›∞✦▶🔒]+', '[A-Z_-]+'] },
        },
      ],
    },
  },
  {
    // The mock backend validates untrusted input, so "unnecessary" checks are intentional; it logs by design.
    files: ['mock-api/**'],
    rules: { '@typescript-eslint/no-unnecessary-condition': 'off', 'no-console': 'off', 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'e2e/**', 'src/test/**', 'scripts/**'],
    rules: {
      'no-restricted-imports': 'off',
      'no-console': 'off',
      // Tests assert on raw JSON responses.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  prettier,
]);
