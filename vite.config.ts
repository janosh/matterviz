// @ts-nocheck - tsgo has "Excessive stack depth" bug with Vite Plugin types
import yaml from '@rollup/plugin-yaml'
import { sveltekit } from '@sveltejs/kit/vite'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { vite_plugin as live_examples } from 'svelte-multiselect/live-examples'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite-plus'
import { mock_vscode } from './extensions/vscode/tests/vscode-mock.ts'

const TEXT_EXT_RE = /\.(xyz|extxyz|cif|poscar|lammpstrj|yaml\.gz)$/
const strip_query = (path: string) => path.replace(/\?.*$/, ``)
const resolve_from_importer = (clean: string, importer?: string) =>
  importer ? resolve(dirname(strip_query(importer)), clean) : clean

let is_build = false

export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 95,
    ignorePatterns: [
      `src/site/structures/*.json`,
      `src/site/molecules/*.json`,
      `src/site/trajectories/*.json`,
      `src/site/phonons/*.json`,
      `src/site/phase-diagrams/binary/data/*.json`,
      `src/lib/xrd/atomic_scattering_params.json`,
      `tests/vitest/fixtures/xrd/*.json`,
      `tests/vitest/bz_reference_data.json`,
      `tests/vitest/convex-hull/fixtures/*.json`,
      `tests/vitest/phase-diagram/fixtures/*.json`,
    ],
  },
  lint: {
    plugins: [`oxc`, `typescript`, `unicorn`, `import`, `vitest`],
    options: { typeAware: true, typeCheck: true },
    categories: { correctness: `error`, suspicious: `error`, perf: `error` },
    ignorePatterns: [
      `build/**`,
      `.svelte-kit/**`,
      `package/**`,
      `dist/**`,
      `extensions/**`,
      `static/**`,
      `src/scripts/**`,
    ],
    rules: {
      // Extra rules not in the enabled categories
      'no-console': [`error`, { allow: [`info`, `warn`, `error`] }],
      'no-template-curly-in-string': `error`,
      'no-constructor-return': `error`,
      'default-param-last': `error`,
      'guard-for-in': `error`,
      'eslint-plugin-unicorn/prefer-array-find': `error`,
      'eslint-plugin-unicorn/no-typeof-undefined': `error`,
      'eslint-plugin-unicorn/prefer-optional-catch-binding': `error`,
      'eslint-plugin-unicorn/no-length-as-slice-end': `error`,
      'eslint-plugin-unicorn/prefer-node-protocol': `error`,
      'eslint-plugin-unicorn/throw-new-error': `error`,
      'eslint-plugin-unicorn/prefer-type-error': `error`,
      'eslint-plugin-unicorn/prefer-date-now': `error`,
      'eslint-plugin-unicorn/require-number-to-fixed-digits-argument': `error`,
      'eslint-plugin-unicorn/no-useless-promise-resolve-reject': `error`,
      'eslint-plugin-unicorn/custom-error-definition': `error`,
      'eslint-plugin-import/no-duplicates': `error`,
      '@typescript-eslint/no-non-null-assertion': `error`,
      '@typescript-eslint/prefer-string-starts-ends-with': `error`,
      '@typescript-eslint/prefer-readonly': `error`,
      '@typescript-eslint/prefer-regexp-exec': `error`,
      '@typescript-eslint/prefer-find': `error`,
      'no-useless-computed-key': `error`,
      'eslint-plugin-vitest/prefer-strict-boolean-matchers': `error`,
      'eslint-plugin-vitest/prefer-called-exactly-once-with': `error`,
      'eslint-plugin-vitest/require-awaited-expect-poll': `error`,
      'eslint-plugin-vitest/require-mock-type-parameters': `off`, // 242 violations, needs manual type annotations

      // Svelte framework patterns — NOT bugs
      'no-self-assign': `off`, // reactive `x = x`
      'no-unassigned-vars': `off`, // `bind:` variables
      '@typescript-eslint/no-floating-promises': `off`,
      '@typescript-eslint/unbound-method': `off`,
      'eslint-plugin-unicorn/consistent-function-scoping': `off`, // Svelte reactive closures
      'eslint-plugin-unicorn/prefer-add-event-listener': `off`,
      // Pervasive intentional patterns
      '@typescript-eslint/no-unsafe-type-assertion': `off`,
      '@typescript-eslint/no-unnecessary-type-assertion': `off`,
      '@typescript-eslint/restrict-template-expressions': `off`,
      '@typescript-eslint/no-unnecessary-template-expression': `off`, // backtick convention
      'no-await-in-loop': `off`,
      'no-shadow': `off`,
      'no-control-regex': `off`,
      'eslint-plugin-unicorn/no-array-sort': `off`, // [...arr].sort() is idiomatic
      'eslint-plugin-unicorn/no-new-array': `off`, // new Array(n).fill() for numeric perf
      'eslint-plugin-unicorn/no-useless-fallback-in-spread': `off`,
      'eslint-plugin-unicorn/no-useless-spread': `off`,
      'eslint-plugin-import/no-unassigned-import': `off`, // CSS side-effect imports
      '@typescript-eslint/require-array-sort-compare': `off`,
      '@typescript-eslint/no-base-to-string': `off`,
      'eslint-plugin-import/no-self-import': `off`, // recursive Svelte components
      '@typescript-eslint/no-unnecessary-type-arguments': `off`,
      '@typescript-eslint/no-redundant-type-constituents': `warn`,
      'eslint-plugin-unicorn/prefer-set-has': `off`,
      'eslint-plugin-unicorn/require-module-specifiers': `off`,
      // VS Code's Webview.postMessage() API doesn't take targetOrigin (not browser postMessage)
      'eslint-plugin-unicorn/require-post-message-target-origin': `off`,
      'oxc/no-map-spread': `off`,
      'oxc/approx-constant': `off`,
      // Vitest default rules — too noisy for this codebase
      'eslint-plugin-jest/no-conditional-expect': `off`, // conditional expects are pervasive
      'eslint-plugin-jest/valid-expect': `off`, // false positives on custom matchers
      'eslint-plugin-jest/expect-expect': `off`, // helper-based assertion patterns
      'eslint-plugin-jest/require-to-throw-message': `off`,
      'eslint-plugin-jest/no-standalone-expect': `off`, // expect in shared helpers
      'eslint-plugin-jest/valid-describe-callback': `off`,
    },
  },
  plugins: [
    {
      // Handle .json.gz files by decompressing them on-the-fly during SSR/build.
      // Skip ?raw (handled by vite-plugin-raw-text) and ?url (Vite built-in asset).
      name: `vite-plugin-json-gz`,
      enforce: `pre`,
      configResolved(config) {
        is_build = config.command === `build`
      },
      resolveId(source, importer) {
        if (source.includes(`raw`) || source.includes(`url`)) return null
        const clean = strip_query(source)
        if (!clean.endsWith(`.json.gz`)) return null
        return resolve_from_importer(clean, importer)
      },
      load(id) {
        if (id.includes(`raw`) || id.includes(`url`)) return null
        const clean_id = strip_query(id)
        if (!clean_id.endsWith(`.json.gz`)) return null
        try {
          const json_str = gunzipSync(readFileSync(clean_id)).toString(`utf-8`)
          JSON.parse(json_str) // validate before passing to bundler
          // Rolldown (production) needs moduleType:'json' for import.meta.glob
          // with import:'default' to properly unwrap the default export.
          // Dev/test server doesn't support moduleType, needs JS module format.
          if (is_build) return { code: json_str, moduleType: `json` }
          return `export default ${json_str}`
        } catch (error) {
          this.error(`Failed to decompress ${id}: ${error}`)
        }
      },
    },
    {
      // Rolldown doesn't honor ?raw for unknown file types in import.meta.glob.
      // Claims the file before rolldown's parser sees it, returns raw text as a string export.
      name: `vite-plugin-raw-text`,
      enforce: `pre`,
      resolveId(source, importer) {
        if (source.includes(`url`)) return null
        const clean = strip_query(source)
        const is_raw_gz = clean.endsWith(`.json.gz`) && source.includes(`raw`)
        if (!TEXT_EXT_RE.test(clean) && !is_raw_gz) return null
        const abs = resolve_from_importer(clean, importer)
        return abs + (source.includes(`?`) ? source.slice(source.indexOf(`?`)) : ``)
      },
      load(id) {
        if (id.includes(`url`)) return null
        const clean_id = strip_query(id)
        const is_raw_gz = clean_id.endsWith(`.json.gz`) && id.includes(`raw`)
        if (!TEXT_EXT_RE.test(clean_id) && !is_raw_gz) return null
        try {
          const buf = readFileSync(clean_id)
          const text = clean_id.endsWith(`.gz`)
            ? gunzipSync(buf).toString(`utf-8`)
            : buf.toString(`utf-8`)
          return { code: `export default ${JSON.stringify(text)}`, map: null }
        } catch (error) {
          console.warn(`vite-plugin-raw-text: failed to load ${clean_id}:`, error)
          return null
        }
      },
    },
    sveltekit(),
    live_examples(),
    yaml(),
    process.env.VITEST ? mock_vscode() : null,
  ].filter((plugin): plugin is Plugin => Boolean(plugin)),

  test: {
    environment: `happy-dom`,
    css: true,
    coverage: {
      reporter: [`text`, `json-summary`],
    },
    setupFiles: `tests/vitest/setup.ts`,
    include: [
      `tests/vitest/**/*.test.ts`,
      `tests/vitest/**/*.test.svelte.ts`,
      `extensions/vscode/tests/**/*.test.ts`,
    ],
  },

  server: {
    fs: { allow: [`..`] }, // needed to import from $root
    port: 3000,
  },

  preview: {
    port: 3000,
  },

  resolve: {
    conditions: process.env.VITEST ? [`browser`] : undefined,
  },

  // Binary/compressed files imported via ?url that rolldown would otherwise
  // try to read as UTF-8. Text formats (.xyz, .cif, .poscar) are handled
  // by vite-plugin-raw-text above (they use ?raw, not ?url).
  assetsInclude: [
    `static/xrd/**`,
    `**/*.tdb`,
    `**/*.bxsf.gz`,
    `**/*.frmsf.gz`,
    `**/*.cube.gz`,
    `**/*.xyz.gz`,
    `**/*.lammpstrj.gz`,
    `**/*CHGCAR*.gz`,
    `**/*LOCPOT*.gz`,
    `**/*ELFCAR*.gz`,
    `**/*.traj`,
    `**/*.h5`,
    `**/*.bz2`,
    `**/*.bin`,
    `**/*.brml`,
    `**/*.raw`,
    `**/*.ras`,
    `**/*.UXD`,
    `**/vasp-XDATCAR*.gz`,
  ],

  // matterviz-wasm is browser-only and optional for consumers
  optimizeDeps: {
    exclude: [`matterviz-wasm`],
  },
  ssr: {
    external: [`matterviz-wasm`],
  },
})
