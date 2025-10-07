# Changelog

## [v0.1.11](https://github.com/janosh/matterviz/compare/v0.1.9...v0.1.11)

> 6 October 2025

### 🛠 Enhancements

- Structure from string by @janosh in https://github.com/janosh/matterviz/pull/150
- 2/3/4D Phase diagrams by @janosh in https://github.com/janosh/matterviz/pull/152
- `XrdPlot.svelte` powered by new `BarPlot.svelte` by @janosh in https://github.com/janosh/matterviz/pull/153
- `ScatterPlot`/`Histogram` support one-sided pin on `x`/`y` range by @janosh in https://github.com/janosh/matterviz/pull/154
- Support on-the-fly 4D energy above hull calculation by @janosh in https://github.com/janosh/matterviz/pull/155
- Enhance interactivity in plotting components by @janosh in https://github.com/janosh/matterviz/pull/157
- Tweaks and tests by @janosh in https://github.com/janosh/matterviz/pull/159
- Add `grouped` mode to `BarPlot` + interactivity improvements by @janosh in https://github.com/janosh/matterviz/pull/162
- Add WebM video export to `Trajectory` by @janosh in https://github.com/janosh/matterviz/pull/163

### 🐛 Bug Fixes

- Fix angle calculation in `Structure` measure mode by @janosh in https://github.com/janosh/matterviz/pull/160

### 📖 Documentation

- Site reorg by @janosh in https://github.com/janosh/matterviz/pull/161

## [v0.1.9](https://github.com/janosh/matterviz/compare/v0.1.8...v0.1.9)

> 5 September 2025

### 🛠 Enhancements

- Interactive symmetry analysis powered by `moyo` WASM bindings by @janosh in https://github.com/janosh/matterviz/pull/140
- Wyckoff table by @janosh in https://github.com/janosh/matterviz/pull/141
- `Structure` rotation controls by @janosh in https://github.com/janosh/matterviz/pull/144

### 🐛 Bug Fixes

- Fix missing Structure/Trajectory pane scroll in `overflow: hidden` containers by @janosh in https://github.com/janosh/matterviz/pull/142

## [v0.1.8](https://github.com/janosh/matterviz/compare/v0.1.7...v0.1.8)

> 17 August 2025

### 🛠 Enhancements

- Measure distances and angles between selected `Structure` sites by @janosh in https://github.com/janosh/matterviz/pull/137
- Optimade page 3-column layout (providers, suggestions, structure) by @janosh in https://github.com/janosh/matterviz/pull/126

### 🐛 Bug Fixes

- Fix parsing `mof-issue-127.cif` by @janosh in https://github.com/janosh/matterviz/pull/128
- Disable `Structure`/`Trajectory` fullscreen buttons in non-browser contexts by @janosh in https://github.com/janosh/matterviz/pull/133
- Set VSCode preferred extension location by @janosh in https://github.com/janosh/matterviz/pull/136

## [v0.1.7](https://github.com/janosh/matterviz/compare/v0.1.6...v0.1.7)

> 11 August 2025

### 🛠 Enhancements

- Settings reset buttons by @janosh in https://github.com/janosh/matterviz/pull/116
- Supercells by @janosh in https://github.com/janosh/matterviz/pull/117

### 🐛 Bug Fixes

- Fix large trajectory loading in VSCode extension by @janosh in https://github.com/janosh/matterviz/pull/115
- Move structure IO by @janosh in https://github.com/janosh/matterviz/pull/123
- Change default camera projection to orthographic by @janosh in https://github.com/janosh/matterviz/pull/124
- Fix `supported_resource` context for keyboard shortcut `when` in VSCode extension by @janosh in https://github.com/janosh/matterviz/pull/125

### 🧪 Tests

- Improve unit tests by @janosh in https://github.com/janosh/matterviz/pull/118

## [v0.1.6](https://github.com/janosh/matterviz/compare/v0.1.5...v0.1.6)

> 28 July 2025

### 🛠 Enhancements

- More `Histogram.svelte` features (near parity with `ScatterPlot.svelte`) by @janosh in https://github.com/janosh/matterviz/pull/101
- Add parsing routines for single OPTIMADE JSON by @ml-evs in https://github.com/janosh/matterviz/pull/100
- Add camera projection selector to `StructureControls.svelte`: perspective (default) or orthographic by @janosh in https://github.com/janosh/matterviz/pull/105
- StructureControls.svelte add CIF and POSCAR file export and clipboard copy buttons by @janosh in https://github.com/janosh/matterviz/pull/110
- Customize site labels (size, color, padding, bg color, offset) via `StructureControls.svelte` by @janosh in https://github.com/janosh/matterviz/pull/111
- Streaming trajectory loader and parser to support large MD files by @janosh in https://github.com/janosh/matterviz/pull/112
- Add lots of VSCode extension settings for customizing default appearance by @janosh in https://github.com/janosh/matterviz/pull/114

### 🐛 Bug Fixes

