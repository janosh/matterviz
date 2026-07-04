<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import {
    add_alpha,
    AXIS_COLORS,
    is_dark_mode,
    NEG_AXIS_COLORS,
    PLOT_COLORS,
    vesta_hex,
    watch_dark_mode,
  } from '$lib/colors'
  import { get_formula_label_segments } from '$lib/composition/format'
  import type { FormulaLabelSegment } from '$lib/composition/format'
  import { normalize_show_controls } from '$lib/controls'
  import { sanitize_html } from '$lib/sanitize'
  import { Spinner } from '$lib/feedback'
  import { format_num } from '$lib/labels'
  import { to_radians, type Point3D, type Vec2, type Vec3 } from '$lib/math'
  import { ColorBar } from '$lib/plot'
  import {
    centered_rect,
    pad_rect,
    rects_overlap,
    rect_within_rect,
  } from '$lib/plot/core/layout'
  import type { Rect } from '$lib/plot/core/layout'
  import { create_pulse_animation } from '$lib/effects.svelte'
  import { DEFAULTS } from '$lib/settings'
  import type { AnyStructure } from '$lib/structure'
  import { Canvas, T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { ticks } from 'd3-array'
  import { PerspectiveCamera, WebGLRenderer } from 'three'
  import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
  import {
    get_ternary_3d_coordinates,
    get_triangle_centroid,
    get_triangle_edges,
    get_triangle_vertical_edges,
    TRIANGLE_VERTICES,
  } from './barycentric-coords'
  import { create_canvas_interactions } from './canvas-interactions.svelte'
  import ConvexHullChrome from './ConvexHullChrome.svelte'
  import GasPressureControls from './GasPressureControls.svelte'
  import * as helpers from './helpers'
  import { create_hull_data_pipeline } from './hull-state.svelte'
  import type { BaseConvexHullProps, Hull3DProps } from './index'
  import { CONVEX_HULL_STYLE, default_controls, default_hull_config } from './index'
  import TemperatureSlider from './TemperatureSlider.svelte'
  import * as thermo from './thermodynamics'
  import type {
    ConvexHullEntry,
    ConvexHullTriangle,
    HighlightStyle,
    HullFaceColorMode,
    LabelPlacement,
  } from './types'
  import { compute_hull_stability } from './helpers'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'

  let {
    entries = [],
    controls = {},
    config = {},
    show_controls,
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(DEFAULTS.convex_hull.ternary.fullscreen),
    fullscreen_toggle = true,
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(DEFAULTS.convex_hull.ternary.show_stable),
    show_unstable = $bindable(DEFAULTS.convex_hull.ternary.show_unstable),
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = $bindable([]),
    show_hull_faces = $bindable(DEFAULTS.convex_hull.ternary.show_hull_faces),
    hull_face_opacity = $bindable(DEFAULTS.convex_hull.ternary.hull_face_opacity),
    hull_face_color_mode = $bindable(
      DEFAULTS.convex_hull.ternary.hull_face_color_mode as HullFaceColorMode,
    ),
    element_colors = vesta_hex,
    color_mode = $bindable(DEFAULTS.convex_hull.ternary.color_mode),
    color_scale = $bindable(DEFAULTS.convex_hull.ternary.color_scale as D3InterpolateName),
    info_pane_open = $bindable(DEFAULTS.convex_hull.ternary.info_pane_open),
    controls_open = $bindable(DEFAULTS.convex_hull.ternary.legend_pane_open),
    max_hull_dist_show_phases = $bindable(
      DEFAULTS.convex_hull.ternary.max_hull_dist_show_phases,
    ),
    max_hull_dist_show_labels = $bindable(
      DEFAULTS.convex_hull.ternary.max_hull_dist_show_labels,
    ),
    show_stable_labels = $bindable(DEFAULTS.convex_hull.ternary.show_stable_labels),
    show_unstable_labels = $bindable(DEFAULTS.convex_hull.ternary.show_unstable_labels),
    on_file_drop,
    enable_click_selection = true,
    enable_structure_preview = true,
    energy_source_mode = $bindable(`precomputed`),
    phase_stats = $bindable(null),
    stable_entries = $bindable([]),
    unstable_entries = $bindable([]),
    highlighted_entries = $bindable([]),
    highlight_style = {},
    selected_entry = $bindable(null),
    temperature = $bindable(),
    interpolate_temperature = true,
    max_interpolation_gap = 500,
    gizmo = true,
    gas_config,
    gas_pressures = $bindable({}),
    children,
    tooltip,
    ...rest
  }: BaseConvexHullProps<ConvexHullEntry> &
    Hull3DProps & {
      highlight_style?: HighlightStyle
    } = $props()

  const merged_controls = $derived({ ...default_controls, ...controls })
  const controls_config = $derived(normalize_show_controls(show_controls))
  const merged_config = $derived({
    ...default_hull_config,
    ...config,
    colors: { ...default_hull_config.colors, ...config.colors },
    margin: { t: 40, r: 40, b: 60, l: 60, ...config.margin },
  })

  // Shared reactive data pipeline (temperature → gas → energy mode → hull data → threshold)
  // Explicit generic breaks the circular type inference through the all_enriched_entries thunk
  const hull_data = create_hull_data_pipeline<ConvexHullEntry>({
    dim: 3,
    entries: () => entries,
    temperature: () => temperature,
    interpolate_temperature: () => interpolate_temperature,
    max_interpolation_gap: () => max_interpolation_gap,
    gas_config: () => gas_config,
    gas_pressures: () => gas_pressures,
    energy_source_mode: () => energy_source_mode,
    all_enriched_entries: () => all_enriched_entries,
    max_hull_dist_show_phases: () => max_hull_dist_show_phases,
    show_stable: () => show_stable,
    show_unstable: () => show_unstable,
    entry_category: () => entry_category,
    hidden_categories: () => hidden_categories,
    keep_plot_entry: helpers.entry_within_hull_dist,
    set_temperature: (next_temp) => (temperature = next_temp),
    set_max_hull_dist_show_phases: (value) => (max_hull_dist_show_phases = value),
    set_stable_entries: (value) => (stable_entries = value),
    set_unstable_entries: (value) => (unstable_entries = value),
  })
  const has_temp_data = $derived(hull_data.has_temp_data)
  const gas_analysis = $derived(hull_data.gas_analysis)
  const merged_gas_config = $derived(hull_data.merged_gas_config)
  const pd_data = $derived(hull_data.pd_data)
  const elements = $derived(hull_data.elements)
  const plot_entries = $derived(hull_data.plot_entries)
  const visible_entries = $derived(hull_data.visible_entries)

  // 1) Raw 3D coordinates (formation-energy z), independent of hull state
  const coords_entries = $derived.by(() => {
    if (elements.length !== 3) return []
    try {
      // Pass precomputed el_refs to avoid recomputing in error diagnostics
      const coords = get_ternary_3d_coordinates(pd_data.entries, elements, pd_data.el_refs)
      return coords
    } catch (error) {
      console.error(`Error computing ternary coordinates:`, error)
      return []
    }
  })

  // Compute lower convex hull faces (triangles) for 3D rendering (low energy hull only)
  // Must be defined before all_enriched_entries which uses hull_model
  const hull_faces = $derived.by((): ConvexHullTriangle[] => {
    if (coords_entries.length === 0) return []
    // Excluded entries don't participate in hull construction
    const hull_entries = coords_entries.filter((entry) => !entry.exclude_from_hull)
    if (hull_entries.length === 0) return []
    const points = hull_entries.map(({ x, y, z }) => ({ x, y, z }))
    try {
      return thermo.compute_lower_hull_triangles(points)
    } catch (error) {
      console.error(`Error computing convex hull:`, error)
      return []
    }
  })

  // Cached hull model for e_above_hull queries; recompute only when faces change
  let hull_model = $derived.by(() => thermo.build_lower_hull_model(hull_faces))

  // Enrich coords with e_above_hull from cached hull model (before filtering)
  const all_enriched_entries = $derived.by(() => {
    if (coords_entries.length === 0) return []
    if (hull_data.energy_mode !== `on-the-fly`) return coords_entries
    const pts = coords_entries.map(({ x, y, z }) => ({ x, y, z }))
    const raw_dists = thermo.compute_e_above_hull_for_points(pts, hull_model)
    // non-finite distance (no covering hull face) -> unknown, handled by compute_hull_stability
    return coords_entries.map((entry, idx) => ({
      ...entry,
      ...compute_hull_stability(raw_dists[idx], entry.exclude_from_hull),
    }))
  })

  // Canvas rendering
  let canvas: HTMLCanvasElement | undefined = undefined
  let ctx: CanvasRenderingContext2D | null = null

  const camera_default = {
    elevation: DEFAULTS.convex_hull.ternary.camera_elevation,
    azimuth: DEFAULTS.convex_hull.ternary.camera_azimuth,
    zoom: DEFAULTS.convex_hull.ternary.camera_zoom,
    center_x: 0,
    center_y: -50, // Shift up to better show the formation energy funnel
  }
  let camera = $state({ ...camera_default })

  // === Gizmo state & coordinate mapping ===
  // ConvexHull3D uses Rz(azimuth) then Rx(-elevation), viewing along -z_rotated.
  // These helpers convert between that system and Three.js camera position/up.
  const GIZMO_CAM_DIST = 5
  const MIN_ELEV_FOR_Z_AXIS = 5 // degrees — below this, z-axis ticks collapse to a point
  let gizmo_cam_ref = $state<PerspectiveCamera>()
  let gizmo_orbit_ref = $state<OrbitControls | undefined>(undefined)
  let gizmo_active = $state(false)

  // Convert elevation/azimuth (degrees) to Three.js camera position + up vector.
  function gizmo_camera(elev_deg: number, azim_deg: number): { position: Vec3; up: Vec3 } {
    const [elev, azim] = [to_radians(elev_deg), to_radians(azim_deg)]
    const [se, ce, sa, ca] = [Math.sin(elev), Math.cos(elev), Math.sin(azim), Math.cos(azim)]
    return {
      position: [-sa * se * GIZMO_CAM_DIST, -ca * se * GIZMO_CAM_DIST, ce * GIZMO_CAM_DIST],
      up: [sa * ce, ca * ce, se],
    }
  }

  // Derived gizmo camera state, avoids recomputing in the template
  const gizmo_cam_state = $derived(gizmo_camera(camera.elevation, camera.azimuth))

  // Center camera on the triangle's visual center for a given elevation.
  // The centroid (rotation center) sits at 1/3 height while the bbox
  // center is at 1/2 height — a difference of sqrt(3)/12 in data units.
  // Scale by cos(elevation) so offset only applies in near-top-down views.
  function center_camera(elev_deg: number): void {
    camera.center_x = 0
    // 0.6 matches the draw_data_points() scale factor that maps data coords to canvas pixels
    const scale = Math.min(canvas_dims.width, canvas_dims.height) * 0.6 * camera.zoom
    camera.center_y = (Math.sqrt(3) / 12) * scale * Math.cos(to_radians(elev_deg))
  }

  // Sync: ConvexHull3D → Three.js gizmo camera (on main canvas drag)
  $effect(() => {
    if (gizmo_active) return
    const cam = gizmo_cam_ref
    if (!cam) return
    const { position, up } = gizmo_camera(camera.elevation, camera.azimuth)
    cam.position.set(...position)
    cam.up.set(...up)
    cam.lookAt(0, 0, 0)
    gizmo_orbit_ref?.update?.()
  })

  // Sync: gizmo → ConvexHull3D (during and after gizmo animation)
  function sync_gizmo_to_camera(): void {
    const cam = gizmo_cam_ref
    if (!cam) return
    const { x: cx, y: cy, z: cz } = cam.position
    const dist = Math.hypot(cx, cy, cz)
    if (dist < 1e-6) return
    const elev_rad = Math.acos(Math.max(-1, Math.min(1, cz / dist)))
    const sin_elev = Math.sin(elev_rad)
    const azim_deg =
      Math.abs(sin_elev) > 1e-6
        ? (Math.atan2(-cx / (dist * sin_elev), -cy / (dist * sin_elev)) * 180) / Math.PI
        : 0
    const elev_deg = (elev_rad * 180) / Math.PI
    camera.elevation = elev_deg
    camera.azimuth = azim_deg
    center_camera(elev_deg)
  }

  // Gizmo axis colors (constant — AXIS_COLORS/NEG_AXIS_COLORS never change)
  const gizmo_axis_options = Object.fromEntries(
    [...AXIS_COLORS, ...NEG_AXIS_COLORS].map(([axis, color, hover_color]) => [
      axis,
      {
        color,
        labelColor: `#111`,
        opacity: 0.85,
        hover: { color: hover_color, labelColor: `#222`, opacity: 1 },
      },
    ]),
  )

  // Extract placement from gizmo options (not a Threlte Gizmo prop)
  const gizmo_placement = $derived(
    typeof gizmo === `object` && gizmo?.placement ? gizmo.placement : `top-right`,
  )

  // Merge constant axis options with consumer overrides (exclude our custom placement)
  const gizmo_props = $derived.by(() => {
    if (typeof gizmo !== `object` || !gizmo) {
      return { background: { enabled: false }, size: 80, ...gizmo_axis_options }
    }
    const { placement: _, ...threlte_opts } = gizmo
    return {
      background: { enabled: false },
      size: 80,
      ...gizmo_axis_options,
      ...threlte_opts,
    }
  })

  // Shared canvas-interaction scaffold (mouse/keyboard handlers, hover/drag/popup
  // state, canvas sizing, render scheduler). Rotation math + keydown actions stay local.
  const interactions = create_canvas_interactions({
    wheel_clamp: [0.5, 10],
    fullscreen_bg_var: `--hull-3d-bg-fullscreen`,
    canvas: () => canvas,
    wrapper: () => wrapper,
    ctx: () => ctx,
    set_ctx: (context) => (ctx = context),
    set_canvas_dims: (dims) => (canvas_dims = dims),
    visible_entries: () => visible_entries,
    plot_entries: () => plot_entries,
    selected_entry: () => selected_entry,
    set_selected_entry: (entry) => (selected_entry = entry),
    fullscreen: () => fullscreen,
    enable_click_selection: () => enable_click_selection,
    enable_structure_preview: () => enable_structure_preview,
    on_point_click: () => on_point_click,
    on_point_hover: () => on_point_hover,
    on_file_drop: () => on_file_drop,
    entry_category: () => entry_category,
    zoom: () => camera.zoom,
    set_zoom: (zoom) => (camera.zoom = zoom),
    project_point: project_3d_point,
    extract_structure: extract_structure_from_entry,
    render_frame,
    on_drag: (dx, dy, panning) => {
      if (panning) {
        camera.center_x += dx
        camera.center_y += dy
      } else {
        // Horizontal drag -> azimuth rotation around z-axis
        camera.azimuth += dx * 0.3 // Positive dx (drag right) rotates clockwise
        // Vertical drag -> elevation angle (full range)
        camera.elevation -= dy * 0.3 // Positive dy (drag down) tilts view down
      }
    },
    // Reset pan center when entering/exiting fullscreen
    on_fullscreen_change: () => {
      camera.center_x = 0
      camera.center_y = -50
    },
    actions: () => ({
      r: reset_camera,
      t: () => {
        camera.elevation = 0
        camera.azimuth = 0
        center_camera(0)
      },
      b: () => (color_mode = color_mode === `stability` ? `energy` : `stability`),
      s: () => (show_stable = !show_stable),
      u: () => (show_unstable = !show_unstable),
      h: () => (show_hull_faces = !show_hull_faces),
      l: () => (show_stable_labels = !show_stable_labels),
    }),
  })
  const { render_once } = interactions
  const sorted_points_cache = $derived(interactions.sorted_points_cache)

  // Hull face color (customizable via controls)
  let hull_face_color = $state(`#4caf50`)

  // Pulsating highlight for selected point
  const pulse = create_pulse_animation(
    () => selected_entry !== null || highlighted_entries.length > 0,
    { on_tick: render_once },
  )
  let pulse_opacity = $derived(0.3 + 0.4 * pulse.unit)

  // Merge highlight style with defaults
  const merged_highlight_style = $derived(helpers.merge_highlight_style(highlight_style))

  // Helper to check if entry is highlighted
  const is_highlighted = (entry: ConvexHullEntry): boolean =>
    helpers.is_entry_highlighted(entry, highlighted_entries)

  // Re-render when important state changes
  $effect(() => {
    // oxfmt-ignore
    void [show_hull_faces, color_mode, color_scale, show_stable_labels, show_unstable_labels, max_hull_dist_show_labels, camera.elevation, camera.azimuth, camera.zoom, camera.center_x, camera.center_y, plot_entries, visible_entries, hull_face_color, hull_face_opacity, hull_face_color_mode, element_colors, highlighted_entries, text_color] // track reactively

    render_once()
  })

  // function (not const) so the create_canvas_interactions options above can reference it
  function extract_structure_from_entry(entry: ConvexHullEntry): AnyStructure | null {
    return helpers.extract_structure_from_entry(entries, entry)
  }

  const reset_camera = () => Object.assign(camera, camera_default)
  function reset_all() {
    reset_camera()
    fullscreen = DEFAULTS.convex_hull.ternary.fullscreen
    info_pane_open = DEFAULTS.convex_hull.ternary.info_pane_open
    controls_open = DEFAULTS.convex_hull.ternary.legend_pane_open
    color_mode = DEFAULTS.convex_hull.ternary.color_mode
    color_scale = DEFAULTS.convex_hull.ternary.color_scale as D3InterpolateName
    show_stable = DEFAULTS.convex_hull.ternary.show_stable
    show_unstable = DEFAULTS.convex_hull.ternary.show_unstable
    hidden_categories = []
    show_stable_labels = DEFAULTS.convex_hull.ternary.show_stable_labels
    show_unstable_labels = DEFAULTS.convex_hull.ternary.show_unstable_labels
    max_hull_dist_show_labels = DEFAULTS.convex_hull.ternary.max_hull_dist_show_labels
    // Use auto-computed threshold based on entry count instead of static default
    max_hull_dist_show_phases = hull_data.auto_default_threshold
    show_hull_faces = DEFAULTS.convex_hull.ternary.show_hull_faces
    hull_face_color = DEFAULTS.convex_hull.ternary.hull_face_color
    hull_face_opacity = DEFAULTS.convex_hull.ternary.hull_face_opacity
    hull_face_color_mode = DEFAULTS.convex_hull.ternary
      .hull_face_color_mode as HullFaceColorMode
  }

  const get_point_color = (entry: ConvexHullEntry): string =>
    helpers.get_point_color_for_entry(
      entry,
      color_mode,
      merged_config.colors,
      energy_color_scale,
    )

  // Cache energy color scale per frame/setting
  const energy_color_scale = $derived.by(() =>
    helpers.get_energy_color_scale(color_mode, color_scale, plot_entries),
  )

  // Convex hull statistics - compute internally and expose via bindable prop
  $effect(() => {
    phase_stats = thermo.get_convex_hull_stats(plot_entries, elements, 3)
  })

  // 3D to 2D projection for ternary diagrams
  function project_3d_point(
    x: number,
    y: number,
    z: number,
  ): { x: number; y: number; depth: number } {
    if (!canvas) return { x: 0, y: 0, depth: 0 }

    const [elev, azim] = [(camera.elevation * Math.PI) / 180, (camera.azimuth * Math.PI) / 180]
    const [cos_az, sin_az, cos_el, sin_el] = [
      Math.cos(azim),
      Math.sin(azim),
      Math.cos(-elev),
      Math.sin(-elev),
    ]
    const centroid = get_triangle_centroid()
    const { center: e_ctr, z_scale } = energy_range

    const [dx, dy, dz] = [x - centroid.x, y - centroid.y, (z - e_ctr) * z_scale]
    const [x1, y1] = [dx * cos_az - dy * sin_az, dx * sin_az + dy * cos_az]
    const [y2, z2] = [y1 * cos_el - dz * sin_el, y1 * sin_el + dz * cos_el]

    // Use Math.min for consistent scaling with cached canvas dimensions
    const scale = Math.min(canvas_dims.width, canvas_dims.height) * 0.6 * camera.zoom
    return {
      x: canvas_dims.width / 2 + camera.center_x + x1 * scale,
      y: canvas_dims.height / 2 + camera.center_y - y2 * scale,
      depth: z2,
    }
  }

  function draw_structure_outline(): void {
    if (!ctx || !canvas) return

    // Set consistent style for all triangle structure lines
    ctx.strokeStyle = CONVEX_HULL_STYLE.structure_line.color
    ctx.lineWidth = CONVEX_HULL_STYLE.structure_line.line_width
    ctx.setLineDash(CONVEX_HULL_STYLE.structure_line.dash) // Dashed lines for all structure lines

    // Draw triangle base and vertical edges
    draw_triangle_structure()
  }

  function draw_triangle_structure(): void {
    if (!ctx || !canvas) return

    // Get formation energy range for vertical edges
    const e_form_min = energy_range.min // Includes 0 for elemental references
    const e_form_max = energy_range.max // Includes 0 for elemental references

    // Draw base triangle edges (top triangle at formation energy = 0)
    const triangle_edges = get_triangle_edges()
    ctx.beginPath()
    for (const [v1, v2] of triangle_edges) {
      const proj1 = project_3d_point(v1.x, v1.y, 0) // Base triangle at formation energy = 0
      const proj2 = project_3d_point(v2.x, v2.y, 0)

      ctx.moveTo(proj1.x, proj1.y)
      ctx.lineTo(proj2.x, proj2.y)
    }
    ctx.stroke()

    // Draw vertical edges from corners (from most negative to 0 formation energy)
    const vertical_edges = get_triangle_vertical_edges(e_form_min, e_form_max)
    ctx.beginPath()
    for (const [v1, v2] of vertical_edges) {
      const proj1 = project_3d_point(v1.x, v1.y, v1.z)
      const proj2 = project_3d_point(v2.x, v2.y, v2.z)

      ctx.moveTo(proj1.x, proj1.y)
      ctx.lineTo(proj2.x, proj2.y)
    }
    ctx.stroke()

    // Draw bottom triangle (connecting the bottom tips of vertical lines)
    const bottom_triangle_edges = get_triangle_edges()
    ctx.beginPath()
    for (const [v1, v2] of bottom_triangle_edges) {
      const proj1 = project_3d_point(v1.x, v1.y, e_form_min) // Bottom triangle at most negative energy
      const proj2 = project_3d_point(v2.x, v2.y, e_form_min)

      ctx.moveTo(proj1.x, proj1.y)
      ctx.lineTo(proj2.x, proj2.y)
    }
    ctx.stroke()

    // Reset stroke style to default for other elements
    const styles = getComputedStyle(canvas)
    ctx.strokeStyle = styles.getPropertyValue(`--hull-edge-color`) || `#212121`
    ctx.setLineDash([]) // Reset line dash for other drawing operations
  }

  function draw_element_labels(): void {
    if (!ctx || elements.length !== 3) return

    ctx.save()

    // Draw element labels outside triangle corners
    const centroid = get_triangle_centroid()
    ctx.fillStyle = text_color
    ctx.font = `bold 16px Arial`
    ctx.textAlign = `center`
    ctx.textBaseline = `middle`

    for (let idx = 0; idx < TRIANGLE_VERTICES.length && idx < elements.length; idx++) {
      const [x, y] = TRIANGLE_VERTICES[idx]
      const dx = x - centroid.x
      const dy = y - centroid.y
      const length = Math.hypot(dx, dy)
      const distance = 0.05

      const label_pos = {
        x: x + (dx / length) * distance,
        y: y + (dy / length) * distance,
        z: 0,
      }

      const proj = project_3d_point(label_pos.x, label_pos.y, label_pos.z)
      ctx.fillText(elements[idx], proj.x, proj.y)
    }

    ctx.restore()
  }

  function draw_z_axis_ticks(): void {
    if (!ctx || elements.length !== 3) return
    // Hide z-axis in near-top-down views where ticks collapse to a point
    if (Math.abs(camera.elevation) < MIN_ELEV_FOR_Z_AXIS) return

    const { min: e_min, max: e_max, center: e_mid } = energy_range
    if (Math.abs(e_max - e_min) < 1e-6) return

    // Find the vertex that projects to the leftmost x-position (changes with rotation)
    const projected_vertices = TRIANGLE_VERTICES.map(([vx, vy]) =>
      project_3d_point(vx, vy, e_mid),
    )
    const leftmost_idx = projected_vertices.reduce(
      (min_idx, proj, idx) => (proj.x < projected_vertices[min_idx].x ? idx : min_idx),
      0,
    )
    const [axis_x, axis_y] = TRIANGLE_VERTICES[leftmost_idx]
    const tick_len = 6 * canvas_dims.scale

    ctx.save()
    ctx.fillStyle = text_color
    ctx.textAlign = `right`
    ctx.textBaseline = `middle`
    ctx.strokeStyle = CONVEX_HULL_STYLE.structure_line.color
    ctx.font = `${merged_config.font_size}px Arial`

    for (const tick of ticks(e_min, e_max, 5)) {
      const { x, y } = project_3d_point(axis_x, axis_y, tick)
      ctx.beginPath()
      ctx.moveTo(x - tick_len, y)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.fillText(format_num(tick, `.2~`), x - tick_len - 4, y)
    }

    // Rotated axis label: Eform (eV/atom) with "form" as subscript
    const { x: lx, y: ly } = project_3d_point(axis_x, axis_y, e_mid)
    const fs = merged_config.font_size ?? 12
    const sub_fs = Math.round(fs * 0.75)
    ctx.translate(lx - 50 * canvas_dims.scale, ly)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = `left`
    // Measure widths in each font, then draw — reordered to minimize font switches
    ctx.font = `bold ${fs}px Arial`
    const e_width = ctx.measureText(`E`).width
    const suffix_width = ctx.measureText(` (eV/atom)`).width
    ctx.font = `${sub_fs}px Arial`
    const form_width = ctx.measureText(`form`).width
    const offset = -(e_width + form_width + suffix_width) / 2
    // Draw subscript while sub-font is still active
    ctx.fillText(`form`, offset + e_width, fs * 0.3)
    ctx.font = `bold ${fs}px Arial`
    ctx.fillText(`E`, offset, 0)
    ctx.fillText(` (eV/atom)`, offset + e_width + form_width, 0)
    ctx.restore()
  }

  function draw_convex_hull_faces(): void {
    if (!ctx || !show_hull_faces || hull_faces.length === 0) return

    // Lazy computation for uniform mode: normalize alpha by formation energy
    let norm_alpha: ((e_form: number) => number) | null = null
    if (hull_face_color_mode === `uniform`) {
      const min_uniform_e_form = energy_range.min
      norm_alpha = (e_form: number) => {
        const alpha_fraction = Math.max(
          0,
          Math.min(1, (0 - e_form) / Math.max(1e-6, 0 - min_uniform_e_form)),
        )
        return alpha_fraction * hull_face_opacity
      }
    }

    // Lazy computation for formation_energy mode
    let energy_face_scale: ((val: number) => string) | null = null
    let min_face_e_form = 0
    if (hull_face_color_mode === `formation_energy`) {
      const all_e_form = hull_faces.flatMap((tri) => tri.vertices.map((vertex) => vertex.z))
      min_face_e_form = helpers.array_min(all_e_form)
      energy_face_scale = helpers.get_energy_color_scale(
        `energy`,
        color_scale,
        all_e_form.map((e_form) => ({
          e_above_hull: e_form - min_face_e_form,
        })), // Normalize to 0-based
      )
    }

    // Helper to get face color based on mode
    const get_face_color = (tri: (typeof hull_faces)[0], tri_idx: number): string => {
      if (hull_face_color_mode === `uniform`) {
        return hull_face_color
      }
      if (hull_face_color_mode === `formation_energy`) {
        const avg_e_form = (tri.vertices[0].z + tri.vertices[1].z + tri.vertices[2].z) / 3
        return energy_face_scale?.(avg_e_form - min_face_e_form) ?? hull_face_color
      }
      if (hull_face_color_mode === `dominant_element`) {
        // Find element vertex closest to face centroid in 2D ternary space (single-pass argmin)
        const { x: cx, y: cy } = tri.centroid
        let [closest_idx, min_dist] = [0, Infinity]
        for (const [idx, [tx, ty]] of TRIANGLE_VERTICES.entries()) {
          const dist = Math.hypot(cx - tx, cy - ty)
          if (dist < min_dist) [closest_idx, min_dist] = [idx, dist]
        }
        const el = elements[closest_idx]
        return element_colors[el] ?? `#888888`
      }
      if (hull_face_color_mode === `facet_index`) {
        return PLOT_COLORS[tri_idx % PLOT_COLORS.length]
      }
      return hull_face_color
    }

    // Sort faces by depth for proper rendering
    const faces_with_depth = hull_faces.map((tri, tri_idx) => {
      const centroid_proj = project_3d_point(tri.centroid.x, tri.centroid.y, tri.centroid.z)
      return { tri, tri_idx, depth: centroid_proj.depth }
    })

    faces_with_depth.sort((left, right) => left.depth - right.depth) // Back to front

    // Draw each face (lower hull only)
    for (const { tri, tri_idx } of faces_with_depth) {
      const [p1, p2, p3] = tri.vertices

      const proj1 = project_3d_point(p1.x, p1.y, p1.z)
      const proj2 = project_3d_point(p2.x, p2.y, p2.z)
      const proj3 = project_3d_point(p3.x, p3.y, p3.z)

      const face_color = get_face_color(tri, tri_idx)

      // For uniform mode, use gradient with variable opacity
      // For other modes, use fixed opacity
      if (hull_face_color_mode === `uniform`) {
        // Build per-face linear gradient in screen space matching linear variation of formation energy
        const a1 = norm_alpha?.(p1.z) ?? 0
        const a2 = norm_alpha?.(p2.z) ?? 0
        const a3 = norm_alpha?.(p3.z) ?? 0

        // Solve a*x + b*y + c = alpha at the three projected vertices
        const x1 = proj1.x,
          y1 = proj1.y
        const x2 = proj2.x,
          y2 = proj2.y
        const x3 = proj3.x,
          y3 = proj3.y
        const det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)
        let coef_a = 0,
          coef_b = 0,
          coef_c = (a1 + a2 + a3) / 3
        if (Math.abs(det) > 1e-9) {
          coef_a = (a1 * (y2 - y3) + a2 * (y3 - y1) + a3 * (y1 - y2)) / det
          coef_b = (a1 * (x3 - x2) + a2 * (x1 - x3) + a3 * (x2 - x1)) / det
          coef_c =
            (a1 * (x2 * y3 - x3 * y2) + a2 * (x3 * y1 - x1 * y3) + a3 * (x1 * y2 - x2 * y1)) /
            det
        }

        // Helper to draw filled+stroked triangle
        const draw_tri = (fill: string | CanvasGradient, stroke_alpha: number) => {
          if (!ctx) return
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(proj1.x, proj1.y)
          ctx.lineTo(proj2.x, proj2.y)
          ctx.lineTo(proj3.x, proj3.y)
          ctx.closePath()
          ctx.fillStyle = fill
          ctx.fill()
          ctx.strokeStyle = add_alpha(face_color, Math.min(0.6, stroke_alpha))
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.restore()
        }

        // Gradient direction is the screen-space gradient of alpha
        const mag = Math.hypot(coef_a, coef_b)
        if (mag < 1e-9) {
          // Fallback: uniform fill if nearly flat
          const avg_alpha = (a1 + a2 + a3) / 3
          draw_tri(add_alpha(face_color, avg_alpha), avg_alpha * 3)
        } else {
          const vx = coef_a / mag
          const vy = coef_b / mag
          const cx = (x1 + x2 + x3) / 3
          const cy = (y1 + y2 + y3) / 3
          const alpha_c = coef_a * cx + coef_b * cy + coef_c
          const alpha_min = Math.min(a1, a2, a3)
          const alpha_max = Math.max(a1, a2, a3)
          const s_min = (alpha_min - alpha_c) / mag
          const s_max = (alpha_max - alpha_c) / mag

          const grad = ctx.createLinearGradient(
            cx + vx * s_min,
            cy + vy * s_min,
            cx + vx * s_max,
            cy + vy * s_max,
          )
          grad.addColorStop(0, add_alpha(face_color, alpha_min))
          grad.addColorStop(1, add_alpha(face_color, alpha_max))
          draw_tri(grad, alpha_max * 3)
        }
      } else {
        // Non-uniform modes: solid color with fixed opacity
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(proj1.x, proj1.y)
        ctx.lineTo(proj2.x, proj2.y)
        ctx.lineTo(proj3.x, proj3.y)
        ctx.closePath()
        ctx.fillStyle = add_alpha(face_color, hull_face_opacity)
        ctx.fill()
        ctx.strokeStyle = add_alpha(face_color, Math.min(0.6, hull_face_opacity * 3))
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  // Formation energy color bar helpers
  const e_form_range = $derived.by((): Vec2 => {
    const min_fe = plot_entries.length > 0 ? energy_range.min : -1
    return [min_fe, 0]
  })

  const e_form_color_scale_fn = $derived.by(() => {
    const [min_fe, max_fe] = e_form_range
    const denom = Math.max(1e-6, max_fe - min_fe)
    return (value: number) => {
      // alpha 0 at 0 eV, goes to hull_face_opacity at most negative energy
      const energy_fraction = Math.max(0, Math.min(1, (value - min_fe) / denom))
      const alpha = (1 - energy_fraction) * hull_face_opacity
      return add_alpha(hull_face_color, alpha)
    }
  })

  function draw_data_points(): void {
    if (!ctx || sorted_points_cache.length === 0) return
    helpers.draw_hull_points(ctx, sorted_points_cache, {
      scale: canvas_dims.scale,
      shadow_factor: 0.1,
      selected_entry,
      is_highlighted,
      get_point_color,
      highlight_style: merged_highlight_style,
      pulse_time: pulse.time,
      pulse_opacity,
    })
  }

  const hull_label_font_size = 12
  const hull_label_subscript_font_size = 11
  const hull_label_font = `${hull_label_font_size}px Arial`
  const hull_label_subscript_font = `${hull_label_subscript_font_size}px Arial`

  function label_priority_energy(entry: ConvexHullEntry): number {
    for (const value of [
      entry.e_form_per_atom,
      entry.z,
      entry.energy_per_atom,
      entry.energy,
      entry.e_above_hull,
    ]) {
      if (typeof value === `number` && Number.isFinite(value)) return value
    }
    return Number.POSITIVE_INFINITY
  }

  function get_label_placements(
    projected: { x: number; y: number },
    point_size: number,
    text_width: number,
    text_height: number,
  ): LabelPlacement[] {
    const padding = Math.max(1, 2 * canvas_dims.scale)
    const gap = point_size + 4 * canvas_dims.scale
    const side_gap = point_size + 5 * canvas_dims.scale
    const placements = [
      { x: projected.x, y: projected.y + gap },
      { x: projected.x, y: projected.y - gap - text_height },
      { x: projected.x + side_gap + text_width / 2, y: projected.y - text_height / 2 },
      { x: projected.x - side_gap - text_width / 2, y: projected.y - text_height / 2 },
      { x: projected.x + side_gap + text_width / 2, y: projected.y + gap },
      { x: projected.x - side_gap - text_width / 2, y: projected.y + gap },
      { x: projected.x + side_gap + text_width / 2, y: projected.y - gap - text_height },
      { x: projected.x - side_gap - text_width / 2, y: projected.y - gap - text_height },
    ]

    return placements.map((placement) => ({
      ...placement,
      rect: pad_rect(
        centered_rect(placement.x, placement.y, text_width, text_height),
        padding,
      ),
    }))
  }

  function measure_formula_segments(
    context: CanvasRenderingContext2D,
    segments: FormulaLabelSegment[],
  ): number {
    context.save()
    const width = segments.reduce((sum, segment) => {
      context.font = segment.subscript ? hull_label_subscript_font : hull_label_font
      return sum + context.measureText(segment.text).width
    }, 0)
    context.restore()
    return width
  }

  function draw_formula_segments(
    context: CanvasRenderingContext2D,
    segments: FormulaLabelSegment[],
    center_x: number,
    top_y: number,
    text_width: number,
  ): void {
    const subscript_offset = hull_label_font_size * 0.28
    let text_x = center_x - text_width / 2

    context.save()
    context.textAlign = `left`
    context.textBaseline = `top`
    for (const segment of segments) {
      context.font = segment.subscript ? hull_label_subscript_font : hull_label_font
      context.fillText(
        segment.text,
        text_x,
        top_y + (segment.subscript ? subscript_offset : 0),
      )
      text_x += context.measureText(segment.text).width
    }
    context.restore()
  }

  function draw_hull_labels(): void {
    if (!ctx || !merged_config.show_labels) return

    ctx.fillStyle = text_color
    ctx.font = hull_label_font
    ctx.textAlign = `center`
    ctx.textBaseline = `top`
    const label_height = hull_label_font_size + 2

    const label_entries = helpers
      .get_composition_label_entries(
        visible_entries.filter((entry) => {
          if (entry.is_element) return false
          const is_stable_point = helpers.entry_is_stable(entry)
          return (
            (is_stable_point && show_stable_labels) ||
            (!is_stable_point &&
              show_unstable_labels &&
              (entry.e_above_hull ?? 0) <= max_hull_dist_show_labels)
          )
        }),
      )
      .sort((entry_1, entry_2) => {
        const energy_diff = label_priority_energy(entry_1) - label_priority_energy(entry_2)
        if (energy_diff !== 0) return energy_diff
        return (entry_1.e_above_hull ?? 0) - (entry_2.e_above_hull ?? 0)
      })

    const occupied_rects: Rect[] = []
    const canvas_rect: Rect = {
      x: 0,
      y: 0,
      width: canvas_dims.width,
      height: canvas_dims.height,
    }
    for (const entry of label_entries) {
      const projected = project_3d_point(entry.x, entry.y, entry.z)
      const formula_segments = get_formula_label_segments(
        helpers.get_entry_label(entry, elements),
      )
      const is_stable_point = helpers.entry_is_stable(entry)
      const point_size = (entry.size || (is_stable_point ? 6 : 4)) * canvas_dims.scale
      const text_width = measure_formula_segments(ctx, formula_segments)
      const placements = get_label_placements(projected, point_size, text_width, label_height)
      const placement = placements.find(
        (candidate) =>
          rect_within_rect(candidate.rect, canvas_rect) &&
          !occupied_rects.some((occupied_rect) =>
            rects_overlap(candidate.rect, occupied_rect),
          ),
      )
      if (!placement) continue

      occupied_rects.push(placement.rect)
      draw_formula_segments(ctx, formula_segments, placement.x, placement.y, text_width)
    }
  }

  function render_frame(): void {
    if (!ctx || !canvas) return

    // Use CSS dimensions for rendering
    const display_width = canvas.clientWidth || 600
    const display_height = canvas.clientHeight || 600

    // Clear canvas
    ctx.clearRect(0, 0, display_width, display_height)

    // Set background - use transparent to inherit from container
    ctx.fillStyle = `transparent`
    ctx.fillRect(0, 0, display_width, display_height)

    if (elements.length !== 3) {
      if (elements.length > 0) {
        ctx.fillStyle = text_color
        ctx.font = `16px Arial`
        ctx.textAlign = `center`
        ctx.textBaseline = `middle`
        ctx.fillText(
          `Ternary convex hull requires exactly 3 elements (got ${elements.length})`,
          display_width / 2,
          display_height / 2,
        )
      }
      return
    }

    draw_structure_outline()
    draw_convex_hull_faces() // behind points
    draw_z_axis_ticks() // after faces for visibility at high opacity
    draw_data_points()
    draw_hull_labels()
    draw_element_labels()
  }

  // Reactive dark mode detection for canvas text color
  let dark_mode = $state(is_dark_mode())
  $effect(() => watch_dark_mode((dark) => (dark_mode = dark)))
  const text_color = $derived(helpers.get_canvas_text_color(dark_mode))

  // Performance: Cache canvas dimensions and formation energy range
  let canvas_dims = $state({ width: 600, height: 600, scale: 1 })
  const energy_range = $derived.by(() => {
    let min = 0
    let max = 0
    for (const entry of all_enriched_entries) {
      const energy = entry.e_form_per_atom ?? 0
      min = Math.min(min, energy)
      max = Math.max(max, energy)
    }
    const z_scale = 0.75 / Math.max(max - min, 0.001)
    return { min, max, center: (min + max) / 2, z_scale }
  })

  let style = $derived(helpers.hull_style_css(merged_config.colors))
</script>

<svelte:document
  onfullscreenchange={() => {
    // tie fullscreen state to this component's own wrapper, not any fullscreen element
    fullscreen = document.fullscreenElement === wrapper
  }}
  onmousemove={interactions.handle_mouse_move}
  onmouseup={interactions.handle_mouse_up}
/>

<div
  {...rest}
  class={[`convex-hull-3d`, rest.class]}
  class:dragover={interactions.drag_over}
  style={`${style}; ${rest.style ?? ``}`}
  data-has-selection={selected_entry !== null}
  data-has-hover={interactions.hover_data !== null}
  data-is-dragging={interactions.is_dragging}
  bind:this={wrapper}
  role="application"
  tabindex="-1"
  {...interactions.wrapper_handlers}
  aria-label="Ternary convex hull visualization"
>
  {@render children?.({
    stable_entries,
    unstable_entries,
    highlighted_entries,
    selected_entry,
  })}
  <h3 style="position: absolute; left: 1em; top: 1ex; margin: 0; font-weight: 500">
    {@html sanitize_html(merged_controls.title || phase_stats?.chemical_system || ``)}
  </h3>
  <canvas
    bind:this={canvas}
    tabindex="0"
    aria-label={merged_controls.title || phase_stats?.chemical_system || `3D Convex Hull`}
    {...interactions.canvas_handlers}
  ></canvas>

  {#if entries.length === 0}
    <Spinner
      text="Loading data..."
      style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center"
    />
  {/if}

  <!-- Formation Energy Color Bar (bottom-left corner) -->
  {#if color_mode === `energy` && plot_entries.length > 0}
    <ColorBar
      title="Energy above hull (eV/atom)"
      range={helpers.hull_distance_range(plot_entries)}
      {color_scale}
      wrapper_style="position: absolute; bottom: 16px; left: 1em; width: 200px;"
      bar_style="height: 12px;"
      title_style="margin-bottom: 4px;"
    />
  {/if}

  <!-- Formation Energy Faces Color Bar (bottom-right corner) -->
  <!-- Only show for uniform/formation_energy modes where face color relates to E_form -->
  {#if plot_entries.length > 0 && show_hull_faces && (hull_face_color_mode === `uniform` || hull_face_color_mode === `formation_energy`)}
    <ColorBar
      title="Formation energy (eV/atom)"
      color_scale_fn={e_form_color_scale_fn}
      color_scale_domain={e_form_range}
      range={e_form_range}
      wrapper_style="position: absolute; bottom: 16px; right: 1em; width: 200px;"
      bar_style="height: 12px;"
      title_style="margin-bottom: 4px;"
    />
  {/if}

  <!-- Toolbar + tooltip/copy-feedback/drag/structure-popup chrome -->
  <ConvexHullChrome
    {interactions}
    {hull_data}
    {controls_config}
    {reset_all}
    reset_title="Reset view and settings"
    {enable_info_pane}
    {phase_stats}
    {label_threshold}
    {fullscreen}
    {fullscreen_toggle}
    {wrapper}
    {camera}
    {merged_controls}
    {stable_entries}
    {unstable_entries}
    {get_point_color}
    {merged_highlight_style}
    {is_highlighted}
    {tooltip}
    {selected_entry}
    bind:show_hull_faces
    bind:hull_face_color
    bind:hull_face_opacity
    bind:hull_face_color_mode
    bind:info_pane_open
    bind:controls_open
    bind:color_mode
    bind:color_scale
    bind:show_stable
    bind:show_unstable
    {entry_category}
    bind:hidden_categories
    bind:show_stable_labels
    bind:show_unstable_labels
    bind:max_hull_dist_show_phases
    bind:max_hull_dist_show_labels
    bind:energy_source_mode
  />

  <!-- Orientation gizmo (configurable placement, default top-right) -->
  {#if gizmo && typeof WebGLRenderingContext !== `undefined`}
    <div class="gizmo-wrapper {controls_config.class}" data-placement={gizmo_placement}>
      <Canvas
        createRenderer={(cvs: HTMLCanvasElement) =>
          new WebGLRenderer({ canvas: cvs, alpha: true, antialias: true })}
      >
        <T.PerspectiveCamera
          makeDefault
          bind:ref={gizmo_cam_ref}
          position={gizmo_cam_state.position}
          up={gizmo_cam_state.up}
          fov={50}
        >
          <extras.OrbitControls
            bind:ref={gizmo_orbit_ref}
            enableRotate={false}
            enableZoom={false}
            enablePan={false}
          >
            <extras.Gizmo
              {...gizmo_props}
              onstart={() => (gizmo_active = true)}
              onchange={sync_gizmo_to_camera}
              onend={() => {
                sync_gizmo_to_camera()
                gizmo_active = false
              }}
            />
          </extras.OrbitControls>
        </T.PerspectiveCamera>
      </Canvas>
    </div>
  {/if}

  {#if (has_temp_data && temperature !== undefined) || (gas_analysis.has_gas_dependent_elements && merged_gas_config)}
    <div class="right-controls">
      {#if has_temp_data && temperature !== undefined}
        <TemperatureSlider
          available_temperatures={hull_data.available_temperatures}
          bind:temperature
        />
      {/if}
      {#if gas_analysis.has_gas_dependent_elements && merged_gas_config}
        <GasPressureControls
          config={merged_gas_config}
          bind:pressures={gas_pressures}
          temperature={temperature ?? 300}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .convex-hull-3d {
    position: relative;
    container-type: size; /* enable cqh/cqw for responsive sizing */
    width: 100%;
    height: var(--hull-height, 500px);
    background: var(--hull-3d-bg, var(--hull-bg));
    border-radius: var(--hull-border-radius, var(--border-radius, 3pt));
  }
  .convex-hull-3d:fullscreen {
    border-radius: 0;
    background: var(--hull-3d-bg-fullscreen, var(--hull-3d-bg, var(--hull-bg)));
    overflow: hidden;
  }
  .convex-hull-3d.dragover {
    border: 2px dashed var(--accent-color, #1976d2);
  }
  canvas {
    width: 100%;
    height: 100%;
    cursor: grab;
  }
  canvas:active {
    cursor: grabbing;
  }
  .right-controls {
    position: absolute;
    top: calc(1ex + 50px);
    right: 1ex;
    z-index: 2;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .right-controls :global(.temperature-slider),
  .right-controls :global(.pressure-controls) {
    position: static;
  }
  /* align both vertical range inputs at the same x position */
  .right-controls :global(.slider-wrapper) {
    justify-content: flex-end;
  }
  .gizmo-wrapper {
    position: absolute;
    width: clamp(80px, 18cqmin, 110px);
    height: clamp(80px, 18cqmin, 110px);
    pointer-events: auto;
    isolation: isolate; /* contain z-index: 1000 from three-viewport-gizmo overlay */
    transition: opacity 0.2s ease-in-out;
  }
  .gizmo-wrapper[data-placement='top-right'] {
    top: 1.8em;
    right: 1ex;
  }
  .gizmo-wrapper[data-placement='top-left'] {
    top: 1.8em;
    left: 1ex;
  }
  .gizmo-wrapper[data-placement='bottom-right'] {
    bottom: 2.5em;
    right: 1ex;
  }
  .gizmo-wrapper[data-placement='bottom-left'] {
    bottom: 2.5em;
    left: 1ex;
  }
  .gizmo-wrapper.hover-visible {
    opacity: 0;
    pointer-events: none;
  }
  .convex-hull-3d:hover .gizmo-wrapper.hover-visible,
  .convex-hull-3d:focus-within .gizmo-wrapper.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
</style>
