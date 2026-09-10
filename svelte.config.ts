// Kept separate from vite.config.ts on purpose: @sveltejs/package only reads
// svelte.config.{js,ts} (node_modules/@sveltejs/package/src/config.js), so moving this into
// an inline config passed to sveltekit() would leave `pnpm package:dist` with no
// preprocessors, extensions or aliases. Kit itself resolves inline config fine.
import adapter from '@sveltejs/adapter-static'
import type { Config } from '@sveltejs/kit'
import { common } from '@wooorm/starry-night'
import svelte_grammar from '@wooorm/starry-night/source.svelte'
import tsx_grammar from '@wooorm/starry-night/source.tsx'
import vue_grammar from '@wooorm/starry-night/text.html.vue'
import { create_markdown } from 'svelte-widgets/markdown'
import { markdown_vite } from 'svelte-widgets/markdown/vite'
import { create_highlighter } from 'svelte-widgets/highlight'

const defaults = {
  hide_style: true,
  collapsible: true,
}

// svelte-widgets' default highlighter only knows starry-night's `common` bundle plus
// Svelte, which would leave the tsx/vue fences in the framework-interop docs unstyled
const grammars = [...common, svelte_grammar, tsx_grammar, vue_grammar]
const highlighter = create_highlighter(grammars)
export const docs = markdown_vite(
  create_markdown({
    examples: defaults,
    highlight: highlighter.highlight,
    typography: true,
  }),
)

export default {
  extensions: [`.svelte`, `.svx`, `.md`],

  preprocess: [docs.preprocess],

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
