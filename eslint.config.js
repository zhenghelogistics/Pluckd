import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Lightweight, non-blocking lint. Rules are mostly warnings so it guides without gating CI.
export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'scripts/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: 'readonly', document: 'readonly', console: 'readonly',
        localStorage: 'readonly', fetch: 'readonly', Blob: 'readonly',
        URL: 'readonly', setTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', FileReader: 'readonly', File: 'readonly',
        Buffer: 'readonly', process: 'readonly', navigator: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
    },
  },
);
