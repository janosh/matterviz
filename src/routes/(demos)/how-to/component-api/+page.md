# Component API guide

Conventions shared across MatterViz components, plus the command-line tools for rendering structure images and trajectory movies. Each demo page lists its component's full props.

## Shared conventions

### Controls, shortcuts and tooltips

Floating viewer, plot, table and heatmap controls share `show_controls`: `true`/`'always'`, `'hover'`, `false`/`'never'`, or `{ mode, hidden, style }`. For example, `{ mode: 'hover', hidden: ['controls'] }` keeps a plot’s fullscreen button and hides its settings pane. `false` hides all plot chrome; `controls_open` independently controls whether the settings pane is open. Every chart, domain plot and viewer defaults to `'hover'` (`DEFAULT_CONTROLS_MODE`); only the `Trajectory` and `NebViewer` playback bars default to `'always'`.

Viewers share one keyboard shortcut registry (`SHORTCUTS`), and each viewer lists the shortcuts that apply to it in its info and settings panes. <kbd>r</kbd> resets the camera of any hovered 3D viewer, <kbd>f</kbd> toggles fullscreen and <kbd>Escape</kbd> closes the open pane or unpins the tooltip.

Every component with a hover tooltip (plots, phase and convex-hull diagrams, `HeatmapMatrix`, `PeriodicTable`, `Structure`, `BrillouinZone`, `FermiSurface`, `ChemPotDiagram`) takes one `tooltip` prop: omitted shows the default, `false` hides it, a snippet replaces its content (`Structure` appends it below the site info), and a config object tunes the default where a component defines one (`{ prefix, suffix }` for phase diagrams, hulls, BZ and Fermi surfaces, `{ detail_level }` for `ChemPotDiagram`).

### File sources

`Structure`, `Trajectory`, `BrillouinZone` and `FermiSurface` share the `source` input for URLs, files and named payloads. `ConvexHull` accepts `entries` and automatically chooses a binary, ternary or quaternary plot. The dimension-specific renderers and `StructureBarPlot` are internal; use `BondAnglePlot`, `CoordinationBarPlot` or `StructureTypePlot` for structure distributions.

### Plot series, legends and tables

Composite components expose deliberate `*_props` options for presentation and interactions. Their parent owns data and synchronization: use `band_structs`, `doses`, or `trajectory` on the parent rather than supplying replacement child data. Plot `series` are read-only inputs; bind `hidden_series` for legend choices and `view` for zoom. Supply stable `id` values when reordering series or persisting visibility; omitted IDs use array positions. Multiple drawing series can share a `legend_id` for one legend entry and visibility choice; their drawing IDs must remain unique, and `hidden_series` then uses the shared `legend_id`. Bands uses `JSON.stringify([material_key, spin])` for these keys (`spin` is `up` or `down`; use material key `""` for an unlabelled dataset). Composite wrappers accept `hidden_series` plus `on_hidden_series_change` for controlled visibility. Legend callbacks run after the chart updates visibility. Axis identifiers are `x`, `x2`, `y`, and `y2`; `on_axis_change` delegates loading to the caller. `create_axis_loader` cancels superseded requests independently per axis; `cancel()` aborts all pending axes.

`HeatmapTable` columns have stable `id` values and optional `key` accessors and `cell` snippets; labels only control headings. Selectable tables require `row_key` and bind `selected_ids`, so replacing rows with fresh objects preserves selection.

## Spectral data

Spectral components accept keyed canonical collections: `<Bands band_structs={{ Si: bands }} />` and `<Dos doses={{ Si: dos }} />`. Bands declare `type: "phonon" | "electronic"`; DOS uses the same discriminator with `frequencies` or `energies`. Data is in THz for phonons and eV for electrons; a shared plot cannot mix the two types. `BandsAndDos` (which adds a linked Brillouin zone when given a `structure`) owns one bindable `units` prop for both plots (default `THz`); changing units resets frequency zoom to the converted shared range; nested `bands_props` and `dos_props` do not accept `units`. Electronic plots always use eV. It accepts a shared `fermi_level` reference, including zero; omit it to use dataset metadata without modifying the input data. Parse external files once using `normalize_band_structure` or `normalize_dos`; extract projections with `extract_pdos(raw, "atom" | "orbital", filter)` before rendering. A single dataset still needs a key (`""` gives an unlabelled series).

## Convex hulls

Hull renderers expose `get_model()` (also `children`’s `model`) instead of writable `stable_entries`, `unstable_entries`, and `phase_stats` outputs. Pass that snapshot to `<ConvexHullStats {model} />`, or call `compute_hull_model(entries, options)` for headless computation. The numerical model is independent of display thresholds and category styles. `model.facets` contains vertex indices into the single enriched `model.entries` table, so geometry and stability always refer to the same entries.

