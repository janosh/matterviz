/// <reference types="vite/client" />

// MatterViz AnyWidget Entry Point

import { is_plain_object } from 'svelte-widgets/utils'
import type { AnyModel, Render } from 'anywidget/types'
import {
  normalize_band_structure,
  normalize_dos,
  set_moyo_wasm_source,
  trajectory_from_binary,
  trajectory_from_json,
  volume_from_binary,
  volume_from_json,
} from 'matterviz'
import {
  html_to_svg,
  is_binary_envelope,
  series_from_binary,
  svg_to_string,
} from 'matterviz/io'
import { check_blob_workers } from 'matterviz/workers'
import { DEFAULTS } from 'matterviz/settings'
import { watch_theme } from 'matterviz/theme/embedded'
import { type Component, mount, unmount } from 'svelte'
import load_component from 'virtual:matterviz-widget-components'
import type { COMPONENTS } from '../../src/elements/components'
import type { DrivenProp, ModelKeySchema, ModelKeyTarget } from './reactive.svelte'
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
// widget_type of each mounted element, for export_svg
const rendered_types = new WeakMap<HTMLElement, string>()

const cleanup_element = (element: HTMLElement): void => {
  cleanups.get(element)?.()
  cleanups.delete(element)
}

// Build an object of { key: model.get(key) } for each key in the list
const pick_props = (model: AnyModel, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, get_prop(model, key)]))

// Each key lands unchanged under the prop path `path` (targets of a picked prop)
const nested_targets = (
  path: readonly string[],
  keys: readonly string[],
): Record<string, ModelKeyTarget> =>
  Object.fromEntries(keys.map((key) => [key, [...path, key]]))

// Derived prop bundling several traits into one object prop (deps == picked keys),
// e.g. bands_props / dos_props.
const picked_prop = (name: string, keys: string): DrivenProp =>
  derived_prop(
    name,
    words(keys),
    (model) => pick_props(model, words(keys)),
    nested_targets([name], words(keys)),
  )

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
  derived_prop(
    target,
    [target, source],
    (model) => merge_object_prop(get_prop(model, target), sub_key, get_prop(model, source)),
    { [target]: [target], [source]: [target, sub_key] },
  )

// Plot series as JSON, or (for large ones) binary `plot-series` envelopes whose numeric
// columns arrive as typed arrays (readme)
const series_prop = derived_prop(
  `series`,
  [`series`],
  (model) => {
    const series = get_prop(model, `series`)
    if (is_binary_envelope(series)) {
      throw new TypeError(
        `series must be a list of series; wrap a binary plot-series in a list`,
      )
    }
    return Array.isArray(series)
      ? series.map((srs) => (is_binary_envelope(srs) ? series_from_binary(srs) : srs))
      : series
  },
  { series: { type: [`array`] } },
)

