import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { lib_aliases, vite_plugin_json_gz } from '../../src/vite-plugins.ts'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, `src/extension.ts`),
      formats: [`es`],
      fileName: () => `extension.js`,
    },
    rollupOptions: {
      // Every node builtin must stay external, bare or `node:`-prefixed: one missing from this
      // list is silently replaced by an empty browser stub (node-io's zlib/stream decompression
      // broke that way)
      external: [`vscode`, /^node:/, ...builtinModules],
    },
    minify: false,
    emptyOutDir: false,
  },
  resolve: { alias: lib_aliases },
  // No svelte(): the host deep-imports $lib modules (never the component barrels), so a
  // .svelte file reaching this bundle is a dependency-graph regression and should fail loudly
  plugins: [vite_plugin_json_gz()],
})
