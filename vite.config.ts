import { sveltekit } from '@sveltejs/kit/vite'
import mdsvexamples from 'mdsvexamples/vite'
import type { UserConfig } from 'vite'
import type { UserConfig as VitestConfig } from 'vitest'

const run_script = process.argv.some((arg) =>
  arg.startsWith(`fetch-elem-images:`)
)
if (run_script) {
  await import(`./src/fetch-elem-images.ts`)
}

export default {
  plugins: [sveltekit(), mdsvexamples],

  test: {
    environment: `jsdom`,
    css: true,
    coverage: {
      reporter: [`text`, `json-summary`],
    },
  },

  server: {
    fs: { allow: [`..`] }, // needed to import from $root
    port: 3000,
  },

  preview: {
    port: 3000,
  },
} satisfies UserConfig & { test: VitestConfig }
