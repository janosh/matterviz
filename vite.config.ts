import yaml from '@rollup/plugin-yaml'
import { sveltekit } from '@sveltejs/kit/vite'
import mdsvexamples from 'mdsvexamples/vite'
import { defineConfig, type Plugin } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [
    sveltekit(),
    mdsvexamples,
    yaml(),
    mode === `test`
      ? {
        // Inline virtual module to mock 'vscode' package during tests
        name: `vscode-mock`,
        enforce: `pre`,
        resolveId: (id: string) => (id === `vscode` ? id : null),
        load: (id: string) =>
          id === `vscode`
            ? `
export const __noop = () => undefined
const __proxy = new Proxy(function(){}, {
  get: () => __proxy,
  apply: () => undefined,
})
export const window = __proxy
export const commands = __proxy
export const workspace = __proxy
export default { window, commands, workspace }
`
            : null,
      }
      : null,
  ].filter((plugin): plugin is Plugin => Boolean(plugin)),

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