## Structure

`Structure` accepts parsed data through `structure`, or a URL, `File` or `{ data, filename }` payload through `source`, and handles file drops. Set `allow_file_drop={false}` when a parent owns loading. Across viewers, `on_file_drop(content, filename, meta)` takes over the raw dropped file and `on_file_load` reports what the viewer loaded. Recoverable parser issues (skipped CIF rows, guessed elements, placeholder cells) arrive on structure results of `open_material()` as `warnings` and show as a dismissible notice (bindable `parse_warnings`). Its `scene_props` accepts `StructureSettings`; computed results are available through the readonly `analysis` export on a component reference. Loading delegates to the same `open_material()` runtime available to non-component hosts, so fetching, decompression, format detection, workers, provenance, and disposal remain centralized. Prediction JSON files reopen with their input, properties, density and provenance; hosts can also pass `prediction_from_json(content)` as the `prediction` prop. Selection, measurements, atom/bond editing with undo/redo and the supercell/image-atom pipeline live in a headless `StructureSession` (exported from `matterviz/structure`); `active_pane: 'controls' | 'info' | 'export' | null` identifies the open floating pane.

`scene_props.camera_position` fits the structure when omitted; any supplied coordinate tuple, including `[0, 0, 0]`, is an explicit position. Clear it with `undefined` to request a fresh fit.

### Volumetric data

Every `VolumetricData` has a nonempty, unique `id`. Isosurface layers require `volume_id` and optionally `color_volume_id`; `active_volume_id` selects the slice field. Keep IDs stable when replacing or reordering fields so selection and surface settings follow the data. Removing a field drops its surfaces and clears color references to it. File loading derives IDs from the source filename and field identity; host predictions use the same `id` contract. A volume’s `origin` is an offset in the structure’s Cartesian frame; cube parsing translates atoms and the grid together into that frame. File imports combine fields only when the nonempty ordered atoms, species, occupancies, coordinates, and lattice match (Cartesian coordinates and lattice vectors use an absolute tolerance below `1e-8 A`; species and occupancies match exactly); otherwise they replace the scene and its fields.

### Host tools

Host computations register a component through `structure_host_tool` from `matterviz/structure`. Each run captures its input and exposes an abort signal plus guarded publication callbacks. Publish complete, versioned JSON-safe calculation metadata through `StructureToolOverlay.result`; the host receives accepted and reopened snapshots through its `prediction` prop. Use `set_overlay_visible()` to toggle predicted properties and density without discarding results or edited surfaces. Overlays marked `transient: true` are live previews (e.g. SCF steps): they render but never reach the `prediction` prop, export pane or JSON. Published after its run's result, a preview replaces only the fields or geometry it carries; fields it omits are hidden and their surfaces return with their settings when republished, and publishing the result again ends the preview. An optional `geometry: { positions, lattice? }` (Cartesian Å, one position per input site, optional cell rows) moves the drawn atoms and cell, e.g. along a relaxation, while runs, selections, edits and structure exports keep addressing the input and volumes keep their own frame; a result's geometry is exported and reopened with the prediction. `run.replace_input(geometry)` adopts it as the input in one undoable edit, rebasing the run's prediction onto it; undo clears the result and redo restores it. Each publication draws one default surface, for its first field. Set `signed: false` on a non-negative field (e.g. a charge density with negative numerical artifacts) to skip its negative lobe, or `signed: true` to show it; unset infers it from the data. A run belongs to the structure object it started on: assigning a new `structure` (other than through `run.replace_input`) ends the run, while in-place edits are not observed. See the [host-tool demo](https://matterviz.janosh.dev/structure/host-tool).

### Structure images from the command line

From a repository checkout with Playwright Chromium installed, one command renders any number of files to images, one per file, named after its input without extensions:

```sh
pnpm snapshot structures/*.cif CHGCAR.gz relax.traj --out-dir images
pnpm snapshot a.json b.vasp --out-dir images --format webp --props '{"cell_type":"conventional","background_color":"#ffffff"}' --dpi 300
```

