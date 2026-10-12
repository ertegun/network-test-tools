import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '.scratch/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts', 'src/helper/**/*.ts', 'src/main/**/*.ts', 'src/preload/**/*.ts', 'tests/**/*.ts', '*.ts', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['*.cjs'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Renderer Node'a erişemez: Node modüllerinin içe aktarılması yasak.
      'no-restricted-imports': ['error', { patterns: ['node:*', 'electron', '../../core/*', '../../helper/*', '../../main/*'] }],
    },
  },
);
