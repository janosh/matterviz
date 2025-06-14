import adapter from '@sveltejs/adapter-static'
import { mdsvex } from 'mdsvex'
import mdsvexamples from 'mdsvexamples'
import katex from 'rehype-katex'
import math from 'remark-math'
import { sveltePreprocess } from 'svelte-preprocess'

const { default: pkg } = await import(`./package.json`, {
  with: { type: `json` },
})
const defaults = {
  Wrapper: `svelte-zoo/CodeExample.svelte`,
  pkg: pkg.name,
  repo: pkg.repository,
  hideStyle: true,
}
const remarkPlugins = [[mdsvexamples, { defaults }], math]
const rehypePlugins = [katex]

/** @type {import('@sveltejs/kit').Config} */
export default {
  extensions: [`.svelte`, `.svx`, `.md`],

  preprocess: [
    sveltePreprocess(),
    mdsvex({ remarkPlugins, rehypePlugins, extensions: [`.svx`, `.md`] }),
  ],

  compilerOptions: {
    // enable direct prop access for vitest unit tests
    accessors: Boolean(process.env.TEST),
  },

  kit: {
    adapter: adapter({ fallback: `404.html` }),

    alias: {
      $site: `src/site`,
      $root: `.`,
      $types: `src/types`,
    },

    prerender: {
      handleHttpError: ({ path, message }) => {
        // ignore missing element photos
        if (path.startsWith(`/elements/`)) return

        // fail the build for other errors
        throw message
      },
    },
  },
}
