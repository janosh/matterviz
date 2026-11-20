# MatterViz anywidget bundle

A prebuilt [anywidget](https://anywidget.dev) bundle that renders MatterViz
components in notebook environments (Jupyter, marimo, VS Code) and anywhere an
ESM module can be loaded.

`anywidget.ts` is the entry point: it dispatches on a `widget_type` string to the
matching MatterViz Svelte component, mounts it into the host element, and forwards
the widget's traitlet values as props. The build is a single self-contained ESM
file (`build/matterviz.js`) plus its CSS (`build/matterviz.css`), with all
dependencies (matterviz components, Svelte runtime, three.js, ...) inlined.

`build/split/` holds the same bundle code-split: an entry `matterviz.js` that loads each widget's component and its dependencies as chunks on first render, so a 2D plot fetches ~1.2 MB (~0.45 MB gzip) instead of all 5.8 MB, skipping three.js. Its chunks load relative to the entry's URL, so it only works imported by URL (jsDelivr, the docs site); hosts that load the bundle as text (a local build synced to the notebook, marimo virtual files, headless or inline HTML export) use the single file. `build/matterviz.css` styles both.

This is a peer of `extensions/vscode`: a framework adapter
that wraps the MatterViz component library for a specific host runtime.

The widgets are the components listed in `src/elements/components.ts`, the registry shared with the custom elements (`matterviz/elements`): its keys are the `widget_type` values. A component added there needs a spec in `anywidget.ts`' `WIDGETS` (the type check fails without one) naming the traits it reads and writes.

## Styles

The bundle injects MatterViz's base styles (`app.css`) into the notebook page, or into the shadow root a host renders the widget in. They are scoped (`@scope`) to the widget elements by the same build step as the custom elements' (`src/elements/scoped-css.ts`), so the page's own inputs, buttons and tables keep their styles. Outside that scope the sheet only defines the theme tokens (`--text-color`, `--surface-bg`, ...) on `:root` at zero specificity, where any page rule setting them wins.

## Binary array transfer

The `trajectory` trait and each entry of `volumetric_data` accept, besides nested JSON, a `matterviz-binary-v1` envelope: a small JSON object whose heavy arrays travel as raw buffers (ipywidgets/anywidget extract any `bytes`/`memoryview` nested in a synced trait into binary comm buffers and hand them to JS as `DataView`s). For a 1000-frame x 1000-atom trajectory that is 11 MB of float32 instead of 97 MB of JSON text, decoded in ~8 ms instead of ~1 s. The `format` tag alone selects the decoder (`trajectory_from_binary`, `volume_from_binary`), so a malformed envelope throws a clear error and never falls back to the JSON path.

```ts
{
  format: 'matterviz-binary-v1',
  kind: 'trajectory' | 'volume' | 'plot-series',
  arrays: { [name]: { dtype, shape: number[], data: DataView | ArrayBuffer } },
  ...kind-specific JSON fields
}
```

- **Arrays**: C-contiguous, little-endian. `dtype` is one of `float32 float64 int8 int16 int32 uint8 uint16 uint32` (cast `int64` steps to `int32` or `float64`). `data` must hold exactly `prod(shape) * itemsize` bytes. Buffers aligned to the item size are viewed in place (zero-copy); a misaligned one (whether the host's `DataView` offsets are aligned depends on how it splits the comm message) is copied once. Trajectory arrays are read in place whatever their float dtype (float32 values widen exactly as each frame is encoded); a float64 volume grid feeds matterviz unchanged, a float32 one is widened to float64 in one pass (half the wire size, one copy). Decoded trajectories and volumes borrow in-place buffers, so callers must not mutate them afterwards.
- **`kind: 'trajectory'`** arrays: `positions` `[n_frames, n_atoms, 3]` float Cartesian Å (required); `numbers` `[n_atoms]` integer atomic numbers (required, fixed atom order); `lattice` `[3, 3]` (fixed cell) or `[n_frames, 3, 3]` float, rows a, b, c (optional); `steps` `[n_frames]` (optional, default 0..n_frames-1). Any other array is a per-atom vector channel if shaped `[n_frames, n_atoms, 3]` (name it `force`, `velocity`, ... as the site property it becomes) or a per-frame scalar if shaped `[n_frames]` (`energy`, `temperature`, ...: plot rows and frame metadata); other shapes are rejected. JSON fields: `pbc` (3 booleans, needs a lattice, default all true), `metadata` (object), `time_step` (`{ value, unit }`, `value` finite and positive, `unit` one of `fs`, `ps`, `ns`); any other field is rejected. Positions, vectors and cells stay flat: each frame is encoded on read into a numeric MD frame, so no per-site JS objects are built beyond the frame-0 preview.
- **`kind: 'volume'`** arrays: exactly one, `values` `[nx, ny, nz]` float in C order (z fastest). JSON fields as for the JSON volume: `id`, `lattice` (3x3), `origin` (Vec3), `periodic`, and optional `label`, `units`, `signed`, `source`; dims come from the `values` shape. Every grid sample, binary or JSON, must be finite: a `NaN` or infinite sample makes the volume malformed, so a mount shows the error and a trait update carrying one tears the widget down like any other malformed update (it then no longer reflects the Python state; re-display the widget after sending a finite grid, e.g. `np.nan_to_num(values)`).
- **`kind: 'plot-series'`**: any entry of a plot widget's `series` trait (scatter, binned scatter, bar, histogram, box) may be such an envelope instead of a JSON series. Arrays: 1D numeric columns of one length (`x`, `y`, `color_values`, `size_values`, ...), decoded to typed arrays (`series_from_binary`); arrays named `metadata.<key>` are zipped into per-point `metadata` objects (non-finite values as `null`); every other field (`label`, `markers`, styles, ...) is plain JSON spread back onto the series. Meant for large series: a 10⁶-point scatter is 16 MB of float64 instead of ~41 MB of JSON.

Python side (pymatviz), with numpy:

```python
import numpy as np

BINARY_FORMAT = "matterviz-binary-v1"


def binary_array(values: np.typing.ArrayLike, dtype: str) -> dict:
    """Encode an array as a matterviz-binary-v1 entry (C order, little-endian)."""
    arr = np.ascontiguousarray(values, dtype=np.dtype(dtype).newbyteorder("<"))
    return {"dtype": dtype, "shape": list(arr.shape), "data": memoryview(arr).cast("B")}


def trajectory_payload(traj: "pymatgen.core.trajectory.Trajectory") -> dict:
    """Binary envelope for the trajectory trait (Cartesian positions, fixed or per-frame cell).

    Reads traj.coords, not list(traj): its Structures wrap sites into the cell, dropping
    cell crossings.
    """
    traj.to_positions()  # in place: fractional positions, not displacements
    lattice = np.asarray(traj.lattice)  # [3, 3] or [n_frames, 3, 3]
    first = traj[0]
    payload = {
        "format": BINARY_FORMAT,
        "kind": "trajectory",
        "arrays": {
            "positions": binary_array(np.asarray(traj.coords) @ lattice, "float32"),
            "numbers": binary_array(first.atomic_numbers, "uint8"),
            "lattice": binary_array(lattice, "float64"),
            "steps": binary_array(np.arange(len(traj)), "int32"),
        },
        "pbc": list(first.lattice.pbc),
    }
    forces = [props.get("forces") for props in traj.frame_properties or []]
    if forces and all(frame_forces is not None for frame_forces in forces):
        payload["arrays"]["force"] = binary_array(forces, "float32")
    return payload


# widget.trajectory = trajectory_payload(traj)  # Dict trait tagged sync=True
# a volume: kind "volume", arrays {"values": binary_array(grid, "float32")} + the JSON volume fields
```

Benchmarks (Node 26, Apple arm64, decode = `JSON.parse` of the trait text + the JSON decoder vs the binary decoder; retained = heap + ArrayBuffer growth after GC):

| payload                       | wire size   | decode                                                                 | retained                 | read all frames    |
| ----------------------------- | ----------- | ---------------------------------------------------------------------- | ------------------------ | ------------------ |
| trajectory 1000 x 1000, JSON  | 97 MB text  | 960-1030 ms (350 of it `JSON.parse`, peaking 207 MB of parsed objects) | 49 MB                    | 0 ms (pre-encoded) |
| trajectory, binary float32    | 11 MB       | 7-8 ms                                                                 | ~0 MB (read in place)    | 26 ms              |
| trajectory, binary float64    | 23 MB       | 4-5 ms                                                                 | ~0 MB (zero-copy)        | 27 ms              |
| volume 200³, JSON nested grid | 150 MB text | 296-333 ms                                                             | 61 MB                    |                    |
| volume 200³, binary float32   | 31 MB       | 17-25 ms                                                               | 61 MB (float64 widening) |                    |
| volume 200³, binary float64   | 61 MB       | 13-25 ms                                                               | ~0 MB (zero-copy)        |                    |

## Bundle size

Two large WASM dependencies are kept out of the inlined bundle (10.4 MB -> 3.4 MB),
configured in `vite.config.ts`:

- **h5wasm** (~5 MB HDF5 reader for client-side `.h5` trajectory parsing) is aliased
  to a stub (`h5wasm-stub.ts`). Hosts that drive this widget (e.g. pymatviz) parse
  trajectories on the Python side and pass structured data, so the in-browser HDF5
  path is never hit; it throws a clear error if it ever is.
- **moyo** (~1.9 MB spglib symmetry WASM, inlined twice) is loaded from jsDelivr on demand by a small build plugin, only when spacegroup/symmetry analysis runs. For offline use, set `globalThis.matterviz_moyo_wasm_url` to a locally served URL or a WASM data URL before the widget renders; symmetry then runs on the main thread, since workers can't read that global. Rendering never needs it.

The publish workflow's size gate fails if either WASM creeps back in.

## Web Workers

The bundle has no URL of its own to load worker files from (anywidget imports it from a `blob:`, CDN or `file://` URL), so the `inline_workers` plugin in `vite.config.ts` ships every MatterViz worker (file parsing, MSD, VACF, RDF, structure ID, spectroscopy, chempot, ternary hulls, isosurfaces, Fermi surfaces, symmetry) as a string in `matterviz.js` (~1.6 MB of 5.9 MB) and starts it from a `blob:` URL. That keeps parsing and analysis off the notebook's UI thread: RDF over 100 frames of a 10k-atom run froze the page for 10 s before, and now runs in 2 s across parallel workers with no frame longer than ~50 ms. A page CSP whose `worker-src` (or its `child-src`/`script-src` fallback) leaves out `blob:` refuses these workers; the bundle tests that once at load and then logs a warning and computes on the main thread.

## Consumers

- [pymatviz](https://github.com/janosh/pymatviz) loads this bundle to render its
  Python widget classes and to power headless image/HTML export.
- Any Python (or JS) wrapper can mount the bundle: call its default export's
  `render({ model, el })` with an anywidget-compatible model exposing
  `get(key)` for the widget's `widget_type` and props.
- `build/widget-model-keys.json` (the exported `WIDGET_MODEL_KEYS`) lists, per `widget_type`, every model key the bundle reads or writes, so wrappers can test their traits against it without a browser. A model must carry `_synced_keys`, the list of its synced trait names (the anywidget model can't enumerate them): `render()` throws when it's missing, and names any key the widget doesn't read besides `widget_type`, `style` and `show_controls`, i.e. when wrapper and bundle versions differ.

## Build

```sh
# from the matterviz repo root: the anywidget package links the root's matterviz
# (bundling its dist/) and the svelte-widgets the root installed
pnpm install && pnpm package:dist

pnpm install:anywidget             # standalone install, no lockfile or pnpm-workspace.yaml
pnpm -C extensions/anywidget build # -> build/matterviz.{js,css}, build/split/ + build/widget-model-keys.json
```

### Building from a matterviz checkout in downstream CI

Python consumers that want to test against unreleased matterviz `main` (instead of the
`matterviz-anywidget@<version>` npm release they pin) build the bundle themselves. The root
`build:anywidget` script chains the three steps above (`package:dist`, the anywidget install, the
bundle build); `MATTERVIZ_SKIP_PREPARE=1` stops the root `prepare` hook from building `dist/` a
first time during `pnpm install`:

```sh
git clone --depth 1 https://github.com/janosh/matterviz
cd matterviz
corepack enable # picks up the pinned pnpm from package.json
MATTERVIZ_SKIP_PREPARE=1 pnpm install --config.strict-dep-builds=false
pnpm build:anywidget
# bundle: extensions/anywidget/build/matterviz.js + build/matterviz.css
```

pymatviz reads that directory when `MATTERVIZ_ANYWIDGET_DIR` points at it
(`export MATTERVIZ_ANYWIDGET_DIR="$PWD/extensions/anywidget/build"`), bypassing its
pinned CDN version.

JS consumers can depend on the component library straight from git: the root `prepare` hook
(`src/scripts/prepare.mjs`) builds `dist/` inside the clone, so `npm install github:janosh/matterviz#main`
works as is. pnpm >= 11.9 only runs git-dependency build scripts for an exact `allowBuilds` key
(`matterviz@https://codeload.github.com/janosh/matterviz/tar.gz/<sha>: true` in
`pnpm-workspace.yaml`, so pin a commit), or install a locally built checkout with
`pnpm add file:../matterviz`.

## Publish (CDN distribution)

Published to npm as `matterviz-anywidget`; the prebuilt bundle is then served with
CORS and a JavaScript MIME type via jsDelivr/unpkg, e.g.:

```txt
https://cdn.jsdelivr.net/npm/matterviz-anywidget@<version>/build/matterviz.js
https://cdn.jsdelivr.net/npm/matterviz-anywidget@<version>/build/split/matterviz.js
```

`build/` is gitignored; the bundle never enters version control. See the
`package_anywidget` job in `.github/workflows/publish.yml`.
