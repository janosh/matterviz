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
          resolveId: (id: string) => (id.endsWith(`.svelte`) ? id : null),
          load: (id: string) => (id.endsWith(`.svelte`) ? `export default {}` : null),
        }
      : svelte(),
    mode === `test` ? mock_vscode() : null,
  ] as PluginOption[],
  // ES-format workers keep code splitting: with the default iife format the parse worker
  // inlined the lazily-imported h5wasm chunk and weighed 5 MB per fresh worker
  worker: { format: `es`, plugins: json_gz_worker_plugins() as () => PluginOption[] },
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
