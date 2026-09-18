import globals from 'globals';

export default [
  {
    files: ['server/**/*.mjs', 'tools/**/*.mjs', 'tools/**/*.cjs', 'tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // 后端是纯 JS，构建/类型检查无法发现未定义变量（见 REVIEW R01）。
      'no-undef': 'error',
    },
  },
  {
    files: ['tools/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
