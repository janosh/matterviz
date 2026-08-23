/// <reference types="vite/client" />

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
  is_plain_object,
  IsobaricBinaryPhaseDiagram,
  PeriodicTable,
  RdfPlot,
  ScatterPlot,
  ScatterPlot3D,
  SpacegroupBarPlot,
  Structure,
  trajectory_from_json,
  TrajectoryFileViewer,
  Treemap,
  volume_from_json,
  XrdPlot,
} from 'matterviz'
import app_css from 'matterviz/app.css?raw'
import { DEFAULTS } from 'matterviz/settings'
import type { ThemeType } from 'matterviz/theme'
import { detect_parent_theme, get_theme_css, watch_theme } from 'matterviz/theme/embedded'
import { mount, unmount } from 'svelte'
import type { DrivenProp } from './reactive.svelte'
import {
  derived_prop,
  drive_prop,
  drive_props,
  get_prop,
  next_event_id,
  reactive_widget,
  set_model,
  throttle,
  writeback_prop,
} from './reactive.svelte'

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
// e.g. bands_props / dos_props.
const picked_prop = (name: string, keys: readonly string[]): DrivenProp =>
  derived_prop(name, keys, (model) => pick_props(model, keys))

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
  ...drive_props([`series`, `display`, `legend`, `ref_lines`, `padding`, `range_padding`]),
  ...[`x`, `x2`, `y`, `y2`].map((axis) =>
    merged_prop(`${axis}_axis`, `range`, `${axis}_range`),
  ),
]
// Every plot component (the generic plots and the Bands/Dos/XrdPlot/RdfPlot wrappers alike)
// declares these four controls props and forwards the pane attribute dicts to its PlotControls
const plot_control_keys = [
  `show_controls`,
  `controls_open`,
  `controls_toggle_props`,
  `controls_pane_props`,
] as const
const plot_controls_drive = plot_control_keys.map((key) =>
  key === `controls_open` ? writeback_prop(key, false) : drive_prop(key),
)
const with_plot_controls = (keys: readonly string[]): DrivenProp[] => [
  ...plot_controls_drive,
  ...drive_props(keys),
]
// The 2D cartesian plots: the shared series/axis traits, the controls, and their own keys
const cartesian_plot_drive = (keys: readonly string[]): DrivenProp[] => [
  ...plot_common_drive,
  ...with_plot_controls(keys),
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
  // unit-cell rendering also lives in scene_props
  `cell_edge_opacity`,
  `cell_surface_opacity`,
  `cell_edge_color`,
  `cell_surface_color`,
  `cell_edge_width`,
  `show_cell_vectors`,
] as const
// All scene traits (deps for the reactive scene_props derived prop); auto_rotate and gizmo
// are defaulted in get_scene_props rather than picked verbatim.
const scene_prop_keys = [...scene_pick_keys, `auto_rotate`, `gizmo`] as const

// Top-level Structure traits the trajectory forwards into its nested structure_props
// (show_site_labels/show_site_indices are NOT here -- they ride inside scene_props).
const traj_structure_prop_keys = [
  `show_image_atoms`,
  `color_scheme`,
  `background_color`,
  `background_opacity`,
] as const

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
  base_drive?: readonly DrivenProp[]
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

