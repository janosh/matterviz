import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// always defined when running under Node/Vite
const __dirname = import.meta.dirname as string

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, `src/extension.ts`),
      formats: [`es`],
      fileName: () => `extension.mjs`,
    },
    rollupOptions: {
      external: [
        `vscode`,
        `fs`,
        `path`,
        `node:buffer`,
        `node:fs`,
        `node:os`,
        `node:path`,
        `os`,
      ],
    },
    minify: false,
  },
  resolve: {
    alias: {
      $lib: resolve(__dirname, `../../src/lib`),
    },
  },
  plugins: [svelte()],
})
