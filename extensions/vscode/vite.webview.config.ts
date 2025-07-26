import { svelte } from '@sveltejs/vite-plugin-svelte'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'

const __dirname = dirname(new URL(import.meta.url).pathname)

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, `src/extension.ts`),
      formats: [`cjs`],
      fileName: () => `extension.cjs`,
    },
    rollupOptions: {
      external: [`vscode`, `fs`, `path`, `node:buffer`],
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