// Base props every widget gets unless its spec sets base_drive. style is the notebook
// wrapper; specs using style_base_drive drive show_controls explicitly.
const top_level_base_drive: readonly DrivenProp[] = [
  drive_prop(`show_controls`),
  drive_prop(`style`),
]
const style_base_drive: readonly DrivenProp[] = [drive_prop(`style`)]
// Viewers with a drop zone: file drops are off in notebooks
const no_file_drop = { allow_file_drop: false }

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
    { ...spec.static_props, ...interaction?.props },
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
    static_props: no_file_drop,
    drive: [
      ...drive_props([
        `structure`,
        `structure_string`,
        `data_url`,
        // show_site_labels/show_site_indices are delivered via scene_props (see
        // scene_pick_keys), not as top-level Structure props.
        ...traj_structure_prop_keys,
        `enable_info_pane`,
        `fullscreen_toggle`,
        `png_dpi`,
        `isosurface_settings`,
        // highlighted_sites stays drive-only: the component sets it from info-pane
        // hover (high frequency), so writeback would flood the comm channel.
        `highlighted_sites`,
      ]),
      // Traits carry nested JSON grids; the renderer stores flat typed arrays
      derived_prop(`volumetric_data`, [`volumetric_data`], (model) => {
        const raw = get_prop(model, `volumetric_data`)
        if (raw == null) return undefined
        return (Array.isArray(raw) ? raw : [raw]).map(volume_from_json)
      }),
      writeback_prop(`active_volume_idx`, 0),
      writeback_prop(`display_mode`, `structure`),
      writeback_prop(`slice_settings`, {}),
      writeback_prop(`selected_sites`, []),
      writeback_prop(`hovered_site_idx`),
      derived_prop(`scene_props`, scene_prop_keys, get_scene_props),
    ],
  },
  trajectory: {
    component: TrajectoryFileViewer,
    static_props: no_file_drop,
    drive: [
      ...drive_props([
        `layout`,
        `fullscreen_toggle`,
        `auto_play`,
        `step_labels`,
        `property_labels`,
      ]),
      // The JSON trait (pymatgen Trajectory, { frames }, array of structures) becomes an
      // in-memory run; data_url is fetched and parsed by the file viewer itself
      derived_prop(`trajectory`, [`trajectory`], (model) => {
        const value = get_prop(model, `trajectory`)
        if (value === undefined || value === null) return undefined
        try {
          return trajectory_from_json(value, { format: `json` })
        } catch (error) {
          console.error(`TrajectoryWidget: invalid trajectory trait:`, error)
          return undefined
        }
      }),
      derived_prop(`src`, [`data_url`], (model) => get_prop(model, `data_url`)),
      // atom_type_mapping ({ "1": "Si", "2": "O" }) names the atom types of a LAMMPS dump
      // fetched from data_url; it rides in the file viewer's loading_options. None/{} mean
      // unset, so loading_options falls back to the viewer's default
      derived_prop(`loading_options`, [`atom_type_mapping`], (model) => {
        const atom_type_mapping = get_prop(model, `atom_type_mapping`)
        const is_set =
          typeof atom_type_mapping === `object` &&
          atom_type_mapping !== null &&
          Object.keys(atom_type_mapping).length > 0
        return is_set ? { atom_type_mapping } : undefined
      }),
      // current_step_idx links widgets; display_mode changes from the view-mode menu.
      writeback_prop(`current_step_idx`, 0),
      writeback_prop(`display_mode`, `structure+scatter`),
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
    base_drive: style_base_drive,
    drive: [
      ...cartesian_plot_drive([
        `styles`,
        `show_legend`,
        `marker_renderer`,
        `color_scale`,
        `color_bar`,
        `size_scale`,
        `fill_regions`,
        `error_bands`,
        `hover_config`,
        `label_placement_config`,
        `point_tween`,
        `line_tween`,
      ]),
      drive_prop(`selected_point`),
    ],
    interactions: scatter_interactions,
    interaction_model_keys: [`active_point`, `hovered_point`],
  },
  scatter_plot_3d: {
    component: ScatterPlot3D,
    base_drive: style_base_drive,
    drive: with_plot_controls([
      `series`,
      `surfaces`,
      `ref_lines`,
      `ref_planes`,
      `x_axis`,
      `y_axis`,
      `z_axis`,
      `display`,
      `styles`,
      `show_legend`,
      `color_scale`,
      `size_scale`,
      `legend`,
      `camera_projection`,
    ]),
  },
  bar_plot: {
    component: BarPlot,
    base_drive: style_base_drive,
    drive: cartesian_plot_drive([
      `show_legend`,
      `orientation`,
      `mode`,
      `bar`,
      `line`,
      `color_scale`,
      `size_scale`,
    ]),
  },
  histogram: {
    component: Histogram,
    base_drive: style_base_drive,
    drive: cartesian_plot_drive([`show_legend`, `bins`, `mode`, `selected_property`, `bar`]),
  },
  composition: {
    component: Composition,
    base_drive: style_base_drive,
    drive: drive_props([`composition`, `mode`, `show_percentages`, `color_scheme`]),
  },
  convex_hull: {
    component: ConvexHull,
    static_props: no_file_drop,
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
    base_drive: style_base_drive,
    drive: with_plot_controls([
      `band_structs`,
      `band_type`,
      `show_legend`,
      `fermi_level`,
      `reference_frequency`,
    ]),
  },
  dos: {
    component: Dos,
    base_drive: style_base_drive,
    drive: with_plot_controls([
      `doses`,
      `stack`,
      `sigma`,
      `normalize`,
      `orientation`,
      `show_legend`,
      `spin_mode`,
    ]),
  },
  bands_and_dos: {
    // BandsAndDos forwards config to its child Bands/Dos via bands_props/dos_props.
    // It internally controls fermi_level, reference_frequency and dos orientation,
    // so those traits are intentionally not forwarded here (they'd be overridden).
    component: BandsAndDos,
    base_drive: style_base_drive,
    drive: [
      ...drive_props([`band_structs`, `doses`]),
      picked_prop(`bands_props`, [`band_type`, `show_legend`, ...plot_control_keys]),
      picked_prop(`dos_props`, [
        `stack`,
        `sigma`,
        `normalize`,
        `show_legend`,
        `spin_mode`,
        ...plot_control_keys,
      ]),
    ],
  },
  fermi_surface: {
    component: FermiSurface,
    static_props: no_file_drop,
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
    static_props: no_file_drop,
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
    static_props: no_file_drop,
    drive: with_plot_controls([`patterns`]),
  },
  periodic_table: {
    component: PeriodicTable,
    base_drive: style_base_drive,
    drive: drive_props([
      `heatmap_values`,
      `color_scale`,
      `color_scale_range`,
      `color_overrides`,
      `labels`,
      `show_color_bar`,
      `gap`,
      `missing`,
      `log`,
    ]),
  },
  rdf_plot: {
    component: RdfPlot,
    base_drive: style_base_drive,
    static_props: no_file_drop,
    drive: with_plot_controls([
      `patterns`,
      `structures`,
      `mode`,
      `show_reference_line`,
      `cutoff`,
      `n_bins`,
      `x_axis`,
      `y_axis`,
    ]),
  },
  heatmap_matrix: {
    component: HeatmapMatrix,
    drive: drive_props([
      `x_items`,
      `y_items`,
      `values`,
      `color_scale`,
      `color_scale_range`,
      `missing`,
      `x_axis`,
      `y_axis`,
      `tile_size`,
      `gap`,
      `show_values`,
      `label_style`,
      `log`,
    ]),
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
    // ChemPotDiagram sizes itself through width/height and spreads no rest props, so the
    // notebook wrapper `style` has nowhere to go
    component: ChemPotDiagram,
    base_drive: [],
    drive: drive_props([`entries`, `config`, `temperature`]),
  },
  treemap: {
    // Function/snippet props cannot cross the JSON bridge; continuous color props
    // requiring color_values stay local.
    component: Treemap,
    base_drive: style_base_drive,
    drive: [
      ...with_plot_controls([
        `data`,
        `value_mode`,
        `sort`,
        `level_lighten`,
        `min_fraction`,
        `other_label`,
        `max_depth`,
        `padding_inner`,
        `padding_top`,
        `padding_outer`,
        `show_labels`,
        `label_text`,
        `label_fit`,
        `label_min_font_size`,
        `label_max_font_size`,
        `parent_label_font_size`,
        `zoom_on_click`,
        `show_breadcrumbs`,
        `legend`,
        `show_legend`,
        `value_format`,
        `padding`,
        `export_buttons`,
        `export_filename`,
        `fullscreen_toggle`,
      ]),
      // Two-way: click-zoom in the UI notifies Python; Python can re-root the view
      writeback_prop(`zoom_root_id`),
    ],
  },
}

// Machine-readable trait contract: for each widget_type, every model trait the JS
// side reads (drive/derived/writeback deps + base drive) or writes (interaction
// callbacks). Consumed by pymatviz's prop-parity test to flag Python widget traits
// the frontend would silently ignore (and frontend props Python cannot set).
export const WIDGET_MODEL_KEYS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(WIDGETS).map(([widget_type, spec]) => {
    const driven_props = [...(spec.base_drive ?? top_level_base_drive), ...spec.drive]
    const model_keys = driven_props.flatMap(({ deps }) => deps)
    return [
      widget_type,
      // built right here, so sorting in place mutates nothing a caller can see, and
      // toSorted needs lib es2023 which this package has no tsconfig to set
      // oxlint-disable-next-line unicorn/no-array-sort
      [...new Set([...model_keys, ...(spec.interaction_model_keys ?? [])])].sort(),
    ]
  }),
)

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