const plot_common_drive: readonly DrivenProp[] = [
  series_prop,
  ...drive_props(`display legend ref_lines padding range_padding`),
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
const band_structs_prop = derived_prop(
  `band_structs`,
  [`band_structs`],
  (model) =>
    spectral_record(
      get_prop(model, `band_structs`),
      normalize_band_structure,
      `band structure`,
    ),
  { band_structs: { type: [`object`] } },
)
const doses_prop = derived_prop(
  `doses`,
  [`doses`],
  (model) => spectral_record(get_prop(model, `doses`), normalize_dos, `DOS`),
  { doses: { type: [`object`] } },
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

// Declarative description of one widget: its reactive props (drive / derived / writeback) and
// optional interaction callbacks + teardown. Its component is COMPONENTS' entry for the same
// widget_type, loaded on first render (vite.config.ts's widget_components)
type WidgetSpec = {
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
  // Model traits written by interaction callbacks (not derivable from drive specs) and the JSON
  // kinds written; listed so WIDGET_MODEL_KEYS reflects the full Python<->JS trait contract.
  interaction_model_keys?: Readonly<Record<string, ModelKeySchema>>
  // Selector of an HTML-built figure (CSS grids, side-by-side panels) export_svg redraws as SVG:
  // the element the component's own Export pane exports, so both give the same file
  html_figure?: string
}

// Every prop a spec drives
const driven_props = ({ no_style, drive }: WidgetSpec): readonly DrivenProp[] =>
  no_style ? drive : [drive_prop(`style`), ...drive]
// Viewers with a drop zone: file drops are off in notebooks
const no_file_drop = { allow_file_drop: false }

// Mount a widget's component: build a two-way reactive $state props object (Python
// trait changes -> live view, component interaction -> model). Returns the teardown that
// unregisters the model listeners, stops the writeback effects and unmounts the component.
// Exported so tests can mount a single widget's wiring directly.
export const mount_spec = (
  model: AnyModel,
  element: HTMLElement,
  spec: WidgetSpec,
  component: Component<Record<string, unknown>>,
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
    instance = mount(component, { target: element, props })
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
    static_props: no_file_drop,
    drive: [
      // show_site_labels/show_site_indices are delivered via scene_props (see scene_pick_keys),
      // not as top-level Structure props. highlighted_sites stays drive-only: the component
      // sets it from info-pane hover (high frequency), so writeback would flood the comm channel.
      ...drive_props(`show_controls structure enable_info_pane fullscreen_toggle png_dpi
        isosurface_settings highlighted_sites cell_type`),
      ...traj_structure_prop_keys.map(drive_prop),
      derived_prop(
        `source`,
        [`data_url`, `structure_string`],
        (model) => {
          const url = get_prop(model, `data_url`)
          const data = get_prop(model, `structure_string`)
          return url || (data ? { data, filename: `string` } : undefined)
        },
        { data_url: [`source`], structure_string: [`source`, `data`] },
      ),
      // Nested JSON grids or binary envelopes (readme), one or a list; the renderer stores
      // flat typed arrays
      derived_prop(
        `volumetric_data`,
        [`volumetric_data`],
        (model) => {
          const raw = get_prop(model, `volumetric_data`)
          if (raw == null) return undefined
          return (Array.isArray(raw) ? raw : [raw]).map((volume) =>
            is_binary_envelope(volume) ? volume_from_binary(volume) : volume_from_json(volume),
          )
        },
        { volumetric_data: { type: [`object`, `array`] } },
      ),
      writeback_prop(`active_volume_id`),
      writeback_prop(`display_mode`, `structure`),
      writeback_prop(`slice_settings`, {}),
      writeback_prop(`selected_sites`, []),
      writeback_prop(`hovered_site_idx`),
      // Open floating pane (StructurePane), e.g. 'flight' for the camera-flight planner
      writeback_prop(`active_pane`),
      derived_prop(
        `scene_props`,
        scene_prop_keys,
        get_scene_props,
        nested_targets([`scene_props`], scene_prop_keys),
      ),
    ],
  },
  trajectory: {
    static_props: no_file_drop,
    drive: [
      ...drive_props(`show_controls layout fullscreen_toggle auto_play step_labels
        property_labels`),
      // The JSON trait (pymatgen Trajectory, { frames }, array of structures) or a binary
      // envelope (readme) becomes an in-memory run; data_url is fetched and parsed by the file
      // viewer. A malformed trait throws like a malformed spectral one, failing the mount
      derived_prop(
        `trajectory`,
        [`trajectory`],
        (model) => {
          const value = get_prop(model, `trajectory`)
          if (value == null) return undefined
          if (is_binary_envelope(value)) return trajectory_from_binary(value)
          return trajectory_from_json(value, { format: `json` })
        },
        { trajectory: { type: [`object`, `array`] } },
      ),
      derived_prop(`source`, [`data_url`], (model) => get_prop(model, `data_url`), {
        data_url: [`source`],
      }),
      // atom_type_mapping ({ "1": "Si", "2": "O" }) names the atom types of a LAMMPS dump
      // fetched from data_url; it rides in the file viewer's loading_options. None/{} mean
      // unset, so loading_options falls back to the viewer's default
      derived_prop(
        `loading_options`,
        [`atom_type_mapping`],
        (model) => {
          const atom_type_mapping = get_prop(model, `atom_type_mapping`)
          const is_set =
            is_plain_object(atom_type_mapping) && Object.keys(atom_type_mapping).length > 0
          return is_set ? { atom_type_mapping } : undefined
        },
        { atom_type_mapping: [`loading_options`, `atom_type_mapping`] },
      ),
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
        {
          ...nested_targets([`structure_props`, `scene_props`], scene_prop_keys),
          ...nested_targets([`structure_props`], traj_structure_prop_keys),
        },
      ),
    ],
  },
  scatter_plot: {
    // selected_point drives the highlight from Python; active_point/hovered_point are
    // written back via the interaction callbacks.
    drive: [
      ...cartesian_plot_drive(`styles show_legend marker_renderer color_scale size_scale
        density_contours fill_regions error_bands hover_config label_placement_config
        point_tween line_tween selected_point highlighted_ids annotation`),
      // None hides these, {} keeps the defaults
      nullable_prop(`color_bar`),
      nullable_prop(`size_legend`),
    ],
    interactions: scatter_interactions,
    // { series_idx, point_idx, x, y } (active_point adds event_id), or null when cleared
    interaction_model_keys: {
      active_point: { type: [`object`, `null`] },
      hovered_point: { type: [`object`, `null`] },
    },
  },
  scatter_plot_3d: {
    drive: [
      series_prop,
      ...with_plot_controls(`surfaces ref_lines ref_planes x_axis y_axis z_axis display styles
        show_legend color_scale size_scale legend camera_projection point_tween`),
    ],
  },
  binned_scatter_plot: {
    drive: [
      series_prop,
      ...drive_props(`size_scale density overlays padding range_padding title point_labels
        selected_point_id marginals annotation fullscreen_toggle`),
      // x_range/y_range fold into the axes like the other cartesian plots'
      ...words(`x y`).map((axis) => merged_prop(`${axis}_axis`, `range`, `${axis}_range`)),
      // Switches between density bins and points as the user zooms (density.auto_point_mode)
      writeback_prop(`render_mode`, `density`),
      nullable_prop(`color_bar`),
    ],
  },
  bar_plot: {
    drive: cartesian_plot_drive(
      `show_legend orientation mode bar line color_scale size_scale`,
    ),
  },
  histogram: {
    drive: [
      ...cartesian_plot_drive(`show_legend bins mode bar`),
      writeback_prop(`selected_series_idx`, 0),
    ],
  },
  composition: {
    drive: drive_props(`composition mode show_percentages color_scheme patterns`),
  },
  convex_hull: {
    static_props: no_file_drop,
    drive: drive_props(`show_controls entries show_stable show_unstable show_hull_faces
      hull_face_opacity show_stable_labels show_unstable_labels max_hull_dist_show_labels
      max_hull_dist_show_phases temperature`),
  },
  band_structure: {
    drive: [
      band_structs_prop,
      ...with_plot_controls(`show_legend fermi_level reference_frequency`),
    ],
  },
  dos: {
    drive: [
      doses_prop,
      ...with_plot_controls(`stack sigma normalize orientation show_legend spin_mode`),
    ],
  },
  bands_and_dos: {
    // BandsAndDos forwards config to its child Bands/Dos via bands_props/dos_props.
    // The parent owns the shared Fermi reference; hover frequency and DOS orientation
    // are controlled internally.
    html_figure: `.bands-and-dos`,
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
    static_props: no_file_drop,
    drive: [
      ...drive_props(`show_controls fermi_data band_data mu color_property color_scale
        property_name custom_property_label representation surface_opacity show_bz bz_opacity
        show_vectors camera_projection`),
      nullable_prop(`color_bar`),
    ],
  },
  brillouin_zone: {
    static_props: no_file_drop,
    drive:
      drive_props(`show_controls structure bz_data surface_color surface_opacity edge_color
      edge_width show_vectors show_ibz ibz_color ibz_opacity camera_projection k_path
      default_k_path`),
  },
  phase_diagram: {
    static_props: no_file_drop,
    drive: drive_props(`show_controls data`),
  },
  xrd: {
    static_props: no_file_drop,
    drive: with_plot_controls(`patterns`),
  },
  periodic_table: {
    html_figure: `.periodic-table`,
    drive: [
      ...drive_props(`heatmap_values color_scale color_overrides labels gap missing tile_plots
        tile_plot_config split_layout tile_props active_elements`),
      nullable_prop(`color_bar`),
      // Tile clicks toggle elements in active_elements once Python opts in by setting it to
      // a list (link_selection does); until then they pin the tile's tooltip and inset plot
      derived_prop(`on_activate`, [`active_elements`], (model) => {
        const active = model.get(`active_elements`) as string[] | null | undefined
        if (!active) return undefined
        return ({ symbol }: { symbol: string }) =>
          set_model(
            model,
            `active_elements`,
            active.includes(symbol)
              ? active.filter((sym) => sym !== symbol)
              : [...active, symbol],
          )
      }),
    ],
  },
  rdf_plot: {
    static_props: no_file_drop,
    drive:
      with_plot_controls(`patterns structures mode show_reference_line cutoff n_bins x_axis
      y_axis`),
  },
  coordination_bar_plot: {
    // Computes its CN series from the structures, so the shared `series` trait has no place here
    static_props: no_file_drop,
    drive: [
      ...with_plot_controls(`structures strategy split_mode orientation show_legend display
        legend padding x_axis y_axis`),
      writeback_prop(`mode`, `grouped`),
    ],
  },
  heatmap_matrix: {
    // not the controls pane's SettingsSection (class `settings-section grid`)
    html_figure: `.heatmap > .grid`,
    drive: [
      ...drive_props(`show_controls x_items y_items values color_scale missing x_axis y_axis
        tile_size gap show_values label_style`),
      nullable_prop(`color_bar`),
    ],
  },
  spacegroup_bar: {
    // No show_controls: the component renders its BarPlot without controls
    drive: drive_props(`data show_counts show_legend orientation x_axis y_axis`),
  },
  chem_pot_diagram: {
    // ChemPotDiagram sizes itself through width/height and spreads no rest props, so the
    // notebook wrapper `style` has nowhere to go: size it with the width/height traits
    no_style: true,
    drive: drive_props(`entries config temperature width height`),
  },
  treemap: {
    drive:
      hierarchy_drive(`padding_inner padding_top padding_outer label_fit label_align label_min_font_size
      label_max_font_size parent_label_font_size`),
  },
  sunburst: {
    drive: hierarchy_drive(`shape inner_radius pad_angle label_rotation`),
  },
  sankey: {
    drive: with_plot_controls(`data orientation node_width node_padding node_align min_fraction
      max_links iterations link_opacity link_color_mode show_node_labels value_format padding
      legend show_legend fullscreen_toggle`),
  },
  box_plot: {
    drive: cartesian_plot_drive(`show_legend orientation title box whisker median_style
      sample_style whisker_mode whisker_range whisker_percentiles show_outliers show_mean points
      show_value_labels value_label_stat value_label_format kind side bandwidth violin_width
      violin_style kde_clip point_side`),
  },
  ternary_plot: {
    drive: [
      series_prop,
      ...with_plot_controls(`labels grid_step show_grid show_ticks tick_format color_scale
        padding legend show_legend fullscreen_toggle`),
      nullable_prop(`color_bar`),
    ],
  },
  ternary_phase_diagram: {
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
    drive: [
      ...with_plot_controls(`paths coord_options coord_mode energy_reference show_spline
        annotate_barrier x_axis y_axis`),
      // The hovered or clicked image, to link e.g. a structure widget showing it
      writeback_prop(`active_path_key`, ``),
      writeback_prop(`active_image_idx`, 0),
    ],
  },
  eos_plot: {
    drive: [
      ...with_plot_controls(`volumes energies kinds show_fit_params data_label x_axis y_axis`),
      // Output only: the fitted E0, V0, B0, B0' and RMSE per successful kind
      writeback_prop(`fits`, []),
    ],
  },
  phonon_mode_explorer: {
    // No show_controls prop: the explorer's panes carry their own chrome
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
      [
        ...new Set([...model_keys, ...Object.keys(spec.interaction_model_keys ?? {})]),
      ].toSorted(),
    ]
  }),
)

