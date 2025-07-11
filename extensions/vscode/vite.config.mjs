import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  },
  resolve: {
    alias: {
      $lib: resolve(__dirname, `../../src/lib`),
    },
  },
})
