import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import type { Plugin, PluginOption } from 'vite'
import { defineConfig } from 'vite'
import {
  json_gz_worker_plugins,
  lib_aliases,
  vite_plugin_json_gz,
  vite_plugin_moyo_wasm_source,
} from '../../src/vite-plugins.ts'

// Root and extension Vite instances have recursively incompatible Plugin types.
const json_gz_plugin = () => vite_plugin_json_gz() as unknown as PluginOption

// Ship the .wasm in the labextension (air-gapped Hub) via a Vite `?url` import
const moyo_wasm_asset_plugin = (): PluginOption =>
  vite_plugin_moyo_wasm_source(
    `moyo-wasm-asset`,
    `__moyo_wasm_url`,
    `import __moyo_wasm_url from '@spglib/moyo-wasm/moyo_wasm_bg.wasm?url';\n`,
  ) as unknown as PluginOption

// `__vitePreload` uses `import(<expression>)`, which webpack can't analyze. With
// modulePreload off the dep lists are empty, so stub to `base_module()`.
const preload_helper_id = `\0vite/preload-helper.js`
const stub_vite_preload = (): Plugin => ({
  name: `stub-vite-preload`,
  enforce: `pre`,
  resolveId: (id: string) => (id === preload_helper_id ? id : null),
  load: (id: string) =>
    id === preload_helper_id
      ? `export const __vitePreload = (base_module) => base_module()`
      : null,
})

export default defineConfig({
  // Relative asset URLs so @jupyterlab/builder can re-emit them under static/.
  // Absolute `/assets/...` 404 when Lab isn't served from the domain root.
  base: `./`,
  plugins: [
    json_gz_plugin(),
    moyo_wasm_asset_plugin(),
    stub_vite_preload(),
    svelte({ compilerOptions: { runes: true } }),
  ],
  worker: { plugins: json_gz_worker_plugins() as unknown as () => PluginOption[] },
  build: {
    outDir: `lib`,
    target: `es2023`,
    modulePreload: false, // empty lists; stub above still required
    cssCodeSplit: false, // one file for package.json `style`
    // webpack minifies next; a second pass here only slows builds / stacks.
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      input: resolve(import.meta.dirname, `src/index.ts`),
      // App-mode would drop `export default plugin` and Lab would load a no-op.
      preserveEntrySignatures: `strict`,
      // Shared Lab singletons — private copies break plugin-token identity.
      external: (id: string) => /^@(?:jupyterlab|lumino)\//.test(id),
      output: {
        format: `es`,
        entryFileNames: `index.js`,
        chunkFileNames: `chunks/[name]-[hash].js`,
        // package.json `style` points at a fixed path
        assetFileNames: (asset) =>
          asset.names?.some((name) => name.endsWith(`.css`))
            ? `index.css`
            : `assets/[name]-[hash][extname]`,
      },
    },
    chunkSizeWarningLimit: 6000, // three.js + MatterViz graph
  },
  resolve: { alias: lib_aliases },
})