// Where each model key goes, from which the build types build/widget-model-schema.json against
// the components' props: per widget_type and key, every prop path its value reaches unchanged
// and every JSON-kinds schema a transforming prop or interaction callback declares for it
export const WIDGET_MODEL_TARGETS: Record<
  string,
  Record<string, ModelKeyTarget[]>
> = Object.fromEntries(
  Object.entries(WIDGETS).map(([widget_type, spec]) => {
    const targets: Record<string, ModelKeyTarget[]> = {}
    const add = (key: string, target: ModelKeyTarget): void => {
      targets[key] = [...(targets[key] ?? []), target]
    }
    for (const { targets: prop_targets = {} } of driven_props(spec)) {
      for (const [key, target] of Object.entries(prop_targets)) add(key, target)
    }
    for (const [key, schema] of Object.entries(spec.interaction_model_keys ?? {})) {
      add(key, schema)
    }
    return [widget_type, targets]
  }),
)

// Hosts list their widget's synced traits in _synced_keys (the anywidget model can't enumerate
// its keys). A trait no spec reads would be silently dropped, so name it rather than render a
// partial widget. Either side can be stale: a Python package newer than the bundle, or a saved
// notebook's state older than the URL-synced bundle it now loads. widget_type, style and
// show_controls are base traits no spec has to read.
const check_synced_keys = (model: AnyModel, widget_type: string): void => {
  const synced_keys = get_prop(model, `_synced_keys`)
  let problem = `_synced_keys must be a list of trait names, got ${typeof synced_keys}`
  if (Array.isArray(synced_keys)) {
    const read_keys = new Set(WIDGET_MODEL_KEYS[widget_type])
    const base_keys = [`widget_type`, `style`, `show_controls`]
    const unknown = synced_keys.filter(
      (key) => !read_keys.has(key) && !base_keys.includes(key),
    )
    if (!unknown.length) return
    problem = `this matterviz-anywidget bundle doesn't read ${widget_type} trait(s) ${unknown.join(`, `)}`
  }
  throw new Error(
    `${problem}. Python wrapper and bundle versions differ: re-run the cell with the Python ` +
      `package version this bundle matches, or load the bundle version matching the Python package.`,
  )
}

