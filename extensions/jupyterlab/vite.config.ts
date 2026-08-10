import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import type { Plugin, PluginOption } from 'vite'
import { defineConfig } from 'vite'
import { three_compat_alias, vite_plugin_json_gz } from '../../src/vite-plugins.ts'

const repo_root = resolve(import.meta.dirname, `../..`)

const moyo_glue_url = `new URL('moyo_wasm_bg.wasm', import.meta.url)`

// wasm-bindgen looks next to the glue module; after bundling that breaks. Rewrite
// to a Vite `?url` import so the .wasm ships in the labextension (air-gapped Hub).
const moyo_wasm_asset_plugin = (): Plugin => ({
  name: `moyo-wasm-asset`,
  enforce: `pre`,
  transform(code: string, id: string) {
    if (!id.includes(`@spglib/moyo-wasm`) || !code.includes(moyo_glue_url)) return null
    return {
      code: `import __moyo_wasm_url from '@spglib/moyo-wasm/moyo_wasm_bg.wasm?url';\n${code.replace(
        moyo_glue_url,
        `__moyo_wasm_url`,
      )}`,
      map: null,
    }
  },
})

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
  // vite@8 vs svelte plugin's bundled Plugin type exceeds TS instantiation depth.
  plugins: [
    vite_plugin_json_gz(),
    moyo_wasm_asset_plugin(),
    stub_vite_preload(),
    svelte({ compilerOptions: { runes: true } }),
  ] as PluginOption[],
  // Worker bundles are a separate rolldown pass that does not inherit `plugins`, so the
  // .json.gz loader must be registered again — structure-id's worker imports element data.
  worker: { plugins: () => [vite_plugin_json_gz()] as PluginOption[] },
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
  resolve: {
    alias: [{ find: `$lib`, replacement: `${repo_root}/src/lib` }, three_compat_alias],
  },
})
