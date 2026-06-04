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
import {
  detect_parent_theme,
  get_theme_css,
  on_theme_change,
  setup_theme_watchers,
} from './theme-detection'

const adopted_sheets = new WeakMap<ShadowRoot, CSSStyleSheet>()

function inject_app_css(theme_type?: ThemeType, target_element?: HTMLElement): void {
  const style_id = `matterviz-widget-styles`
  const detected_theme = theme_type ?? detect_parent_theme(target_element)

  // Determine if we're in Shadow DOM (used by marimo cells) and get the appropriate root
  const root_node = target_element?.getRootNode() ?? document
  const in_shadow = root_node instanceof ShadowRoot

  // Remove existing style element (if any)
  ;(in_shadow ? root_node : document).querySelector(`#${style_id}`)?.remove()

  // Create style content
  const style_content = `
    ${get_theme_css(detected_theme, in_shadow)}
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

const cleanup_element = (element: HTMLElement): void => {
  theme_unsubs.get(element)?.()
  theme_unsubs.delete(element)

  const instance = instances.get(element)
  if (instance) {
    void unmount(instance)
    instances.delete(element)
  }
}

const get_prop = (model: AnyModel, key: string) => {
  try {
    return model.get(key) ?? void 0
  } catch {
    // Missing trait values are omitted from the frontend props object.
    return void 0
  }
}

// Build an object of { key: model.get(key) } for each key in the list
const pick_props = (model: AnyModel, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, get_prop(model, key)]))

const plot_common_prop_keys = [
  `series`,
  `x_axis`,
  `x2_axis`,
  `y_axis`,
  `y2_axis`,
  `display`,
  `legend`,
  `ref_lines`,
  `controls`,
  `padding`,
  `range_padding`,
  `show_legend`,
  `x_range`,
  `x2_range`,
  `y_range`,
  `y2_range`,
] as const

const scatter_plot_prop_keys = [
  ...plot_common_prop_keys,
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
] as const

const bar_plot_prop_keys = [
  ...plot_common_prop_keys,
  `orientation`,
  `mode`,
  `bar`,
  `line`,
  `color_scale`,
  `size_scale`,
  `point_tween`,
] as const

const histogram_prop_keys = [
  ...plot_common_prop_keys,
  `bins`,
  `mode`,
  `selected_property`,
  `bar`,
] as const

// Mount a Svelte component with base props (notebook context, show_controls, style)
const mount_widget = (
  model: AnyModel,
  el: HTMLElement,
  component: unknown,
  props: Record<string, unknown>,
) => {
  // Prevent widget overflow in notebook cell outputs
  el.style.boxSizing = `border-box`
  el.style.maxWidth = `100%`
  el.style.marginRight = `2em` // In vscode-interactive window, content overflows cell container div without this
  const base_props = {
    allow_file_drop: false,
    show_controls: get_prop(model, `show_controls`),
    style: get_prop(model, `style`),
  }
  instances.set(
    el,
    mount(component as Parameters<typeof mount>[0], {
      target: el,
      props: { ...base_props, ...props },
    }),
  )
}

// Build scene/lattice props shared by structure and trajectory renderers
const get_scene_props = (model: AnyModel) => ({
  ...pick_props(model, [
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
  ]),
  auto_rotate: get_prop(model, `auto_rotate`) ?? 0.2,
  gizmo: get_prop(model, `show_gizmo`) ?? true,
})

const get_lattice_props = (model: AnyModel) =>
  pick_props(model, [
    `cell_edge_opacity`,
    `cell_surface_opacity`,
    `cell_edge_color`,
    `cell_surface_color`,
    `cell_edge_width`,
    `show_cell_vectors`,
  ])

// Detect widget type and render
const render: Render = (props) => {
  const { model, el } = props
  const widget_type = get_prop(model, `widget_type`) as string | undefined
  const renderer = widget_type ? renderers[widget_type] : undefined
  if (!renderer) throw new Error(`Unknown or missing widget_type: '${widget_type}'`)

  cleanup_element(el)
  inject_app_css(undefined, el)
  setup_theme_watchers(el)

  theme_unsubs.set(
    el,
    on_theme_change((theme_type) => inject_app_css(theme_type, el)),
  )
  void renderer(props)
  return () => cleanup_element(el)
}

// === Widget renderers ===

const render_composition: Render = ({ model, el }) => {
  mount_widget(
    model,
    el,
    Composition,
    pick_props(model, [`composition`, `mode`, `show_percentages`, `color_scheme`]),
  )
}

const render_structure: Render = ({ model, el }) => {
  mount_widget(model, el, Structure, {
    ...pick_props(model, [
      `structure`,
      `structure_string`,
      `data_url`,
      `show_site_labels`,
      `show_site_indices`,
      `show_image_atoms`,
      `color_scheme`,
      `background_color`,
      `background_opacity`,
      `enable_info_pane`,
      `fullscreen_toggle`,
      `png_dpi`,
      `isosurface_settings`,
      `volumetric_data`,
    ]),
    scene_props: get_scene_props(model),
    lattice_props: get_lattice_props(model),
  })
}

const render_trajectory: Render = ({ model, el }) => {
  mount_widget(model, el, Trajectory, {
    ...pick_props(model, [
      `trajectory`,
      `data_url`,
      `current_step_idx`,
      `layout`,
      `display_mode`,
      `fullscreen_toggle`,
      `auto_play`,
      `step_labels`,
      `property_labels`,
      `units`,
    ]),
    structure_props: {
      scene_props: get_scene_props(model),
      lattice_props: get_lattice_props(model),
      ...pick_props(model, [
        `show_site_labels`,
        `show_site_indices`,
        `show_image_atoms`,
        `color_scheme`,
        `background_color`,
        `background_opacity`,
      ]),
      fullscreen_toggle: false,
    },
  })
}

const render_scatter_plot: Render = ({ model, el }) => {
  mount_widget(model, el, ScatterPlot, pick_props(model, scatter_plot_prop_keys))
}

const render_bar_plot: Render = ({ model, el }) => {
  mount_widget(model, el, BarPlot, pick_props(model, bar_plot_prop_keys))
}

const render_histogram: Render = ({ model, el }) => {
  mount_widget(model, el, Histogram, pick_props(model, histogram_prop_keys))
}

const render_convex_hull: Render = ({ model, el }) => {
  mount_widget(
    model,
    el,
    ConvexHull,
    pick_props(model, [
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
  )
}

const render_band_structure: Render = ({ model, el }) => {
  mount_widget(model, el, Bands, {
    band_structs: get_prop(model, `band_structure`), // Renamed traitlet
    ...pick_props(model, [`band_type`, `show_legend`, `fermi_level`, `reference_frequency`]),
  })
}

const render_dos: Render = ({ model, el }) => {
  mount_widget(model, el, Dos, {
    doses: get_prop(model, `dos`), // Renamed traitlet
    ...pick_props(model, [
      `stack`,
      `sigma`,
      `normalize`,
      `orientation`,
      `show_legend`,
      `spin_mode`,
    ]),
  })
}

const render_bands_and_dos: Render = ({ model, el }) => {
  mount_widget(model, el, BandsAndDos, {
    band_structs: get_prop(model, `band_structure`), // Renamed traitlet
    doses: get_prop(model, `dos`), // Renamed traitlet
  })
}

const render_fermi_surface: Render = ({ model, el }) => {
  mount_widget(
    model,
    el,
    FermiSurface,
    pick_props(model, [
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
  )
}

const render_brillouin_zone: Render = ({ model, el }) => {
  mount_widget(
    model,
    el,
    BrillouinZone,
    pick_props(model, [
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
  )
}

const render_phase_diagram: Render = ({ model, el }) => {
  mount_widget(model, el, IsobaricBinaryPhaseDiagram, pick_props(model, [`data`]))
}

const render_xrd: Render = ({ model, el }) => {
  mount_widget(model, el, XrdPlot, pick_props(model, [`patterns`]))
}

const render_periodic_table: Render = ({ model, el }) => {
  mount_widget(model, el, PeriodicTable, {
    ...pick_props(model, [
      `heatmap_values`,
      `color_scale`,
      `color_scale_range`,
      `color_overrides`,
      `labels`,
      `show_color_bar`,
      `gap`,
      `missing_color`,
    ]),
    log: get_prop(model, `log_scale`),
  })
}

const render_rdf_plot: Render = ({ model, el }) => {
  mount_widget(
    model,
    el,
    RdfPlot,
    pick_props(model, [
      `patterns`,
      `structures`,
      `mode`,
      `show_reference_line`,
      `cutoff`,
      `n_bins`,
      `x_axis`,
      `y_axis`,
    ]),
  )
}

const render_scatter_plot_3d: Render = ({ model, el }) => {
  mount_widget(
    model,
    el,
    ScatterPlot3D,
    pick_props(model, [
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
      `controls`,
      `camera_projection`,
    ]),
  )
}

const render_heatmap_matrix: Render = ({ model, el }) => {
  mount_widget(model, el, HeatmapMatrix, {
    ...pick_props(model, [
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
    log: get_prop(model, `log_scale`),
  })
}

const render_spacegroup_bar: Render = ({ model, el }) => {
  mount_widget(
    model,
    el,
    SpacegroupBarPlot,
    pick_props(model, [
      `data`,
      `show_counts`,
      `show_legend`,
      `orientation`,
      `x_axis`,
      `y_axis`,
    ]),
  )
}

const render_chem_pot_diagram: Render = ({ model, el }) => {
  mount_widget(
    model,
    el,
    ChemPotDiagram,
    pick_props(model, [`entries`, `config`, `temperature`]),
  )
}

// Static dispatch table — referenced by render() at call time (after module init)
const renderers: Record<string, Render> = {
  structure: render_structure,
  trajectory: render_trajectory,
  scatter_plot: render_scatter_plot,
  scatter_plot_3d: render_scatter_plot_3d,
  bar_plot: render_bar_plot,
  histogram: render_histogram,
  composition: render_composition,
  convex_hull: render_convex_hull,
  band_structure: render_band_structure,
  dos: render_dos,
  bands_and_dos: render_bands_and_dos,
  fermi_surface: render_fermi_surface,
  brillouin_zone: render_brillouin_zone,
  phase_diagram: render_phase_diagram,
  xrd: render_xrd,
  periodic_table: render_periodic_table,
  rdf_plot: render_rdf_plot,
  heatmap_matrix: render_heatmap_matrix,
  spacegroup_bar: render_spacegroup_bar,
  chem_pot_diagram: render_chem_pot_diagram,
}

export default { render }
