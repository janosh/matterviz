import adapter from '@sveltejs/adapter-static'
import { preprocessThrelte } from '@threlte/preprocess'
import { mdsvex } from 'mdsvex'
import mdsvexamples from 'mdsvexamples'
import katex from 'rehype-katex-svelte'
import math from 'remark-math'
import preprocess from 'svelte-preprocess'
import seq_preprocessor from 'svelte-sequential-preprocessor'

const { default: pkg } = await import(`./package.json`, {
  assert: { type: `json` },
})
const defaults = {
  Wrapper: `svelte-zoo/CodeExample.svelte`,
  pkg: pkg.name,
  repo: pkg.repository,
}
const remarkPlugins = [[mdsvexamples, { defaults }], math]
const rehypePlugins = [katex]

/** @type {import('@sveltejs/kit').Config} */
export default {
  extensions: [`.svelte`, `.svx`, `.md`],

  preprocess: [
    seq_preprocessor([preprocess(), preprocessThrelte()]),
    mdsvex({ remarkPlugins, rehypePlugins, extensions: [`.svx`, `.md`] }),
  ],

  kit: {
    adapter: adapter(),

    alias: {
      $root: `.`,
      $site: `src/site`,
      $static: `static`,
    },

    prerender: {
      handleHttpError: ({ path, message }) => {
        // ignore missing element photos
        if (path.startsWith(`/elements/`)) return

        // fail the build for other errors
        throw new Error(message)
      },
    },
  },
}
