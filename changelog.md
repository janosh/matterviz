# Changelog

## [v0.4.0](https://github.com/janosh/matterviz/compare/v0.3.6...v0.4.0)

> 6 June 2026

### 🚀 New Features

- Add `BoxPlot` and `Violin` components (raw-data quantiles + Gaussian KDE, tukey/minmax/percentile/std whiskers, split/one-sided violins, `violin+box` overlay) and a `d3-sankey` flow diagram https://github.com/janosh/matterviz/pull/349
- Add zoomable `Sunburst`/`Icicle` hierarchical charts (drill-down breadcrumbs, `value_mode`, `min_fraction` "Other" bucketing, metric coloring, SVG/PNG export) plus chem-system and spacegroup data builders https://github.com/janosh/matterviz/pull/352
- Add `extensions/anywidget`: a self-contained ESM bundle published to npm as `matterviz-anywidget` for notebook/host runtimes (consumed by pymatviz) https://github.com/janosh/matterviz/pull/351

### 🛠 Enhancements

- Rewrite fill-between to trace each boundary through its own `monotoneX` points (edges hug their lines), add fills to the legend with synced hover highlighting, and re-target `starry-night` syntax highlighting to `data-theme` https://github.com/janosh/matterviz/pull/346
- Auto-detect format for extensionless `blob:` URLs via content/magic-byte sniffing, read gzip `Content-Encoding` responses binary-safe, and content-detect minified single-line JSON structures https://github.com/janosh/matterviz/pull/355
- Keep `HeatmapTable` tooltips alive across sort/filter/pagination via a `MutationObserver`, and gzip large Brillouin-zone and XRD test fixtures https://github.com/janosh/matterviz/pull/348
- Split chart content into z-ordered clip groups so reference lines interleave while annotations overflow, and cap/scroll overflowing legends https://github.com/janosh/matterviz/pull/356

### 🐛 Bug Fixes

- Fix correctness bugs across science kernels (XRD scattering prefactor + hkl bounds, `e_above_hull` for arity ≥ 5, gas corrections, moyo-wasm column-major rotations, RDF PBC, marching-cubes) and parsers (POSCAR/CIF/OPTIMADE, NPT XDATCAR, extxyz, composition), each with red→green regression tests https://github.com/janosh/matterviz/pull/354
- Fix OPTIMADE element resolution, a convex-hull click-to-select page freeze (`effect_update_depth_exceeded`), fermi-surface upsampling/NaN crashes, violin KDE on log axes, and PBC-aware structure measurements https://github.com/janosh/matterviz/pull/355
- Fix plot reactive update loops, clamp both ends of log domains to the positive floor (panning past zero stays recoverable), and gate y2 range write-back on actual y2-series presence https://github.com/janosh/matterviz/pull/356
- Fix the fill `where` callback argument order and the reference-line `left`/`right` label side https://github.com/janosh/matterviz/pull/346
- Unskip and triage ~75 Playwright tests, removing bit-rotted pixel-based suites and fixing the bugs they surfaced https://github.com/janosh/matterviz/pull/350

### 💡 Refactoring

- Adopt the shared `@janosh/vite-config` oxlint ruleset, apply the resulting fixes across ~226 files (`to_error()` normalization, node-protocol imports, etc.), and migrate CI/tooling to pnpm on Node 24 https://github.com/janosh/matterviz/pull/347
- Extend linting to the `extensions/` tree and fix the surfaced issues across the VS Code and Dash extensions https://github.com/janosh/matterviz/pull/348
- Extract a reusable `ControlPane` and a crash-safe `unique_id()` helper shared across plot components https://github.com/janosh/matterviz/pull/349
- Dedup plot interaction helpers: centralize tooltip constraining in `PlotTooltip`, extract `remove_drag_listeners`/`create_axis_loader`, and adopt screen-uniform pan-zoom https://github.com/janosh/matterviz/pull/356

## [v0.3.6](https://github.com/janosh/matterviz/compare/v0.3.5...v0.3.6)

> 30 May 2026

### 🚀 New Features

- Add adaptive density-binned scatter plot with hover picking and auto-placed colorbar https://github.com/janosh/matterviz/pull/345
- Add bond editing with add/delete modes, undo snapshots, and bond-order setting https://github.com/janosh/matterviz/pull/342

### 🛠 Enhancements

