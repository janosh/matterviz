import adapter from '@sveltejs/adapter-static'
import type { Config } from '@sveltejs/kit'
import { mdsvex } from 'mdsvex'
import katex from 'rehype-katex'
import math from 'remark-math' // remark-math@3.0.0 pinned due to mdsvex https://github.com/kwshi/rehype-katex-svelte#usage
import { heading_ids } from 'svelte-multiselect/heading-anchors'
import {
  mdsvex_transform,
  starry_night_highlighter,
  sveltePreprocess,
} from 'svelte-multiselect/live-examples'
import type { PreprocessorGroup } from 'svelte/compiler'

const { default: pkg } = await import(`./package.json`, {
  with: { type: `json` },
})
const defaults = {
  Wrapper: [`svelte-multiselect`, `CodeExample`],
  repo: pkg.repository,
  hideStyle: true,
}

export default {
  extensions: [`.svelte`, `.svx`, `.md`],

  preprocess: [
    sveltePreprocess(), // wrapped version that skips markdown files
    mdsvex({
      remarkPlugins: [[mdsvex_transform, { defaults }], math],
      rehypePlugins: [katex],
      extensions: [`.svx`, `.md`],
      highlight: { highlighter: starry_night_highlighter },
    }) as PreprocessorGroup,
    heading_ids(), // runs after mdsvex converts markdown to HTML
  ],

  kit: {
    adapter: adapter({
      strict: false, // don't fail on symlinks
    }),

    alias: { $site: `src/site`, $root: `.`, 'matterviz': `src/lib` },

    prerender: {
      handleHttpError: ({ path, message }) => {
        // ignore missing element photos
        if (path.startsWith(`/elements/`)) return

        // ignore missing ferrox docs (generated in CI, gitignored locally)
        if (
          path.startsWith(`/ferrox/rust`) || path.startsWith(`/ferrox/python`) ||
          path.startsWith(`/ferrox/wasm`)
        ) {
          console.warn(`Skipping missing ferrox doc: ${path}`)
          return
        }

        // fail the build for other errors
        throw new Error(message)
      },
    },
  },
} satisfies Config
