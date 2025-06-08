import yaml_plugin from '@rollup/plugin-yaml'
import { sveltekit } from '@sveltejs/kit/vite'
import mdsvexamples from 'mdsvexamples/vite'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [sveltekit(), mdsvexamples, yaml_plugin()],

  test: {
    environment: `happy-dom`,
    css: true,
    coverage: {
      reporter: [`text`, `json-summary`],
    },
    setupFiles: `tests/unit/setup.ts`,
    include: [`tests/unit/**/*.test.ts`, `tests/unit/**/*.test.svelte.ts`],
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
