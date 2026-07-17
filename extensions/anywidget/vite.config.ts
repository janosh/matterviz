import { config } from '@janosh/vite-config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Plugin } from 'vite'
import { defineConfig, type PluginOption } from 'vite-plus'

// Load moyo (spglib) symmetry WASM from jsDelivr on demand instead of inlining
// it as base64 -- twice (once via symmetry/index.ts's `?url` import, once via the
// wasm-bindgen glue's dead `new URL(..., import.meta.url)` default). Drops ~1.9 MB.
// Symmetry/spacegroup analysis needs network; widget rendering itself does not.
const moyo_version = createRequire(import.meta.url)(`@spglib/moyo-wasm/package.json`).version
const moyo_wasm_cdn = `https://cdn.jsdelivr.net/npm/@spglib/moyo-wasm@${moyo_version}/moyo_wasm_bg.wasm`
const moyo_glue_url = `new URL('moyo_wasm_bg.wasm', import.meta.url)`

let json_gz_is_build = false

const moyo_wasm_cdn_plugin: Plugin = {
  name: `moyo-wasm-cdn`,
  enforce: `pre` as const,
  resolveId(source: string) {
    if (source.includes(`@spglib/moyo-wasm`) && source.endsWith(`.wasm?url`)) {
      return `\0moyo-wasm-cdn-url`
    }
    return null
  },
  load(id: string) {
    if (id === `\0moyo-wasm-cdn-url`) {
      return `export default ${JSON.stringify(moyo_wasm_cdn)}`
    }
    return null
  },
  transform(code: string, id: string) {
    if (id.includes(`@spglib/moyo-wasm`) && code.includes(moyo_glue_url)) {
      return { code: code.replace(moyo_glue_url, JSON.stringify(moyo_wasm_cdn)), map: null }
    }
    return null
  },
}

const json_gz_plugin: Plugin = {
  name: `vite-plugin-json-gz`,
  enforce: `pre`,
  configResolved(resolved_config) {
    json_gz_is_build = resolved_config.command === `build`
  },
  load(id) {
    if (!id.endsWith(`.json.gz`)) return null
    try {
      const json_str = gunzipSync(readFileSync(id)).toString(`utf-8`)
      JSON.parse(json_str) // validate before passing to bundler
      // Rolldown (build) needs moduleType:'json' for import.meta.glob with
      // import:'default' to properly unwrap the default export. Dev/test
      // server doesn't support moduleType, needs JS module format.
      if (json_gz_is_build) return { code: json_str, moduleType: `json` }
      return `export default ${json_str}`
    } catch (error) {
      return this.error(`Failed to decompress ${id}: ${error}`)
    }
  },
}

// svelte() ships its own copy of Vite's Plugin type; inferring the array element
// type deep-compares them and exceeds TypeScript's instantiation depth.
const plugins = [
  moyo_wasm_cdn_plugin as unknown,
  json_gz_plugin as unknown,
  svelte() as unknown,
] as PluginOption[]

export default defineConfig({
  ...config, // shared lint/fmt/build from @janosh/vite-config (dotfiles)
  resolve: {
    alias: {
      // The widget never parses HDF5 client-side (pymatviz parses on the Python
      // side), so stub out h5wasm to drop ~5 MB of HDF5 WASM from the bundle.
      h5wasm: resolve(import.meta.dirname, `h5wasm-stub.ts`),
    },
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
