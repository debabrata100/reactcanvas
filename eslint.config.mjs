import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      eqeqeq: ['error', 'smart'],
      curly: 'error',
      'no-throw-literal': 'error',
    },
  },
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**'],
  }
);
