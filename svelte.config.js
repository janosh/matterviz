import adapter from '@sveltejs/adapter-static'
import { s as hastscript } from 'hastscript'
import { mdsvex } from 'mdsvex'
import mdsvexamples from 'mdsvexamples'
import link_headings from 'rehype-autolink-headings'
import katex from 'rehype-katex'
import heading_slugs from 'rehype-slug'
import math from 'remark-math'
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
// remark-math@3.0.0 pinned due to mdsvex, see
// https://github.com/kwshi/rehype-katex-svelte#usage]
const remarkPlugins = [[mdsvexamples, { defaults }], math]
const rehypePlugins = [katex, heading_slugs, [
  link_headings,
  {
    behavior: `append`,
    test: [`h2`, `h3`, `h4`, `h5`, `h6`], // don't auto-link <h1>
    content: hastscript(
      `svg`,
      {
        width: 16,
        height: 16,
        viewBox: `0 0 16 16`,
        'aria-label': `Link to heading`,
        role: `img`,
      },
      hastscript(`path`, {
        d: `M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0z`,
        fill: `currentColor`,
      }),
    ),
  },
]]

/** @type {import('@sveltejs/kit').Config} */
export default {
  extensions: [`.svelte`, `.svx`, `.md`],

  preprocess: [
    sveltePreprocess(),
    mdsvex({ remarkPlugins, rehypePlugins, extensions: [`.svx`, `.md`] }),
  ],

  kit: {
    adapter: adapter({ fallback: `404.html` }),

    alias: { $site: `src/site`, $root: `.` },

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