Inputs are anything the viewer opens, compressed or not: structure formats (CIF, POSCAR, (ext)xyz, pymatgen/ASE/OPTIMADE JSON, PDB, LAMMPS, ...), volumetric files (CHGCAR, cube) with their default isosurfaces, and trajectories (frame `--frame`, default 0; `--hdf5-group` for HDF5 files with several). `--format` is `png` (default), `webp` or `jpeg` (`--quality`, default 0.9). `--props` takes `Structure` props as inline JSON or a JSON file path, e.g. `cell_type`, `supercell_scaling`, `isosurface_settings`, `color_scheme` or `scene_props` (`show_bonds`, `atom_radius`, `camera_position`, ...). Only the 3D canvas is captured: DOM overlays (site labels, legend, panes) and other display modes are not. `--width`/`--height` set the viewer size in CSS pixels and `--dpi` the resolution (72 = one pixel per CSS pixel, default 144; only PNG records it). Images are transparent unless `background_color` is set (JPEG falls back to white). Existing images are kept unless `--overwrite` is passed. Like `pnpm movie`, it starts a private viewer (`--url` uses a running server) and prints one JSON line per file with the drawn cell's site count. Paths resolve against the caller's directory, also via `node /path/to/matterviz/src/scripts/snapshot.mjs`. Its `/structure/render` page exposes `window.matterviz_snapshot.render(source, { png_dpi, format, quality, frame, hdf5_group_path }, structure_props)` for other automation, where `source` is a `File`, URL or `{ data, filename }` payload. Each call mounts a fresh `Structure` and exports once `Structure` acknowledges the scene's `render_token`, which waits for isosurfaces meshed in a worker.

## Trajectory

`Trajectory.visible_properties` is the shared selection for scatter and histogram modes. It contains exact source property keys, independently of display labels; an empty array hides every series. Legend clicks, isolation, and plot-mode changes use this same state.

**Analysis → Thermal hotspots** maps regional kinetic energy over a selected frame window. Use velocities with masses, or stored kinetic energy with its units and reference. The pane reads declared mass/velocity units and infers missing mass units from recorded masses; verify these defaults and supply any missing units. Choose a stationary device, center-of-mass removal for selected atoms inside the grid, or per-bin center-of-mass removal. The map is an atom-exposure average (integrated energy divided by integrated population), not a persistence statistic. Recorded timestamps determine trapezoidal weights when available; otherwise MD steps do. Empty and undersampled bins are transparent. Kelvin requires suitable translational degrees of freedom; stored energies require an explicit post-reference value.

Large fixed-topology MD HDF5 (`md-trajectory-v1`), TorchSim HDF5, and ASE ULM trajectories provide bounded numeric atom reads for thermal analysis. Local files opened by the viewer calculate in the file-owning worker and support cancellation, a selected-frame preview, and progressive time averages. Cell-following and fixed-device grids support triclinic cells and per-axis periodicity. Atoms remain visible throughout playback, with optional heatmap coloring and a translucent volume cloud with configurable colors and opacity. Threshold and display changes reuse the calculated map; analysis changes require recalculation. `run.compute_hotspots(options)` exposes the calculation programmatically; atom batches stay internal to the readers and reducer. The default 128 MiB budget reserves analysis buffers, retained maps, decoder and display buffers; it is not a total browser/GPU memory limit. HDF5 storage chunks above 8 MiB are rejected and must be rechunked. Large text and Reference MD readers do not yet provide this bounded numeric path.

`Trajectory` accepts a URL, `File` or `{ data, filename }` through `source`, handles drops and HDF5 group selection, and disposes runs it opens. To manage data yourself, pass a `TrajectoryRun` through `trajectory` and dispose it yourself; the viewer borrows supplied runs. Use `trajectory_from_frames(frames)` for existing frames or `open_trajectory(bytes, { filename })` for same-thread parsing. Set `allow_file_drop={false}` when the parent owns loading. Disposed runs reject every frame read, including frame zero; `run.preview` remains accessible.

`run.read_frame()` returns a `NumericFrame` with source-precision coordinate buffers and a separate `header` for step, time, and metadata. These snapshots are read-only: do not mutate or transfer their buffers. Pass `{ vectors: [] }` as the third argument to request coordinates without vector channels, or list the vector keys you need. Use `materialize_frame(await run.read_frame(frame_idx))` when you need editable `TrajectoryFrame` objects with `structure.sites`.

Trajectory event callbacks also receive numeric frames. Prepared playback frames use coordinates wrapped for display; read the frame through `run.read_frame()` when you need the original source coordinates.

### Scripted camera movies

`Trajectory.on_controller` exposes an awaitable `load(source, { hdf5_group_path, signal })`, `prepare_frame(idx)`, `inspect()`, `plan_movie(request)`, `render_movie(plan, on_frame, { signal, on_progress })`, `export_movie(plan, options)` and `cancel_movie()`. Loading resolves after the first scene is rendered; inspection returns atom/frame counts, displayed atom bounds and the interactive camera, which is separate from the export camera. Keep a structure-containing display mode selected. Each render restores the original frame and playback state, including cancellation. `render_movie` calls `on_frame(canvas, idx, signal)` with one reusable canvas at a time: inspect or consume its pixels before resolving your callback, and stop consuming it when the signal aborts. Cancellation releases the viewer even when a consumer remains pending. `movie_frame(plan, idx)` supplies the source-frame index and microsecond timestamp. Source frames are held or skipped to fit the requested duration; atomic coordinates are not interpolated.

