import { sveltekit } from '@sveltejs/kit/vite'
import type { UserConfig } from 'vite'
import type { UserConfig as VitestConfig } from 'vitest'

const vite_config: UserConfig & { test: VitestConfig } = {
  plugins: [sveltekit()],

  server: {
    fs: {
      allow: [`..`], // needed to import package.json
    },
    port: 3000,
  },

  preview: {
    port: 3000,
  },

  test: {
    environment: `jsdom`,
  },
}

export default vite_config
