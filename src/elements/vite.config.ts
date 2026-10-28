// Builds the custom-element bundle (src/elements/index.svelte.ts) into dist/elements/ for
// `matterviz/elements`: Svelte, three.js and every other dependency inlined, each component
// in its own lazily loaded chunk. Run by `pnpm package:dist` after svelte-package.
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig, type PluginOption } from 'vite-plus'
import { extract_prop_docs, type PropDoc } from '../scripts/prop-docs.ts'
import { json_gz_worker_plugins, lib_aliases, vite_plugin_json_gz } from '../vite-plugins.ts'

const lib_dir = resolve(import.meta.dirname, `../lib`)

// Each becomes <mv-{kebab-case name}>, e.g. ScatterPlot3D -> mv-scatter-plot-3d
const components = [
  `structure/Structure`,
  `trajectory/Trajectory`,
  `periodic-table/PeriodicTable`,
  `composition/Composition`,
  `plot/scatter/ScatterPlot`,
  `plot/scatter-3d/ScatterPlot3D`,
  `plot/bar/BarPlot`,
  `plot/bar/SpacegroupBarPlot`,
  `plot/histogram/Histogram`,
  `plot/treemap/Treemap`,
  `heatmap-matrix/HeatmapMatrix`,
  `spectral/Bands`,
  `spectral/Dos`,
  `spectral/BandsAndDos`,
  `brillouin/BrillouinZone`,
  `fermi-surface/FermiSurface`,
  `convex-hull/ConvexHull`,
  `phase-diagram/IsobaricBinaryPhaseDiagram`,
  `chempot-diagram/ChemPotDiagram`,
  `xrd/XrdPlot`,
  `rdf/RdfPlot`,
].map((path) => `${lib_dir}/${path}.svelte`)

const tag_name = (name: string): string =>
  `mv-${(name.match(/[A-Z][a-z]*|\d+[A-Z]?/g) ?? []).join(`-`).toLowerCase()}`

// app.css for a host page. Its theme tokens stay on :root at zero specificity (so any page rule
// beats them) and without color-scheme, which each element sets from its :state(). The demo
// site's matterviz-shell layer (body, links, headings) goes, and every other rule is scoped to
// the elements, so bare button/input/table rules leave the page alone.
const SHELL_LAYER = `@layer matterviz-shell {`
const COLOR_SCHEME = `color-scheme: light dark;`
const element_css = (tags: readonly string[]): string => {
  const css = readFileSync(`${lib_dir}/app.css`, `utf8`).replaceAll(/\/\*[\s\S]*?\*\//g, ``)
  const rules: string[] = []
  let [depth, start] = [0, 0]
  for (let idx = 0; idx < css.length; idx++) {
    if (css[idx] === `{`) depth++
    else if (css[idx] === `}` && --depth === 0) {
      rules.push(css.slice(start, idx + 1).trim())
      start = idx + 1
    }
  }
  const is_token = (rule: string) => /^:(?:root|host)\b/.test(rule)
  const tokens = rules.filter(is_token).join(`\n`)
  if (depth !== 0 || css.slice(start).trim() || !tokens.includes(COLOR_SCHEME)) {
    throw new Error(
      `${lib_dir}/app.css: unbalanced braces or no ${COLOR_SCHEME} in its tokens`,
    )
  }
  if (!rules.some((rule) => rule.startsWith(SHELL_LAYER))) {
    throw new Error(`${lib_dir}/app.css: ${SHELL_LAYER} not found`)
  }
  const scoped = rules.filter((rule) => !is_token(rule) && !rule.startsWith(SHELL_LAYER))
  const tag_list = tags.join(`, `)
  const zero_specificity = tokens
    .replace(COLOR_SCHEME, ``)
    .replaceAll(/^(?<selector>:(?:root|host)[^{]*?)\s*\{/gm, `:where($<selector>) {`)
  return `${zero_specificity}
:where(${tag_list}):not([hidden]) { display: block; }
:where(${tag_list}):state(light) { color-scheme: light; }
:where(${tag_list}):state(dark) { color-scheme: dark; }
@scope (${tag_list}) {
${scoped.join(`\n`)}
}`
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
    const tags = components.map((file) => tag_name(basename(file, `.svelte`)))
    const entries = components.map((file, idx) => {
      const docs = prop_docs[basename(file, `.svelte`)].filter(is_settable)
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
