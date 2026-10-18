import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', 'runs/**'] },
  {
    files: ['**/*.{ts,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
  prettier,
);
