/// <reference types="vite/client" />

// MatterViz AnyWidget Entry Point

import type { AnyModel, Render } from 'anywidget/types'
import {
  Bands,
  BandsAndDos,
  BarPlot,
  BoxPlot,
  BrillouinZone,
  check_blob_workers,
  ChemPotDiagram,
  Composition,
  ConvexHull,
  Dos,
  EosPlot,
  FermiSurface,
  HeatmapMatrix,
  Histogram,
  is_plain_object,
  IsobaricBinaryPhaseDiagram,
  IsobaricTernaryPhaseDiagram,
  NebPlot,
  normalize_band_structure,
  normalize_dos,
  PeriodicTable,
  PhononModeExplorer,
  RdfPlot,
  Sankey,
  ScatterPlot,
  ScatterPlot3D,
  set_moyo_wasm_source,
  SpacegroupBarPlot,
  Structure,
  Sunburst,
  TernaryPlot,
  trajectory_from_json,
  Trajectory,
  Treemap,
  volume_from_json,
  XrdPlot,
} from 'matterviz'
import { DEFAULTS } from 'matterviz/settings'
import { watch_theme } from 'matterviz/theme/embedded'
import { mount, unmount } from 'svelte'
import type { COMPONENTS } from '../../src/elements/components'
import type { DrivenProp } from './reactive.svelte'
import {
  derived_prop,
  drive_prop,
  drive_props,
  get_prop,
  next_event_id,
  nullable_prop,
  reactive_widget,
  set_model,
  throttle,
  words,
  writeback_prop,
} from './reactive.svelte'

// Workers ship inline and run from blob: URLs (see vite.config.ts), which a page CSP may refuse
await check_blob_workers(`MatterViz`)

const styled_shadow_roots = new WeakSet<ShadowRoot>()

// The bundled app styles, which reach only into elements of this class (every widget's root),
// plus VS Code's opaque notebook output background cleared behind them. Theme-independent:
// every token in app.css is light-dark(), resolved against the widget element's own
// color-scheme (set in render).
const WIDGET_CLASS = `matterviz-widget`
// app.css scoped to WIDGET_CLASS, inlined by vite.config.ts's `define`
declare const SCOPED_APP_CSS: string
const widget_base_css = `.cell-output-ipywidget-background:has(.${WIDGET_CLASS}) { background: transparent !important; }
${SCOPED_APP_CSS}`

// Install the app styles once per root (document head, or the widget's shadow root)
function inject_app_css(target_element: HTMLElement): void {
  const root_node = target_element.getRootNode()
  if (root_node instanceof ShadowRoot) {
    if (styled_shadow_roots.has(root_node)) return
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(widget_base_css)
    root_node.adoptedStyleSheets = [...root_node.adoptedStyleSheets, sheet]
    styled_shadow_roots.add(root_node)
    return
  }
  const style_id = `matterviz-widget-styles`
  if (document.getElementById(style_id)) return
  const style = document.createElement(`style`)
  style.id = style_id
  style.textContent = widget_base_css
  document.head.append(style)
}

// Per-element teardown of the mounted widget: theme observer, model listeners + writeback
// effects, interaction throttles and the Svelte instance itself
const cleanups = new WeakMap<HTMLElement, () => void>()

const cleanup_element = (element: HTMLElement): void => {
  cleanups.get(element)?.()
  cleanups.delete(element)
}

// Build an object of { key: model.get(key) } for each key in the list
const pick_props = (model: AnyModel, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, get_prop(model, key)]))

// Derived prop bundling several traits into one object prop (deps == picked keys),
// e.g. bands_props / dos_props.
const picked_prop = (name: string, keys: string): DrivenProp =>
  derived_prop(name, words(keys), (model) => pick_props(model, words(keys)))

