import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'data/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      globals: globals.browser,
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },
  {
    files: ['migrations/**/*.js', 'eslint.config.js', 'vitest.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettier,
);
