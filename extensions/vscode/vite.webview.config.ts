import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = fileURLToPath(new URL(`.`, import.meta.url))

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, `src/extension.ts`),
      formats: [`cjs`],
      fileName: () => `extension.cjs`,
    },
    rollupOptions: {
      external: [`vscode`, `fs`, `path`],
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
