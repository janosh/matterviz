import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import type { Plugin, PluginOption } from 'vite'
import { defineConfig } from 'vite'
// Same build-time helper the VS Code webview uses; both configs run from the
// monorepo, so sharing the file beats keeping two copies in sync.
import { vite_plugin_json_gz } from '../vscode/vite-plugin-json-gz.ts'

const repo_root = resolve(import.meta.dirname, `../..`)

const moyo_glue_url = `new URL('moyo_wasm_bg.wasm', import.meta.url)`

// wasm-bindgen resolves its .wasm next to the glue module, which breaks once the
// glue is bundled. Rewriting to a Vite `?url` import emits the wasm as a real
// asset we ship inside the labextension, so symmetry analysis works on air-gapped
// JupyterHub deployments instead of reaching for a CDN.
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

// Vite wraps every dynamic import in `__vitePreload`, whose body resolves
// preload targets through `import(<expression>)`. Webpack cannot analyze that and
// warns "Critical dependency" while leaving behind an import it can never satisfy.
// With modulePreload off the dep lists are already empty, so the helper only ever
// forwards to the real (statically analyzable) import — replace it with exactly
// that and webpack sees plain dynamic imports.
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
  // Emit asset references relative to the bundle rather than rooted at `/`.
  // @jupyterlab/builder webpacks this output a second time, and it can only pick
  // up (and re-emit under the labextension's static dir) assets it can resolve
  // from lib/index.js. Absolute `/assets/...` URLs are unresolvable at build time
  // and would 404 at runtime, since JupyterLab is rarely served from the domain root.
  base: `./`,
  // vite@8's Plugin type and the svelte plugin's bundled copy are two instances of
  // the same type; comparing them exceeds TS's instantiation depth, so widen to
  // vite's own PluginOption[] to keep defineConfig's overload check shallow.
  plugins: [
    vite_plugin_json_gz(),
    moyo_wasm_asset_plugin(),
    stub_vite_preload(),
    svelte({ compilerOptions: { runes: true } }),
  ] as PluginOption[],
  build: {
    outDir: `lib`,
    target: `es2022`,
    // Vite's preload helper resolves chunk URLs through `import(<expression>)`,
    // which webpack can neither analyze (it warns) nor honour — it rewrites chunk
    // loading to its own runtime anyway. Dropping the helper leaves plain dynamic
    // imports for webpack to pick up.
    modulePreload: false,
    // Ship one stylesheet that package.json's `style` field loads up front.
    // Per-chunk CSS would rely on Vite's preload helper to inject <link> tags on
    // dynamic import, and that helper is stubbed out above.
    cssCodeSplit: false,
    // @jupyterlab/builder runs a production webpack pass over this output, so a
    // second minifier here would only slow the build and obscure stack traces.
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      input: resolve(import.meta.dirname, `src/index.ts`),
      // Vite treats a plain `input` as an app entry and defaults to dropping its
      // exports, which silently tree-shakes `export default plugin` — leaving
      // JupyterLab to load a module with no plugin and abort bootstrap with no
      // error. The entry is a library for webpack to consume, so keep the exports.
      preserveEntrySignatures: `strict`,
      // JupyterLab hands every extension the same singleton instances of these
      // packages. Bundling our own copy would create duplicate plugin tokens that
      // silently fail to match the ones the application registry holds.
      external: (id: string) => /^@(?:jupyterlab|lumino)\//.test(id),
      output: {
        format: `es`,
        entryFileNames: `index.js`,
        chunkFileNames: `chunks/[name]-[hash].js`,
        // package.json's `style` field points at a fixed path, so pin the CSS name
        assetFileNames: (asset) =>
          asset.names?.some((name) => name.endsWith(`.css`))
            ? `index.css`
            : `assets/[name]-[hash][extname]`,
      },
    },
    // three.js + the MatterViz component graph are legitimately large
    chunkSizeWarningLimit: 6000,
  },
  resolve: {
    alias: [
      { find: `$lib`, replacement: `${repo_root}/src/lib` },
      // one copy of three: matterviz imports three/webgpu, its addons and @threlte plain three
      { find: /^three$/, replacement: `${repo_root}/src/lib/scene/three-compat.ts` },
    ],
  },
})
