import { make_config } from 'svelte-widgets/vite-config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig, type PluginOption } from 'vite-plus'
import {
  three_compat_alias,
  vite_plugin_json_gz,
  vite_plugin_moyo_wasm_source,
} from '../../src/vite-plugins.ts'

// Load moyo (spglib) symmetry WASM from jsDelivr by default. Hosts can set
// globalThis.matterviz_moyo_wasm_url to a local/data URL before symmetry analysis.
const moyo_version = createRequire(import.meta.url)(`@spglib/moyo-wasm/package.json`).version
const moyo_wasm_cdn = `https://cdn.jsdelivr.net/npm/@spglib/moyo-wasm@${moyo_version}/moyo_wasm_bg.wasm`
const moyo_wasm_source = `globalThis.matterviz_moyo_wasm_url ?? ${JSON.stringify(moyo_wasm_cdn)}`

// svelte() ships its own copy of Vite's Plugin type; inferring the array element
// type deep-compares them and exceeds TypeScript's instantiation depth.
const plugins = [
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
  },
  plugins,
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
    rollupOptions: {
      // Disable code splitting -- widget asset loader expects a single JS file
      output: { inlineDynamicImports: true },
    },
  },
})
