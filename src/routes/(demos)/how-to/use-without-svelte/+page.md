# Use MatterViz on non‑Svelte sites

## Custom elements

MatterViz ships its main components prebuilt as [custom elements](https://developer.mozilla.org/docs/Web/API/Web_components/Using_custom_elements) in `matterviz/elements`. They work in plain HTML, React, Vue or any other framework, with Svelte, three.js and every other dependency bundled. Importing the bundle defines these tags:

`mv-structure`, `mv-trajectory`, `mv-periodic-table`, `mv-composition`, `mv-scatter-plot`, `mv-scatter-plot-3d`, `mv-bar-plot`, `mv-spacegroup-bar-plot`, `mv-histogram`, `mv-treemap`, `mv-heatmap-matrix`, `mv-bands`, `mv-dos`, `mv-bands-and-dos`, `mv-brillouin-zone`, `mv-fermi-surface`, `mv-convex-hull`, `mv-isobaric-binary-phase-diagram`, `mv-chem-pot-diagram`, `mv-xrd-plot`, `mv-rdf-plot`

Each takes the props of the component it wraps (`mv-structure` takes those of [`Structure`](https://github.com/janosh/matterviz/blob/main/src/lib/structure/Structure.svelte), listed at the bottom of this page) as element properties or attributes. Only the components a page uses are downloaded.

### Plain HTML

```html
<mv-structure source="/TiO2.cif" style="height: 500px"></mv-structure>

<script type="module">
  import 'https://cdn.jsdelivr.net/npm/matterviz/dist/elements/matterviz-elements.js'

  const viewer = document.querySelector(`mv-structure`)
  viewer.on_file_load = ({ filename, structure }) => console.log(`loaded`, filename, structure)
</script>
```

Pin a version in the CDN URL (`matterviz@x.y.z`) for production. To serve it yourself, copy `node_modules/matterviz/dist/elements/` into your static files and import `matterviz-elements.js` from there: keep the whole folder, since the entry file loads its chunks and workers relative to itself. From another origin (like a CDN), browsers refuse those workers, so file parsing and analysis then run on the main thread.

### Properties, attributes and callbacks

- **Properties** take any value: `viewer.structure = parsed_structure`, `viewer.show_controls = false`. Assigning one re-renders the component. To change an object prop, assign a new object: mutating it in place only re-renders for bindable props.
- **Attributes** suit static markup. A bare attribute is `true` (`<mv-structure show_controls>`), values that parse as JSON arrive parsed (`show_controls="false"`, `png_dpi="300"`, `scene_props='{"atom_radius": 0.5}'`) and anything else as a string (`source="/TiO2.cif"`).
- **Callbacks** are `on_*` properties called with a plain object (`{ structure, filename, file_size, ... }`), not DOM events, so there is no `event.detail` to unwrap.
- **State the component sets** reads back through the same property for its bindable props: after `source` loads, `viewer.structure` holds the parsed structure. That works for bindable props without a default, and for those with one when you set them before the element is added to the page. Anything else reads back what you assigned, so follow state the component changes (selection, hover, the active element) through its `on_*` callbacks. Bindable values come back as Svelte state proxies, so `viewer.structure === parsed_structure` is false while their contents match.
- **Sizing:** elements are `display: block` (unless `hidden`) and fill their width. Give 3D views a height.
- **Theme:** elements follow the nearest light or dark theme above them (a `color-scheme`, a `dark`/`light` class or a `data-theme` on any ancestor, else the OS setting). An inline `color-scheme` on the element overrides that. The color tokens (`--text-color`, `--surface-bg`, ...) are defined on `:root` at zero specificity, so any page rule setting them wins. MatterViz's other base styles (buttons, inputs, tables) apply only inside the elements.

Every prop is settable except Svelte snippets (markup can't be passed in from outside) and `style`, `id` and `class`, which stay the element's own. Props named like a DOM member (a plot's `title`, a histogram's `normalize`) belong to the component. Set `title` as a property: as an attribute it also shows the browser's tooltip over the whole element.

### With a bundler

```sh
npm install matterviz
```

```js
// main.js: defines every mv-* element
import 'matterviz/elements'
```

**Vue** needs to know `mv-*` tags are custom elements:

```js
// vite.config.js
import vue from '@vitejs/plugin-vue'

export default {
  plugins: [
    vue({
      template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith(`mv-`) } },
    }),
  ],
}
```

Vue and React 19 set bound values as properties when the element defines them, so objects pass through unchanged. Both treat bound names starting with `on` as event listeners though, so assign `on_*` callbacks through a ref:

```vue
<template>
  <mv-structure ref="viewer" :source="source" :show_controls="true" style="height: 500px" />
</template>

<script setup>
import { onMounted, ref } from 'vue'

const source = `/TiO2.cif`
const viewer = ref()
onMounted(() => {
  viewer.value.on_file_load = ({ filename, structure }) =>
    console.log(`loaded:`, filename, structure)
})
</script>
```

**React 19:**

```tsx
import type { StructureHandlerData } from 'matterviz'
import 'matterviz/elements'
import { useEffect, useRef } from 'react'

export default function StructureEmbed() {
  const ref = useRef<HTMLElement & { on_file_load?: (data: StructureHandlerData) => void }>(
    null,
  )
  useEffect(() => {
    if (!ref.current) return
    ref.current.on_file_load = ({ filename, structure }) =>
      console.log(`loaded:`, filename, structure)
  }, [])

  return <mv-structure ref={ref} source="/TiO2.cif" show_controls style={{ height: 500 }} />
}
```

React 18 and older pass every value as a string attribute: set objects through the ref as well. In TSX, declare the `mv-*` tags in `JSX.IntrinsicElements`. The bundle needs a browser (`document`, `customElements`), so with server rendering (Next.js, Nuxt) import it on the client only, e.g. `useEffect(() => void import('matterviz/elements'), [])`.

## VS Code Extension

A VS Code extension for previewing structure files directly in the editor.

| Resource        | Link                                                                                    |
| --------------- | --------------------------------------------------------------------------------------- |
| **Marketplace** | [MatterViz](https://marketplace.visualstudio.com/items?itemName=janosh.matterviz)       |
| **Source**      | [`extensions/vscode/`](https://github.com/janosh/matterviz/tree/main/extensions/vscode) |
