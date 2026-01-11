import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import process from 'node:process'

export default defineConfig({
  define: {
    // Replace process.env.NODE_ENV for browser compatibility
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || `production`,
    ),
  },

  plugins: [
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
    sourcemap: process.env.NODE_ENV !== `production`,
    // Minify in production
    minify: process.env.NODE_ENV === `production` ? `esbuild` : false,
  },

  // Ensure .wasm files are handled correctly
  assetsInclude: [`**/*.wasm`],

  optimizeDeps: {
    // Pre-bundle these dependencies
    include: [`three`, `prop-types`],
  },
})
