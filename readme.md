<h1 align="center">
  <sub><img src="static/favicon.svg" alt="Logo" width="40px"></sub> MatterViz
</h1>

<h4 align="center">

[![CI](https://github.com/janosh/matterviz/actions/workflows/ci.yml/badge.svg)](https://github.com/janosh/matterviz/actions/workflows/ci.yml)
[![GH Pages](https://github.com/janosh/matterviz/actions/workflows/gh-pages.yml/badge.svg)](https://github.com/janosh/matterviz/actions/workflows/gh-pages.yml)
[![VSCode Extension](https://img.shields.io/badge/Install%20VSCode-Extension-blue?logo=typescript&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=janosh.matterviz)
[![Docs](https://img.shields.io/badge/Read-the%20docs-blue?logo=googledocs&logoColor=white)](https://matterviz.janosh.dev)
[![Open in StackBlitz](https://img.shields.io/badge/Open%20in-StackBlitz-darkblue?logo=stackblitz&logoColor=white)](https://stackblitz.com/github/janosh/matterviz)
[![DOI](https://img.shields.io/badge/DOI-10.5281%2Fzenodo.17094509-blue)](https://doi.org/10.5281/zenodo.17094509)

</h4>

`matterviz` is a toolkit for building interactive web UIs for materials science: 3D crystal structures, molecules, MD/relaxation trajectories, periodic tables, phase diagrams, convex hulls, spectral data (bands, DOS, IR/Raman), diffraction and pair distribution
functions (XRD, SAED, PDF/RDF), diffusion analysis (MSD), reaction paths (NEB), heatmaps,
and scatter plots.

## 🔌 &thinsp; [MatterViz VSCode Extension]

Visualize crystal structures, molecules, and molecular dynamics trajectories [directly in VSCode][MatterViz VSCode Extension]. Features include:

- Native support for common file formats (CIF, POSCAR, XYZ, TRAJ, HDF5, etc.)
- Context menu (right click > "Render with MatterViz") and keyboard shortcuts (<kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>v</kbd> on Windows, <kbd>cmd</kbd>+<kbd>shift</kbd>+<kbd>v</kbd> on Mac) for quick access
- Custom viewer for MD trajectories/geometry optimizations
- **Extensive customization options** via VSCode settings - see [Configuration Guide](extensions/vscode/readme.md#️-configuration--customization) for examples

[matterviz vscode extension]: https://marketplace.visualstudio.com/items?itemName=janosh.matterviz

## 🗺️ &thinsp; Roadmap

- **✅ MatterViz Web**: [matterviz.janosh.dev](https://matterviz.janosh.dev)
- **✅ MatterViz VSCode/Cursor**: [marketplace.visualstudio.com/items?itemName=janosh.matterviz](https://marketplace.visualstudio.com/items?itemName=janosh.matterviz)
- **✅ pymatviz**: [Jupyter](https://jupyter.org)/[Marimo](https://marimo.io) widgets for Python notebooks. See [`pymatviz` readme](https://github.com/janosh/pymatviz/blob/main/readme.md#interactive-widgets).

![Landing page showing 3D structure viewers](https://github.com/janosh/matterviz/releases/download/v0.2.2/2026-01-23-landing-page.webp)

## ⚛️ &thinsp; 3D Structure Viewer

Interactively visualize crystal structures and molecules. Supports drag-and-drop file loading for CIF, POSCAR, XYZ/EXTXYZ, pymatgen JSON, OPTIMADE JSON, and compressed formats.

![3D Structure Viewer](https://github.com/janosh/matterviz/releases/download/v0.2.2/2026-01-23-structure-viewer.webp)

## 📊 &thinsp; Periodic Table Heatmap

Visualize elemental properties across the periodic table. The inset scatter plot shows how properties vary with atomic number - here demonstrating the periodicity of first ionization energy.

![Periodic table heatmap](https://github.com/janosh/matterviz/releases/download/v0.2.2/2026-01-23-heatmap.webp)

## 🔬 &thinsp; Element Details Pages

Rich element pages with physical properties, electron configurations, Bohr atom visualizations, and element photos.

![Element details page for gold](https://github.com/janosh/matterviz/releases/download/v0.2.2/2026-01-23-details-page.webp)

## 🔨 &thinsp; Installation

```sh
npm add -D matterviz
```

## 📙 &thinsp; Usage

Spectral components accept keyed canonical collections: `<Bands band_structs={{ Si: bands }} />` and `<Dos doses={{ Si: dos }} />`. Bands declare `type: "phonon" | "electronic"`; DOS uses the same discriminator with `frequencies` or `energies`. Data is in THz for phonons and eV for electrons; a shared plot cannot mix the two types. `BandsAndDos` and `BrillouinBandsDos` own one bindable `units` prop for both panels (default `THz`); changing units resets frequency zoom to the converted shared range; nested `bands_props` and `dos_props` do not accept `units`. Electronic plots always use eV. Both paired viewers accept a shared `fermi_level` reference, including zero; omit it to use dataset metadata without modifying the input data. Parse external files once using `normalize_band_structure` or `normalize_dos`; extract projections with `extract_pdos(raw, "atom" | "orbital", filter)` before rendering. A single dataset still needs a key (`""` gives an unlabelled series). The renderers no longer accept raw pymatgen objects, positional arrays, `band_type`, `pdos_type`, or `pdos_filter`.

Hull renderers expose `get_model()` (also `children`’s `model`) instead of writable `stable_entries`, `unstable_entries`, and `phase_stats` outputs. Pass that snapshot to `<ConvexHullStats {model} />`, or call `compute_hull_model(entries, options)` for headless computation. The numerical model is independent of display thresholds and category styles. `model.facets` contains vertex indices into the single enriched `model.entries` table, so geometry and stability always refer to the same entries.

Composite components expose deliberate `*_props` options for presentation and interactions. Their parent owns data and synchronization: use `band_structs`, `doses`, or `trajectory` on the parent rather than supplying replacement child data. Plot `series` are read-only inputs; bind `hidden_series` for legend choices and `view` for zoom. Supply stable `id` values when reordering series or persisting visibility; omitted IDs use array positions. Multiple drawing series can share a `legend_id` for one legend entry and visibility choice; their drawing IDs must remain unique, and `hidden_series` then uses the shared `legend_id`. Bands uses `JSON.stringify([material_key, spin])` for these keys (`spin` is `up` or `down`; use material key `""` for an unlabelled dataset). Composite wrappers accept `hidden_series` plus `on_hidden_series_change` for controlled visibility. Legend callbacks run after the chart updates visibility. Axis identifiers are `x`, `x2`, `y`, and `y2`; `on_axis_change` delegates loading to the caller. `create_axis_loader` cancels superseded requests independently per axis; `cancel()` aborts all pending axes.

`HeatmapTable` columns have stable `id` values and optional `key` accessors and `cell` snippets; labels only control headings. Selectable tables require `row_key` and bind `selected_ids`, so replacing rows with fresh objects preserves selection.

### Periodic Table

```svelte
<script>
  import { PeriodicTable } from 'matterviz'

  const heatmap_values = { H: 10, He: 4, Li: 8, Fe: 3, O: 24 }
</script>

<PeriodicTable {heatmap_values} />
```

### Structure

```svelte
<script>
  import { StructureFileViewer } from 'matterviz'
  const source = '/structures/TiO2.cif'
  // supports .cif, .poscar, .xyz/.extxyz, pymatgen JSON, OPTIMADE JSON, .gz
</script>

<StructureFileViewer {source} style="width: 500px; aspect-ratio: 1" />
```

`scene_props.camera_position` fits the structure when omitted; any supplied coordinate tuple, including `[0, 0, 0]`, is an explicit position. Clear it with `undefined` to request a fresh fit.

Floating viewer, plot, table and heatmap controls share `show_controls`: `true`/`'always'`, `'hover'`, `false`/`'never'`, or `{ mode, hidden, style }`. For example, `{ mode: 'hover', hidden: ['controls'] }` keeps a plot’s fullscreen button and hides its settings pane. `false` hides all plot chrome; `controls_open` independently controls whether the settings pane is open. `HeatmapMatrixControls` uses this contract instead of `show_pane` and `toggle_visible`.

`Structure` renders supplied `structure` data. Its `scene_props` accepts `StructureSettings`; computed results are available through the readonly `analysis` export on a component reference. `StructureFileViewer` accepts a URL or `{ data, filename }` payload through `source`, and handles file drops. Loading delegates to the same `open_material()` runtime available to non-component hosts, so fetching, decompression, format detection, workers, provenance, and disposal remain centralized. Prediction JSON files reopen with their input, properties, density and provenance; hosts can also pass `prediction_from_json(content)` as the `prediction` prop. Selection, measurements, atom/bond editing with undo/redo and the supercell/image-atom pipeline live in a headless `StructureSession` (exported from `matterviz/structure`); `active_pane: 'controls' | 'info' | 'export' | null` identifies the open floating pane.

Host computations register a component through `structure_host_tool` from `matterviz/structure`. Each run captures its input and exposes an abort signal plus guarded publication callbacks. Publish complete, versioned JSON-safe calculation metadata through `StructureToolOverlay.result`; the host receives accepted and reopened snapshots through its `prediction` prop. Use `set_overlay_visible()` to toggle predicted properties and density without discarding results or edited surfaces. An optional `structure_host_tool.input_key` selects relevant in-place calculation inputs, including atom order; document replacement still invalidates ownership. See the [host-tool demo](https://matterviz.janosh.dev/structure/host-tool).

Every `VolumetricData` has a nonempty, unique `id`. Isosurface layers require `volume_id` and optionally `color_volume_id`; `active_volume_id` selects the slice field. Keep IDs stable when replacing or reordering fields so selection and surface settings follow the data. Removing a field drops its surfaces and clears color references to it. File loading derives IDs from the source filename and field identity; host predictions use the same `id` contract. A volume’s `origin` is an offset in the structure’s Cartesian frame; cube parsing translates atoms and the grid together into that frame. File imports combine fields only when the nonempty ordered atoms, species, occupancies, coordinates, and lattice match (Cartesian coordinates and lattice vectors use an absolute tolerance below `1e-8 A`; species and occupancies match exactly); otherwise they replace the scene and its fields.

### Composition

```svelte
<script>
  import { Composition } from 'matterviz'
  // modes can be 'pie' (default) | 'bubble' | 'bar'
</script>

<Composition composition="LiFePO4" mode="pie" />
```

### Trajectory

```svelte
<script>
  import { TrajectoryFileViewer } from 'matterviz'
  // supports .xyz/.extxyz, .traj, .hdf5, .npz, .pkl, .dat plus .gz/.zip wrappers;
  // decompress .bz2/.xz first because browsers cannot decode them
</script>

<TrajectoryFileViewer src="/traj/ase-md.xyz" auto_play fps={10} style="max-height: 700px" />
```

`Trajectory.visible_properties` is the shared selection for scatter and histogram modes. It contains exact source property keys, independently of display labels; an empty array hides every series. Legend clicks, isolation, and plot-mode changes use this same state.

`TrajectoryFileViewer` owns loading: it fetches `src` (a URL, `File`, `ArrayBuffer` or `Blob`), accepts drops, decompresses, resolves ambiguous HDF5 groups, opens files above `DEFAULTS.trajectory.index_above_bytes` in a Web Worker and disposes each run when it is replaced or the component unmounts. The `Trajectory` component underneath is a pure viewer that only borrows a `TrajectoryRun` you already hold, so pass `trajectory={await open_trajectory(bytes, { filename })}` (or `trajectory_from_frames(frames)`) when you manage the data yourself and call `run.dispose()` when done. Disposed runs reject every frame read, including frame zero; the stored `run.preview` remains accessible. Worker parsing failures surface as errors. Use `open_trajectory()` directly when you explicitly want same-thread parsing.

## 🧪 &thinsp; Coverage

| Statements                                                                                 | Branches                                                                          | Lines                                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ![Statements](https://img.shields.io/badge/statements-99.84%25-brightgreen.svg?style=flat) | ![Branches](https://img.shields.io/badge/branches-82.92%25-yellow.svg?style=flat) | ![Lines](https://img.shields.io/badge/lines-99.84%25-brightgreen.svg?style=flat) |

## 🙏 &thinsp; Acknowledgements

- Element properties in `src/lib/element/data.ts` were combined from [`Bowserinator/Periodic-Table-JSON`](https://github.com/Bowserinator/Periodic-Table-JSON/blob/master/PeriodicTableJSON.json) under Creative Commons license and [`robertwb/Periodic Table of Elements.csv`](https://gist.github.com/robertwb/22aa4dbfb6bcecd94f2176caa912b952) (unlicensed).
- Thanks to [Images of Elements](https://images-of-elements.com) for providing photos of elemental crystals and glowing excited gases.
- Thanks to [@kadinzhang](https://github.com/kadinzhang) and their [Periodicity project](https://ptable.netlify.app) [[code](https://github.com/kadinzhang/Periodicity)] for the idea to display animated Bohr model atoms and inset a scatter plot into the periodic table to visualize the periodic nature of elemental properties.
- Big thanks to all sources of element images. See [`fetch-elem-images.mjs`](https://github.com/janosh/matterviz/blob/main/src/scripts/fetch-elem-images.mjs) and [`static/elements`](https://github.com/janosh/matterviz/tree/main/static/elements).
- Thanks to [@ixxie](https://github.com/ixxie) ([shenhav.fyi](https://shenhav.fyi)) for great suggestions.

This project would not have been possible as a one-person side project without many fine open-source projects. 🙏 To name just a few:

|           3D graphics           |               2D graphics                |                         Docs                         |               Bundler               |               Testing                |
| :-----------------------------: | :--------------------------------------: | :--------------------------------------------------: | :---------------------------------: | :----------------------------------: |
| [three.js](https://threejs.org) |          [d3](https://d3js.org)          | [svelte-widgets](https://svelte-widgets.janosh.dev/) |     [vite](https://vitejs.dev)      | [playwright](https://playwright.dev) |
| [threlte](https://threlte.xyz)  | [sharp](https://sharp.pixelplumbing.com) |     [rehype](https://github.com/rehypejs/rehype)     | [sveltekit](https://kit.svelte.dev) |     [vitest](https://vitest.dev)     |

## How to cite `matterviz`

Use [`citation.cff`](citation.cff) or cite the [Zenodo record](https://zenodo.org/badge/latestdoi/498793280) using the following BibTeX entry:

```bib
@software{riebesell_matterviz_2022,
  title = {matterviz: visualization toolkit for materials informatics},
  author = {Riebesell, Janosh and Evans, Matthew},
  date = {2026-08-11},
  year = {2026},
  doi = {10.5281/zenodo.17094509},
  url = {https://github.com/janosh/matterviz},
  note = {10.5281/zenodo.17094509 - https://github.com/janosh/matterviz},
  urldate = {2026-08-11}, % optional, replace with your date of access
  version = {0.7.0}, % replace with the version you use
}
```
