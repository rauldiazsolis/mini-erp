import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig([
  {
    ignores: [
      'dist',
      'dist/**',
      '**/dist/**',
      'coverage',
      'test-results',
      '.vite',
      'eslint.config.js',
      'vite.config.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // AGENTS.md: el estado del admin vive en signals; sin hooks de React ni de Preact.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'preact/hooks', message: 'Sin hooks: usar signals (AGENTS.md).' },
            { name: 'preact/compat', message: 'Sin compat de React: Preact directo (AGENTS.md).' },
            { name: 'react', message: 'Es Preact: importar de preact (AGENTS.md).' },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  eslintConfigPrettier,
]);