const merge_object_prop = (
  base: unknown,
  key: string,
  value: unknown,
): Record<string, unknown> | undefined => {
  const base_record = is_plain_object(base) ? base : {}
  if (value === undefined) return base === undefined ? undefined : base_record
  return { ...base_record, [key]: value }
}

// Derived prop that folds a flat source trait into a target object trait under sub_key
// (for example, x_range -> x_axis.range).
const merged_prop = (target: string, sub_key: string, source: string): DrivenProp =>
  derived_prop(target, [target, source], (model) =>
    merge_object_prop(get_prop(model, target), sub_key, get_prop(model, source)),
  )

const plot_common_drive: readonly DrivenProp[] = [
  ...drive_props(`series display legend ref_lines padding range_padding`),
  ...words(`x x2 y y2`).map((axis) => merged_prop(`${axis}_axis`, `range`, `${axis}_range`)),
]
// Every plot component (the generic plots and the Bands/Dos/XrdPlot/RdfPlot wrappers alike)
// declares these four controls props and forwards the pane attribute dicts to its PlotControls
const plot_control_keys = `show_controls controls_open controls_toggle_props controls_pane_props`
const plot_controls_drive = words(plot_control_keys).map((key) =>
  key === `controls_open` ? writeback_prop(key, false) : drive_prop(key),
)
const with_plot_controls = (keys: string): DrivenProp[] => [
  ...plot_controls_drive,
  ...drive_props(keys),
]
// The 2D cartesian plots: the shared series/axis traits, the controls, and their own keys
const cartesian_plot_drive = (keys: string): DrivenProp[] => [
  ...plot_common_drive,
  ...with_plot_controls(keys),
]
// Treemap and Sunburst: the HierarchyChartProps traits they share plus their own keys.
// Function/snippet props cannot cross the JSON bridge; continuous color props requiring
// color_values stay local. zoom_root_id is two-way: click-zoom in the UI notifies Python;
// Python can re-root the view
const hierarchy_drive = (keys: string): DrivenProp[] => [
  ...with_plot_controls(`data value_mode sort level_lighten min_fraction max_children other_label
    max_depth show_labels label_text zoom_on_click show_breadcrumbs legend show_legend
    value_format padding export_formats export_filename fullscreen_toggle ${keys}`),
  writeback_prop(`zoom_root_id`),
]

// Scene traits forwarded verbatim into scene_props via pick_props. Label settings and unit-cell
// rendering live here too: Structure forwards them to StructureScene via {...scene_props}, not
// as top-level Structure props
const scene_pick_keys = words(`atom_radius show_atoms same_size_atoms show_bonds bond_thickness
  bond_color bonding_strategy vector_configs vector_scale vector_color vector_normalize
  vector_uniform_thickness vector_origin_gap show_site_labels show_site_indices
  cell_edge_opacity cell_surface_opacity cell_edge_color cell_surface_color cell_edge_width
  show_cell_vectors`)
// All scene traits (deps for the reactive scene_props derived prop); auto_rotate and gizmo
// are defaulted in get_scene_props rather than picked verbatim.
const scene_prop_keys = [...scene_pick_keys, `auto_rotate`, `gizmo`]

// Top-level Structure traits the trajectory forwards into its nested structure_props
// (show_site_labels/show_site_indices are NOT here -- they ride inside scene_props). cutaway
// is JSON CutawaySettings, sliced in the displayed cell; a hotspots-pane cutaway overrides it
const traj_structure_prop_keys = words(
  `show_image_atoms color_scheme background_color background_opacity cutaway`,
)

// Build scene/lattice props shared by structure and trajectory renderers. Unset traits fall
// back to the same settings defaults the components use, so a notebook widget and a page
// embed look alike.
const get_scene_props = (model: AnyModel) => ({
  ...pick_props(model, scene_pick_keys),
  auto_rotate: get_prop(model, `auto_rotate`) ?? DEFAULTS.structure.auto_rotate,
  gizmo: get_prop(model, `gizmo`) ?? DEFAULTS.structure.gizmo,
})

