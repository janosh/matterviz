# Use MatterViz on non‑Svelte sites

## Preferred: Web Components (Custom Elements)

You can compile Svelte components to custom elements and consume them anywhere (React, Vue, plain HTML) via [shadow DOM](https://developer.mozilla.org/docs/Web/API/Web_components/Using_shadow_DOM). This is framework‑agnostic.

- Svelte docs: [Custom elements](https://svelte.dev/docs/custom-elements)
- React docs: [Using Web Components](https://react.dev/reference/react-dom/components#using-web-components)
- Vue docs: [Web Components](https://vuejs.org/guide/extras/web-components.html)

Minimal custom element `StructureCE.svelte` for [`Structure.svelte`](https://github.com/janosh/matterviz/blob/main/src/lib/structure/Structure.svelte):

```svelte
<script>
  import Structure from 'matterviz/structure/Structure.svelte'
  let props = $props()
</script>

<svelte:options customElement="mv-structure" />

<Structure {...props} />
```

Use in React (set properties and callbacks via ref):

```tsx
import { useEffect, useRef } from 'react'
// Ensure `mv-structure` custom element is defined in browser
import 'matterviz/structure/StructureCE.svelte'

export default function StructureEmbed() {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current as unknown as
      | HTMLElement & {
        data_url?: string
        show_controls?: boolean | number
        performance_mode?: 'quality' | 'speed'
        on_file_load?: (data: unknown) => void
      }
      | null
    if (!el) return
    el.data_url = '/TiO2.cif'
    el.show_controls = true
    el.performance_mode = 'quality'
    el.on_file_load = (data) => {
      // handle callback data
    }
    return () => { // return a cleanup function to remove event handlers
      if (el) el.on_file_load = undefined
    }
  }, [])

  return <mv-structure ref={ref} />
}
```

Use in Vue (set properties and callbacks via ref):

```vue
<template>
  <mv-structure ref="mv" />
</template>
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
const mv = ref()
onMounted(() => {
  if (!mv.value) return
  mv.value.data_url = '/TiO2.cif'
  mv.value.show_controls = true
  mv.value.performance_mode = 'quality'
  mv.value.on_file_load = (data) => {
    // handle callback data
  }
})
onBeforeUnmount(() => {
  if (mv.value) mv.value.on_file_load = undefined
})
</script>
```

Notes

- For callbacks, assign functions to element properties like `on_file_load` rather than listening for DOM CustomEvents.
- If you need richer typing in React, wrap the element with a small typed component or use a helper like `@lit-labs/react` to generate typed React wrappers for custom elements: <https://github.com/lit/lit> ([NPM](https://www.npmjs.com/package/@lit-labs/react))

## `<iframe>` (future option)

We may expose iframe embeds for some demos in the future, but this path is currently not supported. Prefer the custom‑elements approach above. Reasons favoring `<iframe>`:

- **Zero build setup** on the host site.
- **Strong isolation**: dependencies and runtime performance are encapsulated.
