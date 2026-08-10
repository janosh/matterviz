import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'
import process from 'node:process'
import type { Plugin, PluginOption } from 'vite'
import { defineConfig } from 'vite'
import { three_compat_alias } from '../../src/vite-plugins.ts'

// Plugin to strip Node.js imports from the UMD bundle
const strip_node_imports_plugin = (): Plugin => ({
  name: `strip-node-imports`,
  renderChunk(code: string) {
    // Remove the process import that Vite sometimes injects
    return code.replace(/^import process from "node:process";\n?/m, ``)
  },
})

const moyo_glue_url = `new URL('moyo_wasm_bg.wasm', import.meta.url)`

// wasm-bindgen's default URL cannot survive a UMD build because import.meta is replaced
// with an empty object. Convert it to an embedded Vite asset before output transforms run.
const inline_moyo_wasm_plugin = (): Plugin => ({
  name: `inline-moyo-wasm`,
  enforce: `pre`,
  transform(code: string, id: string) {
    if (!id.includes(`@spglib/moyo-wasm`) || !code.includes(moyo_glue_url)) return null
    return {
      code:
        `import __matterviz_moyo_wasm_url from '@spglib/moyo-wasm/moyo_wasm_bg.wasm?url';\n` +
        code.replace(moyo_glue_url, `__matterviz_moyo_wasm_url`),
      map: null,
    }
  },
})

// Plugin to deduplicate large inline WASM base64 strings
// moyo-wasm uses wasm-bindgen which inlines WASM as data URLs
const deduplicate_wasm_plugin = (): Plugin => ({
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
      const list = by_content.get(full) ?? []
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
        result = `var ${var_name}=${wasm_str};\n${result.replaceAll(wasm_str, var_name)}`
      }
    }

    return result
  },
})

export default defineConfig({
  define: {
    // Replace process.env.NODE_ENV for browser compatibility
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? `production`),
  },

  // vite@8's Plugin type and the svelte plugin's bundled copy are two instances
  // of the same type; comparing them exceeds TS's instantiation depth, so widen
  // to vite's own PluginOption[] to keep defineConfig's overload check shallow.
  plugins: [
    strip_node_imports_plugin(),
    inline_moyo_wasm_plugin(),
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
        return undefined
      },
    }),
  ] as PluginOption[],

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
          if (assetInfo.names?.some((name) => name.endsWith(`.css`))) {
            return `matterviz_dash_components.css`
          }
          return assetInfo.names?.[0] ?? `asset`
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
    include: [`three/webgpu`, `prop-types`],
  },

  resolve: {
    alias: [three_compat_alias],
  },
})
