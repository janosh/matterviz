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

// Load moyo (spglib) symmetry WASM from jsDelivr by default. Hosts can set
// globalThis.matterviz_moyo_wasm_url to a local/data URL before symmetry analysis.
const moyo_version = createRequire(import.meta.url)(`@spglib/moyo-wasm/package.json`).version
const moyo_wasm_cdn = `https://cdn.jsdelivr.net/npm/@spglib/moyo-wasm@${moyo_version}/moyo_wasm_bg.wasm`
const moyo_wasm_source = `globalThis.matterviz_moyo_wasm_url ?? ${JSON.stringify(moyo_wasm_cdn)}`

// The bundle loads from a blob:, CDN or file:// URL, against which emitted worker files fail
// to resolve or resolve cross-origin, so every `new Worker(new URL('./x.js', import.meta.url),
// options)` in matterviz becomes Vite's inline worker: its code ships as a string in the bundle
// and runs from a blob: URL, which is same-origin with the notebook page
const worker_url_re =
  /new Worker\(\s*new URL\(\s*([`'"])(\.\/[\w.-]+)\1,\s*import\.meta\.url\s*\)\s*,/g
const inline_workers: Plugin = {
  name: `inline-workers`,
  enforce: `pre`,
  transform(code, identifier) {
    if (!code.includes(`new Worker(`)) return null
    const imports: string[] = []
    const inlined = code.replaceAll(worker_url_re, (match, _quote, path: string) => {
      if (process.env.ZZ_SKIP && path.includes(process.env.ZZ_SKIP))
        return `new Worker(${JSON.stringify(path)},`
      const name = `__inline_worker_${imports.length}`
      imports.push(`import ${name} from ${JSON.stringify(`${path}?worker&inline`)}`)
      return `new ${name}(`
    })
    // a worker built from anything but a relative literal URL with options would load as a file
    if (/new Worker\(\s*new URL\(/.test(inlined)) {
      throw new Error(`inline-workers: unmatched new Worker(new URL(...)) in ${identifier}`)
    }
    return imports.length ? { code: `${imports.join(`\n`)}\n${inlined}`, map: null } : null
  },
}

// svelte() ships its own copy of Vite's Plugin type; inferring the array element
// type deep-compares them and exceeds TypeScript's instantiation depth.
const plugins = [
  inline_workers as unknown,
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
  // Module workers in one file each: an inline worker has no URL its chunks could load from.
  // A worker reads no host globals, so its moyo always comes from the CDN (anywidget.ts keeps
  // symmetry on the main thread when matterviz_moyo_wasm_url is set).
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
