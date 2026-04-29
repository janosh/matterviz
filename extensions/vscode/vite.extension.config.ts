import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { vite_plugin_json_gz } from './vite-plugin-json-gz.ts'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, `src/extension.ts`),
      formats: [`es`],
      fileName: () => `extension.js`,
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
    emptyOutDir: false,
  },
  resolve: {
    alias: {
      $lib: resolve(import.meta.dirname, `../../src/lib`),
    },
  },
  plugins: [vite_plugin_json_gz(), svelte()],
})
