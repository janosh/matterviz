// MatterViz AnyWidget Entry Point

import type { AnyModel, Render } from 'anywidget/types'
import {
  Bands,
  BandsAndDos,
  BarPlot,
  BrillouinZone,
  ChemPotDiagram,
  Composition,
  ConvexHull,
  Dos,
  FermiSurface,
  HeatmapMatrix,
  Histogram,
  IsobaricBinaryPhaseDiagram,
  PeriodicTable,
  RdfPlot,
  ScatterPlot,
  ScatterPlot3D,
  SpacegroupBarPlot,
  Structure,
  Trajectory,
  XrdPlot,
} from 'matterviz'
import app_css from 'matterviz/app.css?raw'
import type { ThemeType } from 'matterviz/theme'
import { mount, unmount } from 'svelte'
import type { DrivenProp } from './reactive.svelte'
import {
  derived_prop,
  drive_prop,
  drive_props,
  get_prop,
  next_event_id,
  reactive_widget,
  rename_prop,
  set_model,
  throttle,
  writeback_prop,
} from './reactive.svelte'
import { detect_parent_theme, get_theme_css, watch_theme } from './theme-detection'

const adopted_sheets = new WeakMap<ShadowRoot, CSSStyleSheet>()

// Static widget chrome + bundled app styles. Only the theme-variable block
// (get_theme_css) changes between calls, so keep this constant rather than
// rebuilding the full ~150 KB string on every theme change.
const widget_base_css = `
    .cell-output-ipywidget-background { background: transparent !important; }
    :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), textarea, select) {
      background-color: var(--surface-bg); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 4px; padding: 6px 8px;
    }
    :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), textarea, select):focus {
      outline: none; border-color: var(--accent-color); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 25%, transparent);
    }
    :is(input, textarea)::placeholder { color: var(--text-color-muted); }
    select option { background-color: var(--surface-bg); color: var(--text-color); }
    ${app_css}
  `

function inject_app_css(theme_type?: ThemeType, target_element?: HTMLElement): void {
  const style_id = `matterviz-widget-styles`
  const detected_theme = theme_type ?? detect_parent_theme(target_element)

  // Determine if we're in Shadow DOM (used by marimo cells) and get the appropriate root
  const root_node = target_element?.getRootNode() ?? document
  const in_shadow = root_node instanceof ShadowRoot

  // Remove existing style element (if any)
  ;(in_shadow ? root_node : document).querySelector(`#${style_id}`)?.remove()

  // Only the theme-variable block varies per call; the rest is widget_base_css.
  const style_content = `${get_theme_css(detected_theme, in_shadow)}${widget_base_css}`

  // Apply styles via adoptedStyleSheets (reuse existing sheet to avoid accumulation)
  if (in_shadow && `adoptedStyleSheets` in root_node) {
    let sheet = adopted_sheets.get(root_node)
    if (!sheet) {
      sheet = new CSSStyleSheet()
      root_node.adoptedStyleSheets = [...root_node.adoptedStyleSheets, sheet]
      adopted_sheets.set(root_node, sheet)
    }
    sheet.replaceSync(style_content)
    return
  }

  // Fallback: create style element
  const style = document.createElement(`style`)
  style.id = style_id
  style.textContent = style_content
  if (in_shadow) root_node.append(style)
  else document.head.append(style)
}

const instances = new WeakMap<HTMLElement, ReturnType<typeof mount>>()
const theme_unsubs = new WeakMap<HTMLElement, () => void>()
// Disposers that unregister model listeners + stop writeback effects for each
// mounted widget (see mount_spec). Kept separate from theme_unsubs so a single
// element can carry both.
const reactive_disposers = new WeakMap<HTMLElement, () => void>()

const cleanup_element = (element: HTMLElement): void => {
  theme_unsubs.get(element)?.()
  theme_unsubs.delete(element)

  reactive_disposers.get(element)?.()
  reactive_disposers.delete(element)

  const instance = instances.get(element)
  if (instance) {
    void unmount(instance)
    instances.delete(element)
  }
}

// Build an object of { key: model.get(key) } for each key in the list
const pick_props = (model: AnyModel, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, get_prop(model, key)]))

// Derived prop bundling several traits into one object prop (deps == picked keys),
// e.g. lattice_props / bands_props / dos_props.
const picked_prop = (name: string, keys: readonly string[]): DrivenProp =>
  derived_prop(name, keys, (model) => pick_props(model, keys))

const as_record = (value: unknown): Record<string, unknown> =>
  value && typeof value === `object` && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const merge_object_prop = (
  base: unknown,
  key: string,
  value: unknown,
): Record<string, unknown> | undefined => {
  if (value === undefined) return base === undefined ? undefined : as_record(base)
  return { ...as_record(base), [key]: value }
}

