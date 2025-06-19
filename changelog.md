# Changelog

#### [v0.1.0](https://github.com/janosh/matterviz/compare/v0.1.0...v0.1.0)

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

**Full Changelog**: https://github.com/janosh/matterviz/commits/v0.1.0