// Trajectory forwards a fixed config object to its embedded Structure view.
const get_structure_props = (model: AnyModel) => ({
  scene_props: get_scene_props(model),
  ...pick_props(model, traj_structure_prop_keys),
  fullscreen_toggle: false,
})

// Spectral traits carry pymatgen as_dict() documents (or matterviz-shaped ones), alone or
// as {label: document}; Bands/Dos take {label: normalized} records, with an empty label
// for an unnamed dataset. A trait that is neither throws, failing the mount.
const spectral_record = <T>(
  value: unknown,
  normalize: (doc: unknown) => T | null,
  kind: string,
): Record<string, T> | undefined => {
  if (value == null) return undefined
  const single = normalize(value)
  if (single) return { '': single }
  if (!is_plain_object(value)) throw new Error(`${kind} must be a document or a map of them`)
  return Object.fromEntries(
    Object.entries(value).map(([label, doc]) => {
      const normalized = normalize(doc)
      if (!normalized) throw new Error(`${kind} "${label}" is not a ${kind} document`)
      return [label, normalized]
    }),
  )
}
const band_structs_prop = derived_prop(`band_structs`, [`band_structs`], (model) =>
  spectral_record(get_prop(model, `band_structs`), normalize_band_structure, `band structure`),
)
const doses_prop = derived_prop(`doses`, [`doses`], (model) =>
  spectral_record(get_prop(model, `doses`), normalize_dos, `DOS`),
)

// Shape pushed back to Python for scatter point click/hover interactions.
type ScatterPointEvent = {
  point?: { series_idx?: number; point_idx?: number; x?: number; y?: number }
} | null
const scatter_point_payload = (data: ScatterPointEvent) =>
  data?.point
    ? {
        series_idx: data.point.series_idx,
        point_idx: data.point.point_idx,
        x: data.point.x,
        y: data.point.y,
      }
    : null

// Scatter click/hover callbacks: click writes active_point with a monotonic
// event_id (so re-clicking the same point still notifies Python, since traitlets
// skip equal reassignments); hover writes hovered_point throttled (fires per
// mousemove) and the throttle is cancelled on widget cleanup.
const scatter_interactions = (model: AnyModel) => {
  const on_point_hover = throttle(
    (data: ScatterPointEvent) =>
      set_model(model, `hovered_point`, scatter_point_payload(data)),
    80,
  )
  return {
    props: {
      on_point_click: (data: ScatterPointEvent) => {
        const payload = scatter_point_payload(data)
        set_model(
          model,
          `active_point`,
          payload && { ...payload, event_id: next_event_id(model, `active_point`) },
        )
      },
      on_point_hover,
    },
    cleanup: on_point_hover.cancel,
  }
}

// Declarative description of one widget: the component, its reactive props (drive /
// derived / writeback), and optional interaction callbacks + teardown.
type WidgetSpec = {
  component: unknown
  drive: readonly DrivenProp[]
  // style is the notebook wrapper, driven unless the component has nowhere to put it
  no_style?: true
  // Fixed props the component declares; anything else would fall through ...rest onto its
  // wrapper element as an unknown HTML attribute
  static_props?: Record<string, unknown>
  interactions?: (model: AnyModel) => {
    props: Record<string, unknown>
    cleanup?: () => void
  }
  // Model traits written by interaction callbacks (not derivable from drive specs);
  // listed so WIDGET_MODEL_KEYS reflects the full Python<->JS trait contract.
  interaction_model_keys?: readonly string[]
}

// Every prop a spec drives
const driven_props = ({ no_style, drive }: WidgetSpec): readonly DrivenProp[] =>
  no_style ? drive : [drive_prop(`style`), ...drive]
// Viewers with a drop zone: file drops are off in notebooks
const no_file_drop = { allow_file_drop: false }

