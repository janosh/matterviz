import { sveltekit } from '@sveltejs/kit/vite'

/** @type {import('vite').UserConfig} */
export default {
  plugins: [sveltekit()],

  server: {
    port: 3000,
  },

  preview: {
    port: 3000,
  },
}