From a repository checkout with Playwright Chromium and FFmpeg installed, run:

```sh
pnpm movie inspect /path/to/trajectory.h5
pnpm movie preview movie.json --output storyboard.png
pnpm movie render movie.json --output movie.mp4
```

The CLI starts a private local viewer automatically; `--url http://localhost:3000` uses an existing server. Its dedicated `/trajectory/render` page exposes the same controller as `window.matterviz_movie`, plus `configure(structure_props)`. Files selected through `#movie-source` stay browser `File` objects, so indexed HDF5 loading does not copy an entire large file into JavaScript memory. Results are JSON on stdout; progress and errors go to stderr. Ctrl+C cancels the job. Existing output files are never overwritten.

From another directory, invoke `node /path/to/matterviz/src/scripts/movie.mjs render movie.json --output movie.mp4`. The private viewer starts from the checkout while the input JSON and output keep their caller-relative paths. `visuals.cutaway` accepts the same cutaway settings as `Structure`; use a slice when a dense bulk system would obscure the motion. Set `visuals.cutaway.whole_atoms` to `true` to select centers inside the slice and retain their complete visible bonds and coordination polyhedra, including intact endpoint atoms just outside it and periodic image endpoints. Volume fields retain their surface clipping.

For covalent or metallic coordination shells, set `visuals.scene_props.polyhedra_neighbor_mode` to `"bonded"` with `show_polyhedra: "always"` and `show_bonds: "always"`. This constructs polyhedra from all bonded neighbors; the default `"anion"` mode selects more electronegative anion neighbors. Opacity, edge visibility, neighbor-count limits, and center-element filters use the normal structure settings.

```json
{
  "source": { "path": "./trajectory.h5" },
  "camera": {
    "preset": "orbit",
    "turns": 0.75,
    "elevation_deg": 25,
    "azimuth_deg": 35,
    "distance_scale": 1.1,
    "up": [0, 0, 1]
  },
  "visuals": {
    "color_scheme": "Jmol",
    "scene_props": { "show_bonds": "never", "gizmo": false }
  },
  "video": {
    "width": 1920,
    "height": 1080,
    "duration_s": 12,
    "fps": 30,
    "background": "#111827",
    "codec": "h264",
    "crf": 18,
    "preset": "slow"
  }
}
```

Local source paths resolve relative to the JSON file; a `source.url` or `source.hdf5_group_path` can also be supplied. Omit `frames` to cover the whole trajectory or provide `{ "start": 0, "end": 100 }` with an exclusive end. Omit `camera` to hold the fitted view, use the orbit preset, or provide an explicit `CameraFlight` with timed keyframes. Orbit fitting starts from the current frame; inspect a storyboard for expanding cells or moving atoms before committing to a long render. A completed job saves the resolved camera path, reference viewport and encoding settings beside the output as `<output>.json`; edit its FPS or duration and render it again to produce a new frame schedule while retaining camera framing.

For irregular simulation timestamps, provide `source_frames` with one zero-based source index per encoded video frame. Indices must lie within the selected `frames` range; repeated indices hold actual recorded coordinates. The array length must equal `round(video.duration_s * video.fps)`, so editing the duration or FPS of an explicit schedule requires updating the schedule too. Previews sample the same schedule, and the saved plan records it for reproducible offline rendering.

During rendering, `<output>.review/plan.json` records the plan and `<output>.review/latest.png` is atomically replaced with sampled frames from the actual encoder input. JSON `sample` events identify the image path, video frame, source frame and timestamp. Inspect that image while the command runs; Ctrl+C or SIGTERM cancels a bad render. `encoding` and `verifying` events distinguish finalization from validation. The final `<output>.review/storyboard.png` is decoded from the encoded video, and validation checks decoding errors, frame count, dimensions and duration. Review artifacts remain available after cancellation or failure. `--samples` controls the sample count for previews and render inspection (default six). Output, manifest and review-path collisions are rejected before loading.

The offline CLI encodes exact frame timestamps through FFmpeg, supports H.264, VP9 and AV1, and accepts `video.bitrate` in bits/s instead of `video.crf`. Pixel dimensions are exact and independent of device pixel ratio. Browser `export_movie` and the export pane use the same frame producer with AV1 MediaRecorder encoding: their elapsed duration can grow with slow frame reads. For exact timing, use the offline CLI. Video captures the 3D canvas; DOM legends, plots and floating controls are not included.
