// ============================================================
// ESLint Flat Config — Backend Node.js (CommonJS)
// ============================================================
const globals = require('globals');

module.exports = [
  {
    // Files to ignore
    ignores: [
      'node_modules/**',
      'public/bundle.js',
      'public/bundle.js.map',
      'public/lazy-bundle.js',
      'public/lazy-bundle.js.map',
      'public/**/*.min.js',
      'coverage/**',
      // Vendored / generated third-party assets — NOT project source.
      // The CDP browser profile ships bundled Chrome extensions (minified,
      // non-standard syntax) and vendor connectors ship prebuilt bundles that
      // reference plugin rules we do not install. Linting them is meaningless
      // and produces thousands of false positives / parse errors.
      'data/**',
      'vendor/**',
    ],
  },

  // ── Backend server code ──
  {
    files: [
      'server.js',
      'mcp-server.js',
      'cli-discovery.js',
      'preset-loader.js',
      'rate-limiter.js',
      'ring-buffer.js',
      'ws-handler.js',
      'routes/**/*.js',
      'ws/**/*.js',
      'plugins/**/*.js',
      'mcp/**/*.js',
      'lib/**/*.js',
      'plans/**/*.js',
      'scripts/**/*.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Safety: catch accidental globals
      'no-undef': 'error',

      // Style: prefer modern JS
      'no-var': 'warn',
      'prefer-const': ['warn', { destructuring: 'all' }],
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',
      'object-shorthand': ['warn', 'always'],

      // Quality: catch common mistakes
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // P0.1-a：不再检查 catch 块中未使用的错误变量（如 `catch (e)` 未引用）。
        // 这类是低信号噪声；恢复 eslint 默认（caughtErrors: 'none'），降噪。
        caughtErrors: 'none',
      }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unused-expressions': 'warn',
      'eqeqeq': ['warn', 'smart'],
      'no-constant-condition': 'warn',
      'no-duplicate-imports': 'warn',
      'no-promise-executor-return': 'warn',
      'no-self-compare': 'warn',

      // Security (complementary to P0 command-exec governance): forbid passing a
      // non-literal (variable / string-concat / template) to child_process.exec,
      // which runs its argument through a shell and is the classic command-
      // injection vector. Prefer execFile(base, argsArray) — no shell — or, for
      // the AI terminal, gate the string through evaluateAiExec() first. Existing
      // audited call sites carry an inline eslint-disable with justification.
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.name='exec'][arguments.0.type='Identifier']",
          message: 'Do not pass a variable to child_process.exec (shell injection risk). Use execFile(base, argsArray), or gate the command via evaluateAiExec() and add an inline eslint-disable with justification.',
        },
        {
          selector: "CallExpression[callee.name='exec'][arguments.0.type='BinaryExpression']",
          message: 'Do not build an exec() command via string concatenation (shell injection risk). Use execFile(base, argsArray) with separate arguments.',
        },
        {
          selector: "CallExpression[callee.name='exec'][arguments.0.type='TemplateLiteral']",
          message: 'Do not build an exec() command via a template literal (shell injection risk). Use execFile(base, argsArray) with separate arguments.',
        },
      ],

      // Console is used extensively for logging — keep enabled
      'no-console': 'off',
    },
  },

  // ── Backend files containing browser-context code ──
  // These modules define code that is serialized and executed *inside a browser*
  // via CDP (page.evaluate) or shipped as plugin UI panels. They legitimately
  // reference `document` / `window` / `navigator`, so they need browser globals
  // layered on top of the Node.js backend config above (flat-config merges).
  {
    files: [
      'routes/browser/**/*.js',
      'routes/ai-tools/builtin/web-fetch.js',
      'plugins/**/ui/**/*.js',
      'plugins/agnes-ai/web/**/*.js',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // ── Frontend code (ES modules) ──
  {
    files: ['public/**/*.js'],
    ignores: ['public/bundle.js', 'public/bundle.js.map', 'public/**/*.min.js'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        window: 'readonly',
        document: 'readonly',
        QCLI: 'writable',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-var': 'warn',
      'prefer-const': ['warn', { destructuring: 'all' }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'eqeqeq': ['warn', 'smart'],
    },
  },

  // ── Test files (stricter about dependencies) ──
  {
    files: ['test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-var': 'warn',
      'prefer-const': 'warn',
    },
  },
];
