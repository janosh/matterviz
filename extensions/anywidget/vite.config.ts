import { make_config } from 'svelte-widgets/vite-config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig, type Plugin, type PluginOption, type Rolldown } from 'vite-plus'
import {
  json_gz_worker_plugins,
  three_compat_alias,
  vite_plugin_json_gz,
  vite_plugin_moyo_wasm_source,
  widget_components,
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

// The class every widget element carries: anywidget.ts injects app.css scoped to it (as is, its
// bare input/button rules and :root color-scheme would restyle the whole notebook page)
export const widget_scope = `.matterviz-widget`

// Writes build/widget-model-keys.json, the bundle's WIDGET_MODEL_KEYS trait contract, so Python
// wrappers can test their widget traits against it without a browser. Evaluates the built bundle
// itself (what ships is what's described), with happy-dom's DOM globals (window, document,
// Element, ...) installed for the import, since module-level code reads them. An output plugin
// of the single-file build only: the split entry runs the same code, described once
export const emit_widget_model_keys: Rolldown.Plugin = {
  name: `emit-widget-model-keys`,
  async writeBundle({ dir }) {
    if (!dir) throw new Error(`emit-widget-model-keys: build has no output dir`)
    const { Window } = await import(`happy-dom`)
    const happy_window = new Window()
    const globals = globalThis as Record<string, unknown>
    const added = Object.getOwnPropertyNames(happy_window).filter((key) => !(key in globals))
    for (const key of added) globals[key] = Reflect.get(happy_window, key)
    globals.window = happy_window
    try {
      // import() caches by URL, so a watch rebuild needs a fresh one to read the new bundle
      const bundle_url = `${pathToFileURL(`${dir}/matterviz.js`).href}?build=${Date.now()}`
      const { WIDGET_MODEL_KEYS } = await import(bundle_url)
      const json = `${JSON.stringify(WIDGET_MODEL_KEYS, null, 2)}\n`
      writeFileSync(`${dir}/widget-model-keys.json`, json)
    } finally {
      for (const key of [...added, `window`]) delete globals[key]
      await happy_window.happyDOM.close()
    }
  },
}

// The split build's CSS repeats the single file's: hosts link build/matterviz.css
const drop_css: Rolldown.Plugin = {
  name: `drop-split-css`,
  generateBundle(_options, bundle) {
    for (const file of Object.keys(bundle)) if (file.endsWith(`.css`)) delete bundle[file]
  },
}

// svelte() ships its own copy of Vite's Plugin type; inferring the array element
// type deep-compares them and exceeds TypeScript's instantiation depth.
const plugins = [
  inline_workers as unknown,
  vite_plugin_moyo_wasm_source(`moyo-wasm-cdn`, moyo_wasm_source) as unknown,
  vite_plugin_json_gz() as unknown,
  svelte() as unknown,
  // dist/, where the `matterviz` imports resolve
  widget_components(resolve(import.meta.dirname, `../../dist`)) as unknown,
] as PluginOption[]

// match the root matterviz printWidth: both checks cover these files, so a narrower
// width here would have each `vp check --fix` undo the other's formatting
const config = make_config({ fmt: { printWidth: 95 } })

export default defineConfig({
  ...config, // shared lint/fmt/build
  define: { SCOPED_APP_CSS: JSON.stringify(scoped_app_css(widget_scope)) },
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
      fileName: `matterviz`,
      cssFileName: `matterviz`,
    },
    rolldownOptions: {
      // Vite's ES lib builds keep whitespace and pure annotations for the consumer's bundler to
      // tree-shake with; nothing bundles these files again, so minify them fully. Two outputs:
      // build/matterviz.js, one self-contained file for hosts loading the bundle as text (local
      // builds, marimo virtual files, headless and inline HTML export), and build/split/, its
      // entry plus chunks for hosts importing it by URL, where a widget loads only its own
      // component's chunks (a 2D plot skips three.js)
      output: [
        {
          codeSplitting: false,
          minify: true,
          comments: false,
          plugins: [emit_widget_model_keys],
        },
        { dir: `build/split`, minify: true, comments: false, plugins: [drop_css] },
      ],
    },
  },
})
