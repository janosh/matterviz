import { config } from '@janosh/vite-config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  ...config, // shared lint/fmt/build from @janosh/vite-config (dotfiles)
  resolve: {
    alias: {
      // The widget never parses HDF5 client-side (pymatviz parses on the Python
      // side), so stub out h5wasm to drop ~5 MB of HDF5 WASM from the bundle.
      h5wasm: resolve(import.meta.dirname, `h5wasm-stub.ts`),
    },
  },
  plugins: [
    {
      name: `vite-plugin-json-gz`,
      enforce: `pre`,
      load(id) {
        if (!id.endsWith(`.json.gz`)) return null
        try {
          const json_data = JSON.parse(gunzipSync(readFileSync(id)).toString(`utf-8`))
          return { code: `export default ${JSON.stringify(json_data)}`, map: null }
        } catch {
          return null
        }
      },
    },
    svelte(),
  ],
  build: {
    ...config.build, // keep shared cssTarget: esnext (for light-dark())
    outDir: `build`,
    lib: {
      entry: resolve(import.meta.dirname, `anywidget.ts`),
      formats: [`es`],
      fileName: `matterviz`,
      cssFileName: `matterviz`,
    },
    minify: true, // published to a CDN + parsed in browsers; halve size/parse cost
    rollupOptions: {
      // Disable code splitting -- widget asset loader expects a single JS file
      output: { inlineDynamicImports: true },
    },
  },
})
