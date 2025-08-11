import yaml from '@rollup/plugin-yaml'
import { sveltekit } from '@sveltejs/kit/vite'
import mdsvexamples from 'mdsvexamples/vite'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [
    sveltekit(),
    mdsvexamples,
    yaml(),
    mode === `test`
      ? { // Inline virtual module to mock 'vscode' package during tests
        name: `vscode-mock`,
        enforce: `pre`,
        resolveId: (id: string) => id === `vscode` ? id : null,
        load: (id: string) => (id === `vscode` ? `export default {}` : null),
      }
      : null,
  ].filter(Boolean),

  test: {
    environment: `happy-dom`,
    css: true,
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