// Mount a widget from its spec: build a two-way reactive $state props object (Python
// trait changes -> live view, component interaction -> model). Returns the teardown that
// unregisters the model listeners, stops the writeback effects and unmounts the component.
// Exported so tests can mount a single widget's wiring directly.
export const mount_spec = (
  model: AnyModel,
  element: HTMLElement,
  spec: WidgetSpec,
  on_update_error?: (error: unknown) => void,
): (() => void) => {
  element.style.boxSizing = `border-box`
  element.style.maxWidth = `100%`
  element.style.marginRight = `2em` // avoid overflow in vscode-interactive cell container
  const interaction = spec.interactions?.(model)
  const { props, dispose } = reactive_widget(
    model,
    driven_props(spec),
    { ...spec.static_props, ...interaction?.props },
    on_update_error,
  )
  let instance: ReturnType<typeof mount> | undefined
  const teardown = (): void => {
    interaction?.cleanup?.()
    dispose()
    if (instance) void unmount(instance)
  }
  try {
    instance = mount(spec.component as Parameters<typeof mount>[0], { target: element, props })
  } catch (error) {
    teardown() // a mount throwing on a malformed trait must not leave model listeners behind
    throw error
  }
  return teardown
}

// === Widget registry ===
// One spec per component of the registry shared with the custom elements, keyed by widget_type.
// Exported so tests can exercise each widget's drive/writeback/derived wiring.
export const WIDGETS: Record<string, WidgetSpec> = {
  structure: {
    component: Structure,
    static_props: no_file_drop,
    drive: [
      // show_site_labels/show_site_indices are delivered via scene_props (see scene_pick_keys),
      // not as top-level Structure props. highlighted_sites stays drive-only: the component
      // sets it from info-pane hover (high frequency), so writeback would flood the comm channel.
      ...drive_props(`show_controls structure enable_info_pane fullscreen_toggle png_dpi
        isosurface_settings highlighted_sites`),
      ...traj_structure_prop_keys.map(drive_prop),
      derived_prop(`source`, [`data_url`, `structure_string`], (model) => {
        const url = get_prop(model, `data_url`)
        const data = get_prop(model, `structure_string`)
        return url || (data ? { data, filename: `string` } : undefined)
      }),
      // Traits carry nested JSON grids; the renderer stores flat typed arrays
      derived_prop(`volumetric_data`, [`volumetric_data`], (model) => {
        const raw = get_prop(model, `volumetric_data`)
        if (raw == null) return undefined
        return (Array.isArray(raw) ? raw : [raw]).map(volume_from_json)
      }),
      writeback_prop(`active_volume_id`),
      writeback_prop(`display_mode`, `structure`),
      writeback_prop(`slice_settings`, {}),
      writeback_prop(`selected_sites`, []),
      writeback_prop(`hovered_site_idx`),
      // Open floating pane (StructurePane), e.g. 'flight' for the camera-flight planner
      writeback_prop(`active_pane`),
      derived_prop(`scene_props`, scene_prop_keys, get_scene_props),
    ],
  },
  trajectory: {
    component: Trajectory,
    static_props: no_file_drop,
    drive: [
      ...drive_props(`show_controls layout fullscreen_toggle auto_play step_labels
        property_labels`),
      // The JSON trait (pymatgen Trajectory, { frames }, array of structures) becomes an
      // in-memory run; data_url is fetched and parsed by the file viewer itself. A malformed
      // trait throws like a malformed spectral one, failing the mount with the parse error
      derived_prop(`trajectory`, [`trajectory`], (model) => {
        const value = get_prop(model, `trajectory`)
        return value == null ? undefined : trajectory_from_json(value, { format: `json` })
      }),
      derived_prop(`source`, [`data_url`], (model) => get_prop(model, `data_url`)),
      // atom_type_mapping ({ "1": "Si", "2": "O" }) names the atom types of a LAMMPS dump
      // fetched from data_url; it rides in the file viewer's loading_options. None/{} mean
      // unset, so loading_options falls back to the viewer's default
      derived_prop(`loading_options`, [`atom_type_mapping`], (model) => {
        const atom_type_mapping = get_prop(model, `atom_type_mapping`)
        const is_set =
          is_plain_object(atom_type_mapping) && Object.keys(atom_type_mapping).length > 0
        return is_set ? { atom_type_mapping } : undefined
      }),
      // Keep playback, layout and plot selection synchronized with the notebook.
      writeback_prop(`current_step_idx`, 0),
      writeback_prop(`display_mode`, DEFAULTS.trajectory.display_mode),
      writeback_prop(`plot_type`, DEFAULTS.trajectory.plot_type),
      writeback_prop(`distribution_property`),
      // Open floating pane (TrajectoryPane), e.g. 'hotspots' or 'flight'
      writeback_prop(`active_pane`),
      // Docked data inspector sidebar (open by default, as in the component)
      writeback_prop(`data_inspector_open`, true),
      derived_prop(
        `structure_props`,
        [...scene_prop_keys, ...traj_structure_prop_keys],
        get_structure_props,
      ),
    ],
  },
  scatter_plot: {
    component: ScatterPlot,
    // selected_point drives the highlight from Python; active_point/hovered_point are
    // written back via the interaction callbacks.
    drive: [
      ...cartesian_plot_drive(`styles show_legend marker_renderer color_scale size_scale
        density_contours fill_regions error_bands hover_config label_placement_config
        point_tween line_tween selected_point`),
      // None hides these, {} keeps the defaults
      nullable_prop(`color_bar`),
      nullable_prop(`size_legend`),
    ],
    interactions: scatter_interactions,
    interaction_model_keys: [`active_point`, `hovered_point`],
  },
  scatter_plot_3d: {
    component: ScatterPlot3D,
    drive:
      with_plot_controls(`series surfaces ref_lines ref_planes x_axis y_axis z_axis display
      styles show_legend color_scale size_scale legend camera_projection point_tween`),
  },
  bar_plot: {
    component: BarPlot,
    drive: cartesian_plot_drive(
      `show_legend orientation mode bar line color_scale size_scale`,
    ),
  },
  histogram: {
    component: Histogram,
    drive: [
      ...cartesian_plot_drive(`show_legend bins mode bar`),
      writeback_prop(`selected_series_idx`, 0),
    ],
  },
  composition: {
    component: Composition,
    drive: drive_props(`composition mode show_percentages color_scheme patterns`),
  },
  convex_hull: {
    component: ConvexHull,
    static_props: no_file_drop,
    drive: drive_props(`show_controls entries show_stable show_unstable show_hull_faces
      hull_face_opacity show_stable_labels show_unstable_labels max_hull_dist_show_labels
      max_hull_dist_show_phases temperature`),
  },
  band_structure: {
    component: Bands,
    drive: [
      band_structs_prop,
      ...with_plot_controls(`show_legend fermi_level reference_frequency`),
    ],
  },
  dos: {
    component: Dos,
    drive: [
      doses_prop,
      ...with_plot_controls(`stack sigma normalize orientation show_legend spin_mode`),
    ],
  },
  bands_and_dos: {
    // BandsAndDos forwards config to its child Bands/Dos via bands_props/dos_props.
    // The parent owns the shared Fermi reference; hover frequency and DOS orientation
    // are controlled internally.
    component: BandsAndDos,
    drive: [
      // structure adds its Brillouin zone beside the bands, configured by bz_props
      band_structs_prop,
      doses_prop,
      ...drive_props(`fermi_level structure bz_props`),
      picked_prop(`bands_props`, `show_legend ${plot_control_keys}`),
      picked_prop(
        `dos_props`,
        `stack sigma normalize show_legend spin_mode ${plot_control_keys}`,
      ),
    ],
  },
  fermi_surface: {
    component: FermiSurface,
    static_props: no_file_drop,
    drive: [
      ...drive_props(`show_controls fermi_data band_data mu color_property color_scale
        property_name custom_property_label representation surface_opacity show_bz bz_opacity
        show_vectors camera_projection`),
      nullable_prop(`color_bar`),
    ],
  },
  brillouin_zone: {
    component: BrillouinZone,
    static_props: no_file_drop,
    drive:
      drive_props(`show_controls structure bz_data surface_color surface_opacity edge_color
      edge_width show_vectors show_ibz ibz_color ibz_opacity camera_projection`),
  },
  phase_diagram: {
    component: IsobaricBinaryPhaseDiagram,
    static_props: no_file_drop,
    drive: drive_props(`show_controls data`),
  },
  xrd: {
    component: XrdPlot,
    static_props: no_file_drop,
    drive: with_plot_controls(`patterns`),
  },
  periodic_table: {
    component: PeriodicTable,
    drive: [
      ...drive_props(`heatmap_values color_scale color_overrides labels gap missing`),
      nullable_prop(`color_bar`),
    ],
  },
  rdf_plot: {
    component: RdfPlot,
    static_props: no_file_drop,
    drive:
      with_plot_controls(`patterns structures mode show_reference_line cutoff n_bins x_axis
      y_axis`),
  },
  heatmap_matrix: {
    component: HeatmapMatrix,
    drive: [
      ...drive_props(`show_controls x_items y_items values color_scale missing x_axis y_axis
        tile_size gap show_values label_style`),
      nullable_prop(`color_bar`),
    ],
  },
  spacegroup_bar: {
    component: SpacegroupBarPlot,
    drive: drive_props(`show_controls data show_counts show_legend orientation x_axis y_axis`),
  },
  chem_pot_diagram: {
    // ChemPotDiagram sizes itself through width/height and spreads no rest props, so the
    // notebook wrapper `style` has nowhere to go: size it with the width/height traits
    component: ChemPotDiagram,
    no_style: true,
    drive: drive_props(`entries config temperature width height`),
  },
  treemap: {
    component: Treemap,
    drive:
      hierarchy_drive(`padding_inner padding_top padding_outer label_fit label_min_font_size
      label_max_font_size parent_label_font_size`),
  },
  sunburst: {
    component: Sunburst,
    drive: hierarchy_drive(`shape inner_radius pad_angle label_rotation`),
  },
  sankey: {
    component: Sankey,
    drive: with_plot_controls(`data orientation node_width node_padding node_align min_fraction
      max_links iterations link_opacity link_color_mode show_node_labels value_format padding
      legend show_legend fullscreen_toggle`),
  },
  box_plot: {
    component: BoxPlot,
    drive: cartesian_plot_drive(`show_legend orientation title box whisker median_style
      sample_style whisker_mode whisker_range whisker_percentiles show_outliers show_mean points
      show_value_labels value_label_stat value_label_format kind side bandwidth violin_width
      violin_style kde_clip`),
  },
  ternary_plot: {
    component: TernaryPlot,
    drive: [
      ...with_plot_controls(`series labels grid_step show_grid show_ticks tick_format color_scale
        padding legend show_legend fullscreen_toggle`),
      nullable_prop(`color_bar`),
    ],
  },
  ternary_phase_diagram: {
    component: IsobaricTernaryPhaseDiagram,
    static_props: no_file_drop,
    drive: [
      ...drive_props(`show_controls entries options temperature display free_energy_mode t_range
        n_samples gas_enabled gas_pressures fullscreen_toggle title`),
      // Clicked phase (index into the computed diagram's phases) and composition probe
      writeback_prop(`selected_phase`),
      writeback_prop(`pinned_composition`),
    ],
  },
  neb_plot: {
    component: NebPlot,
    drive: [
      ...with_plot_controls(`paths coord_options coord_mode energy_reference show_spline
        annotate_barrier x_axis y_axis`),
      // The hovered or clicked image, to link e.g. a structure widget showing it
      writeback_prop(`active_path_key`, ``),
      writeback_prop(`active_image_idx`, 0),
    ],
  },
  eos_plot: {
    component: EosPlot,
    drive: [
      ...with_plot_controls(`volumes energies kinds show_fit_params data_label x_axis y_axis`),
      // Output only: the fitted E0, V0, B0, B0' and RMSE per successful kind
      writeback_prop(`fits`, []),
    ],
  },
  phonon_mode_explorer: {
    // No show_controls prop: the explorer's panes carry their own chrome
    component: PhononModeExplorer,
    drive: [
      ...drive_props(`phonons spectrum_kind amplitude supercell n_frames fps show_vectors
        vector_thickness vector_color auto_play pane_ratio show_bz_inset band_coloring
        mode_values`),
      // The animated mode { qpoint_idx, mode_idx }: follows clicks on the dispersion/spectrum
      writeback_prop(`selection`),
    ],
  },
} satisfies Record<keyof typeof COMPONENTS, WidgetSpec>

