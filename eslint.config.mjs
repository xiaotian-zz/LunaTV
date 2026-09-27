import prettier from 'eslint-config-prettier';
// eslint-config-next@16 原生导出 flat config 数组，不能再用 FlatCompat 按旧格式加载
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import { parser as tsEslintParser } from 'typescript-eslint';

export default [
  {
    ignores: [
      'public/sw.js',
      'public/workbox-*.js',
      'node_modules/**',
      '.next/**',
    ],
  },
  ...nextCoreWebVitals,
  prettier,
  {
    // eslint-plugin-react 7.37.5 在 ESLint 10 下 version:'detect' 会崩溃（context.getFilename 已移除），
    // 固定 React 版本绕过检测路径
    settings: {
      react: { version: '19.3.0' },
    },
  },
  {
    // eslint-config-next 对 js 文件用 @babel/eslint-parser，其 eslint-scope 5 内部版
    // 与 ESLint 10 不兼容（缺 scopeManager.addGlobals）；js 文件改用 typescript-eslint parser
    files: ['**/*.js'],
    languageOptions: {
      parser: tsEslintParser,
    },
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'warn',
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'off',
      'react/jsx-curly-brace-presence': [
        'warn',
        { props: 'never', children: 'never' },
      ],
      // react-hooks v6 新增的 React Compiler 时代规则仅作为编译优化建议，
      // 存量代码大量使用 refs/setState 模式，重构风险高，降级为警告
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'simple-import-sort/exports': 'warn',
      'simple-import-sort/imports': [
        'warn',
        {
          groups: [
            ['^@?\\w', '^\\u0000'],
            ['^.+\\.s?css$'],
            ['^@/lib', '^@/hooks'],
            ['^@/data'],
            ['^@/components', '^@/container'],
            ['^@/store'],
            ['^@/'],
            [
              '^\\./?$',
              '^\\.(?!/?$)',
              '^\\.\\./?$',
              '^\\.\\.(?!/?$)',
              '^\\.\\./\\.\\./?$',
              '^\\.\\./\\.\\.(?!/?$)',
              '^\\.\\./\\.\\./\\.\\./?$',
              '^\\.\\./\\.\\./\\.\\.(?!/?$)',
            ],
            ['^@/types'],
            ['^'],
          ],
        },
      ],
    },
  },
];