// Derived prop that folds a flat source trait into a target object trait under sub_key
// (x_range -> x_axis.range, show_controls -> controls.show): the components read the
// nested field, so driving the flat trait alone would be dropped as an unused prop.
const merged_prop = (target: string, sub_key: string, source: string): DrivenProp =>
  derived_prop(target, [target, source], (model) =>
    merge_object_prop(get_prop(model, target), sub_key, get_prop(model, source)),
  )

const axis_props: readonly DrivenProp[] = [
  merged_prop(`x_axis`, `range`, `x_range`),
  merged_prop(`x2_axis`, `range`, `x2_range`),
  merged_prop(`y_axis`, `range`, `y_range`),
  merged_prop(`y2_axis`, `range`, `y2_range`),
]

const controls_prop: DrivenProp = merged_prop(`controls`, `show`, `show_controls`)

const plot_common_prop_keys = [
  `series`,
  `display`,
  `legend`,
  `ref_lines`,
  `padding`,
  `range_padding`,
] as const

const plot_common_drive = [...drive_props(plot_common_prop_keys), ...axis_props]

const scatter_plot_drive: readonly DrivenProp[] = [
  ...plot_common_drive,
  controls_prop,
  ...drive_props([
    `styles`,
    `color_scale`,
    `color_bar`,
    `size_scale`,
    `fill_regions`,
    `error_bands`,
    `hover_config`,
    `label_placement_config`,
    `point_tween`,
    `line_tween`,
    `point_events`,
  ]),
]

const bar_plot_drive: readonly DrivenProp[] = [
  ...plot_common_drive,
  ...drive_props([
    `show_legend`,
    `orientation`,
    `mode`,
    `bar`,
    `line`,
    `color_scale`,
    `size_scale`,
    `point_tween`,
  ]),
]

const histogram_drive: readonly DrivenProp[] = [
  ...plot_common_drive,
  ...drive_props([`show_legend`, `bins`, `mode`, `selected_property`, `bar`]),
]

// Scene traits forwarded verbatim into scene_props via pick_props.
const scene_pick_keys = [
  `atom_radius`,
  `show_atoms`,
  `same_size_atoms`,
  `show_bonds`,
  `bond_thickness`,
  `bond_color`,
  `bonding_strategy`,
  `vector_configs`,
  `vector_scale`,
  `vector_color`,
  `vector_normalize`,
  `vector_uniform_thickness`,
  `vector_origin_gap`,
  // label settings live in scene_props: Structure forwards them to StructureScene
  // via {...scene_props}, not as top-level Structure props
  `show_site_labels`,
  `show_site_indices`,
] as const
// All scene traits (deps for the reactive scene_props derived prop); auto_rotate
// and show_gizmo get explicit defaults in get_scene_props rather than pick_props.
const scene_prop_keys = [...scene_pick_keys, `auto_rotate`, `show_gizmo`] as const

const lattice_prop_keys = [
  `cell_edge_opacity`,
  `cell_surface_opacity`,
  `cell_edge_color`,
  `cell_surface_color`,
  `cell_edge_width`,
  `show_cell_vectors`,
] as const

// Top-level Structure traits the trajectory forwards into its nested structure_props
// (show_site_labels/show_site_indices are NOT here -- they ride inside scene_props).
const traj_structure_prop_keys = [
  `show_image_atoms`,
  `color_scheme`,
  `background_color`,
  `background_opacity`,
] as const

// Build scene/lattice props shared by structure and trajectory renderers
const get_scene_props = (model: AnyModel) => ({
  ...pick_props(model, scene_pick_keys),
  // defaults mirror the Structure component's own auto_rotate/gizmo defaults
  auto_rotate: get_prop(model, `auto_rotate`) ?? 0.2,
  gizmo: get_prop(model, `show_gizmo`) ?? true,
})

// Trajectory forwards a fixed config object to its embedded Structure view.
const get_structure_props = (model: AnyModel) => ({
  scene_props: get_scene_props(model),
  lattice_props: pick_props(model, lattice_prop_keys),
  ...pick_props(model, traj_structure_prop_keys),
  fullscreen_toggle: false,
})

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
// rename / derived / writeback), and optional interaction callbacks + teardown.
type WidgetSpec = {
  component: unknown
  drive: readonly DrivenProp[]
  base_drive?: readonly DrivenProp[]
  interactions?: (model: AnyModel) => { props: Record<string, unknown>; cleanup?: () => void }
}

