import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { mock_vscode } from './tests/vscode-mock.ts'
import { vite_plugin_json_gz } from './vite-plugin-json-gz.ts'

export default defineConfig(({ mode }) => ({
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
  ],
  build: {
    outDir: `dist`,
    rollupOptions: {
      input: resolve(import.meta.dirname, `src/webview/main.ts`),
      output: { entryFileNames: `webview.js`, format: `es` },
    },
    emptyOutDir: false,
    chunkSizeWarningLimit: 6000,
  },
  resolve: {
    alias: {
      $lib: resolve(import.meta.dirname, `../../src/lib`),
    },
  },
}))
