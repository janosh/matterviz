import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import { defineConfig, type PluginOption } from 'vite'
import { mock_vscode } from './tests/vscode-mock.ts'
import { vite_plugin_json_gz } from './vite-plugin-json-gz.ts'

export default defineConfig(({ mode }) => ({
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
  build: {
    outDir: `dist`,
    rollupOptions: {
      input: resolve(import.meta.dirname, `../../src/lib/file-viewer/main.ts`),
      output: { entryFileNames: `webview.js`, format: `es` },
    },
    emptyOutDir: false,
    chunkSizeWarningLimit: 6000,
  },
  resolve: {
    // Array form so `three` matches exactly — a string alias prefix-matches and would
    // rewrite three/webgpu, three/tsl and three/examples/* too.
    alias: [
      { find: `$lib`, replacement: resolve(import.meta.dirname, `../../src/lib`) },
      // one copy of three: matterviz imports three/webgpu, its addons and @threlte plain three
      {
        find: /^three$/,
        replacement: resolve(import.meta.dirname, `../../src/lib/scene/three-compat.ts`),
      },
    ],
  },
}))
