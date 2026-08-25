import adapter from '@sveltejs/adapter-static'
import type { Config } from '@sveltejs/kit'
import { common } from '@wooorm/starry-night'
import svelte_grammar from '@wooorm/starry-night/source.svelte'
import tsx_grammar from '@wooorm/starry-night/source.tsx'
import vue_grammar from '@wooorm/starry-night/text.html.vue'
import { mdsvex } from 'mdsvex'
import { heading_ids } from 'svelte-widgets/heading-anchors'
import { mdsvex_transform } from 'svelte-widgets/live-examples'
import {
  create_highlighter,
  render_block,
} from 'svelte-widgets/live-examples/create-highlighter'

const { default: pkg } = await import(`./package.json`, {
  with: { type: `json` },
})
const defaults = {
  Wrapper: [`svelte-widgets`, `CodeExample`],
  repo: pkg.repository,
  hideStyle: true,
  collapsible: true,
}

// svelte-widgets' default highlighter only knows starry-night's `common` bundle plus
// Svelte, which would leave the tsx/vue fences in the framework-interop docs unstyled
const grammars = [...common, svelte_grammar, tsx_grammar, vue_grammar]
const starry_night = await create_highlighter(grammars).ready()

export default {
  extensions: [`.svelte`, `.svx`, `.md`],

  preprocess: [
    mdsvex({
      remarkPlugins: [[mdsvex_transform, { defaults }]],
      extensions: [`.svx`, `.md`],
      highlight: { highlighter: (code, lang) => render_block(starry_night, code, lang) },
    }),
    heading_ids(), // runs after mdsvex converts markdown to HTML
  ],

  kit: {
    adapter: adapter({
      strict: false, // don't fail on symlinks
    }),

    alias: { $site: `src/site`, $root: `.`, matterviz: `src/lib` },

    prerender: {
      handleHttpError: ({ path, message }) => {
        // ignore missing element photos
        if (path.startsWith(`/elements/`)) return

        // fail the build for other errors
        throw new Error(message)
      },
    },
  },
} satisfies Config
