import { make_config } from 'svelte-widgets/vite-config'
import { sveltekit } from '@sveltejs/kit/vite'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { gunzipSync } from 'node:zlib'
import { vite_plugin as live_examples } from 'svelte-widgets/live-examples'
import source_links from 'svelte-widgets/source-links/vite-plugin'
import type { Plugin } from 'vite'
import { defineConfig, type PluginOption } from 'vite-plus'
import { configDefaults } from 'vitest/config'
// @ts-expect-error Node ESM config load needs the .ts extension here
import * as shared from './src/vite-plugins.ts'

// Extensions raw_text_plugin below claims and hands back as a plain string. Covers exactly
// the structure/trajectory/phonon fixtures this repo imports (from src/site and tests), not
// every format the library can parse: it therefore carries trajectory extensions that
// STRUCTURE_EXTENSIONS in src/lib/constants.ts lacks (xyz, extxyz, lammpstrj, yaml.gz) and
// omits ones no fixture imports (.vasp, .cube). Add an extension here before importing a
// fixture that uses it, else rolldown parses the fixture as JavaScript and the build dies.
const TEXT_EXT_RE =
  /\.(?:xyz|extxyz|cif|mmcif|mcif|poscar|pdb|mol2|mol|sdf|lmp|data|dump|lammpstrj|yaml(?:\.gz)?|BORN)$/
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
      /@media \(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{(?<dark_rules>[^}]*)\}\s*\}/u
    // warn (don't silently no-op) if upstream restructured both.css and the regex stops matching
    if (!dark_query.test(code))
      this.warn(`starry-night dark-palette query not found; update regex`)
    return code.replace(dark_query, `:root[data-theme='dark'], :root[data-theme='black'] {$1}`)
  },
}

const json_gz_options = { resolve_queries: true }
const json_gz_plugin = () => shared.vite_plugin_json_gz(json_gz_options)

// Rolldown doesn't honor ?raw for unknown file types in import.meta.glob.
// Claims the file before rolldown's parser sees it, returns raw text as a string export.
const raw_text_plugin: Plugin = {
  name: `vite-plugin-raw-text`,
  enforce: `pre`,
  resolveId(source, importer) {
    // Leave bare package specifiers such as @wooorm/starry-night/source.yaml to Vite.
    if (!/^[./$]/.test(source)) return null
    const [clean, query] = shared.split_query(source)
    if (query.includes(`url`)) return null
    const is_raw_gz = clean.endsWith(`.json.gz`) && query.includes(`raw`)
    if (!TEXT_EXT_RE.test(clean) && !is_raw_gz) return null
    const abs = shared.resolve_from_importer(clean, importer)
    return abs + query
  },
  load(id) {
    const [clean_id, query] = shared.split_query(id)
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

// sveltekit()/live-examples ship their own copy of vite's Plugin type; inferring this
// array's element type deep-compares them and exceeds TS's instantiation depth (TS2321).
// Typing as `unknown[]` skips that comparison; vite ignores the falsy (null) entry.
const plugins = [
  json_gz_plugin() as unknown,
  raw_text_plugin as unknown,
  starry_night_theme_plugin as unknown,
  source_links() as unknown,
  sveltekit() as unknown,
  live_examples() as unknown,
] as PluginOption[]

const config = make_config()

export default defineConfig({
  ...config, // shared lint/fmt/build
  plugins,
  worker: {
    plugins: shared.json_gz_worker_plugins(json_gz_options) as unknown as () => PluginOption[],
  },
  fmt: {
    ...config.fmt,
    printWidth: 95,
    ignorePatterns: [
      `src/site/structures/*.json`,
      `src/site/molecules/*.json`,
      `src/site/phase-diagrams/binary/data/*.json`,
      `src/lib/xrd/atomic_scattering_params.json`,
      `tests/vitest/fixtures/xrd/*.json`,
      `tests/vitest/convex-hull/fixtures/*.json`,
      `tests/vitest/phase-diagram/fixtures/*.json`,
    ],
  },
  lint: {
    ...config.lint,
    rules: {
      ...config.lint.rules,
      // Timer/animation callbacks return opaque handles that Promise ignores. The rule added in
      // vite-plus (still in 0.3.0) mistakes those conventional executors for meaningful Promise returns.
      'no-promise-executor-return': `off`,
    },
    // src/scripts/** are standalone utility scripts excluded from tsconfig (so
    // type-aware rules can't resolve $lib/Deno-style imports there) — keep them unlinted.
    // extensions/** are separate packages with dependencies and test mocks that
    // are not type-compatible with the root project, so lint them in their own packages.
    ignorePatterns: [
      `static/**`,
      `src/scripts/**`,
      `extensions/anywidget/**`,
      `extensions/jupyterlab/**`,
      `extensions/vscode/**`,
    ],
  },

  test: {
    environment: `happy-dom`,
    css: true,
    coverage: {
      reporter: [`text`, `json-summary`],
    },
    setupFiles: `tests/vitest/setup.ts`,
    // The VS Code extension's tests run under its own vitest (pnpm -C extensions/vscode test):
    // they need the `vscode` module mocked and the extension's own dependency tree
    include: [`tests/vitest/**/*.test.ts`, `tests/vitest/**/*.test.svelte.ts`],
    // The perf tripwires import every heavy subsystem (~6 s of transform/import for nothing
    // when skipped), so they only exist for the opt-in run (MATTERVIZ_PERF=1; own CI job)
    exclude: [
      ...configDefaults.exclude,
      ...(process.env.MATTERVIZ_PERF === `1` ? [] : [`tests/vitest/perf-baselines.test.ts`]),
    ],
  },

  // Pre-commit work, driven by `vp staged` from .pre-commit-config.yaml: format and lint only
  // the staged files, and run the (whole-project) Svelte type check only when a TS/Svelte
  // file is staged. Commands get the staged paths appended; svelte-check takes no file list,
  // so those two run as thunks that ignore the names. No shell: one command per entry.
  staged: {
    '*.{ts,js,mjs,svelte,css,json,md,yml,yaml}': `vp fmt`,
    '*.{ts,js,mjs,svelte}': [
      `vp lint`,
      () => `npx svelte-kit sync`,
      () => `npx svelte-check --tsconfig ./tsconfig.json --threshold warning`,
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
    dedupe: [`svelte`],
    conditions: process.env.VITEST ? [`browser`] : undefined,
    alias: [shared.three_compat_alias],
  },

  // Binary/compressed files imported via ?url that rolldown would otherwise
  // try to read as UTF-8. Text formats (.xyz, .cif, .poscar) are handled
  // by vite-plugin-raw-text above (they use ?raw, not ?url).
  assetsInclude: [
    `src/site/xrd/**`,
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
