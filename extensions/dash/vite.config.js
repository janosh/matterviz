import { svelte } from '@sveltejs/vite-plugin-svelte'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const is_dev = process.env.NODE_ENV !== `production`

// Plugin to strip Node.js imports from the UMD bundle
function stripNodeImportsPlugin() {
  return {
    name: `strip-node-imports`,
    renderChunk(code) {
      // Remove the process import that Vite sometimes injects
      return code.replace(/^import process from "node:process";\n?/m, ``)
    },
  }
}

export default defineConfig({
  define: {
    // Replace process.env.NODE_ENV for browser compatibility
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || `production`),
  },

  plugins: [
    stripNodeImportsPlugin(),
    svelte({
      compilerOptions: {
        runes: true,
      },
      // Handle .ce.svelte files as custom elements
      dynamicCompileOptions({ filename, compileOptions }) {
        if (filename.endsWith(`.ce.svelte`)) {
          return {
            ...compileOptions,
            customElement: true,
          }
        }
      },
    }),
  ],

  build: {
    lib: {
      entry: resolve(__dirname, `src/lib/index.js`),
      name: `matterviz_dash_components`,
      formats: [`umd`],
      fileName: () => `matterviz_dash_components.min.js`,
    },
    outDir: `matterviz_dash_components`,
    emptyOutDir: false, // Don't delete py files in the output dir
    rollupOptions: {
      external: [`react`, `react-dom`],
      output: {
        globals: {
          react: `React`,
          'react-dom': `ReactDOM`,
        },
        // Ensure assets go to the same directory
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(`.wasm`)) {
            return `matterviz_wasm.wasm`
          }
          if (assetInfo.name?.endsWith(`.css`)) {
            return `matterviz_dash_components.css`
          }
          return assetInfo.name || `asset`
        },
        // Note: manualChunks not supported with UMD format
      },
    },
    // Generate sourcemaps in dev
    sourcemap: is_dev,
    // Minify in production
    minify: is_dev ? false : `esbuild`,
  },

  // Ensure .wasm files are handled correctly
  assetsInclude: [`**/*.wasm`],

  optimizeDeps: {
    // Pre-bundle these dependencies
    include: [`three`, `prop-types`],
  },
})