- Auto-move legend/colorbar outside crowded plots with smart side selection and overflow-aware footprint measurement https://github.com/janosh/matterviz/pull/345
- Add `./coordination`, `./heatmap-matrix`, and `./isosurface` subpath exports and fix the `./periodic-table` export path https://github.com/janosh/matterviz/pull/345
- Add `knip` unused-dependency CI check and remove the dead `@rollup/plugin-yaml` dependency https://github.com/janosh/matterviz/pull/345

### 🐛 Bug Fixes

- Fix stale visualization interaction state (selections, popups, async frames, legend) leaking across data source replacements https://github.com/janosh/matterviz/pull/343
- Fix auto-placed colorbar/legend overlapping plot axes and clean up arcsinh tick labels https://github.com/janosh/matterviz/pull/345

### 💡 Refactoring

- Unify the four-side plot axes into a reusable `PlotAxis` component across `ScatterPlot`, `BarPlot`, `Histogram`, and `BinnedScatterPlot` https://github.com/janosh/matterviz/pull/345
- Tighten lint rules and centralize shared geometry/parser validation (finite `Vec3` checks, throwing `Error` objects) https://github.com/janosh/matterviz/pull/344

### 🔒 Security Fixes

- Sanitize tooltip HTML (e.g. `InfoTag`, `StructureExportPane`) and limit `allow_html` to tooltips that actually render HTML https://github.com/janosh/matterviz/pull/345

## [v0.3.5](https://github.com/janosh/matterviz/compare/v0.3.4...v0.3.5)

> 19 May 2026

### 🚀 New Features

- Add bond-order perception, rendering, and editing controls https://github.com/janosh/matterviz/pull/339
- Add searchable info pane cards, row copying, legend filtering, and richer hover/selection feedback https://github.com/janosh/matterviz/pull/338

### 🛠 Enhancements

- Improve convex-hull performance and demo loading with caching, lazy mounting, and reduced repeated work https://github.com/janosh/matterviz/pull/338
- Preserve explicit `structure.properties.bonds` metadata through parsing, perception, supercells, and cell transforms https://github.com/janosh/matterviz/pull/339
- Improve default site labels, label placement, and overlay z-index layering for structure viewers https://github.com/janosh/matterviz/pull/339

### 🐛 Bug Fixes

