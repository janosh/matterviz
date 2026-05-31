import { lint_config } from '@janosh/vite-config'
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

// starry-night's `both.css` switches to its dark palette via
// `@media (prefers-color-scheme: dark)`, i.e. it follows the OS instead of the
// app's theme toggle. Re-target that one block to the app's `data-theme`
// attribute so manually chosen themes get readable syntax colors (auto mode
// already resolves data-theme from the OS, so OS support is preserved).
const starry_night_theme_plugin: Plugin = {
  name: `vite-plugin-starry-night-theme`,
  transform(code, id) {
    if (!id.includes(`starry-night/style/both.css`)) return null
    const dark_query =
      /@media \(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/u
    // warn (don't silently no-op) if upstream restructured both.css and the regex stops matching
    if (!dark_query.test(code))
      this.warn(`starry-night dark-palette query not found; update regex`)
    return code.replace(dark_query, `:root[data-theme='dark'], :root[data-theme='black'] {$1}`)
  },
}

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
  // Shared rules/plugins/categories live in @janosh/vite-lint-config (dotfiles).
  // Append only matterviz-specific ignore dirs here; add per-project rule overrides
  // via `rules: { ...lint_config.rules, 'some-rule': 'off' }` if ever needed.
  lint: {
    ...lint_config,
    ignorePatterns: [
      ...lint_config.ignorePatterns,
      `extensions/**`,
      `static/**`,
      `src/scripts/**`,
    ],
  },
  // @ts-expect-error vite@8's Plugin and vite-plus's bundled Plugin are two copies
  // of the same type; comparing them exceeds TS's instantiation depth here
  plugins: [
    json_gz_plugin,
    raw_text_plugin,
    starry_night_theme_plugin,
    sveltekit(),
    live_examples(),
    process.env.VITEST ? mock_vscode() : null,
    // oxlint-disable-next-line eslint-plugin-unicorn/prefer-native-coercion-functions -- type predicate needed for narrowing
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
