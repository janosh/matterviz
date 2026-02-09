import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { mock_vscode } from './tests/vscode-mock'

// always defined when running under Node/Vite
const __dirname = import.meta.dirname as string

export default defineConfig(({ mode }) => ({
  plugins: [
    mode === `test`
      ? { // just ignore svelte files in test mode
        name: `svelte-mock`,
        resolveId: (id: string) => id.endsWith(`.svelte`) ? id : null,
        load: (id: string) => id.endsWith(`.svelte`) ? `export default {}` : null,
      }
      : svelte(),
    mode === `test` ? mock_vscode() : null,
  ],
  build: {
    outDir: `dist`,
    rollupOptions: {
      input: resolve(__dirname, `src/webview/main.ts`),
      output: { entryFileNames: `webview.js`, format: `iife` },
    },
    emptyOutDir: false,
    chunkSizeWarningLimit: 6000,
  },
  resolve: {
    alias: {
      $lib: resolve(__dirname, `../../src/lib`),
    },
  },
}))
