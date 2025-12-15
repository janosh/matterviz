import yaml from '@rollup/plugin-yaml'
import { sveltekit } from '@sveltejs/kit/vite'
import mdsvexamples from 'mdsvexamples/vite'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { defineConfig, type Plugin } from 'vite'
import { mock_vscode } from './extensions/vscode/tests/vscode-mock'

export default defineConfig(({ mode }) => ({
  plugins: [
    { // Handle .json.gz files by decompressing them on-the-fly during SSR/build
      name: `vite-plugin-json-gz`,
      enforce: `pre`,
      load(id) {
        if (!id.endsWith(`.json.gz`)) return null
        try {
          const json_data = JSON.parse(gunzipSync(readFileSync(id)).toString(`utf-8`))
          return { code: `export default ${JSON.stringify(json_data)}`, map: null }
        } catch (error) {
          this.error(`Failed to decompress ${id}: ${error}`)
        }
      },
    } satisfies Plugin,
    sveltekit(),
    mdsvexamples,
    yaml(),
    mode === `test` ? mock_vscode() : null,
  ].filter((plugin): plugin is Plugin => Boolean(plugin)),

  test: {
    environment: `happy-dom`,
    css: true,
    pool: `forks`, // Use forks instead of threads to avoid esbuild conflicts
    coverage: {
      reporter: [`text`, `json-summary`],
    },
    setupFiles: `tests/vitest/setup.ts`,
    include: [
      `tests/vitest/**/*.test.ts`,
      `tests/vitest/**/*.test.svelte.ts`,
      `extensions/vscode/tests/**/*.test.ts`,
    ],
  },

  server: {
    fs: { allow: [`..`] }, // needed to import from $root
    port: 3000,
  },

  preview: {
    port: 3000,
  },

  resolve: {
    conditions: mode === `test` ? [`browser`] : undefined,
  },
}))
