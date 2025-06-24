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
    setupFiles: `tests/vitest/setup.ts`,
    include: [`tests/vitest/**/*.test.ts`, `tests/vitest/**/*.test.svelte.ts`],
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
