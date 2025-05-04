import { sveltekit } from '@sveltejs/kit/vite'
import mdsvexamples from 'mdsvexamples/vite'
import { defineConfig } from 'vite'

const run_script = process.argv.some((arg) =>
  arg.startsWith(`fetch-elem-images:`),
)
if (run_script) {
  await import(`./src/fetch-elem-images.ts`)
}

export default defineConfig(({ mode }) => ({
  plugins: [sveltekit(), mdsvexamples],

  test: {
    environment: `happy-dom`,
    css: true,
    coverage: {
      reporter: [`text`, `json-summary`],
    },
    setupFiles: `tests/unit/setup.ts`,
    include: [`tests/unit/**/*.test.ts`],
  },

  server: {
    fs: { allow: [`..`] }, // needed to import from $root
    port: 3000,
  },

  ssr: {
    noExternal: [`three`],
  },

  preview: {
    port: 3000,
  },

  resolve: {
    conditions: mode === `test` ? [`browser`] : [],
  },
}))
