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
import { mdsvex } from 'mdsvex'
import type { PreprocessorGroup } from 'svelte/compiler'
import { heading_ids } from 'svelte-widgets/heading-anchors'
import { mdsvex_transform } from 'svelte-widgets/live-examples'
import {
  create_highlighter,
  render_block,
} from 'svelte-widgets/live-examples/create-highlighter'

const defaults = {
  Wrapper: [`svelte-widgets`, `CodeExample`],
  hideStyle: true,
  collapsible: true,
}

// svelte-widgets' default highlighter only knows starry-night's `common` bundle plus
// Svelte, which would leave the tsx/vue fences in the framework-interop docs unstyled
const grammars = [...common, svelte_grammar, tsx_grammar, vue_grammar]
const starry_night = await create_highlighter(grammars).ready()

// Heading anchors are a docs-site feature, but preprocessors run over src/lib too, where
// the injected ids end up in the published package: nothing references them, and a heading
// inside an {#each} (ChemPotDiagram's per-projection <h4>) repeats one id per iteration.
// Site pages lose nothing - the heading_anchors attachment slugifies missing ids at runtime
// with document-wide deduping.
const heading_id_injector = heading_ids()
const site_heading_ids: PreprocessorGroup = {
  name: heading_id_injector.name,
  // Separators normalized first: on Windows `input.filename` arrives back-slashed, so a
  // `/`-only pattern misses src\lib and injects ids into packaged library components.
  markup: (input) =>
    /(?:^|\/)src\/lib\//.test(input.filename?.replaceAll(`\\`, `/`) ?? ``)
      ? undefined
      : heading_id_injector.markup(input),
}

export default {
  extensions: [`.svelte`, `.svx`, `.md`],

  preprocess: [
    mdsvex({
      remarkPlugins: [[mdsvex_transform, { defaults }]],
      extensions: [`.svx`, `.md`],
      highlight: { highlighter: (code, lang) => render_block(starry_night, code, lang) },
    }),
    site_heading_ids, // runs after mdsvex converts markdown to HTML
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
