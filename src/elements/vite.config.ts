// Builds the custom-element bundle (src/elements/index.svelte.ts) into dist/elements/ for
// `matterviz/elements`: Svelte, three.js and every other dependency inlined, each component
// in its own lazily loaded chunk. Run by `pnpm package:dist` after svelte-package.
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { basename, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig, type PluginOption } from 'vite-plus'
import { extract_prop_docs, type PropDoc } from '../scripts/prop-docs.ts'
import { json_gz_worker_plugins, lib_aliases, vite_plugin_json_gz } from '../vite-plugins.ts'
import { COMPONENTS, tag_name } from './components.ts'
import { scoped_app_css } from './scoped-css.ts'

const lib_dir = resolve(import.meta.dirname, `../lib`)
// Each becomes <mv-{kebab-case name}>, e.g. ScatterPlot3D -> mv-scatter-plot-3d
const components = Object.values(COMPONENTS).map((path) => `${lib_dir}/${path}.svelte`)

// app.css scoped to the elements, which are blocks that take their color-scheme from the
// :state() they set to the page theme
const element_css = (tags: readonly string[]): string => {
  const tag_list = tags.join(`, `)
  return `${scoped_app_css(tag_list)}
:where(${tag_list}):not([hidden]) { display: block; }
:where(${tag_list}):state(light) { color-scheme: light; }
:where(${tag_list}):state(dark) { color-scheme: dark; }`
}

// Props an element exposes: not snippets (markup can't come from outside), not hyphenated
// (data-testid would copy the host's test id inward) and not the element's own style/id/class
const ELEMENT_OWN = new Set([`style`, `id`, `class`])
const is_settable = ({ name, type = `` }: PropDoc): boolean => {
  // union members of the type with generic arguments removed, which may hold unions themselves
  let outer = type
  while (/<[^<>]*>/.test(outer)) outer = outer.replaceAll(/<[^<>]*>/g, ``)
  return (
    /^[a-z_]\w*$/i.test(name) &&
    !ELEMENT_OWN.has(name) &&
    !outer.split(`|`).every((member) => /^\s*Snippet\b/.test(member))
  )
}
// Svelte writes a bindable prop back only into keys the props hold at mount, and rejects an
// undefined key whose prop has a default, so the elements seed exactly these
const is_bindable_without_default = (doc: PropDoc): boolean =>
  Boolean(doc.bindable) && (!doc.default || /^undefined\b/.test(doc.default))

// `virtual:matterviz-elements` default-exports { [tag]: { load, props, bindable, seeded } }
// from each component's `$props()`: its settable prop names, the bindable ones and those of
// them without a default, so elements expose new props unasked. `css` is their stylesheet.
const VIRTUAL_ID = `virtual:matterviz-elements`
const elements_plugin: PluginOption = {
  name: `matterviz-elements`,
  resolveId: (id: string) => (id === VIRTUAL_ID ? `\0${id}` : null),
  load(id: string) {
    if (id !== `\0${VIRTUAL_ID}`) return null
    const prop_docs = extract_prop_docs(components)
    const tags = Object.values(COMPONENTS).map(tag_name)
    const entries = components.map((file, idx) => {
      const docs = prop_docs[basename(file, `.svelte`)].props.filter(is_settable)
      const props = docs.map((doc) => doc.name)
      const bindable = docs.filter((doc) => doc.bindable).map((doc) => doc.name)
      const seeded = docs.filter(is_bindable_without_default).map((doc) => doc.name)
      const lists = { props, bindable, seeded }
      return `${JSON.stringify(tags[idx])}: { load: () => import(${JSON.stringify(file)}), ...${JSON.stringify(lists)} }`
    })
    const css = JSON.stringify(element_css(tags))
    return `export const css = ${css}\nexport default {\n${entries.join(`,\n`)}\n}`
  },
}

// Pages on another origin than this bundle (a CDN) can't start its worker files directly, so
// `Worker` is CrossOriginWorker wherever one is constructed (Vite still emits them by syntax)
const cross_origin_worker = resolve(import.meta.dirname, `cross-origin-worker.ts`)
const cross_origin_workers: Plugin = {
  name: `cross-origin-workers`,
  enforce: `pre`,
  transform(code, identifier) {
    if (identifier === cross_origin_worker || !/\bnew Worker\(/.test(code)) return null
    const binding = `import { CrossOriginWorker as Worker } from ${JSON.stringify(cross_origin_worker)}`
    return { code: `${binding}\n${code}`, map: null }
  },
}

// three's DRACO and KTX2 loaders name their decoders via `new URL(..., import.meta.url)`, so
// those files (1.9 MB) are emitted even after tree-shaking drops the loaders: drop every asset
// no other output file names, repeating as dropping one can orphan the files it named
const drop_orphan_assets: Plugin = {
  name: `drop-orphan-assets`,
  generateBundle(_options, bundle) {
    const text = (file: (typeof bundle)[string]): string =>
      file.type === `chunk` ? file.code : typeof file.source === `string` ? file.source : ``
    for (let dropped = true; dropped;) {
      dropped = false
      const files = Object.values(bundle)
      for (const file of files) {
        const name = basename(file.fileName)
        const named = files.some((other) => other !== file && text(other).includes(name))
        if (file.type === `asset` && !named) {
          Reflect.deleteProperty(bundle, file.fileName)
          dropped = true
        }
      }
    }
  },
}

export default defineConfig({
  // Relative chunk and worker URLs: the default absolute `/assets/...` resolves against the
  // host page's origin root, not wherever the bundle is served from
  base: `./`,
  // svelte() ships its own copy of Vite's Plugin type; comparing the two exceeds TS's
  // instantiation depth, so widen to PluginOption[]
  plugins: [
    vite_plugin_json_gz(),
    elements_plugin,
    cross_origin_workers,
    drop_orphan_assets,
    // No stylesheet for hosts to link: each component injects its CSS when first mounted
    svelte({ compilerOptions: { css: `injected` } }),
  ] as PluginOption[],
  resolve: { alias: lib_aliases },
  // One file per worker, h5wasm included in the parse worker: an app bundling this package
  // copies each `new URL('worker.js', import.meta.url)` file alone into its own assets, where
  // the worker's relative imports of sibling chunks would 404
  worker: {
    format: `es`,
    plugins: json_gz_worker_plugins(),
    rolldownOptions: { output: { codeSplitting: false } },
  },
  build: {
    outDir: resolve(import.meta.dirname, `../../dist/elements`),
    emptyOutDir: true,
    // An app build with a script entry, not lib mode, whose ES output keeps its whitespace.
    // Without preload hints: their base-relative chunk lists 404 once an app re-bundles them.
    modulePreload: false,
    rolldownOptions: {
      input: resolve(import.meta.dirname, `index.svelte.ts`),
      output: {
        entryFileNames: `matterviz-elements.js`,
      },
    },
    reportCompressedSize: false,
    chunkSizeWarningLimit: 6000,
  },
})