// Machine-readable trait contract: for each widget_type, every model trait the JS
// side reads (drive/derived/writeback deps + style) or writes (interaction
// callbacks). Consumed by pymatviz's prop-parity test to flag Python widget traits
// the frontend would silently ignore (and frontend props Python cannot set).
export const WIDGET_MODEL_KEYS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(WIDGETS).map(([widget_type, spec]) => {
    const model_keys = driven_props(spec).flatMap(({ deps }) => deps)
    return [
      widget_type,
      [...new Set([...model_keys, ...(spec.interaction_model_keys ?? [])])].toSorted(),
    ]
  }),
)

// Detect widget type and render
const render: Render = (props) => {
  const { model, el: element } = props
  const widget_type = get_prop(model, `widget_type`) as string | undefined
  // anywidget only logs a throwing render or change handler, which leaves a blank or silently
  // stale cell, so a bad widget_type or malformed trait shows its error in place of the widget
  const show_error = (error: unknown): void => {
    element.textContent = `MatterViz ${widget_type}: ${error instanceof Error ? error.message : error}`
  }
  // guard with Object.hasOwn so prototype keys (toString, constructor, ...) don't
  // resolve as specs and silently bypass the unknown-widget_type error
  const spec =
    widget_type && Object.hasOwn(WIDGETS, widget_type) ? WIDGETS[widget_type] : undefined

  cleanup_element(element)
  element.classList.add(WIDGET_CLASS)
  inject_app_css(element)
  // Workers fetch moyo from the CDN; a host-served WASM (offline use) keeps symmetry here
  const { matterviz_moyo_wasm_url } = globalThis as { matterviz_moyo_wasm_url?: string }
  if (matterviz_moyo_wasm_url) set_moyo_wasm_source(matterviz_moyo_wasm_url)
  // The widget's theme is its own color-scheme, now and as the host's changes: light-dark()
  // tokens, native form controls and svelte-widgets all resolve against it, and setting it on
  // the element (not the host page's root) leaves the notebook's own scheme alone. Started
  // before mount so the first paint already has it; a throwing mount stops it and replaces the
  // partial DOM with the error.
  const stop_theme = watch_theme(element, (theme) => (element.style.colorScheme = theme))
  let unmount_widget: () => void
  try {
    if (!spec) throw new Error(`Unknown or missing widget_type: '${widget_type}'`)
    // A malformed update tears the widget down: it no longer reflects the Python state
    unmount_widget = mount_spec(model, element, spec, (error) => {
      cleanup_element(element)
      show_error(error)
      console.error(`MatterViz ${widget_type}: trait update failed`, error)
    })
  } catch (error) {
    stop_theme()
    show_error(error)
    throw error
  }
  cleanups.set(element, () => {
    stop_theme()
    unmount_widget()
  })
  return () => cleanup_element(element)
}

export default { render }
