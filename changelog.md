# Changelog

## [v0.6.0](https://github.com/janosh/matterviz/compare/v0.5.0...v0.6.0)

> 23 August 2026

### Migration to 0.6

- Callback props are `on_<event>` on every component: `onchange`/`ontoggle`/`onclose`/`onselect`/… → `on_change`/`on_toggle`/`on_close`/`on_select`; `HeatmapTable.onrowclick/onrowdblclick` → `on_row_click`/`on_row_double_click`; `HeatmapMatrix.onclick/ondblclick/oncontextmenu/onbrush` → `on_click/on_double_click/on_context_menu/on_brush`. The old spelling still type-checks (as an HTML attribute) and lands on the root element as an inert DOM listener, so nothing warns: grep your code for `on[a-z]+=\{` on matterviz components
- Structure parsing: `parse_any_structure` → `parse_structure_file`; parsers return `Crystal`/`Molecule` instead of `ParsedStructure`
- Symmetry: `spacegroup_num_to_crystal_sys` → `spacegroup_to_crystal_sys`, which returns `CrystalSystem | null`
- `HeatmapMatrix`: `show_legend`/`legend_position`/`legend_label`/`legend_format` → `show_color_bar`/`color_bar_position`/`color_bar_label`/`color_bar_format` (`LegendPosition` → `ColorBarPosition`); same rename on the pymatviz `HeatmapMatrixWidget`
- Frequency units: `cm^-1` is the one spelling of the `FrequencyUnit` (`spectral/frequency-units.ts`); `cm-1`/`cm⁻¹` in input data are still accepted by `parse_frequency_unit`
- `Histogram`: `series` is `HistogramSeries[]` with `{ values: number[], label?, color?, … }` instead of `DataSeries[]` with a dummy `x`; the legacy `{ x, y, line_style }` entries still bind (`y` is read as the samples)
- `Structure`: `isosurface_settings` is layers-only (`{ layers: [{ isovalue, color, … }], wireframe, halo, display_range? }`, no top-level `iso_value`); `lattice_props` folds into `scene_props`; `controls_open`/`info_pane_open` → one bindable `active_pane`
- Trajectory: `<Trajectory data_url>` → `<TrajectoryFileViewer src>`; `parse_trajectory_data`/`parse_trajectory_async` → `open_trajectory`; the per-pane `*_open` booleans → `active_pane`
- `format_relative_time`/`format_duration` and the `matterviz/time` subpath are removed: vendor the function (matbench-discovery did)
- Downstream: pymatviz widgets need the pymatviz release that includes [pymatviz#358](https://github.com/janosh/pymatviz/pull/358) (`MATTERVIZ_ANYWIDGET_VERSION = "0.6.0"`; pymatviz ≤ 0.18.0 targets the 0.5.0 bundle), i.e. `matterviz-anywidget@0.6.0` on npm/jsDelivr; matbench-discovery updates `site/src/lib/table/MetricsTable.svelte` (`HeatmapTable onrowdblclick` → `on_row_double_click`) and `site/src/lib/plot/EnergyParityPlot.svelte` (`StructurePopup onclose` → `on_close`) and vendors `format_relative_time`

### ⚠️ Breaking Changes

- Callback props are `on_<event>` everywhere (≈450 sites): `onchange`/`ontoggle`/`onclose`/`onclear`/`onparse`/`onselect`/`oncopy`/`onexport`/`onremove`/`onrender`/`onactivate`/`ondata` → `on_change`/…; `HeatmapTable.onrowclick/onrowdblclick` → `on_row_click`/`on_row_double_click`; `HeatmapMatrix` `onclick/ondblclick/oncontextmenu/onbrush` → `on_click/on_double_click/on_context_menu/on_brush` and `show_legend/legend_position/legend_label/legend_format` → `show_color_bar/color_bar_position/color_bar_label/color_bar_format` (`LegendPosition` → `ColorBarPosition`); `FlyToHooks`/`Gizmo` `onstart/onend` → `on_start/on_end`, `build_orbit_props` `onstart_extra/onend_extra` → `on_start_extra/on_end_extra`; `ScatterPlot.on_pointer_leave` is removed (`on_point_hover(null)`); `FermiSurface.on_mu_change` and `FermiSurfaceControls.on_interpolation_change` are removed (bind `mu`/`interpolation_factor`); `Histogram.on_bar_hover/on_bar_click` receive `HistogramHandlerProps & { event }` like `BarPlot`; `Structure.on_bonds_change`/`on_display_mode_change`/`on_active_volume_idx_change`/`on_slice_settings_change`, `StructureControls.on_slice_settings_change`, `VolumeSliceControls.on_settings_change`, `ToggleMenu.on_reset` (`on_toggle` already reports every column a reset changes) and `ScatterPlot3D.on_series_visibility_change` are removed (bind the prop instead) https://github.com/janosh/matterviz/pull/438 https://github.com/janosh/matterviz/pull/439
- `Structure`: one bindable `active_pane: 'controls' | 'info' | 'export' | null` replaces `controls_open`/`info_pane_open`; `multi_view_active`, `multi_view_min_pane_width/height`, `multi_view_gap` (fixed 300×200 px panes, 2 px gap), `reset_text`, `hovered`, `spinner_props`, `bottom_left`, `trajectory_lines_result`, `element_mapping`, `element_radius_overrides`, `site_radius_overrides` and `hidden_prop_vals` are removed; `lattice_props` folds into `scene_props` (`Structure`, `StructureScene`, viewer state, anywidget); `StructureViewport` takes a `session` instead of per-pane selection/edit bindings and, like `StructureScene`, loses the `on_isosurface_error` pass-through (`Structure` registers its handler via Svelte context, `set_isosurface_error_handler`/`get_isosurface_error_handler` in `isosurface/context.ts`, and `Isosurface` falls back to it when mounted without `on_error`); `StructureScene` takes `property_colors` from the session instead of `atom_color_config`/`sym_data` and its `hovered_site` is no longer bindable; `StructureInfoPane` takes `wyckoff_positions`; `sym_data` props are typed `SymmetryDataset`; unused props are dropped from `AtomLegend` (`get_element_label`, `amount_format`, `show_amounts`, `elem_color_picker_title`, `title`), `Lattice` (`vector_colors`, `vector_origin`, `float_fmt`), `CellSelect` (`align`) and `StructureHandlerData`; `StructureSession`'s pipeline deriveds (`structure_with_bonds`, `supercell_factors`, `has_scaled_cell`, `supercell_job`, `supercell_is_large`, `async_supercell`, `supercell`, `displayed_site_count`, `topology_signature`, `edited_bonds`, `to_base_site_idx`) and `last_edited_structure` are private or gone https://github.com/janosh/matterviz/pull/439
- `Structure`/`BrillouinZone`/`FermiSurface` share one loader (`scene/viewer-loader.svelte.ts`): `create_viewer_loader<Value, Parsed = Value>` takes `parse(content, filename, metadata)` (run untracked, so it may read the viewer's current state) plus `commit(value, filename, metadata, file_size)` and `report_error`; `ViewerParseContext`, `structure/loader.svelte.ts` (`create_structure_loader`, `StructureLoaderInputs`) are gone and `Structure` volumetric merges go through `structure/loader.ts`'s `open_structure_text`. Error wording is the loader's: a `data_url` transport failure reports the fetch error as-is (`Failed to fetch <url>: HTTP 404`, was `Failed to load structure: …`), a host `on_file_drop` failure reports the handler's own message (`on_error` carries `source_filename`/`source_url`), an unparsable `structure_string` reports `Failed to parse string: …`, an unparsable `data_url` payload `Failed to parse <filename>: …`, a throwing `on_file_load` `on_file_load failed for <filename>: …`; `structure_string` parsing sets `loading`; dropped files fail through the drop zone's per-batch report (`Failed to load N files — a.cif: …; b.cube: …`) in every viewer. `BrillouinZone.bz_data` is a plain input (no longer `$bindable`): a supplied zone wins over the one derived from `structure` and is never written back; the rendered zone is available through `children`, `on_file_load` and `on_fullscreen_change`
- Settings: `matterviz.{histogram,bar,box,scatter}.display.*` and `matterviz.plot.show_{x,y}_zero_line` → one `matterviz.plot.display.*` group; `matterviz.structure.show_gizmo` → `matterviz.structure.gizmo: boolean | GizmoOptions`; `trajectory.bin_file_threshold`/`trajectory.text_file_threshold`/`trajectory.use_indexing` → one `trajectory.index_above_bytes` (VS Code `matterviz.trajectory.index_above_bytes`, default 25 MB); `composition.{display_mode,color_scheme}`, `plot.{x,y}_scale_type` and `matterviz.trajectory.show_parsing_progress` (generated into the VS Code configuration but never read) are removed; `DEFAULTS.plot.{x,x2,y,y2}_format`, `DEFAULTS.plot.{x,y}_ticks`, `DEFAULTS.plot.grid_lines/axis_labels` and `PlotControls.show_ticks` are removed (the pane always shows a Ticks section whose inputs edit the live `x_axis.ticks`/`y_axis.ticks` override, leave explicit tick lists alone and reset to the mount-time value, like Tick format) https://github.com/janosh/matterviz/pull/438 https://github.com/janosh/matterviz/pull/439
- Structure parsing: `parse_any_structure` → `parse_structure_file`, parsers return `Crystal`/`Molecule` instead of `ParsedStructure`, `CellType` → `PhonopyCellType`; `ensure_lattice_params`, `drop_json_pbc`, `parse_optimade_json`, `is_optimade_json`, `BondPair.strength` and the `serialize.ts` facade (import from `matterviz/structure/export`) are removed; `optimade_to_structure` + `optimade_structure_from_raw` replace `build_optimade_sites`/`parse_optimade_from_raw`/`optimade_to_crystal`; `parse_cif(content)`, `parse_phonopy_yaml(content)` and `find_image_atoms(structure)` lose their test-only parameters; `export_structure_as` throws without a structure; truncated CHGCAR/`.cube` files throw instead of rendering zero-padded volumes (`looks_like_volumetric` is the cheap probe); LAMMPS dumps without an element column still read unmapped type N as atomic number N (ASE's default) but emit one warning per file listing the guesses (pass `atom_type_mapping`) https://github.com/janosh/matterviz/pull/438 https://github.com/janosh/matterviz/pull/439
- Composition: `FormulaToken` → `FormulaSpecies`, `normalize_composition`/`sanitize_composition_keys` → `parse_composition`, which throws on unknown symbols and non-numeric amounts; `ATOMIC_NUMBER_TO_SYMBOL`, `SYMBOL_TO_ATOMIC_NUMBER`, `ATOMIC_WEIGHTS`, `ELEM_NAME_TO_SYMBOL`, `ELEM_SYMBOL_TO_NAME` and the wildcard chemsys helpers are removed (use `element_by_symbol`/`ELEM_SYMBOLS`); formula markup helpers (`tokenize_formula_markup`, `format_formula_html/svg`) live in `composition/format.ts` https://github.com/janosh/matterviz/pull/438
- Neighbor search, coordination and bond angles: `neighbor_query` is the only PBC neighbour primitive; `electroneg_ratio` bonds a site list as the finite set of atoms it is unless `pbc` is passed, in which case bonds cross cell boundaries and carry `cell_shift` with `pos_2` at the image (`BondPair.cell_shift` is set on computed bonds too); `calc_coordination_nums(structure, { strategy, pbc })` and `compute_bond_angles` → `calc_bond_angles(structure, options)` bond across the lattice's `pbc` by default (pass `pbc: [false, false, false]` for the finite box), so a site's own periodic images count as neighbours and `BondAngleTriplet.neighbor_idxs` name the partner site rather than an image's original; `CoordinationData` is `{ coordination_nums, cn_histogram, cn_histogram_by_element }` (per-site `sites`/`neighbor_elements`/`cn_by_element` removed); `BondAngleTriplet.center_element`, `BondAngleSeries.density`, `StructureIdResult.cutoff`, `electroneg_ratio`'s `center_count`, `expand_structure_for_pbc`, `calc_structure_coordination`, `BondAngleOptions.auto_expand`, `RdfOptions.auto_expand` and `RdfPlot.dragover` are removed; `compute_structure_id_async` → `calc_structure_id_async`; `SPLIT_MODES`/`SplitMode` → `BOND_ANGLE_SPLIT_MODES`/`COORDINATION_SPLIT_MODES`, `NORMALIZE_MODES` → `BOND_ANGLE_NORMALIZE_MODES`, `DEFAULT_BIN_WIDTH` → `BOND_ANGLE_DEFAULT_BIN_WIDTH` https://github.com/janosh/matterviz/pull/438 https://github.com/janosh/matterviz/pull/439
- Symmetry: `get_conventional_cell`/`get_primitive_cell` → `transform_cell`; `spacegroup_num_to_crystal_sys` → `spacegroup_to_crystal_sys` (returns `CrystalSystem | null`); `BRAVAIS_LATTICES`, `to_cell_json`, `orig_site_indices_by_std_idx`, `simplicity_score` and `structure-id/neighbors.ts` are removed; `normalize_spacegroup` rejects non-integers https://github.com/janosh/matterviz/pull/438
- Convex hull: `compute_lower_hull_nd(points)` + `compute_e_above_hull_nd(queries, facets, points)` replace `compute_lower_hull_2d`, `compute_quickhull_triangles`, `compute_lower_hull_triangles`, `compute_e_above_hull_for_points`, `compute_quickhull_4d`, `compute_lower_hull_4d`, `compute_e_above_hull_4d`, `compute_quickhull_nd` and `HullFaceModel`; synthetic element corners are stable entries with `e_above_hull` 0; `ConvexHull3D`/`ConvexHull4D` merge into `ConvexHullCanvas dim={3|4}`; `ConvexHullConfig` drops `width/height/margin/unstable_threshold/point_size/line_width` and the unused colour keys; `normalize_hull_composition_keys` throws on compound-like keys (pymatgen species suffixes `Fe2+,spin=5`/`Fe2.5+` and the isotopes `D`/`T` → `H` are accepted, `DummySpecies` `X…` keys are skipped with a warning); an `entries` prop whose element count doesn't match the component's arity (a ternary dataset on `ConvexHull2D`, 1 or 5+ elements on `ConvexHull`) renders the "Invalid convex hull data" empty state with the message instead of a blank plot plus `console.error` https://github.com/janosh/matterviz/pull/438
- `ChemPotDiagram`: `ChemPotDiagramData` is `{ domains, elements, lims }` (`build_chempot_hyperplanes` exposes the intermediates, `chebyshev_centre` the interior point); `safe_energy_per_atom` applies the Materials Project `correction` (eV, total) like `ConvexHull`'s `get_energy_per_atom`, so `ComputedEntry.as_dict()` input with a non-zero `correction` shifts every hyperplane, domain vertex and axis limit by `correction / n_atoms` eV/atom relative to v0.5 (pass entries without `correction`, or with `energy` already corrected and `correction: 0`, to keep the old numbers); the interior point seeding the domain intersection is the Chebyshev centre (exact LP) instead of a centre-of-box heuristic, so asymmetric per-element `limits` such as `{ A: [-1, 0] }` next to `default_min_limit: -100` no longer throw "Chemical potential region is empty" for a non-empty region
- Isosurface/Fermi: `VolumetricData.{grid,grid_dims,data_order}` → flat `values`/`dims` (`ScalarGrid3D<Float64Array>`; `volume_from_json` accepts both shapes), `BandGridData.energies` is `ScalarGrid3D[][]` and `BandGridData.grid_shift` carries the FRMSF `lshift`; `IsosurfaceSettings` is layers-only (`{ layers, wireframe, halo, display_range? }`; `auto_isosurface_settings(volume)`, `materialize_layers` → `pin_layers`, `isovalue` replaces every `iso_value`); `Isosurface` type → `FermiIsosurface`, stored as typed arrays `positions/indices/normals/properties`; `ColorProperty` is `'band' | 'spin' | 'property'` (`property` replaces `velocity` and `custom`; a saved VS Code `matterviz.fermi.color_property` of `velocity`/`custom` falls back to band colouring); `marching_cubes` drops `interpolate`, `centered`, nested `number[][][]` input and `marching_cubes_buffers`; the unused Fermi analysis pipeline (`compute_surface_area`, `compute_fermi_velocities`, `analyze_surface_topology`, `velocities`/`dimensionality`/`area` fields, `compute_velocities`/`selected_bands`/`wigner_seitz` options) is removed; `geometry.worker.ts`/`geometry-worker-types.ts` → `geometry.ts`/`geometry-worker.ts`/`async-geometry.svelte.ts`; `compute_irreducible_bz` throws on a degenerate clip instead of skipping the plane https://github.com/janosh/matterviz/pull/438
- Phase diagrams: `parse_tdb` returns `{ data, binary_system?, temperature_range }` or throws instead of a success/error record, and the TDB parser plus `TdbInfoPanel` move out of the library into `src/site/phase-diagrams/`; `phase-diagram/colors.ts`/`DIAGRAM_COLORS` are removed, so diagram JSON `"color"` values that named a palette key (`liquid`, `fcc_a1`, `two_phase`, …) must be raw CSS colours (`"rgba(135, 206, 250, 0.6)"`; the bundled data files were converted); the MPDS SVG import branch is removed and an SVG without matplotlib `xtick_N` groups or class-based tick text throws `could not find x-axis tick marks in this SVG`; `constrain_tooltip_position` is removed from `plot/core/layout.ts` https://github.com/janosh/matterviz/pull/438
- Spectral: pymatgen-format band structures (`@class`/`@module` markers or bare `qpoints`/`kpoints`) require the reciprocal lattice as `lattice_rec.matrix` (pymatgen `as_dict()`) or `recip_lattice.matrix` (phonopy/atomate2 dumps) and throw naming the missing key; k-path distances are Cartesian reciprocal-space lengths `|Mᵀ·Δq|` like pymatgen/phonopy (the fractional-coordinate metric distorted non-cubic paths by up to 4.2× between segments on the hexagonal H2 fixture and 2× on FCC); inferred branches split at every labeled q-point as well as at path jumps; `BaseBandStructure.recip_lattice`, `PhononModeData.reciprocal_lattice`, the site-only `transform_band_structure` duplicate (`$site/phonons` uses `normalize_band_structure`) and the unused `Bands` props `show_path_mode_control`, `show_units_control`, `show_spin_control`, `show_annotation_controls` are removed; one `FrequencyUnit` (`THz | eV | meV | cm^-1 | Ha`, `cm^-1` the only spelling) with `convert_frequencies`/`frequency_unit_label`/`parse_frequency_unit` in `spectral/frequency-units.ts` replaces `vacf/units.ts` and the three converters (`MD_FREQUENCY_UNITS` = `THz | cm^-1`; VACF adds `1/frame`, trajectory spectroscopy `1/step`); XRD parsers throw on malformed input instead of falling back to `start=0`/`step=0.02`, return raw counts (decimation to 1000 points happens in `XrdPlot` via `decimate_pattern`) and `XrdOptions.symprec` is removed; `lineshape.ts` rejects `shape_factor` outside `[0, 1]` https://github.com/janosh/matterviz/pull/438
- Tables: `HeatmapTable` drops `onsort`, `sort_data`, `virtual_columns`, `controls_target`, `row_title`, `tri_state_sort`, `footer`, `fixed_header`, `empty_message` and the legacy `key (group)` column-id migration; `HeatmapMatrix` drops `theme`, `animate_updates`, `show_gridlines`, `sticky_*`, `highlight_*`, `value_transform`, `quantile_clip`, `legend_ticks` and renames `NormalizeMode` → `HeatmapNormalizeMode`; `ToggleMenu` drops `n_columns` (the menu caps itself at three columns) https://github.com/janosh/matterviz/pull/438 https://github.com/janosh/matterviz/pull/439
- `Histogram` takes `HistogramSeries[]` (`{ values: number[], label?, color?, id?, visible?, legend_group?, x_axis?, y_axis? }`, `values` required) instead of `DataSeries[]` with a dummy `x`; the `series` prop accepts `HistogramSeriesInput = HistogramSeries | LegacyHistogramSeries` and normalises each entry via `to_histogram_series(input)` (legacy `{ x, y, line_style }`: `y` is the samples, `x` is dropped, `line_style.stroke` is the colour when `color` is unset; a sample-less legacy entry yields `values: []` and renders nothing); legend toggles write the bound `series` back in the caller's own shape; `histogram_samples` and `histogram_series_color` are removed
- One series palette: `PLOT_COLORS`/`plot_color(idx)` (`matterviz/colors`) hold the Tableau-10 hues `ScatterPlot` used and `DEFAULT_SERIES_COLORS`/`get_series_color` are removed; `RdfPlot`, `PdfPlot`, `XrdPlot`, `Bands`, `Dos`, `MsdPlot`, `VacfPlot`, `NebPlot`, `CoordinationBarPlot`, bond-angle series, trajectory plot panes and hull facets switch from the pastel `#63b3ed, #68d391, …` set to `#4e79a7, #f28e2c, #e15759, …`, and unstyled multi-series `Histogram`s cycle it too (previously every unstyled series took `DEFAULTS.scatter.point.color`), so a given series index renders the same colour in every plot
- Plots: `BarPlot.point_tween` and `BarStyle.rx/ry`, `BoxPlot.kde_{points,cut,max_samples}`, `ScatterPlot3D.series_visibility` (use `bind:series`), `BinnedScatterPlot`'s `.reset-view` button, `ReferenceLine` self-placement props, `HierarchyColorBar`, `InteractiveAxisLabel` (folded into `AxisLabel`), `Point.offset`, `DataSeries.point_tween`, `PointStyle.highlight_effect` `size|color|both`, `PointStyle.shape`, `PlotPoint`, `AXIS_LABEL_OUTER`, `group_ref_lines_by_z`, `calculate_domain`, `create_time_scale`, `safe_hierarchy_layout`, `prune_muted_ids`, `CELLS_3X3` and `LINE_TYPES` are removed; duplicate `ScatterPlot` series ids throw; `BinnedScatterPlot` `x_axis`/`y_axis` are bindable and carry zoom ranges; `compute_label_positions` takes a `scales: Record<FacetAxis, PlotScaleFn>` map; `ScatterPlot` x/x2 axis titles are centred on the plot area (`pad.l + chart_width / 2`, via the shared `PlotAxes`) like `BarPlot`/`BoxPlot`/`Histogram` instead of on the full figure width, so an `x_axis.label_shift.x` tuned to compensate must be removed; the colour-bar wrapper in `ScatterPlot` and `BinnedScatterPlot` is the shared `ColorBarDecoration` with class `.colorbar-wrapper` (`BinnedScatterPlot`'s was `.color-bar`) https://github.com/janosh/matterviz/pull/438
- Plot internals: `tick-geometry.ts`, `tick-density.ts` and `tick-strategies/*` merge into `tick-layout.ts`, `data-cleaning-signal.ts` into `data-cleaning.ts`, `auto-place.ts` into `decorations/{obstacles,outside,solve}.ts`, `hierarchy-labels.ts` into `hierarchy-chart.ts`; `resolve_ref_line_axes` is the new name of the `ref_line_axes(line, axes)` helper (the frame getter `frame.ref_line_axes` is unchanged) https://github.com/janosh/matterviz/pull/438
- Layout/scene: the `SettingsSection` wrapper is deleted (`svelte-widgets` exports it); unused props are dropped from `FullscreenButton`, `ViewerChrome`, `PropertyFilter`, `InfoCard`, `FilePicker`, `DragControlTab`, `Gizmo`, `SceneCamera` and `BarChart`; `scene/export.ts` `export_scene_as(scene, 'stl' | 'obj' | 'glb', basename)` replaces the Fermi/structure/chempot exporters (`fermi-surface/export.ts`, `export_structure_as_glb/obj` are gone; Fermi exports binary `.glb`); `labels.format_power_ten`, the `math.lerp` duplicates, `layout.InfoItem` (use `InfoPaneRow`), the `url-params` `SortDir`/`TableSort` re-exports and `perceived_brightness` callers' ad-hoc contrast are removed; `format_bytes` moves from `labels.ts` to `utils.ts`; `./tooltip` is exported from the package root https://github.com/janosh/matterviz/pull/438
- Trajectory runtime: `TrajectoryType` (frames plus optional `indexed_frames`/`plot_metadata`/`is_indexed`/`frame_loader`/`frame_store`) → `TrajectoryRun { frame_count, preview, provenance, properties, signals, read_frame(idx, signal), collect_positions?, dispose }`; `parse_trajectory_data`/`parse_trajectory_async` → `open_trajectory(source, { filename, signal, on_progress, hdf5_group_path, atom_type_mapping, index_above_bytes })`, `trajectory_from_frames` and `trajectory_from_json`; `FrameLoader`, `FrameIndex`, `TrajectoryFrameStore`, `VSCodeFrameLoader`, `validate_trajectory`, `LoadingOptions`, `TrajFrameReader`, `LARGE_FILE_THRESHOLD`/`MAX_BIN_FILE_SIZE`/`MAX_TEXT_FILE_SIZE` and the `derive_time_step` heuristic are removed; `Hdf5TrajectoryGroupSelectionError.group_paths` → `Hdf5GroupSelectionRequiredError.groups`; an electronic-only `vaspout.h5` throws `VaspoutElectronicOnlyError` instead of yielding a zero-frame trajectory https://github.com/janosh/matterviz/pull/438
- `TrajectoryRun.signals` / `TrajectoryRunSummary.signals` / `LazyTrajectorySource.signals` absorb `signal_descriptors`: one `signals: Record<string, TrajectorySignal | TrajectorySignalDescriptor>` (`TrajectoryRunSignal`) whose entries are loaded (`{ values: Float64Array, sample_shape, steps, unit? }`) or lazy descriptors (`{ sample_shape, sample_count, unit? }`, streamed by `collect_positions({ signal_keys })`), told apart by `'values' in signal` via `is_loaded_signal`/`is_signal_descriptor`. Wire format of the run summary crossing the parse-worker port and the VS Code `large_file_response.run_summary`: before `{ signals?, signal_descriptors? }`, after `{ signals? }` (a lazy HDF5 run that sent `signal_descriptors: { velocity: { sample_shape: [n, 3], sample_count: 4, unit: 'A/fs' } }` sends the same object under `signals`); `ParsedTrajectory.signal_descriptors` is removed
- Trajectory components: `<Trajectory>` is a pure viewer that borrows a `trajectory: TrajectoryRun` and loses `data_url`, `allow_file_drop`, `loading_options`, `atom_type_mapping`, `spinner_props`, `error_snippet`, `on_file_load` and `on_error`; those move to the new `<TrajectoryFileViewer src={url | File | ArrayBuffer | Blob}>`, which owns fetching, drops, decompression, HDF5 group selection and run disposal; the bindable `controls_open`, `info_pane_open`, `msd_pane_open`, `vacf_pane_open`, `spectroscopy_pane_open`, `structure_id_pane_open` and `data_inspector_open` booleans → one bindable `active_pane: TrajectoryPane | null`; `TrajHandlerData.trajectory` is a `TrajectoryRun`, `TrajHandlerData.mode/fullscreen/fps` are removed and step handlers receive `{ step_idx, frame_count, frame? }`; `InfoPaneCards.row_value` and `overlays/CopyButton.svelte` are removed https://github.com/janosh/matterviz/pull/438
- Trajectory analyses: `MsdCollectOptions`, `VacfCollectOptions`, `SpectroscopyCollectOptions`, the structure-id collector and the CSV/JSON export helpers take the run only (`raw_data` removed); `TrajectoryRun.collect_positions(options)`, `accumulate_positions` and `collect_trajectory_positions(run, options)` take one options object (`frame_stride`, `max_bytes`, `on_progress`, `signal`, …) and the unused `scalars`/`scalar_keys` stream channel is gone; `calc_vacf` runs through the FFT (Wiener–Khinchin) and drops `origin_stride`/`lag_stride`/`work_budget`/`std_error`; `MsdOptions`/`VacfOptions`/`VdosOptions` lose `skip_unwrap`/`pbc`/`window_options`/`zero_pad_factor`/`skip`; `TrajectorySpectroscopyOptions` loses `peak_prominence`/`activity_relative_threshold`/`activity_snr` (`velocity_source: 'stored' | 'central_difference' | 'auto'` stays, sharing the VACF's `VelocitySource`), the Raman `field_response` signal and `polarized` geometry are gone (`raman_geometry` → `raman_channel`); `create_trajectory_spectroscopy_async_runner` → `compute_trajectory_spectroscopy_async(input, options?, { signal, on_progress })`, which like `compute_vacf_async`/`compute_msd_async` is a `create_worker_client` instance (type `WorkerClient`) with `.cancel(reason?)` (rejects every in-flight request and terminates the worker) and `.release()` (terminates only when nothing is in flight); the shared position kernels live in `trajectory/positions.ts` (`unwrap_flat_positions`, `group_atoms_by_element`, …)
- Workers/IO: `ParseInWorkerOptions.{fallback_on_worker_error,timeout_ms}` and `reset_parse_worker` are removed (one module worker per request, abort terminates it, only `WorkerUnavailableError` falls back to the main thread); `MATTERVIZ_FILE_EXTENSIONS`, `get_trajectory_stats`, `load_binary_traj` and `LoadingOptions.buffer_size` are removed; `.bz2`/`.xz` drops fail up front https://github.com/janosh/matterviz/pull/438
- Math/colors: the `time.ts` module, its `matterviz/time` subpath and the root re-exports `format_relative_time`/`format_duration` (matbench-discovery used `format_relative_time` in three files and now vendors it), `hermite_normal_form`, `apply_transformation_matrix`, `to_voigt`/`from_voigt`, `are_coplanar`, `centered_frac`, `vecs_equal`, `Vec5`, `NdVector`, `get_page_background`, `relative_luminance` and the per-scheme `*_hex` color exports are removed https://github.com/janosh/matterviz/pull/438
- VS Code host protocol: `startWatching`/`stopWatching`/`WatchedFileContext` and `large_file_progress` are removed; a `settingsChanged { theme, defaults }` message replaces rebuilding the webview HTML (theme/config changes no longer re-read the file from disk and discard unsaved editor buffers; after a failed parse or a failed reload over an existing display the webview re-parses the file the host last sent, a reload that lands mid-retry wins silently, a settings change during the bootstrap parse waits for it, a theme-only change never re-parses); `large_file_response.parsed_trajectory` → `run_summary` plus batched `plot_metadata_stream` messages; the webview's `info` host messages (one per successful render) are logged to a `MatterViz` output channel instead of an information toast (`error` stays a toast) and the webview no longer posts `File reloaded successfully` on top of the `… rendered` message; `DEPRECATED_SETTINGS` (the removed `matterviz.plot.*` keys kept as `deprecationMessage` entries) lives in `extensions/vscode/scripts/sync-config.ts`, not `$lib/settings`, and `SettingType` has no `deprecated` field; `merge()` fills gaps from `DEFAULTS` at every nesting depth (an explicit `undefined` at any depth keeps the default, `Date`/`Map`/typed-array values replace the default instead of merging into `{}`, `__proto__` keys from host JSON are ignored) https://github.com/janosh/matterviz/pull/438
- Packaging: `@sveltejs/kit` is a devDependency; the root `prepare` hook (`src/scripts/prepare.mjs`) runs `svelte-kit sync` and builds `dist/` only when it is missing, so `npm install github:janosh/matterviz#main` (and pnpm git deps with the matching `allowBuilds` key) yield a usable package while dev checkouts stay fast (`MATTERVIZ_SKIP_PREPARE=1`, set by `.github/actions/setup`, skips the build; run `pnpm package:dist` before tests that read `dist/`); a root `.npmrc` (`legacy-peer-deps=true`, npm-only) lets the `npm install` inside a git clone resolve vite-plus's one-patch-behind optional `@vitest/browser-*` peers; the VS Code extension's tests run via `pnpm -C extensions/vscode test`, not the root vitest
- pymatviz widget wire format (anywidget traits that change in lockstep; pin pymatviz to the release that includes [pymatviz#358](https://github.com/janosh/pymatviz/pull/358)): `HistogramWidget.series` entries are `{ values, label?, color?, … }` (the legacy `{ x: [], y, line_style }` shape is still accepted with `y` as the samples and `line_style.stroke` as the colour); `StructureWidget.isosurface_settings` is layers-only (`{ layers: [{ isovalue, color, … }], wireframe, halo, display_range? }`, no top-level `iso_value`/shell count); `StructureWidget.lattice_props` is gone (the `cell_*`/`show_cell_vectors` traits travel in `scene_props`); `FermiSurfaceWidget.fermi_data` accepts both the parsed typed-array form (`parse_fermi_file` output with `positions/indices/normals`) and the JSON mesh form (`vertices`/`faces`/`normals` rows as IFermi's `as_dict()` emits, or an IFermi dict), and `band_data` accepts flat `ScalarGrid3D` or nested `[spin][band][kx][ky][kz]` energies (`FermiSurface` normalises both at the prop boundary); `HeatmapMatrixWidget.log` stays a boolean and `show_legend` → `show_color_bar`; the bridge reads the `gizmo` trait directly (no `show_gizmo` mapping) and no longer drives `ScatterPlot.point_events` (a function-valued prop cannot cross the JSON bridge); the `trajectory` widget reads a new `atom_type_mapping` trait (`{ "1": "Si", "2": "O" }`) into `TrajectoryFileViewer.loading_options` https://github.com/janosh/matterviz/pull/439
- Zero-caller exports are removed (nothing in `matterviz`, `pymatviz` or `matbench-discovery` referenced them): the `io/ndjson.ts` module (`parse_ndjson`, `flatten_row`, `is_ndjson_filename`, `NdjsonParseResult`), `handle_url_drop`/`handle_trajectory_url_drop` (use `dropped_file_url` + `load_from_url`), `merge_nested` (`merge()` recurses to any depth), `to_query`, `get_hill_formula`, `get_molecular_weight`, `parse_si_float`, `CATEGORY_COUNTS`, `D3_INTERPOLATE_NAMES` (use `is_d3_interpolate_name`), `sanitize_icon_svg`, `tile_volumetric_data`, `volume_index`, `is_binary_system`, `is_whisker_mode`, `clean_trajectory_props`, `compute_element_chemical_potential`, `structure_type_fractions`, `saed_spot_angle`, `image_distance` (use `reaction_coordinate` on a two-image path), `compute_treemap_layout` (compose `compute_sunburst_layout` + `tile_rects`), `measure_max_tick_width`, `measure_css_text_width`, `complex_conjugate_product`, `is_optimade_raw` (use `optimade_structure_from_raw(raw) !== null`), the types `Vec9`, `Matrix4x4`, `TreemapNodeHandlerProps` (use `SunburstNodeHandlerProps`), `PlotConfig3D`, `BrillouinZoneProps`, `BZTooltipConfig`, `CompressionExtension`, `DiagramColorKey`, `WorkerTrajectoryResult`, `CellRect`; `det_4x4` (route through `det_nxn`), `cross_2d`, `monotone_chain`, `RAD_TO_DEG`, `HULL_EPS` and ~230 further module-internal helpers and types that were only ever imported by their own module are no longer exported; data-cleaning `compute_local_variance`, `smooth_savitzky_golay`, `remove_local_outliers`, `handle_invalid_values`, `apply_bounds`, `sync_metadata` and `LocalOutlierResult` (`clean_series`, `clean_multi_series`, `clean_xyz`, `detect_instability` and `smooth_moving_average` remain; `savgol` smoothing is still reachable through `CleaningConfig.smooth`) https://github.com/janosh/matterviz/pull/439

### 🚀 New Features

- `StructureSession` (exported from `matterviz/structure`): headless display pipeline, selection validated against the displayed structure, edit-atoms/edit-bonds with undo/redo and pane camera bookkeeping, unit-tested without a DOM; `StructureEditToolbar` renders the measure/edit toolbar over a session; the toolbar dropdown chrome shared by `Structure` and `Trajectory` is the new `ToolbarMenu` component (exported from `matterviz/overlays`, themed via `--view-mode-*` vars, no `app.css` import needed) https://github.com/janosh/matterviz/pull/439
- `Structure` exposes bindable output `wyckoff_positions: WyckoffPos[]` (the analyzed cell's Wyckoff rows with `site_indices` re-expressed onto `displayed_structure`, empty until symmetry analysis finishes); the symmetry demo binds it instead of re-running `map_wyckoff_to_all_atoms`
- `TrajectoryRun` with `open_trajectory`/`trajectory_from_frames`/`trajectory_from_json` (memory, indexed-text, HDF5, worker and VS Code host run kinds, progressive `properties` rows, `read_frame` abort, `dispose`) driven by a headless `trajectory/session.svelte.ts` (LRU frame cache, latest-request-wins reads with an `AbortController` each, scrub vs commit, prefetch, playback); `<TrajectoryFileViewer src>` (URL/File/ArrayBuffer/Blob, drops, decompression, HDF5 group picker, abort, off-thread opens above `index_above_bytes`) wraps the pure `<Trajectory>` viewer with one bindable `active_pane`; `file_drop_zone` gains `hdf5_as_blob` https://github.com/janosh/matterviz/pull/438
- LAMMPS `atom_type_mapping` reaches hosts: new setting `trajectory.atom_type_mapping` (VS Code `matterviz.trajectory.atom_type_mapping`, `{ "1": "Si", "2": "O" }`, default `{}`) is forwarded from the webview bootstrap defaults into `open_trajectory` via `TrajectoryLoadOptions` (an empty map is omitted) and the anywidget `trajectory` widget reads an `atom_type_mapping` trait; `SETTINGS_CONFIG` leaves may be free-form maps (`SettingType.additionalProperties` names the value type and `sync-config.ts` emits JSON-schema `type: object` + `additionalProperties`; `structure.vector_configs` was emitted as `type: string` before)
- `Histogram` `normalize: 'count' | 'probability' | 'density'` (plus `DEFAULTS.histogram.normalize`, a control and axis label); bins are uniform in the scale's transformed space on log/asinh axes https://github.com/janosh/matterviz/pull/438
- `neighbor_query(structure, { cutoff } | { k }, pbc?)` returns a typed-array `NeighborList`; RDF, CNA, CSP, `electroneg_ratio`, coordination and bond angles run on it https://github.com/janosh/matterviz/pull/438
- `math.reciprocal_lattice(lattice, { two_pi })` and raw lattice/reciprocal matrices on `LatticeConverters` https://github.com/janosh/matterviz/pull/438
- `file_drop_zone` attachment in `io/file-drop.ts`; gzip streams through `DecompressionStream`, `.zip` files and URLs inflate via fflate; the worker client gains per-caller `AbortSignal`, progress fan-out and transferables https://github.com/janosh/matterviz/pull/438
- `TrajectoryAnalysisPane` (collect/stride/timestep/progress chrome) shared by the MSD, VACF and structure-id panes https://github.com/janosh/matterviz/pull/438
- `BinnedScatterPlot` `pan`, `InfoPaneCards` `page_size`/`card_attrs`, `MillerIndexInput` bar notation, `ChemPotTooltip`, `is_planar` on chemical-potential domains and `volume_from_json` https://github.com/janosh/matterviz/pull/438
- `PaneDivider` pixel-primary mode: bindable `first_px` sizes the first pane in px (`--split-pane-size` becomes `${px}px`), clamped by `min_px`/`max_px`/`second_min_px` against the container and re-clamped on container resize; `JsonBrowser` uses it for its 320 px sidebar
- CIF rows at one position merge into a single disordered site instead of overlapping atoms https://github.com/janosh/matterviz/pull/438
- Installable from git and downstream CI: `npm install github:janosh/matterviz#main` yields a usable package (see Packaging above); new root script `pnpm build:anywidget` chains `package:dist` → anywidget install → bundle build (documented in `extensions/anywidget/readme.md`); `.github/workflows/downstream.yml` runs pymatviz's widget tests (`MATTERVIZ_ANYWIDGET_DIR`) and matbench-discovery's site tests (`pnpm add file:<checkout>`) against every push to `main`

### 🐛 Bug Fixes

- `Structure`: a `data_url` volumetric load kept replacing a caller-supplied `isosurface_settings` with the automatic 20 %-of-|max| layer; layers set before any volume existed (pymatviz passing `isosurface_settings` next to `data_url`) now apply to the loaded volume
- `Structure` edit-atoms Cmd/Ctrl+D left the duplicated atoms unselected (the topology-change effect wiped the selection it had just set); a URL-loaded structure handed back as a `$state` proxy was mistaken for a caller-supplied one, so a later `data_url` change did not reload https://github.com/janosh/matterviz/pull/439
- `BarPlot` on a log value axis rendered zero rects (bar base mapped to ±Infinity); histogram thresholds were linear on log axes; `remove_local_outliers` deleted the endpoints of every monotonic ramp; `generate_log_ticks` widened narrow domains https://github.com/janosh/matterviz/pull/438
- `parse_cube` used `N·voxel` as the lattice (densities stretched by N/(N−1)); `parse-vaspwave` now divides by the cell volume; singular voxel matrices throw; Brillouin zones are built by quickhull on f64 with exact Wigner–Seitz refinement (non-reduced bases gave +3.5 % volume) https://github.com/janosh/matterviz/pull/438
- `parse_tdb` skipped every statement after a blank line and fabricated a `[T_hi, 5000]` tail on `FUNCTION` ranges; `simple_pca` collapsed elemental chemical-potential domains to a line https://github.com/janosh/matterviz/pull/438
- `HeatmapTable`: releasing a column-resize drag inside the header sorted the column (the click after `mouseup` reached the sortable `<th>`); the handle captures the pointer and swallows its click, and resizing uses pointer capture instead of document `mousemove`/`mouseup` listeners so a drag that leaves the window still ends https://github.com/janosh/matterviz/pull/439
- XRD: Rigaku `.asc`, ILL/PSI, RAW1.01, GSAS ESD/FXYE and reversed `.xy` files decoded wrong; `parse_bruker_raw_file` read only the first of a multi-range RAW1.01 file (every range is now decoded from its own header and concatenated in 2θ order); `parse_xy_file` rejected a 9-point scan with one out-of-order angle and passed a count block whose first and last values coincide (it now counts reversals against the majority direction, tolerates one reversal outright and one per ten steps beyond that, and names the shape it saw: `a block of bare counts, 10 per row` / `(intensity, error) pairs`); structure factors 2.2× faster with `max |Δ2θ|` 5.7e-14° https://github.com/janosh/matterviz/pull/438 https://github.com/janosh/matterviz/pull/439
- Web Workers never started inside VS Code webviews (`SecurityError` on cross-origin worker URLs), so parsing always ran on the main thread and MSD/VACF/structure-id/isosurface requests rejected https://github.com/janosh/matterviz/pull/438
- Trajectory parsers: ASE `.traj` readers reused the first file's species; unknown-symbol frames and torn final atom lines now throw or drop with the line; LAMMPS rejects duplicate/non-positive ids, non-integer types and malformed boxes naming the frame; a complete final XYZ frame with a corrupt `Lattice=` or no recognised element was dropped with a misleading "truncated" warning by both the eager parser and the indexed run (only a tail a writer can leave mid-write is dropped now, with the line counts in the warning) and a frame whose atom block runs past the end of the file no longer disappears silently https://github.com/janosh/matterviz/pull/438 https://github.com/janosh/matterviz/pull/439
- `h2o` and `Fe2O3)` parsed silently; the formula tokenizer now throws naming the offending token and position; `HeatmapMatrix` cells and legend disagreed on descending `color_scale_range`; `ScatterPlot` NaN `color_values`/`size_values` widened extents and painted invalid colours; `ZoomRect` was hidden under canvas marker layers https://github.com/janosh/matterviz/pull/438
- `matrix_inverse_3x3`/`solve_linear_system`/`det_nxn` singularity checks are relative to the matrix scale so nm-scale and reciprocal cells invert; marching-cubes normals interpolate along the edge (2.58° → 0.03° error) https://github.com/janosh/matterviz/pull/438
- Sankey cycles throw `links must form a DAG but contain the cycle A -> B -> C -> A` and render as a `StatusMessage`; `fly_to` orbits at constant radius (antipodal flights passed through radius 0); `ColorBar` time ticks, duplicate labels and descending ranges; `MillerIndexInput` no longer parses `10 0` as `[1,0,0]`; `performance_mode="speed"` no longer overwrites `sphere_segments`; `ensure_moyo_wasm_ready` memoizes the init promise; `OptimadeStructureViewer` guards against stale responses https://github.com/janosh/matterviz/pull/438
- `TrajectoryAnalysisPane` discards collects that finish after a trajectory swap; streamed trajectory series no longer force the first two properties visible; `Nucleus` radius derives from `size` instead of clobbering caller values https://github.com/janosh/matterviz/pull/438
- A run opened by an unbound `TrajectoryFileViewer` was disposed immediately (proxy identity mismatch); a synchronous `read_frame` error banner was wiped in the same batch; `collect_positions` on a disposed run threw instead of rejecting; worker-served runs leaked their worker on unmount; VS Code progressive plot rows arrived through a global `window` listener keyed by path that mutated the caller's object and now stream to the run instance; `TrajectoryFileViewer` fetched an empty `src` as a URL (a notebook clearing its `data_url` trait got the page itself back as a trajectory), so `` and `null` now mean no source https://github.com/janosh/matterviz/pull/438 https://github.com/janosh/matterviz/pull/439
- `neighbor_query` threw on a molecule centred far from the origin (x ≈ 600 Å at a 1 Å cutoff exceeded the spatial grid's ±511-cell window) and refused a 160k-atom / 120 Å box at a 15 Å cutoff from an unfiltered 27× replica bound although the padded cloud is ~312k positions; it now bins relative to the cloud's own bounding box and estimates the refusal from the images it will actually build https://github.com/janosh/matterviz/pull/439
- `ChemPotDiagram` ignored MP `correction` energies while `ConvexHull` applied them (716/775 Li-Co-Ni-O entries differ; Ni9O13 −4.643 vs −6.088 eV/atom) so the two gave different stable sets; both use one `get_energy_per_atom`. `ConvexHull` gas-pressure and temperature sliders had no effect in the default `precomputed` energy mode; SVG phase-diagram import turned every region into its bounding box (wrong centroids, lever rule and hover for non-rectangular fields) and now traces the rectilinear outline; the 2D ternary section painted excluded below-hull phases as stable; hull legend swatches read CSS vars nobody defined; `FormulaFilter` inferred `Li,Fe:1-2` as a chemical system
- `ConvexHull`: the arity check ran on the temperature-filtered entries, so a selected T outside one element's tabulated `temperatures` (with `interpolate_temperature: false`, or beyond `max_interpolation_gap`) replaced the diagram with an "Invalid convex hull data" panel and unmounted the temperature slider needed to recover; it now runs on the `entries` prop and the dropped element is closed with a synthetic corner; `entries={[]}` (the anywidget bridge's not-loaded-yet shape) rendered the red 1-element-short alert instead of the neutral missing-data state, which dropped `hidden`, `onclick`, `aria-*` and `data-*` from the wrapper; `build_chempot_hyperplanes` let a negative composition amount through (`amount <= 0` short-circuited the element check) and failed deep in `chebyshev_centre`, it now throws `Invalid composition amount <el>: <amt> in entry <id>` at the entry boundary
- `JsonTree`/`JsonBrowser`: a root label containing `.` (every real filename) broke every path lookup, so clicking a node in the VS Code/JupyterLab JSON browser rendered nothing and edits/collapse-to-level hit the wrong node; badge re-application looped at rAF rate through its own `MutationObserver` and nothing re-applied badges once the async scan landed; `requestIdleCallback` was unguarded (Safari); panel lookups used `document.querySelector` (broken inside shadow roots); a viewer that threw while mounting left a blank panel (it now shows the error) and re-selecting what a panel already shows rebuilt its viewer
- Embedded theme detection (`detect_parent_theme`) checked the OS `matchMedia` before host signals, so a dark JupyterLab on a light OS rendered light widgets (`JupyterLab Dark` also never matched a case-sensitive `dark`); it now walks a shadow host's whole ancestor chain for a declared `data-theme`/theme class before sniffing any element's background or text colour, so a light-styled host inside a `data-theme="dark"` page resolves dark
- `BrillouinZone` never recomputed after the first zone (its effect early-returned on the `bz_data` it had itself set), so `bz_order` and structure changes were ignored; it showed the "Drop Structure File" empty state for a caller-supplied `bz_data` without a `structure` (the file viewer's `{k_lattice, vertices, faces}` case) and its info pane now lists the zone-only rows there; `on_file_load` carries the zone derived from the loaded structure; a multi-file drop onto `BrillouinZone`/`FermiSurface` no longer overwrites one parse error with the next
- `FermiSurface` rendered nothing when only `band_data` was passed and the initial file load ignored `interpolation_factor`; FRMSF `lshift` was parsed then discarded (surface offset by half a voxel); a URL-loaded surface re-extracted after a `mu`/`interpolation_factor` change was claimed as the raw result rather than the proxy a bound parent hands back, so a later `data_url` change never loaded; a structure/surface stored by a host `on_file_drop` read as a caller-supplied value that cancelled the next `data_url`; a throwing host `on_file_load` was reported as `Failed to parse …` and dropped the URL's ownership of the value it had already stored; `FermiSurfaceScene` rebuilt and disposed every surface material on each opacity-slider tick (a shader recompile per step), opacity is now written in place and only the transparent/opaque switch rebuilds, and surfaces whose geometry cannot be built get no materials
- `Isosurface` worker failures silently fell back (they now report through `Isosurface.on_error`, shown as a dismissible notice in `Structure`); a truncated CHGCAR magnetization block no longer discards the intact charge density; repeated "+" clicks in `IsosurfaceControls` add distinct shells instead of coincident surfaces
- Wyckoff colouring indexed the conventional/primitive cell with original-cell site indices (primitive Cu shown conventional → 3 `unknown` sites); `WyckoffTable` hover/click highlighted the wrong atoms for non-original cells and supercells; property colours on caller-supplied supercells with per-site data read the first tile's values (hit `PhononModeExplorer`); the `SymmetryElements` overlay was drawn in the transformed lattice for conventional/primitive cells (it is now blanked there, with a toast and a note in `SymmetryElementControls` saying why); `hide_redundant_axes` missed lattice-equivalent sub-axes in non-standard frames; CSP in `cna_mode: 'fixed'` reused the single-cutoff query and returned NaN for under-coordinated atoms; analysis bar plots unmounted on a NaN coordinate instead of showing the error
- Structure parsers: CIF unquoted two-column symop loops (`1 x,y,z`) generated phantom atoms at x=0; CIF cell parameters matched by prefix (`_cell_length_a_su` before `_cell_length_a`), depended on file order and failed on leading whitespace; uppercase symbols (`FE2+`, `CL`) became F/C in CIF/mmCIF/XYZ; POSCAR rejected `Selective`, blank coordinate mode and lowercase `t`/`f` flags; CIF disorder groups other than 2 were kept; MOL2 CRYSIN placeholders became 1 Å cells; `parse_coordinate('   ')` was 0; CHGCAR Cartesian coordinates kept unwrapped `xyz`; a plain (underscore-style) CIF whose atom-site loop carries a residue / record-type column (`_atom_site_label_comp_id`, `_atom_site_auth_comp_id` or `_atom_site_group_PDB`) and no usable `_atom_site_type_symbol` reads its labels as PDB atom names like `parse_mmcif` does (`CD` → C, `NE2` → N, `HG11` → H, `ZN` → Zn) instead of two-letters-first with an ambiguity warning (`Cd`, `Ne`, `Hg`), and hydroxyl/water labels `OH`/`OH2` stay O sites that keep their occupancy (pymatgen drops those rows; documented at `CIF_GROUP_ELEMENTS`)
- Plots: the `[0,1]` "no data" range sentinel swallowed real ranges (y ∈ [0.02, 0.98] never re-fit), `expand` range sync now uses an explicit `has_data` flag; auto-placed labels on `x2` series anchored to the `x1` scale; `ScatterPlotControls` Reset overwrote authored per-series styles; `BoxPlot` log axes included zero whiskers (12-decade axis); the `PlotControls` Tick-format Reset applied `.2~s`/`d` formats no plot uses and Ticks Reset handed back `undefined` for an axis mounted with an explicit tick list that later became a count (it now restores the mount-time `ticks`); the line Opacity slider did nothing; stacked `BarPlot` tooltips anchored at the unstacked value; hidden series widened the `ScatterPlot` x range but not y; `Histogram` bars baselined at the plot bottom instead of `y_scale(0)` and its tooltip ignored `hovered`; reference-line annotations vanished on an inverted axis range (the label was solved against unsorted bounds) and were solved against the chart area without the marginal-plot reservation (`solve_reference_annotations` overrode the passed `base_pad`), so on `BinnedScatterPlot`/`ScatterPlot` with marginals the label-dodging saw data obstacles at the wrong pixels; `BoxPlot` secondary-axis tooltips used the primary format
- Trajectory analyses: MSD/VACF panes recomputed with the typed (not collected) frame stride, so retyping the stride without recollecting scaled `D` and every VDOS frequency; the spectroscopy pane collected unbudgeted and dead-ended above 512 MB; any 3-vector metadata key (`box_origin`) was offered as an IR dipole; superseded MSD/VACF worker jobs ran to completion; `1/frame` meant cycles per collected frame in VACF but per MD step in spectroscopy; a strided spectroscopy collect sub-sampled run-level signals to the kept steps but left HDF5-streamed descriptor signals at native cadence, so rigid-motion removal found velocity samples with no position; `collect_trajectory_spectroscopy_input` takes `preprocessing` and only aligns what the calculation matches to positions (velocities always, IR/Raman under `body_fixed`), so a dipole sampled every step beside strided positions keeps its cadence, and a signal the stride leaves without samples throws `Signal '<key>' has no samples on the strided position steps` rather than yielding an empty spectrum; an HDF5 velocity descriptor with one `[n_atoms, 3]` sample per frame (`sample_count` = `frame_count`) is streamed strided through `collect_positions({ vector_keys })` instead of a full native-cadence `signal_keys` read, so the HDF5 byte budget and `suggest_frame_stride` count velocities per kept frame and a strided collect no longer overruns `max_bytes` (a descriptor on its own step axis still goes through `signal_keys`; streamed velocities keep the descriptor's `unit`)
- Trajectory Raman spectra no longer carry an ω² factor: the classical Placzek intensity is the polarizability power spectrum FT⟨α(0)α(t)⟩ (the ω² from using α̇ cancels against the 1/ω·Bose prefactor in the classical limit); IR from a dipole signal keeps ω², IR from a current signal never had it
- VS Code: the host bundle stubbed `node:zlib`/`node:stream` (gzipped large trajectories failed with `createGunzip is not a function`); theme/config changes re-read the file from disk (unsaved edits vanished, large files re-parsed); `.vscodeignore` shipped `tests/`, `scripts/` and `.svelte-kit/`; gitignored directories under `src/lib/` were copied into `dist/` and the npm tarball (a `package-exports` test now guards this); `OptimadeStructureViewer` bypassed the router with `history.pushState`; the phase-diagram demo had two competing mount effects; `matterviz.plot.*` scatter/histogram settings were spread onto a `<div>` instead of the components https://github.com/janosh/matterviz/pull/438
- `contrast_color_memo` cleared its whole cache at the cap, so a working set just over `CONTRAST_MEMO_LIMIT` never hit (FIFO eviction now; a `pick` option injects the picker); `PaneDivider` with `min_px` wider than its container set `--split-pane-size` above 100 % (capped at the whole container)

### 🛠 Enhancements

- `Structure.svelte` 2638 → ~1100 lines, 31 → 7 `$effect`s, 79 → 61 props; selection/measured/highlighted/hovered indices reach the scene only after validation against the displayed site count, so no overlay can index a missing site; mount/selection/image-atom toggles on a 5184-atom supercell are at parity (84–95 vs 105–113 ms mount, 202–235 vs 262–276 ms image toggle); CIF/POSCAR/JSON exports of one edit sequence are byte-identical before and after https://github.com/janosh/matterviz/pull/439
- Perf regression tripwires: `tests/vitest/perf-baselines.test.ts` times seeded synthetic workloads for `ScatterPlot` (100k canvas points), `Trajectory` (mount + 100 frame switches), `JsonTree`, `HeatmapTable`, `calculate_e_above_hull`, CHGCAR parse, marching cubes, `neighbor_query`, XRD, polyhedra 8000-site detect/merge (and its 8000/1000-site ratio), 4D quickhull, 1M-point density binning, the flyaway-atom `neighbor_query` grid, coordination colours and 27k-site `make_supercell` against stored medians with a 2× band scaled by a reference workload, in its own CI job (`MATTERVIZ_PERF=1` locally); the default vitest run has no wall-clock assertions left; the Playwright trajectory perf spec builds its run in-page instead of skipping on CI; new Playwright smoke specs for `FermiSurface` (`tests/playwright/fermi-surface.test.ts`) and `IsobaricTernaryPhaseDiagram` (`tests/playwright/phase-diagram/isobaric-ternary.test.ts`) https://github.com/janosh/matterviz/pull/439
- Settings guards: every component reading `DEFAULTS` has each `$props()` default statically evaluated against the schema (the check that would have caught `Trajectory` shipping `fps = 5`), and every VS Code setting `sync-config` generates must be read by the library or extension host, including through a destructure https://github.com/janosh/matterviz/pull/439
- `calculate_e_above_hull` on 775 MP entries 27 → 8 ms and 4D hull of 7750 points 15.8 → 4.8 ms (`max |Δe_hull|` ≤ 9e-15 vs before, ≤ 3e-14 vs pymatgen); `label_threshold` applies in every dimension https://github.com/janosh/matterviz/pull/438
- `ScatterPlot` 100k canvas points mount 1239 → 244 ms and range-change frame 597 → 78 ms; pan/zoom filters pre-materialised points by mask instead of rebuilding every `InternalPoint` (200k points per frame 8.9 → 1.2 ms) and drops the per-point `new Date()` wrapping on time axes; axes/legend/reference lines render through the shared `PlotAxes`/`PlotLegendLayer`/`ReferenceLinesLayer` (`ScatterPlot.svelte` −635 lines; legend drag works on Bar/Box/Histogram too); `JsonTree` 10k-key mount 21.9 s → 0.81 s; `HeatmapTable` 10k×30 mount 572 → 464 ms, parses each cell value once and memoises contrast colours; `HeatmapMatrix` computes contrast only for rendered/selected cells; `StructureScene` highlight shells ×500 22.6 → 0.03 ms; lattice edges drawn as one `InstancedMesh` https://github.com/janosh/matterviz/pull/438
- Cartesian frame (`ScatterPlot`/`BarPlot`/`Histogram`/`BoxPlot`): the legend's footprint and an explicitly styled legend's offset are measured in an effect after each flush's DOM writes (re-measured on legend resize, plot resize and legend-style change) instead of forcing a reflow with `offsetWidth`/`offsetLeft` reads inside `$derived`; legend dragging caches the SVG's client origin at grab time so a 20-step drag calls `getBoundingClientRect` 2 times (was 21)
- `PlotTooltip` / `resolve_css_color` / `resolve_computed_color` (`matterviz/colors`): the theme + ancestor `MutationObserver`s live as long as the observed node and a reactive `fallback` (the tooltip's per-point `bg_color`) only re-reads the colour; a `ScatterPlot` tooltip following the pointer across 50 points with alternating colours constructed 104 `MutationObserver`s, now 4
- 80×80×96 CHGCAR parse 112 → 39 ms, Fermi-surface geometry 18.7 → 1.0 ms with indexed buffers, Brillouin zone orders 1/2/3 2.3/40/200 → 0.6/8/36 ms, 1008-atom CNA+CSP 10.6 → 5.7 ms, RDF 1.5–4× faster, `pbc_dist` 2.3× and in-place FFT 3× faster https://github.com/janosh/matterviz/pull/438
- `Trajectory` viewer on 1000 frames × 200 atoms: mount 5621 → 289 ms, 100 frame switches 2058 → 268 ms, indexed open 32 → 15 ms (positions/lattices/properties `max |Δ|` = 0; memory/indexed/worker `collect_positions` parity 0); `Trajectory.svelte` 2327 → 1180 lines, 48 → 34 props, 29 → 8 `$effect`s; `TrajectoryInfoPane` rebuilds only when open (closed pane per step 1.95 → 0.001 ms); the text/plain drop fallback is removed; `is_binary` samples the first 8 KiB (25 MB text: 49 → 0.8 ms) https://github.com/janosh/matterviz/pull/438
- VS Code parse worker 5.0 MB → 425 KB (h5wasm loaded only for `.h5`); the host bundle drops the `$lib/trajectory` barrel, `package.json` and d3 (2123 → 217 modules) and no longer needs the Svelte plugin; anywidget reads `DEFAULTS` for `auto_rotate`/`gizmo`; JupyterLab parses via `parse_in_worker` with an `AbortController` per render https://github.com/janosh/matterviz/pull/438
- `BoxPlot` quartiles pinned as type-7 (numpy/R/d3); `PeriodicTable` tiles and `ColorBar` share `resolve_color_ramp`; Composition "Copy Formula" copies plain text; `get_reduced_formula` scales fractional compositions to the smallest integer formula via a float gcd resolved to 1/10000 (pymatgen's `get_integer_formula_and_factor`; `Fe0.01O0.99` → `FeO99`, rounded `0.3333/0.6667` → `FeO2`) and lives in `composition/reduce.ts`, shared with the chempot worker https://github.com/janosh/matterviz/pull/438
- `compute_domains` (chemical-potential diagrams) builds the polar dual and runs the N-D quickhull instead of enumerating C(n, dim) hyperplane intersections: quaternaries 53–217 → 1.7–3.4 ms, ternaries 125 → 0.7 ms, identical formula sets and vertex counts, per-domain Hausdorff `max |Δ|` ≤ 9.1e-13 eV on MP fixtures; the `nd_cache` singleton and grid pre-warm are gone; the worker payload carries geometry fields only
- `ChemPotDiagram3D` keeps its `<Canvas>` mounted across recomputes (previous geometry dims under the spinner; ~120 lines of camera-pinning machinery deleted); outlines come from PCA hull edges and `EdgesGeometry` crease edges; formula-overlay hull meshes and crease-edge geometries are cached per formula (keyed on the domain and the axis stretch) and disposed on eviction, so with k overlays drawn a toggle runs 2 `ConvexGeometry` builds instead of k + 1 (2, 3, 4 for three successive toggles on the Li-Fe-O test set) and un-drawing one runs 1 https://github.com/janosh/matterviz/pull/438
- `TernarySectionCanvas` (`IsobaricTernaryPhaseDiagram`): hover (tie-triangle emphasis, lever-rule probe) and selection/highlight/emphasis rings draw on a stacked overlay canvas via the shared `create_canvas_surface` scheduler, so the pointer no longer repaints faces, points and labels (5 hovers + 1 selection repainted the base canvas 6 times, now 0)
- `calc_vacf` via FFT: 2000 frames × 200 atoms 719 → 51 ms (`max |Δ|` 5.7e-14 on unit-scale sums vs the direct origin loop) with no work-budget cap; `one_sided_periodogram` reuses its buffers and caches twiddle tables; `remove_rigid_velocity` builds the inertia tensor only for `body_fixed`; TorchSim HDF5 open no longer reads the whole positions dataset to find a torn tail (100k × 500 atoms: 1.2 GB of h5wasm reads avoided); `check_step_plausibility` caches the cart→frac converter per lattice; the spectroscopy worker payload is no longer deep-copied twice
- Fermi surfaces: BXSF/FRMSF parse through `parse_float_block` (mgb2 37.8 → 10.2 ms, srvo3 31.4 → 5.9 ms, cu 16.8 → 2.2 ms, `max |new−old|` = 0 over 365k values); geometries are cached per surface and colour changes update the colour attribute in place; symmetry copies share one material per (surface, pass); slice contours use numeric edge keys; NEB profiles are computed once per path (`reaction_coordinate` was evaluated 3–4×)
- Structure-id worker payload sends flat `xyz` + lattice only (10,976 atoms: 1.76 MB → 0.26 MB); `property_colors` are computed once per session instead of per pane + legend; `Isosurface` profiling uses `performance.mark/measure` instead of a threaded `profiler` prop
- `neighbor_query` backs `electroneg_ratio` (its private spatial grid is gone, `sorted: false` skips the per-centre distance sort it never used), coordination and bond angles, which bond periodically instead of appending capped image shells; LiFePO4 2016/10976-atom supercells: `electroneg_ratio` 1.9/12.9 → 1.9/11.6 ms, coordination 7.9/36 → 4.3/17.7 ms, bond angles 27.5/148 → 7.1/40.8 ms with identical bond sets (incl. lengths), coordination numbers and angle histograms (`max |Δ|` = 0) https://github.com/janosh/matterviz/pull/439
- Test suite: ≈ −6,000 lines with unchanged behavioural coverage (shared builders `make_run`, `make_phase`, `make_struct`, `make_molecule`, `make_rocksalt`, `make_position_stream`, `with_property_rows`, `install_stub_worker`, `mock_canvas_context`, `mock_clipboard_write`, `mock_object_url`, `rejection_of` in `tests/vitest/setup.ts`; frame-shared chart behaviours tested once via `test.each(frame_charts)`); `open.test.ts` no longer re-executes the whole `runs` suite through an import; a `TrajectoryFileViewer` test no longer issues a real `fetch` to `localhost:3000`; the `TrajectoryFileViewer` HDF5 picker tests initialise h5wasm once in a `beforeAll`; vacuous tests fixed or deleted (a Playwright `.tooltip` selector that never matched, histogram control selectors that don't exist, a mode-switch test that never switched, a mocked formula that fabricated `LiFeP4O7`)

### 💡 Refactoring

- Shared helpers replace per-module copies: `math.ts` `clamp`, `mean`, `sample_std`, `median`, `first_non_increasing_index`; `utils.ts` `is_editable_target`, `rows_to_csv`, `csv_line`, `format_bytes`; `colors/index.ts` `plot_color(idx)`; `element/helpers.ts` `symbol_to_atomic_number`; `constants.ts` `HDF5_EXT_REGEX`/`BINARY_VIEWER_EXT_REGEX`; `structure/site.ts` `is_image_site`/`get_orig_site_idx`; `worker-serve.ts` `serve_worker` (every analysis worker entry is 3 lines); `scene/SceneLights.svelte`; `create_orthographic_zoom({ camera, … }).orbit_zoom_props()`; `canvas-surface.svelte.ts` shared by the hull and ternary canvases; `file-viewer/mount-viewer.ts` `mount_viewer`
- `plot/core/color-ramp.ts` (`resolve`/`sample`/`gradient`) backs `ColorBar`, legends, `HeatmapMatrix` and `PeriodicTable`; `ColorBar` 712 → 378 lines https://github.com/janosh/matterviz/pull/438
- `HeatmapTable` 3494 → 2305 lines: sorting/search/filter/datetime, CSV/TSV/markdown/LaTeX export, range selection and virtualisation move to `table/{data,export,selection.svelte,virtual}.ts`; header, body and summary cells read one per-column view model (`cols`) instead of re-deriving ID, key, width, stickiness and color scale per cell; `<tbody>` handles pointer/keyboard/focus/context-menu once via `data-row-idx`/`data-col-idx` instead of seven closures per cell; sticky offsets are a `$derived` over header widths reported by a per-header attachment (was `$state` + `$effect` + `querySelector`); the per-column filter panel and date/time format picker are `ColumnFilter.svelte`/`DateTimeFormatMenu.svelte` with `column_filter_panel`, `with_numeric_bound`, `with_category_toggled` and `table_to_json` in `data.ts`/`export.ts`; `ToggleMenu`'s reset baseline is a cached `$derived` https://github.com/janosh/matterviz/pull/438 https://github.com/janosh/matterviz/pull/439
- `StructureControls` rows are generated from `SETTINGS_CONFIG.structure`; `StructureInfoPane` and `ConvexHullStats` sit on `InfoPaneCards`; `BinnedScatterPlot` sits on `create_cartesian_frame`/`CartesianFrame`; `ScatterPlot3D` uses `SceneCamera` + `build_orbit_props` https://github.com/janosh/matterviz/pull/438
- `symmetry/index.ts` splits into `analyze.ts` (moyo bridge, `transform_cell`) and `wyckoff.ts`; `composition/chart.ts` is shared by Pie/Bubble/Bar; `hull-state.svelte.ts`, `canvas-interactions.svelte.ts` and `canvas-draw.ts` are shared by the 2D/3D/4D hulls; `spectral/helpers.ts` 1372 → 1021 and `xrd/parse.ts` 836 → 470 lines https://github.com/janosh/matterviz/pull/438
- `file-viewer/parse-in-worker.ts` 611 → 390 lines with one module worker per request; `host-protocol.ts` exports `HostRequest`/`HostToWebviewMessage`; `extensions/anywidget` type-checks on its own `tsconfig.json` via `pnpm -C extensions/anywidget run typecheck` https://github.com/janosh/matterviz/pull/438

## [v0.5.0](https://github.com/janosh/matterviz/compare/v0.4.4...v0.5.0)

> 11 August 2026

### ⚠️ Breaking Changes

- Narrow the public API: import plot components from `matterviz/plot` rather than `matterviz/plot/...`; the `matterviz/json-path`, `matterviz/marching-cubes`, and `matterviz/file-viewer/eligibility` subpaths and broad root/core re-exports are no longer public https://github.com/janosh/matterviz/pull/431
- Require Svelte 5.48 or newer
- Migrate VS Code settings: `matterviz.structure.show_cell` and `matterviz.plot.show_x2_grid` are no longer supported; replace `matterviz.plot.{show_x_grid,show_y_grid,show_y2_grid}` with the corresponding `matterviz.{histogram,bar,box,scatter}.display.{x_grid,y_grid,y2_grid}` setting.
- The removed camera settings `matterviz.convex_hull.binary.camera_center_x`, `matterviz.convex_hull.binary.camera_center_y`, `matterviz.convex_hull.ternary.camera_center_x`, `matterviz.convex_hull.ternary.camera_center_y`, `matterviz.convex_hull.quaternary.camera_center_x`, and `matterviz.convex_hull.quaternary.camera_center_y` have no setting replacements; pan hull views interactively instead.
- The remaining removed legacy `matterviz.plot.*` and `matterviz.trajectory.*` settings have no replacements. This includes plot animation, auto-range, zoom, trajectory caching/chunking, playback-loop, prefetch, memory, formatting, tooltip, and compact-control settings.

### 🚀 New Features

- Add a JupyterLab file viewer for structures, trajectories, volumetric data, bands, DOS, and other supported materials files https://github.com/janosh/matterviz/pull/421
- Add per-atom trajectory analysis, CNA and centrosymmetry, VACF/VDOS, trajectory lines, a data inspector, and CSV export https://github.com/janosh/matterviz/pull/422
- Add plot facets, coordinated axes, adaptive ticks and titles, shared decoration placement, and improved accessibility https://github.com/janosh/matterviz/pull/425

### 🛠 Enhancements

- Improve camera framing, color parsing, extXYZ fidelity, and trajectory data export https://github.com/janosh/matterviz/pull/420
- Overhaul plot controls, legends, dense rendering, searchable settings, and viewer preferences https://github.com/janosh/matterviz/pull/424 https://github.com/janosh/matterviz/pull/426 https://github.com/janosh/matterviz/pull/427
- Speed up plots, convex hulls, and tables while improving their correctness and interaction behavior https://github.com/janosh/matterviz/pull/428
- Derive readable foreground colors automatically from a shared theme backdrop token https://github.com/janosh/matterviz/pull/429

### 💡 Refactoring

- Share reusable file-parsing utilities across the library and extensions https://github.com/janosh/matterviz/pull/423
- Consolidate common tooling, test helpers, settings factories, and maintenance infrastructure https://github.com/janosh/matterviz/pull/430

## [v0.4.4](https://github.com/janosh/matterviz/compare/v0.4.3...v0.4.4)

> 30 July 2026

### 🚀 New Features

- Add MSD/diffusion, PDF, bond-angle, neutron/electron XRD, SAED, NEB, and IR/Raman analysis https://github.com/janosh/matterviz/pull/417
- Parse PDB, MOL/SDF, MOL2, mmCIF, and LAMMPS files; add selective-dynamics colors, dihedrals, zone-axis views, and displacement overlays https://github.com/janosh/matterviz/pull/417
- Add interactive volumetric cross-sections with HKL planes and live offset sampling https://github.com/janosh/matterviz/pull/415
- Add site-wide Pagefind documentation search https://github.com/janosh/matterviz/commit/702d917283414d26feb193c0a4ecef98d46acc9b

### 🛠 Enhancements

- Move 3D rendering to WebGPU and accelerate RDF, bonding, XRD, parsers, and render hot loops https://github.com/janosh/matterviz/pull/416
- Support flat typed-array scalar grids in marching cubes https://github.com/janosh/matterviz/pull/414
- Improve responsive structure controls, URL state, public APIs, Sunburst gaps, and colorbar layout https://github.com/janosh/matterviz/pull/413
- Cut structure-viewer render churn and improve camera framing, reset controls, and plot-axis padding https://github.com/janosh/matterviz/pull/419

### 🐛 Bug Fixes

- Fix bonding, diffraction, MSD unwrapping, supercells, symmetry elements, and malformed analysis/parser inputs https://github.com/janosh/matterviz/pull/417
- Clean up renderer, canvas, stream, and recorder resources after failed exports https://github.com/janosh/matterviz/pull/415
- Fix bond-edit resets and portaled widget interactions https://github.com/janosh/matterviz/pull/418
- Fix WebGPU gradients and camera state, bundled Moyo WASM, and plot clipping/interactions https://github.com/janosh/matterviz/pull/419

### 💡 Refactoring

- Replace local UI widget copies with `svelte-widgets` 1.1 https://github.com/janosh/matterviz/pull/418
- Make releases artifact-first, retry-safe, and tag-last https://github.com/janosh/matterviz/commit/53d508778bad2994197c316cc7fe9c6e76b7452f

## [v0.4.3](https://github.com/janosh/matterviz/compare/v0.4.2...v0.4.3)

> 15 July 2026

### 🚀 New Features

- Add multi-volume isosurface scenes with simultaneous surfaces, cross-volume scalar coloring, trilinear sampling across mismatched grids, fractional display ranges, and grouped volume/layer controls https://github.com/janosh/matterviz/pull/376
- Expose the VS Code webview as a reusable `matterviz/file-viewer` module with host protocols, worker-safe parsing, transfer planning, automatic plot selection, and combined trajectory/DOS views https://github.com/janosh/matterviz/pull/373

### 🛠 Enhancements

- Add multiline Treemap labels with hide/shrink/clip fitting, rotation, and anywidget zoom-root writeback; improve SVG export padding and plot overlay stability https://github.com/janosh/matterviz/pull/373
- Harden large and compressed trajectory loading, embedded theme handling, plot pan/zoom bounds, stale reload behavior, and structure/treemap UI https://github.com/janosh/matterviz/pull/374
- Add configurable volume-slice contours, Y flipping, synchronous rendering callbacks, bounded contour levels, and robust sampler-cache invalidation https://github.com/janosh/matterviz/pull/400
- Improve VS Code auto-render eligibility, Explorer commands, shared file watchers, resource validation, and error reporting https://github.com/janosh/matterviz/pull/409

### 🐛 Bug Fixes

- Correct partial-PBC RDF expansion, nonorthogonal reciprocal coordinates and marching-cubes normals, chemical-potential cache keys, CIF zero occupancy, EXTXYZ periodicity, and binned-scatter automatic ranges https://github.com/janosh/matterviz/pull/405
- Reload reactive `Structure`/`Trajectory` URLs safely, reject stale completions and streams, and keep lazy-frame details synchronized with the displayed trajectory frame https://github.com/janosh/matterviz/pull/409
- Round-trip arbitrary JSON object keys, fix site metadata/error links, and align browser compression and VS Code file-size documentation with actual support https://github.com/janosh/matterviz/pull/410

### 💡 Refactoring

- Remove dead branches, exports, styles, and redundant tests across the library and extensions; consolidate shared helpers and settings factories while strengthening volume rendering and restored regression coverage https://github.com/janosh/matterviz/pull/400
- Consolidate file-viewer, element, structure, scene, tooltip, trajectory, and embedded-theme infrastructure and move extension coverage into the main Vitest suite https://github.com/janosh/matterviz/pull/374

### 🔒 Security Fixes

- Sanitize chemical-potential axis-label HTML and make SSR sanitization fail closed instead of returning unsafe input when DOM emulation is unavailable https://github.com/janosh/matterviz/pull/405

## [v0.4.2](https://github.com/janosh/matterviz/compare/v0.4.1...v0.4.2)

> 9 July 2026

### 🚀 New Features

- Add zoomable `Treemap` hierarchical charts (squarified nested rectangles with click-to-zoom, breadcrumb pathbar, branch header strips, legend muting, metric coloring, and SVG/PNG export) sharing Sunburst tree semantics and data builders so switching charts is a one-line change https://github.com/janosh/matterviz/pull/372
- Add VASP 6 HDF5 support: `vaspout.h5` trajectories (torn-file recovery, SCF pseudo-frames), electronic bands/DOS-only views, and `vaspwave` charge-density volumetrics, with VS Code webview routing for `vaspout_electronic` and `TrajectoryWithDos` https://github.com/janosh/matterviz/pull/372
- Add `StructureCarousel` for browsable structure cards (virtualized WebGL mounts, keyboard/wheel paging, resizable track, portaled pager) plus a demo page https://github.com/janosh/matterviz/pull/372
- Add opt-in `HeatmapTable` row virtualization with a `controls_target` portal for host-header search/export/settings https://github.com/janosh/matterviz/pull/372

### 🛠 Enhancements

- Fit-aware hierarchy labels: ordered fallback chain (`extended` → `label` → compact `label_short`), Sunburst font downscaling, and `auto` rotation that tries the other orientation before hiding text on narrow arcs/cells https://github.com/janosh/matterviz/pull/372
- Smooth carousel scrolling by promoting entering cards to live WebGL canvases at most one per ~200ms mid-scroll (label shells first; remaining mounts on settle) https://github.com/janosh/matterviz/pull/372

### 🐛 Bug Fixes

- Harden HDF5 parsing against torn/corrupt files (keep frames before a bad trailing step as `dropped_steps`, constant-cell torch-sim normalization, vaspwave shape checks, gzipped `.traj` binary fast-path) https://github.com/janosh/matterviz/pull/372
- Fix stale `DraggablePane` viewport clamps (including legitimate `top: 0px`), HeatmapTable virtual-scroll/selection edge cases, carousel vertical page sizing, and bond-deletion e2e framing after `ensure_lattice_params` https://github.com/janosh/matterviz/pull/372

### 💡 Refactoring

- Deduplicate Sunburst/Treemap into shared `hierarchy-chart` helpers and a single `HierarchyControls` keyed by chart type; collapse duplicated sunburst/treemap settings into one factory https://github.com/janosh/matterviz/pull/372
- Split the VS Code webview parse path into worker-safe `parse.ts`, unify SCF frame metadata helpers, and trim carousel/table internals (opt-in virtualization, ID-indexed row selection) https://github.com/janosh/matterviz/pull/372

## [v0.4.1](https://github.com/janosh/matterviz/compare/v0.4.0...v0.4.1)

> 15 June 2026

### 🚀 New Features

- Render coordination polyhedra around cation-like centers in the 3D structure viewer — `compute_polyhedra` derives them from perceived bonds with PBC-aware neighbor expansion (closing correctly across cell boundaries), with `show_polyhedra`/opacity/edge/color-mode settings wired into `StructureControls` plus a demo page https://github.com/janosh/matterviz/pull/358
- Make the anywidget bridge two-way reactive instead of fire-once: Python trait changes (incl. ipywidgets `link`) drive the live `Structure`/`Trajectory`/`ScatterPlot` view and component interaction writes back to Python, enabling coordinated multi-widget views https://github.com/janosh/matterviz/pull/365
- Add generic categorical entry classification for convex-hull diagrams (2D/3D/4D) — shape-code entries by any categorical property (electronic class, crystallinity, magnetic ordering, ...) with a filter row of shape swatches, per-value counts, and show/hide toggles, plus a built-in magnetic-ordering preset https://github.com/janosh/matterviz/pull/363
- Add symmetry-element overlays classifying operations into rotation/screw axes, mirror/glide planes, inversion centers, and rotoinversion axes (rendered by `SymmetryElements.svelte`) https://github.com/janosh/matterviz/pull/359

### 🐛 Bug Fixes

- Fix moyo Wyckoff tables for non-conventional input cells: moyo's per-site arrays index the input cell (not `std_cell`), so sites are now grouped into crystallographic orbits with correct conventional-cell multiplicity (primitive FCC Cu now shows one `4a` instead of `1a` + 3 bogus letter-less rows) https://github.com/janosh/matterviz/pull/359
- Fix the homepage file picker dropping all crystal structures in production — the Rolldown build ignores `import: 'default'` in eager `import.meta.glob`, so a new `glob_text` helper normalizes module-namespace/parsed values back to raw text https://github.com/janosh/matterviz/pull/360

### 💡 Refactoring

- Codebase-wide type-safety + naming cleanup (single-letter → snake_case, `[number, number]` → `Vec2`/`VecN`) and DRY extraction of shared plot/science helpers — net ~2,200 fewer lines across 247 files https://github.com/janosh/matterviz/pull/360
- Extract shared 3D-scene (`SceneCamera`/`bind_renderer`), export-pane (`io/ExportPane.svelte`), and viewer-chrome (`layout/ViewerChrome.svelte`) modules across the Structure/Brillouin/FermiSurface/ChemPot/Trajectory viewers, plus parser hardening (106 files) https://github.com/janosh/matterviz/pull/361
- Follow-up dedup pass: `ConvexHullChrome.svelte` and `FullscreenButton.svelte` collapse copy-pasted toolbar/fullscreen code and a `create_chempot_overrides` factory dedupes the ChemPot control panes (~600 lines removed across 86 files) https://github.com/janosh/matterviz/pull/362
- Add tag-triggered publish CI: on a `v*.*.*` tag, gate on lint + tests + a version-match check, then publish `matterviz` and `matterviz-anywidget` to npm via OIDC trusted publishing and the VS Code extension to Open VSX (plus a `.vsix` artifact for the Marketplace) https://github.com/janosh/matterviz/pull/357

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
