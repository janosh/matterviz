import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import { make_config } from 'svelte-widgets/vite-config'
import { defineConfig, type PluginOption } from 'vite'
import {
  json_gz_worker_plugins,
  lib_aliases,
  vite_plugin_json_gz,
} from '../../src/vite-plugins.ts'
import { mock_vscode } from './tests/vscode-mock.ts'

// Fail the build instead of shipping a worker that only breaks inside a VS Code webview
const self_contained_worker: PluginOption = {
  name: `self-contained-worker`,
  generateBundle(_options, bundle) {
    const files = Object.keys(bundle)
    if (files.length > 1) {
      throw new Error(`Webview workers must be single files, got ${files.join(`, `)}`)
    }
  },
}

export default defineConfig(({ mode }) => ({
  // Relative asset URLs: the webview loads dist/webview.js from a vscode-resource URL, so the
  // default absolute `/assets/<worker>.js` would resolve against that origin's root and 404.
  base: `./`,
  // vite@8's Plugin type and the svelte plugin's bundled copy are two instances
  // of the same type; comparing them exceeds TS's instantiation depth, so widen
  // to vite's own PluginOption[] to keep defineConfig's overload check shallow.
  plugins: [
    vite_plugin_json_gz(),
    mode === `test`
      ? {
          // just ignore svelte files in test mode
          name: `svelte-mock`,
          resolveId: (identifier: string) =>
            identifier.endsWith(`.svelte`) ? identifier : null,
          load: (identifier: string) =>
            identifier.endsWith(`.svelte`) ? `export default {}` : null,
        }
      : svelte(),
    mode === `test` ? mock_vscode() : null,
  ] as PluginOption[],
  // Webview workers start from blob URLs of their fetched scripts (see file-viewer/main.ts),
  // where neither relative imports nor relative asset URLs resolve, so each worker must be one
  // self-contained file. This inlines the lazily imported h5wasm chunk, making the parse
  // worker ~5 MB.
  worker: {
    format: `es`,
    plugins: () => [...json_gz_worker_plugins()(), self_contained_worker] as PluginOption[],
    rolldownOptions: { output: { codeSplitting: false } },
  },
  build: {
    outDir: `dist`,
    rollupOptions: {
      input: resolve(import.meta.dirname, `../../src/lib/file-viewer/main.ts`),
      output: { entryFileNames: `webview.js`, format: `es` },
    },
    emptyOutDir: false,
    chunkSizeWarningLimit: 6000,
    // Taken from the shared config rather than repeated: vite's default target lacks
    // light-dark(), so LightningCSS downlevels app.css's tokens into an OS-prefers-color-scheme
    // polyfill that ignores the color-scheme the webview sets from VS Code's theme. This build
    // drifted from the root's precisely because the value was declared in two places.
    cssTarget: make_config().build.cssTarget,
  },
  resolve: { alias: lib_aliases },
}))