- Fix VSCode PNG export by @janosh in https://github.com/janosh/matterviz/pull/103
- Fix Matterviz auto-render triggering on unsupported files by @janosh in https://github.com/janosh/matterviz/pull/108
- Fix CIF parsing of TiO2 (mp-2657) by @janosh in https://github.com/janosh/matterviz/pull/109

## New Contributors

- @ml-evs made their first contribution in https://github.com/janosh/matterviz/pull/100

## [v0.1.5](https://github.com/janosh/matterviz/compare/v0.1.4...v0.1.5)

> 22 July 2025

### 🛠 Enhancements

- Significant speedups of Trajectory and Structure viewers by @janosh in https://github.com/janosh/matterviz/pull/96
- Add `auto-render` setting to VSCode extension by @janosh in https://github.com/janosh/matterviz/pull/97

## [v0.1.4](https://github.com/janosh/matterviz/compare/v0.1.3...v0.1.4)

> 20 July 2025

### 🛠 Enhancements

- Add `ContextMenu.svelte` used on double click in `Composition.svelte` to select chart mode, color palette, export text/JSON/SVG/PNG by @janosh in https://github.com/janosh/matterviz/pull/94
- URL-based data loading in Structure and refactored in Trajectory by @janosh in https://github.com/janosh/matterviz/pull/93

### 🐛 Bug Fixes

- Fix vscode extension build by @janosh in https://github.com/janosh/matterviz/pull/95
- Housekeeping + Fixes by @janosh in https://github.com/janosh/matterviz/pull/92

### 💥 Breaking Changes

- Structure.svelte rename prop `show_buttons` to `show_controls` for consistency with other components by @janosh

## [v0.1.3](https://github.com/janosh/matterviz/compare/v0.1.2...v0.1.3)

> 9 July 2025

### 🛠 Enhancements

- Add color theme support to MatterViz Web and VSCode by @janosh in https://github.com/janosh/matterviz/pull/86
- `DraggablePane` replaces `ControlPane` used by `StructureControls`, `StructureInfoPane`, `ScatterPlotControls` by @janosh in https://github.com/janosh/matterviz/pull/89
- VSCode extension file-watching: Structure and Trajectory viewers auto-update on file changes by @janosh in https://github.com/janosh/matterviz/pull/91

### 🐛 Bug Fixes

- Add `HistogramControls` using `DraggablePane`, rename `TrajectorySidebar` to `TrajectoryInfoPane` now also using `DraggablePane` by @janosh in https://github.com/janosh/matterviz/pull/90

## [v0.1.2](https://github.com/janosh/matterviz/compare/v0.1.1...v0.1.2)

> 4 July 2025

### 🛠 Enhancements

- Allow toggling between histogram and line plot of properties in Trajectory viewer by @janosh in https://github.com/janosh/matterviz/pull/85
- VSCode extension for rendering structures and trajectories with MatterViz directly in editor tabs by @janosh in https://github.com/janosh/matterviz/pull/82

#### [v0.1.1](https://github.com/janosh/matterviz/compare/v0.1.1...v0.1.2)

> 19 June 2025

### 🛠 Enhancements

- Big speedup of binary trajectory parsing by avoiding data-URI conversion, use ArrayBuffer directly by @janosh in https://github.com/janosh/matterviz/pull/81
- Force vectors by @janosh in https://github.com/janosh/matterviz/pull/80

## [v0.1.0](https://github.com/janosh/matterviz/commits/v0.1.0)

> 19 June 2025

### 🛠 Enhancements

