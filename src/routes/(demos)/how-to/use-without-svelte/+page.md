# Use MatterViz on non‑Svelte sites

## Preferred: Web Components (Custom Elements)

You can compile Svelte components to custom elements and consume them anywhere (React, Vue, plain HTML) via [shadow DOM](https://developer.mozilla.org/docs/Web/API/Web_components/Using_shadow_DOM). This is framework‑agnostic.

- Svelte docs: [Custom elements](https://svelte.dev/docs/custom-elements)
- React docs: [Using Web Components](https://react.dev/reference/react-dom/components#using-web-components)
- Vue docs: [Web Components](https://vuejs.org/guide/extras/web-components.html)

Minimal custom element `StructureCE.svelte` for [`Structure.svelte`](https://github.com/janosh/matterviz/blob/main/src/lib/structure/Structure.svelte):

```svelte
<svelte:options customElement="mv-structure" />

<!-- matterviz/structure/StructureCE.svelte -->
<script lang="ts">
  import { Structure } from 'matterviz'
  let props = $props()
</script>

<Structure {...props} />
```

Use in React (set properties via ref):

```tsx
import { useEffect, useRef } from 'react'
import 'matterviz/structure/StructureCE.svelte'

export default function StructureEmbed() {
  const ref = useRef<
    HTMLElement & {
      data_url?: string
      show_controls?: boolean
      on_file_load?: (data: { detail: unknown }) => void
    }
  >(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.data_url = '/TiO2.cif'
    ref.current.show_controls = true
    ref.current.on_file_load = (ev) => console.log('loaded:', ev.detail)
  }, [])

  return <mv-structure ref={ref} />
}
```

Use in Vue:

```vue
<template>
  <mv-structure ref="mv" />
</template>
<script setup>
import { onMounted, ref } from 'vue'
const mv = ref()
onMounted(() => {
  if (!mv.value) return
  mv.value.data_url = '/TiO2.cif'
  mv.value.show_controls = true
  mv.value.on_file_load = (ev) => console.log('loaded:', ev.detail)
})
</script>
```

Assign callback functions directly to element properties (like `on_file_load` above) rather than listening for DOM CustomEvents. For richer typing in React, use [`@lit-labs/react`](https://www.npmjs.com/package/@lit-labs/react) to generate typed wrappers.

## VS Code Extension

A VS Code extension for previewing structure files directly in the editor.

| Resource        | Link                                                                                    |
| --------------- | --------------------------------------------------------------------------------------- |
| **Marketplace** | [MatterViz](https://marketplace.visualstudio.com/items?itemName=janosh.matterviz)       |
| **Source**      | [`extensions/vscode/`](https://github.com/janosh/matterviz/tree/main/extensions/vscode) |