// Detect widget type and render
const render: Render = async (props) => {
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
  // a cleanup while the component loads (the element rendering again) cancels this render
  let cancelled = false
  let unmount_widget = (): void => {}
  const cleanup = (): void => {
    cancelled = true
    rendered_types.delete(element)
    stop_theme()
    unmount_widget()
  }
  cleanups.set(element, cleanup)
  try {
    if (!widget_type || !spec)
      throw new Error(`Unknown or missing widget_type: '${widget_type}'`)
    check_synced_keys(model, widget_type)
    // its own chunks in the split build, already inlined in the single-file one
    const { default: component } = await load_component[widget_type]()
    if (cancelled) return () => {}
    // A malformed update tears the widget down: it no longer reflects the Python state
    unmount_widget = mount_spec(model, element, spec, component, (error) => {
      cleanup_element(element)
      show_error(error)
      console.error(`MatterViz ${widget_type}: trait update failed`, error)
    })
    rendered_types.set(element, widget_type)
  } catch (error) {
    if (!cancelled) {
      cleanup_element(element)
      show_error(error)
    }
    throw error
  }
  // a stale disposer (the element since rendered again) leaves the later widget mounted
  return () => {
    if (cleanups.get(element) === cleanup) cleanup_element(element)
  }
}

// Standalone SVG file content of a rendered widget, through the same serializer as the in-app
// SVG export: HTML figures redrawn as SVG, else the largest <svg> (under 20px: an icon). Throws
// for a chart-sized (50px+) canvas outside that SVG (3D viewers, canvas charts): no vector form.
export function export_svg(element: HTMLElement, png_dpi?: number): string {
  const widget_type = rendered_types.get(element)
  if (!widget_type) throw new Error(`No rendered MatterViz widget to export`)
  const { html_figure } = WIDGETS[widget_type]
  const area = (node: Element, min_px: number): number => {
    const { width, height } = node.getBoundingClientRect()
    return width >= min_px && height >= min_px ? width * height : 0
  }
  const figure = html_figure
    ? element.querySelector(html_figure)
    : ([...element.querySelectorAll(`svg`)]
        .filter((svg) => area(svg, 20))
        .toSorted((svg_a, svg_b) => area(svg_b, 0) - area(svg_a, 0))[0] ?? null)
  // canvases in an SVG's <foreignObject> (canvas markers) export as images, HTML redraws drop them
  const canvas = [...element.querySelectorAll(`canvas`)].find(
    (node) => area(node, 50) && !(figure instanceof SVGElement && figure.contains(node)),
  )
  if (canvas || !figure) {
    const content = canvas ? `canvas content` : `no ${html_figure ?? `<svg>`} figure`
    throw new Error(
      `MatterViz ${widget_type} renders ${content}, which has no vector form: export PNG or PDF instead`,
    )
  }
  return svg_to_string(
    figure instanceof SVGElement ? figure : html_to_svg(figure as HTMLElement),
    png_dpi,
  )
}

export default { render }