// Base props every widget gets unless its spec sets base_drive. style is the notebook
// wrapper; show_controls is driven top-level only for components that expose it as a prop
// -- plot widgets read controls.show instead (see controls_prop), so they use style_base_drive.
const top_level_base_drive: readonly DrivenProp[] = [
  drive_prop(`show_controls`),
  drive_prop(`style`),
]
const style_base_drive: readonly DrivenProp[] = [drive_prop(`style`)]

// Mount a widget from its spec: build a two-way reactive $state props object (Python
// trait changes -> live view, component interaction -> model) and wire teardown.
// Exported so tests can mount a single widget's wiring directly.
export const mount_spec = (model: AnyModel, el: HTMLElement, spec: WidgetSpec): void => {
  el.style.boxSizing = `border-box`
  el.style.maxWidth = `100%`
  el.style.marginRight = `2em` // avoid overflow in vscode-interactive cell container
  const interaction = spec.interactions?.(model)
  const { props, dispose } = reactive_widget(
    model,
    [...(spec.base_drive ?? top_level_base_drive), ...spec.drive],
    {
      allow_file_drop: false, // off in notebooks
      ...(interaction?.props ?? {}),
    },
  )
  reactive_disposers.set(el, () => {
    interaction?.cleanup?.()
    dispose()
  })
  instances.set(
    el,
    mount(spec.component as Parameters<typeof mount>[0], { target: el, props }),
  )
}

