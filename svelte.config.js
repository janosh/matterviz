import adapter from '@sveltejs/adapter-static'
import { mdsvex } from 'mdsvex'
import examples from 'mdsvexamples'
import katex from 'rehype-katex-svelte'
import math from 'remark-math'
import preprocess from 'svelte-preprocess'

const { default: pkg } = await import(`./package.json`, {
  assert: { type: `json` },
})
const defaults = {
  Wrapper: `svelte-zoo/CodeExample.svelte`,
  pkg: pkg.name,
  repo: pkg.repository,
}
const remarkPlugins = [[examples, { defaults }], math]
const rehypePlugins = [katex]

/** @type {import('@sveltejs/kit').Config} */
export default {
  extensions: [`.svelte`, `.svx`, `.md`],

  preprocess: [
    preprocess(),
    mdsvex({ remarkPlugins, rehypePlugins, extensions: [`.svx`, `.md`] }),
  ],

  kit: {
    adapter: adapter(),

    alias: {
      $root: `.`,
      $site: `src/site`,
    },
  },
}
