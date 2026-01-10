# matterviz-dash-components

A Dash component library that renders **MatterViz** (Svelte) components inside **Plotly Dash**.

## Design goals

- **Simple**: one Dash component (`MatterViz`) + one browser custom element (`<mv-matterviz>`)
- **Maintainable**: no per-component React wrappers required
- **Broad coverage**: render *any* MatterViz `.svelte` component that is present in the installed `matterviz` npm package
- **Sync-friendly**: to update for a new MatterViz release you typically only bump the npm dependency and rebuild

## How it works

1. Webpack bundles this library.
2. During bundling, we include all `matterviz/dist/**/*.svelte` files via `require.context`.
3. A small Svelte **custom element** (`<mv-matterviz>`) dynamically picks a MatterViz component by name/path and renders it.
4. A small React wrapper (`MatterViz`) is the Dash-facing component:
   - sets the custom element’s `component` and `props` **properties** (not HTML attributes)
   - optionally injects JS callbacks into `props` to surface MatterViz events back into Dash

This avoids having to re-create every MatterViz component as a separate Dash component.

## Install (from source)

### 1) JavaScript build

```bash
cd matterviz-dash-components
npm install
npm run build
```

This emits the JS bundle (and any emitted assets like `.wasm`) into `matterviz_dash_components/`.
The webpack `svelte-preprocess` is pointed at `tsconfig.svelte.json` to avoid
TS5083 errors when compiling MatterViz’ distributed `.svelte` files (they expect
a project tsconfig). Keep that file with the repo so `npm run build` works.

### Sample app

Run a minimal Dash app to verify the bundle:

```bash
# from the dash/ directory
python -m pip install -e .
python scripts/sample_app.py
```

Then open http://127.0.0.1:8050 to see a `Structure` and `PeriodicTable` demo.

### Built assets for distribution

- The compiled bundle **must** be present in `matterviz_dash_components/` for `pip` installs to work (Dash serves JS/CSS/wasm from the installed package).
- Commit the emitted assets:
  - `matterviz_dash_components.min.js`, hashed chunk files, `.css`, `.wasm`, and the LICENSE chunk.
- Do **not** rely on consumers to run `npm run build`; publish wheels/sdists with these assets included.

### 2) Python install

```bash
pip install -e .
```

## Usage

### Basic

```python
import dash
from dash import html
import matterviz_dash_components as mvc

app = dash.Dash(__name__)

app.layout = html.Div(
    style={"height": "600px"},
    children=[
        mvc.MatterViz(
            component="Structure",  # or "structure/Structure"
            mv_props={
                # MatterViz props go here (must be JSON-serializable)
                # e.g. structure=..., show_controls=True, ...
            },
            style={"height": "100%"},
        )
    ],
)

if __name__ == "__main__":
    app.run_server(debug=True)
```

### Convenience factories (optional)

This package also provides a dynamic factory for any *capitalized* attribute via `__getattr__`.
So you can write:

```python
mvc.Structure(
    structure={...},
    show_controls=True,
)
```

That is syntactic sugar for:

```python
mvc.MatterViz(component="Structure", mv_props={"structure": {...}, "show_controls": True})
```

If a component name is ambiguous, use a path key:

```python
mvc.MatterViz(component="structure/Structure", mv_props={...})
```


## Typed wrappers

This package ships **two** Python APIs:

1. **Typed wrappers** (discoverability / autocomplete)
   - Classes like `Structure`, `PeriodicTable`, `Trajectory`, ... are generated from MatterViz
     `*.svelte.d.ts` files.
   - They subclass `MatterViz` and simply forward keyword arguments into `mv_props`.

2. **Generic** `MatterViz` (advanced / full coverage)
   - Use this for any component not present in the curated wrapper set, or for passing new props
     that were added upstream before wrappers are regenerated.

### Example

```python
import dash
from dash import html
from matterviz_dash_components import Structure, MatterViz

app = dash.Dash(__name__)

app.layout = html.Div(
    [
        # Typed wrapper
        Structure(
            id="struct",
            structure_string="Si",
            show_controls=True,
            height=500,
        ),

        # Generic API (any component by name/path)
        MatterViz(
            id="pt",
            component="periodic-table/PeriodicTable",
            mv_props={"height": 320},
        ),
    ]
)
```

### Keeping wrappers in sync with MatterViz

Wrappers are generated from a curated manifest file:

- `component_manifest.toml`

To regenerate wrappers after bumping the `matterviz` npm dependency:

1. `npm install`
2. `python scripts/sync_typed_wrappers.py --manifest component_manifest.toml --matterviz-dist node_modules/matterviz/dist --out matterviz_dash_components/typed.py`

If a component is not in the manifest, it remains accessible through the generic `MatterViz` API
(and via the `__getattr__` fallback factory).

## Props

### `MatterViz` (Dash component)

- `component: str`
  - A MatterViz component identifier.
  - Accepts either a base name (e.g. `"Structure"`) or a path key (e.g. `"structure/Structure"`).

- `mv_props: dict`
  - Props passed into the selected MatterViz component.
  - Must be JSON-serializable from the Python side.

- `set_props: list[str]`
  - Names of props within `mv_props` that should be converted from `list` → `Set` on the JS side.
  - Example: `set_props=["hidden_elements", "hidden_prop_vals"]`.

- `float32_props: list[str]`
  - Names of props within `mv_props` that should be converted from `list` → `Float32Array`.

- `event_props: list[str]`
  - Names of callback props to inject into MatterViz.
  - Each callback will update `last_event`.
  - Example for `Structure`: `event_props=["on_file_load", "on_error"]`.

- `last_event: dict` (read-only from Python; updated by the component)
  - Updated whenever one of `event_props` callbacks fires.
  - Structure: `{ "prop": <event prop name>, "data": <JSON-safe payload>, "timestamp": <ms since epoch> }`

- Standard Dash props: `id`, `className`, `style`

## Notes / limitations

- Dash can only send JSON-serializable props from Python. Any MatterViz props that require functions, DOM nodes, Maps/Sets, typed arrays, etc. must be adapted.
  - Use `set_props` / `float32_props` conversions.
  - Use `event_props` to surface events (functions are injected client-side, not from Python).

- This library uses a Svelte custom element with `shadow: "none"` so MatterViz styles can apply globally.

## Development tips

- To update MatterViz:
  1. bump the `matterviz` version in `package.json`
  2. run `npm install`
  3. run `npm run build`
  4. bump Python package version and publish

