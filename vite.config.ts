import { sveltekit } from '@sveltejs/kit/vite'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { vite_plugin as live_examples } from 'svelte-multiselect/live-examples'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite-plus'
// @ts-expect-error Node ESM config load needs the .ts extension here
import { mock_vscode } from './extensions/vscode/tests/vscode-mock.ts'

const TEXT_EXT_RE = /\.(xyz|extxyz|cif|poscar|lammpstrj|yaml\.gz)$/
const strip_query = (path: string) => path.replace(/\?.*$/, ``)
const split_query = (path: string): [clean: string, query: string] => {
  const clean = strip_query(path)
  return [clean, path.slice(clean.length)]
}
const resolve_from_importer = (clean: string, importer?: string) =>
  importer ? resolve(dirname(strip_query(importer)), clean) : clean

let is_build = false

// Handle .json.gz files by decompressing them on-the-fly during SSR/build.
// Skip ?raw (handled by raw_text_plugin) and ?url (Vite built-in asset).
const json_gz_plugin: Plugin = {
  name: `vite-plugin-json-gz`,
  enforce: `pre`,
  configResolved(config) {
    is_build = config.command === `build`
  },
  resolveId(source, importer) {
    const [clean, query] = split_query(source)
    if (query.includes(`raw`) || query.includes(`url`)) return null
    if (!clean.endsWith(`.json.gz`)) return null
    return resolve_from_importer(clean, importer)
  },
  load(id) {
    const [clean_id, query] = split_query(id)
    if (query.includes(`raw`) || query.includes(`url`)) return null
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
      return this.error(`Failed to decompress ${id}: ${error}`)
    }
  },
}

// Rolldown doesn't honor ?raw for unknown file types in import.meta.glob.
// Claims the file before rolldown's parser sees it, returns raw text as a string export.
const raw_text_plugin: Plugin = {
  name: `vite-plugin-raw-text`,
  enforce: `pre`,
  resolveId(source, importer) {
    const [clean, query] = split_query(source)
    if (query.includes(`url`)) return null
    const is_raw_gz = clean.endsWith(`.json.gz`) && query.includes(`raw`)
    if (!TEXT_EXT_RE.test(clean) && !is_raw_gz) return null
    const abs = resolve_from_importer(clean, importer)
    return abs + query
  },
  load(id) {
    const [clean_id, query] = split_query(id)
    if (query.includes(`url`)) return null
    const is_raw_gz = clean_id.endsWith(`.json.gz`) && query.includes(`raw`)
    if (!TEXT_EXT_RE.test(clean_id) && !is_raw_gz) return null
    try {
      const buf = readFileSync(clean_id)
      const text = clean_id.endsWith(`.gz`)
        ? gunzipSync(buf).toString(`utf-8`)
        : buf.toString(`utf-8`)
      return { code: `export default ${JSON.stringify(text)}`, map: null }
    } catch (error) {
      // resolveId already claimed this file, so surface a clear error (like
      // json_gz_plugin) instead of returning null and falling back to default loading
      return this.error(`Failed to read ${clean_id}: ${error}`)
    }
  },
}

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
      '@typescript-eslint/no-deprecated': `error`,
      '@typescript-eslint/no-misused-promises': `error`,
      '@typescript-eslint/restrict-plus-operands': `error`,
      '@typescript-eslint/no-dynamic-delete': `error`,
      '@typescript-eslint/no-empty-object-type': `error`,
      '@typescript-eslint/no-explicit-any': `error`,
      '@typescript-eslint/no-import-type-side-effects': `error`,
      '@typescript-eslint/no-invalid-void-type': `error`,
      '@typescript-eslint/no-mixed-enums': `error`,
      '@typescript-eslint/no-require-imports': `error`,
      '@typescript-eslint/only-throw-error': `error`,
      '@typescript-eslint/ban-ts-comment': `error`,
      '@typescript-eslint/consistent-type-imports': `error`,
      '@typescript-eslint/prefer-function-type': `error`,
      '@typescript-eslint/prefer-includes': `error`,
      '@typescript-eslint/prefer-optional-chain': `error`,
      '@typescript-eslint/prefer-reduce-type-parameter': `error`,
      '@typescript-eslint/prefer-ts-expect-error': `error`,
      '@typescript-eslint/return-await': `error`,
      '@typescript-eslint/switch-exhaustiveness-check': `error`,
      '@typescript-eslint/unified-signatures': `error`,
      'array-callback-return': `error`,
      'prefer-object-has-own': `error`,
      'eslint-plugin-promise/no-multiple-resolved': `error`,
      'eslint-plugin-promise/no-return-in-finally': `error`,
      'eslint-plugin-promise/param-names': `error`,
      'eslint-plugin-promise/valid-params': `error`,
      '@typescript-eslint/consistent-type-exports': `error`,
      'eslint-plugin-unicorn/require-array-join-separator': `error`,
      'no-useless-computed-key': `error`,
      'eslint-plugin-vitest/prefer-strict-boolean-matchers': `error`,
      'eslint-plugin-vitest/prefer-each': `error`,
      'eslint-plugin-vitest/prefer-called-exactly-once-with': `error`,
      'eslint-plugin-vitest/require-awaited-expect-poll': `error`,

      'eslint-plugin-vitest/require-mock-type-parameters': `off`, // 242 violations, needs manual type annotations
      'eslint-plugin-unicorn/consistent-function-scoping': `off`, // Svelte reactive closures
      // Pervasive intentional patterns
      '@typescript-eslint/no-unsafe-type-assertion': `off`,
      '@typescript-eslint/restrict-template-expressions': `off`,
      'no-await-in-loop': `off`,
      'eslint-plugin-unicorn/no-array-sort': `off`, // [...arr].sort() is idiomatic
      'oxc/no-map-spread': `off`,
      'eslint-plugin-vitest/no-conditional-expect': `off`, // Vitest default rules — too noisy for this codebase
      'eslint-plugin-vitest/valid-expect': [`error`, { maxArgs: 2 }], // Vitest supports expect(actual, message)
    },
  },
  // @ts-expect-error vite@8's Plugin and vite-plus's bundled Plugin are two copies
  // of the same type; comparing them exceeds TS's instantiation depth here
  plugins: [
    json_gz_plugin,
    raw_text_plugin,
    sveltekit(),
    live_examples(),
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

  build: {
    // Default cssTarget is chrome111 which doesn't support light-dark(),
    cssTarget: `esnext`, // causing LightningCSS to polyfill it with broken space toggles
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
    `**/*PARCHG*.gz`,
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
})