- Fix `BarPlot` honoring `show_legend={false}` in render gating [c85befeb](https://github.com/janosh/matterviz/commit/c85befeb)
- Fix visualization inspector UX rough edges across structure, trajectory, plot, and convex-hull views https://github.com/janosh/matterviz/pull/338

### 💡 Refactoring

- Remove obsolete FerroX WASM integration and matching demo now that FerroX lives in its own repository https://github.com/janosh/matterviz/pull/337

## [v0.3.4](https://github.com/janosh/matterviz/compare/v0.3.3...v0.3.4)

> 29 April 2026

### 🛠 Enhancements

- Package decompressed element data from a TypeScript asset script for synchronous npm consumers [fadef983](https://github.com/janosh/matterviz/commit/fadef983)
- Load generated CSS assets in the VS Code webview and switch the webview bundle to native ES module loading [fadef983](https://github.com/janosh/matterviz/commit/fadef983)
- Simplify Dash and VS Code Vite configs around `import.meta.dirname`, production minification, and TypeScript imports [fadef983](https://github.com/janosh/matterviz/commit/fadef983)

### 🐛 Bug Fixes

- Fix packaged chemical-potential worker resolution by loading the emitted `.js` worker URL [fadef983](https://github.com/janosh/matterviz/commit/fadef983)
- Prevent Vite from transforming the optional `happy-dom` SSR fallback import in sanitization code [fadef983](https://github.com/janosh/matterviz/commit/fadef983)

## [v0.3.3](https://github.com/janosh/matterviz/compare/v0.3.2...v0.3.3)

> 28 April 2026

### 🚀 New Features

- Export API: programmatic capture functions + UI polish https://github.com/janosh/matterviz/pull/323
- Multi-vector-per-atom rendering https://github.com/janosh/matterviz/pull/324
- Support PARCHG files https://github.com/janosh/matterviz/pull/331

### 🛠 Enhancements

- Replace Deno CLI + ESLint with unified vite-plus toolchain https://github.com/janosh/matterviz/pull/325
- Remove all ferrox references from config and source files [27a729b0](https://github.com/janosh/matterviz/commit/27a729b0)
- Enable lint on extension code, fix all 89 errors [03551f7f](https://github.com/janosh/matterviz/commit/03551f7f)

### 🐛 Bug Fixes

- Fix PBC distance calculation for non-orthogonal lattices https://github.com/janosh/matterviz/pull/328
- Tile volumetric data when creating supercells https://github.com/janosh/matterviz/pull/333
- Fix InstancedMesh limit hiding atoms in large structures https://github.com/janosh/matterviz/pull/335

### 🔒 Security Fixes

- Sanitize all `{@html}` directives with DOMPurify to prevent XSS https://github.com/janosh/matterviz/pull/326

## [v0.3.2](https://github.com/janosh/matterviz/compare/v0.3.1...v0.3.2)

> 4 March 2026

### 🚀 New Features

- Add side-by-side layout mode to ConvexHullStats https://github.com/janosh/matterviz/pull/307
- Add HeatmapMatrix component with controls and ordering https://github.com/janosh/matterviz/pull/311
- Add ChemPotDiagram component for chemical potential diagrams https://github.com/janosh/matterviz/pull/312
- Add categorical bar chart support https://github.com/janosh/matterviz/pull/320
- Add PlotPanel for interactive JSON data visualization https://github.com/janosh/matterviz/pull/321

### 🛠 Enhancements

- Phase diagram: vertical lever rule, dynamic x-domain, formula formatting, inline JSON editing via JsonTree, always-visible phase diagram editor https://github.com/janosh/matterviz/pull/309
- Polish chempot diagram UX and interaction coverage https://github.com/janosh/matterviz/pull/313
- Speed up chempot construction and add temperature filtering https://github.com/janosh/matterviz/pull/314
- Improve isosurface render ordering and comparison sync https://github.com/janosh/matterviz/pull/316
- Improve plot tooltips with richer defaults and physics-based band classification https://github.com/janosh/matterviz/pull/319

### 🐛 Bug Fixes

- Fix packaging json.gz to NPM + more component updates https://github.com/janosh/matterviz/pull/308
- Isosurface performance: grid downsampling, debounced rendering, UI fixes https://github.com/janosh/matterviz/pull/322

### 💡 Refactoring

- Refactor trajectory parsing and tighten runtime type guards https://github.com/janosh/matterviz/pull/315
- Unify plot components and add x2-axis (secondary top x-axis) support https://github.com/janosh/matterviz/pull/318

## [v0.3.1](https://github.com/janosh/matterviz/compare/v0.3.0...v0.3.1)

> 9 February 2026

### 🛠 Enhancements

- Add classical potentials, MD thermostats, and benchmark suite https://github.com/janosh/matterviz/pull/290
- Add multiple face coloring modes for 3D/4D convex hulls https://github.com/janosh/matterviz/pull/292
- Add TorchSim state conversion + improve Rust bindings https://github.com/janosh/matterviz/pull/293
- Automate `ferrox` docs generation for Rust + Python + WASM APIs https://github.com/janosh/matterviz/pull/294
- Add 10 ferrox Marimo notebooks and improve structure matching UX https://github.com/janosh/matterviz/pull/295
- Auto-generate Python type stubs from Rust with pyo3-stub-gen https://github.com/janosh/matterviz/pull/296
- Add section grouping and layout options to ToggleMenu https://github.com/janosh/matterviz/pull/297
- Add isosurface visualization for volumetric data https://github.com/janosh/matterviz/pull/300
- Add interactive edit-atoms mode for adding, moving, and deleting structure sites https://github.com/janosh/matterviz/pull/301
- VS Code extension: JsonBrowser with multi-panel drag-and-drop layout https://github.com/janosh/matterviz/pull/303

### 💡 Refactoring

- `ferrox` modularize Python and WASM bindings into namespaced submodules https://github.com/janosh/matterviz/pull/291

## [v0.3.0](https://github.com/janosh/matterviz/compare/v0.2.2...v0.3.0)

> 1 February 2026

### 🛠 Enhancements

- Extend convex hull to support 5+ element systems https://github.com/janosh/matterviz/pull/254
- Add sync_y_zoom for Bands/DOS plots, Formula copy, and plot padding fix https://github.com/janosh/matterviz/pull/257
- Pseudo-binary phase diagrams with chemical formula rendering https://github.com/janosh/matterviz/pull/259
- Add JsonTree controls and HeatmapTable uncertainty parsing https://github.com/janosh/matterviz/pull/260
- Add Y2 axis synchronization for dual-axis plots https://github.com/janosh/matterviz/pull/261
- Add irreducible Brillouin zone visualization https://github.com/janosh/matterviz/pull/263
- Add gas-phase thermodynamics for atmosphere-controlled convex hulls by @killiansheriff in https://github.com/janosh/matterviz/pull/270
- Add supercell creation, lattice reduction, and atomic mass to Rust extension https://github.com/janosh/matterviz/pull/272
- Add structure normalization, pseudo-elements, and site properties https://github.com/janosh/matterviz/pull/273
- Add ferrox WASM package and structure matching demo https://github.com/janosh/matterviz/pull/275
- `pymatgen` `sites.py` feature parity in `ferrox` https://github.com/janosh/matterviz/pull/276
- Add Rust structure transformations and Ewald summation https://github.com/janosh/matterviz/pull/277
- Add coordination analysis module to ferrox https://github.com/janosh/matterviz/pull/279
- Add RDF calculation module to ferrox https://github.com/janosh/matterviz/pull/282
- `ferrox` powder XRD pattern calculation https://github.com/janosh/matterviz/pull/283
- Add Element class, oxidation state guessing, and composition utilities https://github.com/janosh/matterviz/pull/284
- Add atomistic simulation features to ferrox https://github.com/janosh/matterviz/pull/285
- Add molecule support and fix structure charge parsing https://github.com/janosh/matterviz/pull/287

### 🐛 Bug Fixes

- Extract PortalSelect component, fix ColorBar rollback bugs https://github.com/janosh/matterviz/pull/252

### 📖 Documentation

- Migrate to `svelte-multiselect/live-examples` allowing upgrade demos to TypeScript https://github.com/janosh/matterviz/pull/262

### 🧪 Tests

- Port pymatgen and torch-sim reference tests to Rust https://github.com/janosh/matterviz/pull/286

## New Contributors

- @killiansheriff made their first contribution in https://github.com/janosh/matterviz/pull/270

## [v0.2.2](https://github.com/janosh/matterviz/compare/v0.2.1...v0.2.2)

> 14 January 2026

### 🛠 Enhancements

- Hover visibility for convex hull control toggles and fix spectral/legend issues https://github.com/janosh/matterviz/pull/237
- Add reference lines and planes for 2D/3D plots https://github.com/janosh/matterviz/pull/239
- Clickable axis labels for switching plot properties with async data loading https://github.com/janosh/matterviz/pull/240
- `Structure` add atomic size user override UI https://github.com/janosh/matterviz/pull/242
- Add plot data cleaning API for handling noisy scientific data https://github.com/janosh/matterviz/pull/243
- Add arcsinh scale for 2D plots https://github.com/janosh/matterviz/pull/245
- Plotly Dash integration for MatterViz with typed Python wrappers by @mkhorton in https://github.com/janosh/matterviz/pull/244
- HuggingFace Spaces deployment and typed wrapper improvements https://github.com/janosh/matterviz/pull/247

### 🐛 Bug Fixes

- fix: legend deduplication by label+group, structure coord normalization, BZ wrapping https://github.com/janosh/matterviz/pull/250

### 🧪 Tests

- Use `structuredClone` to prevent `DEFAULTS` mutation in `Structure` https://github.com/janosh/matterviz/pull/248

## New Contributors

- @mkhorton made their first contribution in https://github.com/janosh/matterviz/pull/244

## [v0.2.1](https://github.com/janosh/matterviz/compare/v0.2.0...v0.2.1)

> 4 January 2026

### 🛠 Enhancements

- `Structure` cell type switch (primitive/conventional) https://github.com/janosh/matterviz/pull/219
- BarPlot: add line marker support https://github.com/janosh/matterviz/pull/220
- Parse `.xy`, `.xye`, `.brml`, `.xrdml` XRD file formats https://github.com/janosh/matterviz/pull/221
- `FermiSurface` visualization https://github.com/janosh/matterviz/pull/223
- `HeatmapTable` https://github.com/janosh/matterviz/pull/227
- Parse and display metadata from Optimade JSON files + codebase improvements https://github.com/janosh/matterviz/pull/231
- `IsobaricBinaryPhaseDiagram` https://github.com/janosh/matterviz/pull/233

### 🐛 Bug Fixes

- Fix CIF parser for compound symmetry operations https://github.com/janosh/matterviz/pull/228
- Wrap fractional coordinates to [0, 1) for nested `pymatgen` JSON structures https://github.com/janosh/matterviz/pull/232
- Fix all failing E2E Playwright tests https://github.com/janosh/matterviz/pull/234
- Fix cyclic barrel imports causing SSR failures + unskip some more E2E tests + delete low value ones https://github.com/janosh/matterviz/pull/235

### 💡 Refactoring

- Refactor: Improve variable names https://github.com/janosh/matterviz/pull/229

## [v0.2.0](https://github.com/janosh/matterviz/compare/v0.1.15...v0.2.0)

> 8 December 2025

### 🛠 Enhancements

- Support tick labels inside + rounded bars on all plots, smarter default filtering of unstable PD entries https://github.com/janosh/matterviz/pull/214
- Native `pymatgen` band structure and DOS support https://github.com/janosh/matterviz/pull/215
- Support LAMMPS trajectory format `.lammpstrj` https://github.com/janosh/matterviz/pull/216
- Fat bands visualization https://github.com/janosh/matterviz/pull/217

### 💥 Breaking Changes

- Rename `PhaseDiagramND` to `ConvexHullND` https://github.com/janosh/matterviz/pull/218

### 🚧 CI

- Fix all legacy type errors and run `svelte-check` as pre-commit hook https://github.com/janosh/matterviz/pull/212

## [v0.1.15](https://github.com/janosh/matterviz/compare/v0.1.14...v0.1.15)

> 29 November 2025

### 🛠 Enhancements

- Plot fullscreen mode, supercell selector, XRD broadening https://github.com/janosh/matterviz/pull/206
- Phase diagrams: add `calculate_e_above_hull` API, custom marker symbols, tweak pulse/glow highlights https://github.com/janosh/matterviz/pull/207
- Highlight selected entry in `PhaseDiagram2D` https://github.com/janosh/matterviz/pull/209

### 🐛 Bug Fixes

- Respect PBC in coordination number atom colors https://github.com/janosh/matterviz/pull/197
- Fix blank `Structure` and `BrillouinZone` PNG exports https://github.com/janosh/matterviz/pull/205
- Add composition utilities and fix phase diagram oxidation state handling https://github.com/janosh/matterviz/pull/208

### 🏷️ Type Hints

- Type fixes https://github.com/janosh/matterviz/pull/198

## Unreleased

### 💥 Breaking Changes

- **Band structure types**: Renamed `lattice_rec` to `recip_lattice` in `BaseBandStructure` interface for consistency with structure types. External consumers using `$lib/bands` types should update their code accordingly. [cf57545f](https://github.com/janosh/matterviz/commit/cf57545f)

## [v0.1.14](https://github.com/janosh/matterviz/compare/v0.1.13...v0.1.14)

> 6 November 2025

### 🛠 Enhancements

- Show status messages in RDF/XRD/Coordination plots if empty/on error https://github.com/janosh/matterviz/pull/184
- `ElementTile` add `--elem-tile-active-border` CSS variable https://github.com/janosh/matterviz/pull/190
- Introduce highlight styles for phase diagram entries for customizable visual effects on selected entries https://github.com/janosh/matterviz/pull/192
- SymmetryStats https://github.com/janosh/matterviz/pull/195

### 🐛 Bug Fixes

- Refactor `extension/vscode` file IO to use VSCode API instead of node:fs https://github.com/janosh/matterviz/pull/182
- fix/transpose cell for torchsim trajectory by @thomasloux in https://github.com/janosh/matterviz/pull/193

### 🧪 Tests

- Test `Bond.svelte` https://github.com/janosh/matterviz/pull/179

## New Contributors

- @thomasloux made their first contribution in https://github.com/janosh/matterviz/pull/193

## [v0.1.13](https://github.com/janosh/matterviz/compare/v0.1.12...v0.1.13)

> 18 October 2025

### 💥 Breaking Changes

- Plot component refactor: use grouped x/y axis, display, bar/line/point style props https://github.com/janosh/matterviz/pull/169
- `y2`-axis support for `BarPlot` + `Histogram` https://github.com/janosh/matterviz/pull/171

### 🛠 Enhancements

- RDF plot component https://github.com/janosh/matterviz/pull/164
- `CoordinationBarPlot` https://github.com/janosh/matterviz/pull/165
- 3D `Structure` export as GLB/OBJ https://github.com/janosh/matterviz/pull/168
- `Bands`, `Dos`, `BandsAndDos` components https://github.com/janosh/matterviz/pull/172
- Brillouin zone https://github.com/janosh/matterviz/pull/174

### 💡 Refactoring

- Use spatial decomposition to speed up bond detection https://github.com/janosh/matterviz/pull/178

## [v0.1.12](https://github.com/janosh/matterviz/compare/v0.1.9...v0.1.12)

> 6 October 2025

### 🛠 Enhancements

- Structure from string https://github.com/janosh/matterviz/pull/150
- 2/3/4D Phase diagrams https://github.com/janosh/matterviz/pull/152
- `XrdPlot.svelte` powered by new `BarPlot.svelte` https://github.com/janosh/matterviz/pull/153
- `ScatterPlot`/`Histogram` support one-sided pin on `x`/`y` range https://github.com/janosh/matterviz/pull/154
- Support on-the-fly 4D energy above hull calculation https://github.com/janosh/matterviz/pull/155
- Enhance interactivity in plotting components https://github.com/janosh/matterviz/pull/157
- Tweaks and tests https://github.com/janosh/matterviz/pull/159
- Add `grouped` mode to `BarPlot` + interactivity improvements https://github.com/janosh/matterviz/pull/162
- Add WebM video export to `Trajectory` https://github.com/janosh/matterviz/pull/163

### 🐛 Bug Fixes

- Fix angle calculation in `Structure` measure mode https://github.com/janosh/matterviz/pull/160

### 📖 Documentation

- Site reorg https://github.com/janosh/matterviz/pull/161

## [v0.1.9](https://github.com/janosh/matterviz/compare/v0.1.8...v0.1.9)

> 5 September 2025

### 🛠 Enhancements

- Interactive symmetry analysis powered by `moyo` WASM bindings https://github.com/janosh/matterviz/pull/140
- Wyckoff table https://github.com/janosh/matterviz/pull/141
- `Structure` rotation controls https://github.com/janosh/matterviz/pull/144

### 🐛 Bug Fixes

- Fix missing Structure/Trajectory pane scroll in `overflow: hidden` containers https://github.com/janosh/matterviz/pull/142

## [v0.1.8](https://github.com/janosh/matterviz/compare/v0.1.7...v0.1.8)

> 17 August 2025

### 🛠 Enhancements

- Measure distances and angles between selected `Structure` sites https://github.com/janosh/matterviz/pull/137
- Optimade page 3-column layout (providers, suggestions, structure) https://github.com/janosh/matterviz/pull/126

### 🐛 Bug Fixes

- Fix parsing `mof-issue-127.cif` https://github.com/janosh/matterviz/pull/128
- Disable `Structure`/`Trajectory` fullscreen buttons in non-browser contexts https://github.com/janosh/matterviz/pull/133
- Set VSCode preferred extension location https://github.com/janosh/matterviz/pull/136

## [v0.1.7](https://github.com/janosh/matterviz/compare/v0.1.6...v0.1.7)

> 11 August 2025

### 🛠 Enhancements

- Settings reset buttons https://github.com/janosh/matterviz/pull/116
- Supercells https://github.com/janosh/matterviz/pull/117

### 🐛 Bug Fixes

- Fix large trajectory loading in VSCode extension https://github.com/janosh/matterviz/pull/115
- Move structure IO https://github.com/janosh/matterviz/pull/123
- Change default camera projection to orthographic https://github.com/janosh/matterviz/pull/124
- Fix `supported_resource` context for keyboard shortcut `when` in VSCode extension https://github.com/janosh/matterviz/pull/125

### 🧪 Tests

- Improve unit tests https://github.com/janosh/matterviz/pull/118

## [v0.1.6](https://github.com/janosh/matterviz/compare/v0.1.5...v0.1.6)

> 28 July 2025

### 🛠 Enhancements

- More `Histogram.svelte` features (near parity with `ScatterPlot.svelte`) https://github.com/janosh/matterviz/pull/101
- Add parsing routines for single OPTIMADE JSON by @ml-evs in https://github.com/janosh/matterviz/pull/100
- Add camera projection selector to `StructureControls.svelte`: perspective (default) or orthographic https://github.com/janosh/matterviz/pull/105
- StructureControls.svelte add CIF and POSCAR file export and clipboard copy buttons https://github.com/janosh/matterviz/pull/110
- Customize site labels (size, color, padding, bg color, offset) via `StructureControls.svelte` https://github.com/janosh/matterviz/pull/111
- Streaming trajectory loader and parser to support large MD files https://github.com/janosh/matterviz/pull/112
- Add lots of VSCode extension settings for customizing default appearance https://github.com/janosh/matterviz/pull/114

### 🐛 Bug Fixes

- Fix VSCode PNG export https://github.com/janosh/matterviz/pull/103
- Fix Matterviz auto-render triggering on unsupported files https://github.com/janosh/matterviz/pull/108
- Fix CIF parsing of TiO2 (mp-2657) https://github.com/janosh/matterviz/pull/109

## New Contributors

- @ml-evs made their first contribution in https://github.com/janosh/matterviz/pull/100

## [v0.1.5](https://github.com/janosh/matterviz/compare/v0.1.4...v0.1.5)

> 22 July 2025

### 🛠 Enhancements

- Significant speedups of Trajectory and Structure viewers https://github.com/janosh/matterviz/pull/96
- Add `auto-render` setting to VSCode extension https://github.com/janosh/matterviz/pull/97

## [v0.1.4](https://github.com/janosh/matterviz/compare/v0.1.3...v0.1.4)

> 20 July 2025

### 🛠 Enhancements

- Add `ContextMenu.svelte` used on double click in `Composition.svelte` to select chart mode, color palette, export text/JSON/SVG/PNG https://github.com/janosh/matterviz/pull/94
- URL-based data loading in Structure and refactored in Trajectory https://github.com/janosh/matterviz/pull/93

### 🐛 Bug Fixes

- Fix vscode extension build https://github.com/janosh/matterviz/pull/95
- Housekeeping + Fixes https://github.com/janosh/matterviz/pull/92

### 💥 Breaking Changes

- Structure.svelte rename prop `show_buttons` to `show_controls` for consistency with other components [9a2440e0](https://github.com/janosh/matterviz/commit/9a2440e0)

## [v0.1.3](https://github.com/janosh/matterviz/compare/v0.1.2...v0.1.3)

> 9 July 2025

### 🛠 Enhancements

- Add color theme support to MatterViz Web and VSCode https://github.com/janosh/matterviz/pull/86
- `DraggablePane` replaces `ControlPane` used by `StructureControls`, `StructureInfoPane`, `ScatterPlotControls` https://github.com/janosh/matterviz/pull/89
- VSCode extension file-watching: Structure and Trajectory viewers auto-update on file changes https://github.com/janosh/matterviz/pull/91

### 🐛 Bug Fixes

- Add `HistogramControls` using `DraggablePane`, rename `TrajectorySidebar` to `TrajectoryInfoPane` now also using `DraggablePane` https://github.com/janosh/matterviz/pull/90

## [v0.1.2](https://github.com/janosh/matterviz/compare/v0.1.1...v0.1.2)

> 4 July 2025

### 🛠 Enhancements

- Allow toggling between histogram and line plot of properties in Trajectory viewer https://github.com/janosh/matterviz/pull/85
- VSCode extension for rendering structures and trajectories with MatterViz directly in editor tabs https://github.com/janosh/matterviz/pull/82

#### [v0.1.1](https://github.com/janosh/matterviz/compare/v0.1.1...v0.1.2)

> 19 June 2025

### 🛠 Enhancements

- Big speedup of binary trajectory parsing by avoiding data-URI conversion, use ArrayBuffer directly https://github.com/janosh/matterviz/pull/81
- Force vectors https://github.com/janosh/matterviz/pull/80

## [v0.1.0](https://github.com/janosh/matterviz/commits/v0.1.0)

> 19 June 2025

### 🛠 Enhancements

- Add tick labels to ColorBar https://github.com/janosh/matterviz/pull/19
- Add prop `color_scale_range` to `PeriodicTable` https://github.com/janosh/matterviz/pull/20
- `Structure` allow selecting from different element color schemes + override individual elements https://github.com/janosh/matterviz/pull/29
- Structure hide buttons on desktop until hover https://github.com/janosh/matterviz/pull/31
- Structure tooltips when hovering atoms https://github.com/janosh/matterviz/pull/33
- Highlight active and hovered sites in `Structure` https://github.com/janosh/matterviz/pull/34
- Add materials detail pages https://github.com/janosh/matterviz/pull/35
- Add `Bond` component https://github.com/janosh/matterviz/pull/37
- Show cylinder between active and hovered sites https://github.com/janosh/matterviz/pull/40
- Add `Lattice.svelte` https://github.com/janosh/matterviz/pull/41
- Add `SymmetryCard.svelte` https://github.com/janosh/matterviz/pull/42
- Add props and control sliders for ambient and directional lighting to `Structure` https://github.com/janosh/matterviz/pull/45
- Support partial site occupancies by rendering atoms as multiple sphere slices https://github.com/janosh/matterviz/pull/46
- Add `parse_si_float` inverse function to `pretty_num` in `labels.ts` https://github.com/janosh/matterviz/pull/50
- Migrate to Svelte 5 runes syntax https://github.com/janosh/matterviz/pull/55
- `ScatterPlot` support custom x/y tick label spacing and formatting https://github.com/janosh/matterviz/pull/56
- Make `ScatterPlot.svelte` drag-zoomable and add auto-placed `ColorBar` https://github.com/janosh/matterviz/pull/59
- Auto-placed ScatterPlot labels https://github.com/janosh/matterviz/pull/60
- `PlotLegend.svelte` https://github.com/janosh/matterviz/pull/61
- `ScatterPlot` allow custom tween easing and interpolation functions + fix NaNs in interpolated ScatterPoint coords when tweening between linear/log scaled https://github.com/janosh/matterviz/pull/62
- Fix ScatterPlot zoom https://github.com/janosh/matterviz/pull/63
- More element color schemes https://github.com/janosh/matterviz/pull/65
- Add `PeriodicTable` element tile tooltip and more `Structure` UI controls https://github.com/janosh/matterviz/pull/66
- `Lattice` replace wireframe with `EdgesGeometry` cylinders and add PBC distance calculation in `Structure` hover tooltip (prev. direct only) https://github.com/janosh/matterviz/pull/67
- Support dragging `POSCAR` + `(ext)XYZ` files onto the Structure viewer https://github.com/janosh/matterviz/pull/68
- Add drag-and-drop CIF file support to `Structure.svelte` https://github.com/janosh/matterviz/pull/70
- Add new `lib/composition` module with `PieChart`/`BubbleChart`/`BarChart` components for rendering chemical formulae https://github.com/janosh/matterviz/pull/73
- `ElementTile` split support for multi-value `PeriodicTable` heatmaps + more testing https://github.com/janosh/matterviz/pull/74
- Add `Trajectory` sidebar, full-screen toggle, and plot/structure/plot+structure display mode buttons https://github.com/janosh/matterviz/pull/77
- `phonopy.yaml` support https://github.com/janosh/matterviz/pull/79

### 🐛 Bug Fixes

- Structure grid example https://github.com/janosh/matterviz/pull/30
- Fix structure controls for `atom_radius`, `same_size_atoms` https://github.com/janosh/matterviz/pull/38
- `Structure` fixes https://github.com/janosh/matterviz/pull/64
- Color bonds as linear gradient between connected element colors, fix `ElementTile` not using user-set `text_color` https://github.com/janosh/matterviz/pull/71

### 🏥 Package Health

- Split `/src/lib` into submodules https://github.com/janosh/matterviz/pull/36
- Swap `node` for `deno` https://github.com/janosh/matterviz/pull/76
- Rename package from `elementari` to `matterviz` https://github.com/janosh/matterviz/pull/78

### 🤷‍♂️ Other Changes

- Add fill area below elemental periodicity line plot https://github.com/janosh/matterviz/pull/4
- Bohr Atoms https://github.com/janosh/matterviz/pull/6
- Fix build after update to `vite` v3 https://github.com/janosh/matterviz/pull/7
- SvelteKit auto migration https://github.com/janosh/matterviz/pull/8
- Update scatter tooltip when hovering element tiles https://github.com/janosh/matterviz/pull/9
- Migrate to PNPM https://github.com/janosh/matterviz/pull/12
- Convert src/lib/element-data.{ts -> yml} https://github.com/janosh/matterviz/pull/13
- Heatmap unit test https://github.com/janosh/matterviz/pull/14
- Deploy site to GitHub Pages https://github.com/janosh/matterviz/pull/15
- AVIF element images https://github.com/janosh/matterviz/pull/18
- Add unit tests for `ColorBar.svelte` https://github.com/janosh/matterviz/pull/21
- DRY workflows and ColorBar snap tick labels to nice values https://github.com/janosh/matterviz/pull/22
- Rename ColorBar props https://github.com/janosh/matterviz/pull/27
- Initial support for rendering interactive 3d structures https://github.com/janosh/matterviz/pull/28
- Get started with testing `Structure.svelte` and `structure.ts` https://github.com/janosh/matterviz/pull/32
- Fix and speedup `max_dist` and `nearest_neighbor` bonding algorithms https://github.com/janosh/matterviz/pull/48
- Couple new unit tests https://github.com/janosh/matterviz/pull/52
- Add `color_scale_type`, `color_scheme`, `color_range` props to `ScatterPlot` for coloring points by numeric values https://github.com/janosh/matterviz/pull/58
- `Trajectory` viewer https://github.com/janosh/matterviz/pull/75