// === Widget registry ===
// Exported so tests can exercise each widget's drive/writeback/derived wiring.
export const WIDGETS: Record<string, WidgetSpec> = {
  structure: {
    component: Structure,
    drive: [
      ...drive_props([
        `structure`,
        `structure_string`,
        `data_url`,
        // show_site_labels/show_site_indices are delivered via scene_props (see
        // scene_pick_keys), not as top-level Structure props.
        `show_image_atoms`,
        `color_scheme`,
        `background_color`,
        `background_opacity`,
        `enable_info_pane`,
        `fullscreen_toggle`,
        `png_dpi`,
        `isosurface_settings`,
        `volumetric_data`,
        // highlighted_sites stays drive-only: the component sets it from info-pane
        // hover (high frequency), so writeback would flood the comm channel.
        `highlighted_sites`,
      ]),
      writeback_prop(`selected_sites`, []),
      writeback_prop(`hovered_site_idx`),
      derived_prop(`scene_props`, scene_prop_keys, get_scene_props),
      picked_prop(`lattice_props`, lattice_prop_keys),
    ],
  },
  trajectory: {
    component: Trajectory,
    drive: [
      ...drive_props([
        `trajectory`,
        `data_url`,
        `layout`,
        `fullscreen_toggle`,
        `auto_play`,
        `step_labels`,
      ]),
      // pymatviz trait `property_labels` is consumed by the component as ELEM_PROPERTY_LABELS
      rename_prop(`property_labels`, `ELEM_PROPERTY_LABELS`),
      // current_step_idx links widgets; display_mode changes from the view-mode menu.
      writeback_prop(`current_step_idx`, 0),
      writeback_prop(`display_mode`, `structure+scatter`),
      derived_prop(
        `structure_props`,
        [...scene_prop_keys, ...lattice_prop_keys, ...traj_structure_prop_keys],
        get_structure_props,
      ),
    ],
  },
  scatter_plot: {
    component: ScatterPlot,
    // selected_point drives the highlight from Python; active_point/hovered_point are
    // written back via the interaction callbacks.
    base_drive: style_base_drive,
    drive: [...scatter_plot_drive, drive_prop(`selected_point`)],
    interactions: scatter_interactions,
  },
  scatter_plot_3d: {
    component: ScatterPlot3D,
    base_drive: style_base_drive,
    drive: [
      controls_prop,
      ...drive_props([
        `series`,
        `surfaces`,
        `ref_lines`,
        `ref_planes`,
        `x_axis`,
        `y_axis`,
        `z_axis`,
        `display`,
        `styles`,
        `color_scale`,
        `size_scale`,
        `legend`,
        `camera_projection`,
      ]),
    ],
  },
  bar_plot: { component: BarPlot, drive: bar_plot_drive },
  histogram: { component: Histogram, drive: histogram_drive },
  composition: {
    component: Composition,
    base_drive: style_base_drive,
    drive: drive_props([`composition`, `mode`, `show_percentages`, `color_scheme`]),
  },
  convex_hull: {
    component: ConvexHull,
    drive: drive_props([
      `entries`,
      `show_stable`,
      `show_unstable`,
      `show_hull_faces`,
      `hull_face_opacity`,
      `show_stable_labels`,
      `show_unstable_labels`,
      `max_hull_dist_show_labels`,
      `max_hull_dist_show_phases`,
      `temperature`,
    ]),
  },
  band_structure: {
    component: Bands,
    drive: [
      rename_prop(`band_structure`, `band_structs`), // Renamed traitlet
      ...drive_props([`band_type`, `show_legend`, `fermi_level`, `reference_frequency`]),
    ],
  },
  dos: {
    component: Dos,
    drive: [
      rename_prop(`dos`, `doses`), // Renamed traitlet
      ...drive_props([
        `stack`,
        `sigma`,
        `normalize`,
        `orientation`,
        `show_legend`,
        `spin_mode`,
      ]),
    ],
  },
  bands_and_dos: {
    // BandsAndDos forwards config to its child Bands/Dos via bands_props/dos_props.
    // It internally controls fermi_level, reference_frequency and dos orientation,
    // so those traits are intentionally not forwarded here (they'd be overridden).
    component: BandsAndDos,
    base_drive: style_base_drive,
    drive: [
      rename_prop(`band_structure`, `band_structs`), // Renamed traitlet
      rename_prop(`dos`, `doses`), // Renamed traitlet
      picked_prop(`bands_props`, [`band_type`, `show_legend`, `show_controls`]),
      picked_prop(`dos_props`, [
        `stack`,
        `sigma`,
        `normalize`,
        `show_legend`,
        `spin_mode`,
        `show_controls`,
      ]),
    ],
  },
  fermi_surface: {
    component: FermiSurface,
    drive: drive_props([
      `fermi_data`,
      `band_data`,
      `mu`,
      `representation`,
      `surface_opacity`,
      `show_bz`,
      `bz_opacity`,
      `show_vectors`,
      `camera_projection`,
    ]),
  },
  brillouin_zone: {
    component: BrillouinZone,
    drive: drive_props([
      `structure`,
      `bz_data`,
      `surface_color`,
      `surface_opacity`,
      `edge_color`,
      `edge_width`,
      `show_vectors`,
      `show_ibz`,
      `ibz_color`,
      `ibz_opacity`,
      `camera_projection`,
    ]),
  },
  phase_diagram: { component: IsobaricBinaryPhaseDiagram, drive: drive_props([`data`]) },
  xrd: {
    component: XrdPlot,
    base_drive: style_base_drive,
    drive: [drive_prop(`patterns`), controls_prop],
  },
  periodic_table: {
    component: PeriodicTable,
    base_drive: style_base_drive,
    drive: [
      ...drive_props([
        `heatmap_values`,
        `color_scale`,
        `color_scale_range`,
        `color_overrides`,
        `labels`,
        `show_color_bar`,
        `gap`,
        `missing_color`,
      ]),
      rename_prop(`log_scale`, `log`),
    ],
  },
  rdf_plot: {
    component: RdfPlot,
    base_drive: style_base_drive,
    drive: [
      controls_prop,
      ...drive_props([
        `patterns`,
        `structures`,
        `mode`,
        `show_reference_line`,
        `cutoff`,
        `n_bins`,
        `x_axis`,
        `y_axis`,
      ]),
    ],
  },
  heatmap_matrix: {
    component: HeatmapMatrix,
    drive: [
      ...drive_props([
        `x_items`,
        `y_items`,
        `values`,
        `color_scale`,
        `color_scale_range`,
        `missing_color`,
        `x_axis`,
        `y_axis`,
        `tile_size`,
        `gap`,
        `show_values`,
        `label_style`,
      ]),
      rename_prop(`log_scale`, `log`),
    ],
  },
  spacegroup_bar: {
    component: SpacegroupBarPlot,
    drive: drive_props([
      `data`,
      `show_counts`,
      `show_legend`,
      `orientation`,
      `x_axis`,
      `y_axis`,
    ]),
  },
  chem_pot_diagram: {
    component: ChemPotDiagram,
    base_drive: style_base_drive,
    drive: drive_props([`entries`, `config`, `temperature`]),
  },
}

// Detect widget type and render
const render: Render = (props) => {
  const { model, el } = props
  const widget_type = get_prop(model, `widget_type`) as string | undefined
  // guard with Object.hasOwn so prototype keys (toString, constructor, ...) don't
  // resolve as specs and silently bypass the unknown-widget_type error
  const spec =
    widget_type && Object.hasOwn(WIDGETS, widget_type) ? WIDGETS[widget_type] : undefined
  if (!spec) throw new Error(`Unknown or missing widget_type: '${widget_type}'`)

  cleanup_element(el)
  inject_app_css(undefined, el)

  // Watch this element's theme and re-inject CSS on change. The returned disposer
  // (invoked by cleanup_element) unregisters this widget and tears down the shared
  // DOM/media observers once the last widget is gone.
  theme_unsubs.set(
    el,
    watch_theme(el, () => inject_app_css(undefined, el)),
  )
  mount_spec(model, el, spec)
  return () => cleanup_element(el)
}

export default { render }
