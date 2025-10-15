import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixupPluginRules } from '@eslint/compat';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslintComments from 'eslint-plugin-eslint-comments';
import _import from 'eslint-plugin-import';
import jsdoc from 'eslint-plugin-jsdoc';
import json from 'eslint-plugin-json';
import prettier from 'eslint-plugin-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  {
    ignores: [
      '**/artifacts/**',
      '**/bot/**',
      '**/cache/**',
      '**/coverage/**',
      '**/deployments/**',
      '**/lib/**',
      '**/node_modules/**',
      '**/reports/**',
      '**/typechain-types/**',
      '**/.certora_internal/**',
      '**/.shared/**',
      '**/.yarn/**',
    ],
  },
  {
    files: [
      '*.cjs',
      '*.cts',
      '*.js',
      '*.mjs',
      '*.mts',
      '*.ts',
      'config/**/*.{ts,js}',
      'deploy/**/*.{ts,js}',
      'scripts/**/*.{ts,js}',
      'test/**/*.{ts,js}',
      'typescript/**/*.{ts,js}',
    ],
  },
  ...compat.extends('plugin:eslint-comments/recommended', 'plugin:jsdoc/recommended', 'prettier'),
  {
    plugins: {
      '@typescript-eslint': typescriptEslint,
      'eslint-comments': eslintComments,
      import: fixupPluginRules(_import),
      jsdoc,
      json,
      prettier,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'max-len': [
        'error',
        {
          code: 140,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
          ignoreComments: true,
        },
      ],
      'padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: ['*'],
          next: ['block-like'],
        },
      ],
      'eslint-comments/require-description': 'error',
      'json/*': [
        'error',
        {
          allowComments: true,
        },
      ],
      'prettier/prettier': [
        'error',
        {
          printWidth: 140,
          tabWidth: 2,
          useTabs: false,
          singleQuote: false,
          semi: true,
          trailingComma: 'all',
          bracketSpacing: true,
          arrowParens: 'always',
          endOfLine: 'auto',
        },
      ],
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-duplicates': 'error',
      'jsdoc/require-jsdoc': 'error',
      'jsdoc/require-description': 'error',
      'jsdoc/require-param-description': 'warn',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/tag-lines': [
        'error',
        'never',
        {
          startLines: 1,
        },
      ],
    },
  },
];
