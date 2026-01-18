import adapter from '@sveltejs/adapter-static'
import { mdsvex } from 'mdsvex'
import mdsvexamples from 'mdsvexamples'
import katex from 'rehype-katex'
import math from 'remark-math' // remark-math@3.0.0 pinned due to mdsvex, see https://github.com/kwshi/rehype-katex-svelte#usage]
import { heading_ids } from 'svelte-multiselect/heading-anchors' // adds IDs to headings at build time
import { sveltePreprocess } from 'svelte-preprocess'

const { default: pkg } = await import(`./package.json`, {
  with: { type: `json` },
})
const defaults = {
  Wrapper: [`svelte-multiselect`, `CodeExample`],
  pkg: pkg.name,
  repo: pkg.repository,
  hideStyle: true,
}

/** @type {import('@sveltejs/kit').Config} */
export default {
  extensions: [`.svelte`, `.svx`, `.md`],

  preprocess: [
    sveltePreprocess(),
    mdsvex({
      remarkPlugins: [[mdsvexamples, { defaults }], math],
      rehypePlugins: [katex],
      extensions: [`.svx`, `.md`],
    }),
    heading_ids(), // runs after mdsvex converts markdown to HTML
  ],

  kit: {
    adapter: adapter({
      fallback: `404.html`,
      strict: false, // don't fail on symlinks
    }),

    alias: { $site: `src/site`, $root: `.`, 'matterviz': `src/lib` },

    prerender: {
      handleHttpError: ({ path, message }) => {
        // ignore missing element photos
        if (path.startsWith(`/elements/`)) return

        // fail the build for other errors
        throw message
      },
    },
  },

  compilerOptions: { // TODO maybe remove in future
    warningFilter: (warning) => warning.code !== `state_referenced_locally`,
  },
}
