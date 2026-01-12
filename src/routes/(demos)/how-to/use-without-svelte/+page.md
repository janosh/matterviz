# Use MatterViz on non‑Svelte sites

## Preferred: Web Components (Custom Elements)

You can compile Svelte components to custom elements and consume them anywhere (React, Vue, plain HTML) via [shadow DOM](https://developer.mozilla.org/docs/Web/API/Web_components/Using_shadow_DOM). This is framework‑agnostic.

- Svelte docs: [Custom elements](https://svelte.dev/docs/custom-elements)
- React docs: [Using Web Components](https://react.dev/reference/react-dom/components#using-web-components)
- Vue docs: [Web Components](https://vuejs.org/guide/extras/web-components.html)

Minimal custom element `StructureCE.svelte` for [`Structure.svelte`](https://github.com/janosh/matterviz/blob/main/src/lib/structure/Structure.svelte):

```svelte
<!-- matterviz/structure/StructureCE.svelte -->
<script>
  import { Structure } from 'matterviz'
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
from matterviz_dash_components import Structure, PeriodicTable, XrdPlot

app = Dash(__name__)

# Pymatgen-compatible structure dict
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

@callback(
    Output("info", "children"),
    Input("structure-viewer", "last_event"),
)
def handle_event(event):
    if event and event.get("type") == "atom_click":
        return f"Clicked atom: {event['detail']['element']}"
    return ""
```

### Deploy Your Own

The demo is hosted on [Hugging Face Spaces](https://huggingface.co/spaces) using Docker. To deploy your own:

1. Fork the repo
2. Create a new Space on HF with Docker SDK
3. Push the `extensions/dash/Dockerfile` to your Space

The official demo auto-updates on every push to `main` via GitHub Action.

## VS Code Extension

A VS Code extension for previewing structure files directly in the editor is also available.

**Source**: [`extensions/vscode/`](https://github.com/janosh/matterviz/tree/main/extensions/vscode)
**Marketplace** (coming soon): Search "MatterViz" in VS Code extensions

## `<iframe>` (future option)

We may expose iframe embeds for some demos in the future, but this path is currently not supported. Prefer the custom‑elements approach above. Reasons favoring `<iframe>`:

- **Zero build setup** on the host site.
- **Strong isolation**: dependencies and runtime performance are encapsulated.
