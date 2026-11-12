import { make_config } from 'svelte-widgets/vite-config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig, type PluginOption } from 'vite-plus'
import {
  json_gz_worker_plugins,
  three_compat_alias,
  vite_plugin_json_gz,
  vite_plugin_moyo_wasm_source,
} from '../../src/vite-plugins.ts'
import { scoped_app_css } from '../../src/elements/scoped-css.ts'

// Load moyo (spglib) symmetry WASM from jsDelivr by default. Hosts can set
// globalThis.matterviz_moyo_wasm_url to a local/data URL before symmetry analysis.
const moyo_version = createRequire(import.meta.url)(`@spglib/moyo-wasm/package.json`).version
const moyo_wasm_cdn = `https://cdn.jsdelivr.net/npm/@spglib/moyo-wasm@${moyo_version}/moyo_wasm_bg.wasm`
const moyo_wasm_source = `globalThis.matterviz_moyo_wasm_url ?? ${JSON.stringify(moyo_wasm_cdn)}`

// The bundle loads from a blob:, CDN or file:// URL, against which emitted worker files can't
// start, so each `new Worker(new URL('./x.js', import.meta.url), options)` becomes Vite's inline
// worker: shipped as a string, run from a blob: URL (same-origin with the notebook page)
const worker_url_re =
  /new Worker\(\s*new URL\(\s*([`'"])(\.\/[\w.-]+)\1,\s*import\.meta\.url\s*\)\s*,/g
export const inline_workers: Plugin = {
  name: `inline-workers`,
  enforce: `pre`,
  transform(code, identifier) {
    if (!code.includes(`new Worker(`)) return null
    const imports: string[] = []
    const inlined = code.replaceAll(worker_url_re, (_match, _quote, path: string) => {
      const name = `__inline_worker_${imports.length}`
      imports.push(`import ${name} from ${JSON.stringify(`${path}?worker&inline`)}`)
      return `new ${name}(`
    })
    // any other new Worker(new URL(...)) would emit a worker file this bundle can't start
    if (/new Worker\(\s*new URL\(/.test(inlined)) {
      throw new Error(`inline-workers: unmatched new Worker(new URL(...)) in ${identifier}`)
    }
    return imports.length ? { code: `${imports.join(`\n`)}\n${inlined}`, map: null } : null
  },
}

// anywidget.ts's `matterviz/app.css?raw` import gets app.css scoped to the widget elements (each
// carries this class), not the file as is: its bare input/button rules and :root color-scheme
// would restyle the whole notebook page
export const widget_scope = `.matterviz-widget`
let scoped_app_css_served = false
const scoped_app_css_plugin: Plugin = {
  name: `scoped-app-css`,
  enforce: `pre`,
  load(identifier) {
    if (!/[\\/]app\.css\?raw$/.test(identifier)) return null
    scoped_app_css_served = true
    return `export default ${JSON.stringify(scoped_app_css(widget_scope))}`
  },
  buildEnd() {
    if (!scoped_app_css_served) this.error(`scoped-app-css: no app.css?raw import to scope`)
  },
}

// svelte() ships its own copy of Vite's Plugin type; inferring the array element
// type deep-compares them and exceeds TypeScript's instantiation depth.
const plugins = [
  inline_workers as unknown,
  scoped_app_css_plugin as unknown,
  vite_plugin_moyo_wasm_source(`moyo-wasm-cdn`, moyo_wasm_source) as unknown,
  vite_plugin_json_gz() as unknown,
  svelte() as unknown,
] as PluginOption[]

// match the root matterviz printWidth: both checks cover these files, so a narrower
// width here would have each `vp check --fix` undo the other's formatting
const config = make_config({ fmt: { printWidth: 95 } })

export default defineConfig({
  ...config, // shared lint/fmt/build
  resolve: {
    // Array form so `three` matches exactly — a string alias prefix-matches and would
    // rewrite three/webgpu, three/tsl and three/examples/* too.
    alias: [
      // The widget never parses HDF5 client-side (pymatviz parses on the Python
      // side), so stub out h5wasm to drop ~5 MB of HDF5 WASM from the bundle.
      { find: `h5wasm`, replacement: resolve(import.meta.dirname, `h5wasm-stub.ts`) },
      three_compat_alias,
    ],
    // `matterviz` is a link: dependency, so its dist resolves `three/webgpu` from the repo
    // root's store while this package resolves it from its own. Two copies means the
    // lights registered by one are unknown to the other's LightsNode ("Light node not
    // found"), which renders every lit mesh black in the standalone/CDN bundle.
    dedupe: [`three`],
  },
  plugins,
  // One file per module worker (an inline worker has no URL to load chunks from). Workers can't
  // read host globals, so theirs is the CDN moyo (anywidget.ts handles matterviz_moyo_wasm_url)
  worker: {
    format: `es`,
    plugins: () => [
      vite_plugin_moyo_wasm_source(`moyo-wasm-cdn`, JSON.stringify(moyo_wasm_cdn)),
      ...json_gz_worker_plugins()(),
    ],
    rolldownOptions: { output: { codeSplitting: false } },
  },
  build: {
    ...config.build, // keep shared cssTarget: esnext (for light-dark())
    outDir: `build`,
    lib: {
      entry: resolve(import.meta.dirname, `anywidget.ts`),
      formats: [`es`],
      fileName: `matterviz`,
      cssFileName: `matterviz`,
    },
    minify: true, // published to a CDN + parsed in browsers; halve size/parse cost
    rolldownOptions: {
      // Disable code splitting -- widget asset loader expects a single JS file
      output: { codeSplitting: false },
    },
  },
})
