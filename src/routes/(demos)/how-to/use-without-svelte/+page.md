# Use MatterViz on non‑Svelte sites

## Preferred: Web Components (Custom Elements)

You can compile Svelte components to custom elements and consume them anywhere (React, Vue, plain HTML) via [shadow DOM](https://developer.mozilla.org/docs/Web/API/Web_components/Using_shadow_DOM). This is framework‑agnostic.

- Svelte docs: [Custom elements](https://svelte.dev/docs/custom-elements)
- React docs: [Using Web Components](https://react.dev/reference/react-dom/components#using-web-components)
- Vue docs: [Web Components](https://vuejs.org/guide/extras/web-components.html)

Minimal custom element `StructureCE.svelte` for [`Structure.svelte`](https://github.com/janosh/matterviz/blob/main/src/lib/structure/Structure.svelte):

```svelte
<!-- matterviz/structure/StructureCE.svelte -->
<script lang="ts">
  import { Structure } from 'matterviz'
  let props = $props()
</script>

<svelte:options customElement="mv-structure" />

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

## Dash (Plotly) Integration

For Python data science workflows, MatterViz provides a [Dash](https://dash.plotly.com) extension that wraps all components as native Dash components with full callback support.

| Resource        | Link                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| **Live Demo**   | [huggingface.co/spaces/janoshr/matterviz-dash](https://huggingface.co/spaces/janoshr/matterviz-dash)   |
| **Source Code** | [`extensions/dash/`](https://github.com/janosh/matterviz/tree/main/extensions/dash)                    |
| **Sample App**  | [`sample_app.py`](https://github.com/janosh/matterviz/blob/main/extensions/dash/scripts/sample_app.py) |
| **PyPI**        | `pip install matterviz-dash-components` (coming soon)                                                  |

### Quick Start

```python
from dash import Dash, html
from matterviz_dash_components import Structure, PeriodicTable

app = Dash(__name__)

structure = {
    "lattice": {"matrix": [[5.43, 0, 0], [0, 5.43, 0], [0, 0, 5.43]]},
    "sites": [
        {"species": [{"element": "Si", "occu": 1}], "abc": [0, 0, 0]},
        {"species": [{"element": "Si", "occu": 1}], "abc": [0.25, 0.25, 0.25]},
    ],
}

app.layout = html.Div([
    Structure(structure=structure, show_controls=True),
    PeriodicTable(show_names=True),
])

if __name__ == "__main__":
    app.run(debug=True)
```

### Available Components

| Component                             | Description                          |
| ------------------------------------- | ------------------------------------ |
| `Structure`                           | 3D crystal structure viewer          |
| `PeriodicTable`                       | Interactive periodic table           |
| `Composition`                         | Composition breakdown visualization  |
| `Trajectory`                          | Molecular dynamics trajectory player |
| `BrillouinZone`                       | Reciprocal space visualization       |
| `ConvexHull2D/3D/4D`                  | Thermodynamic stability hulls        |
| `IsobaricBinaryPhaseDiagram`          | Binary phase diagrams                |
| `XrdPlot`                             | X-ray diffraction pattern viewer     |
| `Bands`, `Dos`, `BandsAndDos`         | Electronic/phonon band structures    |
| `ScatterPlot`, `Histogram`, `HeatMap` | General plotting components          |

### Callbacks

All MatterViz events are surfaced via the `last_event` prop:

```python
from dash import callback, Input, Output

@callback(Output("info", "children"), Input("structure-viewer", "last_event"))
def handle_event(event):
    if event and event.get("type") == "atom_click":
        return f"Clicked atom: {event['detail']['element']}"
    return ""
```

### Deploy Your Own

The demo is hosted on [Hugging Face Spaces](https://huggingface.co/spaces) using Docker. Fork the repo, create a new Space with Docker SDK, and push the `extensions/dash/Dockerfile`. The official demo auto-updates on every push to `main`.

## VS Code Extension

A VS Code extension for previewing structure files directly in the editor.

| Resource        | Link                                                                                    |
| --------------- | --------------------------------------------------------------------------------------- |
| **Marketplace** | [MatterViz](https://marketplace.visualstudio.com/items?itemName=janosh.matterviz)       |
| **Source**      | [`extensions/vscode/`](https://github.com/janosh/matterviz/tree/main/extensions/vscode) |
