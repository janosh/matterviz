import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

// this file is trying to load ESM-only packages but it's being loaded as CommonJS by VSCode extension.
// Needs to be explicitly named .mjs to communicate correct import format to VSCode.

const __dirname = fileURLToPath(new URL(`.`, import.meta.url))

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: `dist`,
    rollupOptions: {
      input: resolve(__dirname, `webview/src/main.ts`),
      output: { entryFileNames: `webview.js`, format: `iife` },
    },
    emptyOutDir: false,
    chunkSizeWarningLimit: 1_000_000,
  },
  test: {
    setupFiles: [`tests/setup.ts`],
  },
  resolve: {
    alias: {
      '$lib': resolve(__dirname, `../../src/lib`),
      '$app/navigation': resolve(
        __dirname,
        `webview/src/stubs/app-navigation.ts`,
      ),
      '$app/stores': resolve(__dirname, `webview/src/stubs/app-stores.ts`),
      '$app/environment': resolve(
        __dirname,
        `webview/src/stubs/app-environment.ts`,
      ),
      // Mock vscode module for tests
      'vscode': resolve(__dirname, `tests/vscode-mock.ts`),
    },
  },
})
