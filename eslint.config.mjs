import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  { ignores: ['node_modules', 'out', 'dist', 'release', 'coverage', 'tests/e2e/__shots__', 'resources'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // ADR-0006: src/core must stay pure.
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['electron', 'node:*', 'fs', 'path'] }],
      'no-restricted-properties': ['error', { object: 'Date', property: 'now', message: 'Use ctx.now (ADR-0006).' }],
    },
  },
);