- Add tick labels to ColorBar by @janosh in https://github.com/janosh/matterviz/pull/19
- Add prop `color_scale_range` to `PeriodicTable` by @janosh in https://github.com/janosh/matterviz/pull/20
- `Structure` allow selecting from different element color schemes + override individual elements by @janosh in https://github.com/janosh/matterviz/pull/29
- Structure hide buttons on desktop until hover by @janosh in https://github.com/janosh/matterviz/pull/31
- Structure tooltips when hovering atoms by @janosh in https://github.com/janosh/matterviz/pull/33
- Highlight active and hovered sites in `Structure` by @janosh in https://github.com/janosh/matterviz/pull/34
- Add materials detail pages by @janosh in https://github.com/janosh/matterviz/pull/35
- Add `Bond` component by @janosh in https://github.com/janosh/matterviz/pull/37
- Show cylinder between active and hovered sites by @janosh in https://github.com/janosh/matterviz/pull/40
- Add `Lattice.svelte` by @janosh in https://github.com/janosh/matterviz/pull/41
- Add `SymmetryCard.svelte` by @janosh in https://github.com/janosh/matterviz/pull/42
- Add props and control sliders for ambient and directional lighting to `Structure` by @janosh in https://github.com/janosh/matterviz/pull/45
- Support partial site occupancies by rendering atoms as multiple sphere slices by @janosh in https://github.com/janosh/matterviz/pull/46
- Add `parse_si_float` inverse function to `pretty_num` in `labels.ts` by @janosh in https://github.com/janosh/matterviz/pull/50
- Migrate to Svelte 5 runes syntax by @janosh in https://github.com/janosh/matterviz/pull/55
- `ScatterPlot` support custom x/y tick label spacing and formatting by @janosh in https://github.com/janosh/matterviz/pull/56
- Make `ScatterPlot.svelte` drag-zoomable and add auto-placed `ColorBar` by @janosh in https://github.com/janosh/matterviz/pull/59
- Auto-placed ScatterPlot labels by @janosh in https://github.com/janosh/matterviz/pull/60
- `PlotLegend.svelte` by @janosh in https://github.com/janosh/matterviz/pull/61
- `ScatterPlot` allow custom tween easing and interpolation functions + fix NaNs in interpolated ScatterPoint coords when tweening between linear/log scaled by @janosh in https://github.com/janosh/matterviz/pull/62
- Fix ScatterPlot zoom by @janosh in https://github.com/janosh/matterviz/pull/63
- More element color schemes by @janosh in https://github.com/janosh/matterviz/pull/65
- Add `PeriodicTable` element tile tooltip and more `Structure` UI controls by @janosh in https://github.com/janosh/matterviz/pull/66
- `Lattice` replace wireframe with `EdgesGeometry` cylinders and add PBC distance calculation in `Structure` hover tooltip (prev. direct only) by @janosh in https://github.com/janosh/matterviz/pull/67
- Support dragging `POSCAR` + `(ext)XYZ` files onto the Structure viewer by @janosh in https://github.com/janosh/matterviz/pull/68
- Add drag-and-drop CIF file support to `Structure.svelte` by @janosh in https://github.com/janosh/matterviz/pull/70
- Add new `lib/composition` module with `PieChart`/`BubbleChart`/`BarChart` components for rendering chemical formulae by @janosh in https://github.com/janosh/matterviz/pull/73
- `ElementTile` split support for multi-value `PeriodicTable` heatmaps + more testing by @janosh in https://github.com/janosh/matterviz/pull/74
- Add `Trajectory` sidebar, full-screen toggle, and plot/structure/plot+structure display mode buttons by @janosh in https://github.com/janosh/matterviz/pull/77
- `phonopy.yaml` support by @janosh in https://github.com/janosh/matterviz/pull/79

### 🐛 Bug Fixes

- Structure grid example by @janosh in https://github.com/janosh/matterviz/pull/30
- Fix structure controls for `atom_radius`, `same_size_atoms` by @janosh in https://github.com/janosh/matterviz/pull/38
- `Structure` fixes by @janosh in https://github.com/janosh/matterviz/pull/64
- Color bonds as linear gradient between connected element colors, fix `ElementTile` not using user-set `text_color` by @janosh in https://github.com/janosh/matterviz/pull/71

### 🏥 Package Health

- Split `/src/lib` into submodules by @janosh in https://github.com/janosh/matterviz/pull/36
- Swap `node` for `deno` by @janosh in https://github.com/janosh/matterviz/pull/76
- Rename package from `elementari` to `matterviz` by @janosh in https://github.com/janosh/matterviz/pull/78

### 🤷‍♂️ Other Changes

- Add fill area below elemental periodicity line plot by @janosh in https://github.com/janosh/matterviz/pull/4
- Bohr Atoms by @janosh in https://github.com/janosh/matterviz/pull/6
- Fix build after update to `vite` v3 by @janosh in https://github.com/janosh/matterviz/pull/7
- SvelteKit auto migration by @janosh in https://github.com/janosh/matterviz/pull/8
- Update scatter tooltip when hovering element tiles by @janosh in https://github.com/janosh/matterviz/pull/9
- Migrate to PNPM by @janosh in https://github.com/janosh/matterviz/pull/12
- Convert src/lib/element-data.{ts -> yml} by @janosh in https://github.com/janosh/matterviz/pull/13
- Heatmap unit test by @janosh in https://github.com/janosh/matterviz/pull/14
- Deploy site to GitHub Pages by @janosh in https://github.com/janosh/matterviz/pull/15
- AVIF element images by @janosh in https://github.com/janosh/matterviz/pull/18
- Add unit tests for `ColorBar.svelte` by @janosh in https://github.com/janosh/matterviz/pull/21
- DRY workflows and ColorBar snap tick labels to nice values by @janosh in https://github.com/janosh/matterviz/pull/22
- Rename ColorBar props by @janosh in https://github.com/janosh/matterviz/pull/27
- Initial support for rendering interactive 3d structures by @janosh in https://github.com/janosh/matterviz/pull/28
- Get started with testing `Structure.svelte` and `structure.ts` by @janosh in https://github.com/janosh/matterviz/pull/32
- Fix and speedup `max_dist` and `nearest_neighbor` bonding algorithms by @janosh in https://github.com/janosh/matterviz/pull/48
- Couple new unit tests by @janosh in https://github.com/janosh/matterviz/pull/52
- Add `color_scale_type`, `color_scheme`, `color_range` props to `ScatterPlot` for coloring points by numeric values by @janosh in https://github.com/janosh/matterviz/pull/58
- `Trajectory` viewer by @janosh in https://github.com/janosh/matterviz/pull/75
