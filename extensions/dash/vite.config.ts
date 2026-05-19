import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import process from 'node:process'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

// Plugin to strip Node.js imports from the UMD bundle
const strip_node_imports_plugin = (): Plugin => ({
  name: `strip-node-imports`,
  renderChunk(code: string) {
    // Remove the process import that Vite sometimes injects
    return code.replace(/^import process from "node:process";\n?/m, ``)
  },
})

// Plugin to deduplicate large inline WASM base64 strings
// moyo-wasm uses wasm-bindgen which inlines WASM as data URLs
function deduplicate_wasm_plugin(): Plugin {
  return {
    name: `deduplicate-wasm`,
    renderChunk(code: string) {
      // Find all base64 WASM data URLs (they're ~700KB each as base64)
      const wasm_regex = /"data:application\/wasm;base64,([A-Za-z0-9+/=]{1000,})"/g
      const matches = [...code.matchAll(wasm_regex)]

      if (matches.length <= 1) return null // Nothing to dedupe

      // Group by content to find duplicates
      const by_content = new Map<string, RegExpExecArray[]>()
      for (const match of matches) {
        const full = match[0]
        const list = by_content.get(full) || []
        list.push(match)
        by_content.set(full, list)
      }

      // Replace duplicates with a shared variable
      let result = code
      let var_idx = 0
      for (const [wasm_str, occurrences] of by_content) {
        if (occurrences.length > 1) {
          const var_name = `__wasm_data_${var_idx++}__`
          // Add variable declaration at the start of the chunk
          result = `var ${var_name}=${wasm_str};\n` + result.replaceAll(wasm_str, var_name)
        }
      }

      return result
    },
  }
}

export default defineConfig({
  define: {
    // Replace process.env.NODE_ENV for browser compatibility
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || `production`),
  },

  plugins: [
    strip_node_imports_plugin(),
    deduplicate_wasm_plugin(),
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
      entry: resolve(import.meta.dirname, `src/lib/index.ts`),
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
    // Use Vite 8's bundled Oxc minifier instead of requiring esbuild separately.
    minify: process.env.NODE_ENV === `production` ? `oxc` : false,
  },

  optimizeDeps: {
    // Pre-bundle these dependencies
    include: [`three`, `prop-types`],
  },
})
