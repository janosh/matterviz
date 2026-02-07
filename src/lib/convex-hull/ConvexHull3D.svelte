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
  import { normalize_show_controls } from '$lib/controls'
  import type { ElementSymbol } from '$lib/element'
  import { ClickFeedback, DragOverlay } from '$lib/feedback'
  import Icon from '$lib/Icon.svelte'
  import { format_num } from '$lib/labels'
  import {
    set_fullscreen_bg,
    setup_fullscreen_effect,
    toggle_fullscreen,
  } from '$lib/layout'
  import { ColorBar, PlotTooltip } from '$lib/plot'
  import { DEFAULTS } from '$lib/settings'
  import type { AnyStructure } from '$lib/structure'
  import { Canvas, T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { ticks } from 'd3-array'
  import { SvelteMap } from 'svelte/reactivity'
  import { PerspectiveCamera, WebGLRenderer } from 'three'
  import {
    get_ternary_3d_coordinates,
    get_triangle_centroid,
    get_triangle_edges,
    get_triangle_vertical_edges,
    TRIANGLE_VERTICES,
  } from './barycentric-coords'
  import ConvexHullControls from './ConvexHullControls.svelte'
  import ConvexHullInfoPane from './ConvexHullInfoPane.svelte'
  import ConvexHullTooltip from './ConvexHullTooltip.svelte'
  import GasPressureControls from './GasPressureControls.svelte'
  import * as helpers from './helpers'
  import type { BaseConvexHullProps, Hull3DProps } from './index'
  import { CONVEX_HULL_STYLE, default_controls, default_hull_config } from './index'
  import StructurePopup from './StructurePopup.svelte'
  import TemperatureSlider from './TemperatureSlider.svelte'
  import * as thermo from './thermodynamics'
  import type {
    ConvexHullEntry,
    HighlightStyle,
    HoverData3D,
    HullFaceColorMode,
    Point3D,
  } from './types'

  let {
    entries = [],
    controls = {},
    config = {},
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(DEFAULTS.convex_hull.ternary.fullscreen),
    enable_fullscreen = true,
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(DEFAULTS.convex_hull.ternary.show_stable),
    show_unstable = $bindable(DEFAULTS.convex_hull.ternary.show_unstable),
    show_hull_faces = $bindable(DEFAULTS.convex_hull.ternary.show_hull_faces),
    hull_face_opacity = $bindable(DEFAULTS.convex_hull.ternary.hull_face_opacity),
    hull_face_color_mode = $bindable(
      DEFAULTS.convex_hull.ternary.hull_face_color_mode as HullFaceColorMode,
    ),
    element_colors = vesta_hex,
    color_mode = $bindable(DEFAULTS.convex_hull.ternary.color_mode),
    color_scale = $bindable(
      DEFAULTS.convex_hull.ternary.color_scale as D3InterpolateName,
    ),
    info_pane_open = $bindable(DEFAULTS.convex_hull.ternary.info_pane_open),
    legend_pane_open = $bindable(DEFAULTS.convex_hull.ternary.legend_pane_open),
    max_hull_dist_show_phases = $bindable(
      DEFAULTS.convex_hull.ternary.max_hull_dist_show_phases,
    ),
    max_hull_dist_show_labels = $bindable(
      DEFAULTS.convex_hull.ternary.max_hull_dist_show_labels,
    ),
    show_stable_labels = $bindable(DEFAULTS.convex_hull.ternary.show_stable_labels),
    show_unstable_labels = $bindable(
      DEFAULTS.convex_hull.ternary.show_unstable_labels,
    ),
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
  }: BaseConvexHullProps<ConvexHullEntry> & Hull3DProps & {
    highlight_style?: HighlightStyle
  } = $props()

  const merged_controls = $derived({ ...default_controls, ...controls })
  const controls_config = $derived(normalize_show_controls(merged_controls.show))
  const merged_config = $derived({
    ...default_hull_config,
    ...config,
    colors: { ...default_hull_config.colors, ...(config.colors || {}) },
    margin: { t: 40, r: 40, b: 60, l: 60, ...(config.margin || {}) },
  })

  // Temperature-dependent free energy support
  const { has_temp_data, available_temperatures } = $derived(
    helpers.analyze_temperature_data(entries),
  )

  // Initialize or reset temperature when it's undefined or no longer valid
  $effect(() => {
    if (
      has_temp_data &&
      available_temperatures.length > 0 &&
      (temperature === undefined || !available_temperatures.includes(temperature))
    ) temperature = available_temperatures[0]
  })

  // Filter entries by temperature when in temperature mode
  const temp_filtered_entries = $derived(
    has_temp_data && temperature !== undefined
      ? helpers.filter_entries_at_temperature(entries, temperature, {
        interpolate: interpolate_temperature,
        max_interpolation_gap,
      })
      : entries,
  )

  // Gas-dependent chemical potential support (corrections based on T, P)
  // Default to DEFAULT_GAS_TEMP (room temperature) when no temperature specified
  const {
    entries: gas_corrected_entries,
    analysis: gas_analysis,
    merged_config: merged_gas_config,
  } = $derived(
    helpers.get_gas_corrected_entries(
      temp_filtered_entries,
      gas_config,
      gas_pressures,
      temperature ?? helpers.DEFAULT_GAS_TEMP,
    ),
  )

  let { // Compute energy mode information
    has_precomputed_e_form,
    has_precomputed_hull,
    can_compute_e_form,
    can_compute_hull,
    energy_mode,
    unary_refs,
  } = $derived(
    helpers.compute_energy_mode_info(
      gas_corrected_entries,
      thermo.find_lowest_energy_unary_refs,
      energy_source_mode,
    ),
  )

  const effective_entries = $derived(
    helpers.get_effective_entries(
      gas_corrected_entries,
      energy_mode,
      unary_refs,
      thermo.compute_e_form_per_atom,
    ),
  )

  // Process convex hull data with unified PhaseData interface using effective entries
  const pd_data = $derived(thermo.process_hull_entries(effective_entries))

  // Pre-compute polymorph stats once for O(1) tooltip lookups
  const polymorph_stats_map = $derived(
    helpers.compute_all_polymorph_stats(effective_entries),
  )

  const elements = $derived.by(() => {
    if (pd_data.elements.length > 3) {
      console.error(
        `ConvexHull3D: Dataset contains ${pd_data.elements.length} elements, but ternary diagrams require exactly 3. Found: [${
          pd_data.elements.join(`, `)
        }]`,
      )
      return []
    }

    return pd_data.elements
  })

  // 1) Raw 3D coordinates (formation-energy z), independent of hull state
  const coords_entries = $derived.by(() => {
    if (elements.length !== 3) return []
    try {
      // Pass precomputed el_refs to avoid recomputing in error diagnostics
      const coords = get_ternary_3d_coordinates(
        pd_data.entries,
        elements,
        pd_data.el_refs,
      )
      return coords
    } catch (error) {
      console.error(`Error computing ternary coordinates:`, error)
      return []
    }
  })

  // Compute lower convex hull faces (triangles) for 3D rendering (low energy hull only)
  // Must be defined before all_enriched_entries which uses hull_model
  type HullTriangle = {
    vertices: [Point3D, Point3D, Point3D]
    normal: Point3D
    centroid: Point3D
  }
  const hull_faces = $derived.by((): HullTriangle[] => {
    if (coords_entries.length === 0) return []
    const points = coords_entries.map((e) => ({ x: e.x, y: e.y, z: e.z }))
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
    if (energy_mode !== `on-the-fly`) return coords_entries
    const pts = coords_entries.map((e) => ({ x: e.x, y: e.y, z: e.z }))
    const e_hulls = thermo.compute_e_above_hull_for_points(pts, hull_model)
    return coords_entries.map((e, idx) => ({ ...e, e_above_hull: e_hulls[idx] }))
  })

  // Auto threshold: show all for few entries, use default for many, interpolate between
  const max_hull_dist_in_data = $derived(
    helpers.calc_max_hull_dist_in_data(all_enriched_entries),
  )
  const auto_default_threshold = $derived(helpers.compute_auto_hull_dist_threshold(
    all_enriched_entries.length,
    max_hull_dist_in_data,
    DEFAULTS.convex_hull.ternary.max_hull_dist_show_phases,
  ))

  // Initialize threshold to auto value on first load
  let initialized = $state(false)
  $effect(() => {
    if (!initialized && all_enriched_entries.length > 0) {
      initialized = true
      max_hull_dist_show_phases = auto_default_threshold
    }
  })

  // Filter by threshold and compute visibility
  const plot_entries = $derived(
    all_enriched_entries
      .filter((e) => (e.e_above_hull ?? 0) <= max_hull_dist_show_phases)
      .map((e) => ({
        ...e,
        visible: ((e.is_stable || e.e_above_hull === 0) && show_stable) ||
          (!(e.is_stable || e.e_above_hull === 0) && show_unstable),
      })),
  )

  $effect(() => {
    stable_entries = plot_entries.filter((entry: ConvexHullEntry) =>
      entry.is_stable || entry.e_above_hull === 0
    )
    unstable_entries = plot_entries.filter((entry: ConvexHullEntry) =>
      typeof entry.e_above_hull === `number` && entry.e_above_hull > 0 &&
      !entry.is_stable
    )
  })

  // Canvas rendering
  let canvas: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null

  // Performance optimization
  let frame_id = 0
  let pulse_frame_id = 0

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
  const deg2rad = (deg: number): number => deg * Math.PI / 180
  let gizmo_cam_ref = $state<PerspectiveCamera>()
  let gizmo_orbit_ref = $state<{ update?: () => void }>()
  let gizmo_active = false

  // Convert elevation/azimuth (degrees) to Three.js camera position.
  function gizmo_position(
    elev_deg: number,
    azim_deg: number,
  ): [number, number, number] {
    const [elev, azim] = [deg2rad(elev_deg), deg2rad(azim_deg)]
    return [
      -Math.sin(azim) * Math.sin(elev) * GIZMO_CAM_DIST,
      -Math.cos(azim) * Math.sin(elev) * GIZMO_CAM_DIST,
      Math.cos(elev) * GIZMO_CAM_DIST,
    ]
  }

  // Convert elevation/azimuth (degrees) to Three.js camera up vector.
  function gizmo_up(elev_deg: number, azim_deg: number): [number, number, number] {
    const [elev, azim] = [deg2rad(elev_deg), deg2rad(azim_deg)]
    return [
      Math.sin(azim) * Math.cos(elev),
      Math.cos(azim) * Math.cos(elev),
      Math.sin(elev),
    ]
  }

  // Center camera on the triangle's visual center for a given elevation.
  // The centroid (rotation center) sits at 1/3 height while the bbox
  // center is at 1/2 height — a difference of sqrt(3)/12 in data units.
  // Scale by cos(elevation) so offset only applies in near-top-down views.
  function center_camera(elev_deg: number): void {
    camera.center_x = 0
    const scale = Math.min(canvas_dims.width, canvas_dims.height) * 0.6 * camera.zoom
    camera.center_y = Math.sqrt(3) / 12 * scale * Math.cos(deg2rad(elev_deg))
  }

  // Sync: ConvexHull3D → Three.js gizmo camera (on main canvas drag)
  $effect(() => {
    if (gizmo_active) return
    const cam = gizmo_cam_ref
    if (!cam) return
    cam.position.set(...gizmo_position(camera.elevation, camera.azimuth))
    cam.up.set(...gizmo_up(camera.elevation, camera.azimuth))
    cam.lookAt(0, 0, 0)
    gizmo_orbit_ref?.update?.()
  })

  // Sync: gizmo → ConvexHull3D (during and after gizmo animation)
  function sync_gizmo_to_camera(): void {
    const cam = gizmo_cam_ref
    if (!cam) return
    const { x: cx, y: cy, z: cz } = cam.position
    const dist = Math.sqrt(cx * cx + cy * cy + cz * cz)
    if (dist < 1e-6) return
    const elev = Math.acos(Math.max(-1, Math.min(1, cz / dist))) * 180 / Math.PI
    const sin_elev = Math.sin(deg2rad(elev))
    const azim = Math.abs(sin_elev) > 1e-6
      ? Math.atan2(-cx / (dist * sin_elev), -cy / (dist * sin_elev)) * 180 / Math.PI
      : 0
    camera.elevation = elev
    camera.azimuth = azim
    center_camera(elev)
  }

  // Gizmo axis colors, with consumer overrides merged on top
  const gizmo_props = $derived.by(() => {
    const axis_options = Object.fromEntries(
      [...AXIS_COLORS, ...NEG_AXIS_COLORS].map(([axis, color, hover_color]) => {
        const is_neg = axis.startsWith(`n`)
        return [axis, {
          color,
          labelColor: `#111`,
          opacity: is_neg ? 0.9 : 0.8,
          hover: {
            color: hover_color,
            labelColor: `#222`,
            opacity: is_neg ? 1 : 0.9,
          },
        }]
      }),
    )
    return {
      background: { enabled: false },
      size: 80,
      ...axis_options,
      ...(typeof gizmo === `object` ? gizmo : {}),
    }
  })

  // Interaction state
  let is_dragging = $state(false)
  let drag_started = $state(false)
  let last_mouse = $state({ x: 0, y: 0 })
  let hover_data = $state<HoverData3D<ConvexHullEntry> | null>(null)
  let copy_feedback = $state({ visible: false, position: { x: 0, y: 0 } })

  // Drag and drop state
  let drag_over = $state(false)

  // Structure popup state
  let modal_open = $state(false)
  let selected_structure = $state<AnyStructure | null>(null)
  let modal_place_right = $state(true)

  // Hull face color (customizable via controls)
  let hull_face_color = $state(`#4caf50`)

  // Pulsating highlight for selected point
  let pulse_time = $state(0)
  let pulse_opacity = $derived(0.3 + 0.4 * Math.sin(pulse_time * 4))

  // Merge highlight style with defaults
  const merged_highlight_style = $derived(
    helpers.merge_highlight_style(highlight_style),
  )

  // Helper to check if entry is highlighted
  const is_highlighted = (entry: ConvexHullEntry): boolean =>
    helpers.is_entry_highlighted(entry, highlighted_entries)

  $effect(() => {
    if (!selected_entry && !highlighted_entries.length) return
    const animate = () => {
      pulse_time += 0.02
      render_once()
      pulse_frame_id = requestAnimationFrame(animate)
    }
    pulse_frame_id = requestAnimationFrame(animate)
    return () => {
      if (pulse_frame_id) cancelAnimationFrame(pulse_frame_id)
    }
  })

  // Re-render when important state changes
  $effect(() => {
    // deno-fmt-ignore
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    [show_hull_faces, color_mode, color_scale, show_stable_labels, show_unstable_labels, max_hull_dist_show_labels, camera.elevation, camera.azimuth, camera.zoom, camera.center_x, camera.center_y, plot_entries, hull_face_color, hull_face_opacity, hull_face_color_mode, element_colors, highlighted_entries, text_color]

    render_once()
  })

  // Function to extract structure data from a convex hull entry
  function extract_structure_from_entry(
    entry: ConvexHullEntry,
  ): AnyStructure | null {
    const orig_entry = entries.find((ent) => ent.entry_id === entry.entry_id)
    return orig_entry?.structure as AnyStructure || null
  }

  const reset_camera = () => Object.assign(camera, camera_default)
  function reset_all() {
    reset_camera()
    fullscreen = DEFAULTS.convex_hull.ternary.fullscreen
    info_pane_open = DEFAULTS.convex_hull.ternary.info_pane_open
    legend_pane_open = DEFAULTS.convex_hull.ternary.legend_pane_open
    color_mode = DEFAULTS.convex_hull.ternary.color_mode
    color_scale = DEFAULTS.convex_hull.ternary.color_scale as D3InterpolateName
    show_stable = DEFAULTS.convex_hull.ternary.show_stable
    show_unstable = DEFAULTS.convex_hull.ternary.show_unstable
    show_stable_labels = DEFAULTS.convex_hull.ternary.show_stable_labels
    show_unstable_labels = DEFAULTS.convex_hull.ternary.show_unstable_labels
    max_hull_dist_show_labels = DEFAULTS.convex_hull.ternary.max_hull_dist_show_labels
    // Use auto-computed threshold based on entry count instead of static default
    max_hull_dist_show_phases = auto_default_threshold
    show_hull_faces = DEFAULTS.convex_hull.ternary.show_hull_faces
    hull_face_color = DEFAULTS.convex_hull.ternary.hull_face_color
    hull_face_opacity = DEFAULTS.convex_hull.ternary.hull_face_opacity
    hull_face_color_mode = DEFAULTS.convex_hull.ternary
      .hull_face_color_mode as HullFaceColorMode
  }

  const handle_keydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target.tagName.match(/INPUT|TEXTAREA/)) return

    // Stop propagation if event came from canvas to prevent wrapper's handler
    // from running again (both have onkeydown, causing duplicate handling)
    if (target === canvas) {
      event.stopPropagation()
    }

    if (event.key === `Escape` && modal_open) {
      close_structure_popup()
      return
    }

    // Handle Enter for keyboard accessibility - select hovered entry
    if (event.key === `Enter`) {
      const entry = hover_data?.entry
      if (entry) {
        on_point_click?.(entry)
        if (enable_click_selection) {
          selected_entry = entry
          if (enable_structure_preview) {
            const structure = extract_structure_from_entry(entry)
            if (structure) {
              selected_structure = structure
              modal_place_right = helpers.calculate_modal_side(wrapper)
              modal_open = true
            }
          }
        }
      } else if (modal_open) {
        close_structure_popup()
      }
      return
    }

    const actions: Record<string, () => void> = {
      r: reset_camera,
      t: () => {
        camera.elevation = 0
        camera.azimuth = 0
        center_camera(0)
      },
      b: () => color_mode = color_mode === `stability` ? `energy` : `stability`,
      s: () => show_stable = !show_stable,
      u: () => show_unstable = !show_unstable,
      h: () => show_hull_faces = !show_hull_faces,
      l: () => show_stable_labels = !show_stable_labels,
    }
    actions[event.key.toLowerCase()]?.()
  }

  async function handle_file_drop(event: DragEvent): Promise<void> {
    drag_over = false
    const data = await helpers.parse_hull_entries_from_drop(event)
    if (data) on_file_drop?.(data)
  }

  async function copy_entry_data(
    entry: ConvexHullEntry,
    position: { x: number; y: number },
  ) {
    await helpers.copy_entry_to_clipboard(entry, position, (visible, pos) => {
      copy_feedback.visible = visible
      copy_feedback.position = pos
    })
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
    helpers.get_energy_color_scale(color_mode, color_scale, plot_entries)
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

    const [elev, azim] = [
      (camera.elevation * Math.PI) / 180,
      (camera.azimuth * Math.PI) / 180,
    ]
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
    if (!ctx) return

    // Set consistent style for all triangle structure lines
    ctx.strokeStyle = CONVEX_HULL_STYLE.structure_line.color
    ctx.lineWidth = CONVEX_HULL_STYLE.structure_line.line_width
    ctx.setLineDash(CONVEX_HULL_STYLE.structure_line.dash) // Dashed lines for all structure lines

    // Draw triangle base and vertical edges
    draw_triangle_structure()
  }

  function draw_triangle_structure(): void {
    if (!ctx) return

    // Get formation energy range for vertical edges
    const formation_energies = plot_entries.map((e) => e.e_form_per_atom ?? 0)
    const e_form_min = Math.min(0, ...formation_energies) // Include 0 for elemental references
    const e_form_max = Math.max(0, ...formation_energies) // Include 0 for elemental references

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
    const vertical_edges = get_triangle_vertical_edges(
      e_form_min,
      e_form_max,
    )
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

    for (
      let idx = 0;
      idx < TRIANGLE_VERTICES.length && idx < elements.length;
      idx++
    ) {
      const [x, y] = TRIANGLE_VERTICES[idx]
      const dx = x - centroid.x
      const dy = y - centroid.y
      const length = Math.sqrt(dx * dx + dy * dy)
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

    const { min: e_min, max: e_max, center: e_mid } = energy_range
    if (Math.abs(e_max - e_min) < 1e-6) return

    // Find the vertex that projects to the leftmost x-position (changes with rotation)
    const projected_vertices = TRIANGLE_VERTICES.map(([vx, vy]) =>
      project_3d_point(vx, vy, e_mid)
    )
    const leftmost_idx = projected_vertices.reduce(
      (
        min_idx,
        proj,
        idx,
      ) => (proj.x < projected_vertices[min_idx].x ? idx : min_idx),
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

    // Rotated axis label (Unicode superscript: Eᶠᵒʳᵐ)
    const { x: lx, y: ly } = project_3d_point(axis_x, axis_y, e_mid)
    ctx.translate(lx - 50 * canvas_dims.scale, ly)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = `center`
    ctx.font = `bold ${merged_config.font_size}px Arial`
    ctx.fillText(`E\u1DA0\u1D52\u02B3\u1D50 (eV/atom)`, 0, 0) // Eᶠᵒʳᵐ
    ctx.restore()
  }

  function draw_convex_hull_faces(): void {
    if (!ctx || !show_hull_faces || hull_faces.length === 0) return

    // Lazy computation for uniform mode: normalize alpha by formation energy
    let norm_alpha: ((z: number) => number) | null = null
    if (hull_face_color_mode === `uniform`) {
      const formation_energies = plot_entries.map((e) => e.e_form_per_atom ?? 0)
      const min_fe = Math.min(0, ...formation_energies)
      norm_alpha = (z: number) => {
        const t = Math.max(0, Math.min(1, (0 - z) / Math.max(1e-6, 0 - min_fe)))
        return t * hull_face_opacity
      }
    }

    // Lazy computation for formation_energy mode
    let energy_face_scale: ((val: number) => string) | null = null
    let min_z = 0
    if (hull_face_color_mode === `formation_energy`) {
      const all_z = hull_faces.flatMap((tri) => tri.vertices.map((v) => v.z))
      min_z = Math.min(...all_z)
      energy_face_scale = helpers.get_energy_color_scale(
        `energy`,
        color_scale,
        all_z.map((z) => ({ e_above_hull: z - min_z })), // Normalize to 0-based
      )
    }

    // Helper to get face color based on mode
    const get_face_color = (
      tri: typeof hull_faces[0],
      tri_idx: number,
    ): string => {
      if (hull_face_color_mode === `uniform`) {
        return hull_face_color
      }
      if (hull_face_color_mode === `formation_energy`) {
        const avg_z = (tri.vertices[0].z + tri.vertices[1].z + tri.vertices[2].z) / 3
        return energy_face_scale!(avg_z - min_z)
      }
      if (hull_face_color_mode === `dominant_element`) {
        // Find element vertex closest to face centroid in 2D ternary space
        const { x: cx, y: cy } = tri.centroid
        const dists = TRIANGLE_VERTICES.map(([tx, ty]) =>
          Math.hypot(cx - tx, cy - ty)
        )
        const el = elements[dists.indexOf(Math.min(...dists))]
        return element_colors[el] ?? `#888888`
      }
      if (hull_face_color_mode === `facet_index`) {
        return PLOT_COLORS[tri_idx % PLOT_COLORS.length]
      }
      return hull_face_color
    }

    // Sort faces by depth for proper rendering
    const faces_with_depth = hull_faces.map((tri, tri_idx) => {
      const centroid_proj = project_3d_point(
        tri.centroid.x,
        tri.centroid.y,
        tri.centroid.z,
      )
      return { tri, tri_idx, depth: centroid_proj.depth }
    })

    faces_with_depth.sort((a, b) => a.depth - b.depth) // Back to front

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
        const a1 = norm_alpha!(p1.z)
        const a2 = norm_alpha!(p2.z)
        const a3 = norm_alpha!(p3.z)

        // Solve a*x + b*y + c = alpha at the three projected vertices
        const x1 = proj1.x, y1 = proj1.y
        const x2 = proj2.x, y2 = proj2.y
        const x3 = proj3.x, y3 = proj3.y
        const det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)
        let coef_a = 0, coef_b = 0, coef_c = (a1 + a2 + a3) / 3
        if (Math.abs(det) > 1e-9) {
          coef_a = (a1 * (y2 - y3) + a2 * (y3 - y1) + a3 * (y1 - y2)) / det
          coef_b = (a1 * (x3 - x2) + a2 * (x1 - x3) + a3 * (x2 - x1)) / det
          coef_c = (a1 * (x2 * y3 - x3 * y2) + a2 * (x3 * y1 - x1 * y3) +
            a3 * (x1 * y2 - x2 * y1)) /
            det
        }

        // Helper to draw filled+stroked triangle (ctx guaranteed non-null by early return)
        const draw_tri = (fill: string | CanvasGradient, stroke_alpha: number) => {
          ctx!.save()
          ctx!.beginPath()
          ctx!.moveTo(proj1.x, proj1.y)
          ctx!.lineTo(proj2.x, proj2.y)
          ctx!.lineTo(proj3.x, proj3.y)
          ctx!.closePath()
          ctx!.fillStyle = fill
          ctx!.fill()
          ctx!.strokeStyle = add_alpha(face_color, Math.min(0.6, stroke_alpha))
          ctx!.lineWidth = 1
          ctx!.stroke()
          ctx!.restore()
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
  const e_form_range = $derived.by((): [number, number] => {
    const energies = plot_entries.map((e) => e.e_form_per_atom ?? 0)
    const min_fe = energies.length ? Math.min(0, ...energies) : -1
    return [min_fe, 0]
  })

  const e_form_color_scale_fn = $derived.by(() => {
    const [min_fe, max_fe] = e_form_range
    const denom = Math.max(1e-6, max_fe - min_fe)
    return (value: number) => {
      // alpha 0 at 0 eV, goes to hull_face_opacity at most negative energy
      const t = Math.max(0, Math.min(1, (value - min_fe) / denom))
      const alpha = (1 - t) * hull_face_opacity
      return add_alpha(hull_face_color, alpha)
    }
  })

  function draw_data_points(): void {
    if (!ctx || sorted_points_cache.length === 0) return

    for (const { entry, projected } of sorted_points_cache) {
      const is_stable = entry.is_stable || entry.e_above_hull === 0
      const is_entry_highlighted = is_highlighted(entry)
      const color = get_point_color(entry)
      const size = (entry.size || (is_stable ? 6 : 4)) * canvas_dims.scale
      const marker = entry.marker || `circle`

      // Shadow
      const shadow_offset = Math.abs(entry.z) * 0.1 * canvas_dims.scale
      ctx.fillStyle = `rgba(0, 0, 0, 0.2)`
      const shadow_path = helpers.create_marker_path(size * 0.8, marker)
      ctx.save()
      ctx.translate(projected.x + shadow_offset, projected.y + shadow_offset)
      ctx.fill(shadow_path)
      ctx.restore()

      // Highlights
      if (selected_entry && entry.entry_id === selected_entry.entry_id) {
        helpers.draw_selection_highlight(
          ctx,
          projected,
          size,
          canvas_dims.scale,
          pulse_time,
          pulse_opacity,
        )
      }
      if (is_entry_highlighted) {
        helpers.draw_highlight_effect(
          ctx,
          projected,
          size,
          canvas_dims.scale,
          pulse_time,
          merged_highlight_style,
        )
      }

      // Main point with marker symbol
      ctx.fillStyle =
        is_entry_highlighted && merged_highlight_style.effect === `color`
          ? merged_highlight_style.color
          : color
      ctx.strokeStyle = is_stable ? `#ffffff` : `#000000`
      ctx.lineWidth = 0.5 * canvas_dims.scale
      const marker_path = helpers.create_marker_path(size, marker)
      ctx.save()
      ctx.translate(projected.x, projected.y)
      ctx.fill(marker_path)
      ctx.stroke(marker_path)
      ctx.restore()
    }
  }

  function draw_hull_labels(): void {
    if (!ctx || !merged_config.show_labels) return

    const composition_map = new SvelteMap<string, ConvexHullEntry>()
    for (const entry of plot_entries) {
      if (!entry.visible || entry.is_element) continue
      const comp_key = Object.entries(entry.composition)
        .filter(([, amt]) => amt > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([el, amt]) => `${el}${amt.toFixed(3)}`)
        .join(``)
      const existing = composition_map.get(comp_key)
      if (
        !existing || (entry.e_form_per_atom ?? 0) < (existing.e_form_per_atom ?? 0)
      ) {
        composition_map.set(comp_key, entry)
      }
    }

    ctx.fillStyle = text_color
    ctx.font = `12px Arial`
    ctx.textAlign = `center`
    ctx.textBaseline = `top`

    for (const entry of composition_map.values()) {
      const is_stable_point = entry.is_stable || (entry.e_above_hull ?? 0) <= 1e-6
      const can_label = (is_stable_point && show_stable_labels) ||
        (!is_stable_point && show_unstable_labels &&
          (entry.e_above_hull ?? 0) <= max_hull_dist_show_labels)
      if (!can_label) continue

      const projected = project_3d_point(entry.x, entry.y, entry.z)
      let formula = entry.reduced_formula || entry.name || ``
      if (!formula) {
        formula = Object.entries(entry.composition)
          .filter(([, amt]) => amt > 0)
          .sort(([el1], [el2]) =>
            elements.indexOf(el1 as ElementSymbol) -
            elements.indexOf(el2 as ElementSymbol)
          )
          .map(([el, amt]) =>
            Math.abs(amt - 1) < 1e-6 ? el : `${el}${format_num(amt, `.2~`)}`
          )
          .join(``)
      }
      ctx.fillText(formula, projected.x, projected.y + 16 * canvas_dims.scale)
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
      ctx.fillStyle = text_color
      ctx.font = `16px Arial`
      ctx.textAlign = `center`
      ctx.textBaseline = `middle`

      ctx.fillText(
        `Ternary convex hull requires exactly 3 elements (got ${pd_data.elements.length})`,
        display_width / 2,
        display_height / 2,
      )
      return
    }

    draw_structure_outline()
    draw_convex_hull_faces() // behind points
    draw_z_axis_ticks() // after faces for visibility at high opacity
    draw_data_points()
    draw_hull_labels()
    draw_element_labels()
  }

  function handle_mouse_down(event: MouseEvent) {
    is_dragging = true
    drag_started = false
    last_mouse = { x: event.clientX, y: event.clientY }
  }

  const handle_mouse_move = (event: MouseEvent) => {
    if (!is_dragging) return
    const [dx, dy] = [event.clientX - last_mouse.x, event.clientY - last_mouse.y]

    // Mark as drag if any movement occurred
    if (dx !== 0 || dy !== 0) drag_started = true

    // With Cmd/Ctrl held: pan the view instead of rotating
    if (event.metaKey || event.ctrlKey) {
      camera.center_x += dx
      camera.center_y += dy
    } else {
      // Horizontal drag -> azimuth rotation around z-axis
      camera.azimuth += dx * 0.3 // Positive dx (drag right) rotates clockwise

      // Vertical drag -> elevation angle (full range)
      camera.elevation -= dy * 0.3 // Positive dy (drag down) tilts view down
    }

    last_mouse = { x: event.clientX, y: event.clientY }
  }

  const handle_wheel = (event: WheelEvent) => {
    event.preventDefault()
    camera.zoom = Math.max(
      0.5,
      Math.min(10, camera.zoom * (event.deltaY > 0 ? 0.98 : 1.02)),
    )
  }

  const handle_hover = (event: MouseEvent) => {
    const entry = find_entry_at_mouse(event)
    hover_data = entry
      ? { entry, position: { x: event.clientX, y: event.clientY } }
      : null
    on_point_hover?.(hover_data)
  }

  const find_entry_at_mouse = (event: MouseEvent): ConvexHullEntry | null =>
    helpers.find_hull_entry_at_mouse(
      canvas,
      event,
      plot_entries,
      (x: number, y: number, z: number) => {
        const pt = project_3d_point(x, y, z)
        return { x: pt.x, y: pt.y }
      },
    )

  const handle_click = (event: MouseEvent) => {
    event.stopPropagation()
    // Check if this was a drag operation (any mouse movement during drag)
    const was_drag = drag_started
    drag_started = false // Reset for next interaction
    if (was_drag) return // Don't trigger click if this was a drag

    const entry = find_entry_at_mouse(event)
    if (!entry) {
      if (modal_open) close_structure_popup()
      return
    }

    on_point_click?.(entry)

    if (enable_click_selection) {
      selected_entry = entry
      if (enable_structure_preview) {
        const structure = extract_structure_from_entry(entry)
        if (structure) {
          selected_structure = structure
          modal_place_right = helpers.calculate_modal_side(wrapper)
          modal_open = true
        }
      }
    }
  }

  function close_structure_popup() {
    modal_open = false
    selected_structure = null
    selected_entry = null
  }

  const handle_double_click = (event: MouseEvent) => {
    const entry = find_entry_at_mouse(event)
    if (entry) {
      copy_entry_data(entry, {
        x: event.clientX,
        y: event.clientY,
      })
    }
  }

  const render_once = () => {
    if (!frame_id) {
      frame_id = requestAnimationFrame(() => {
        render_frame()
        frame_id = 0
      })
    }
  }

  function update_canvas_size() {
    if (!canvas) return
    const dpr = globalThis.devicePixelRatio || 1
    const container = canvas.parentElement
    const rect = container?.getBoundingClientRect()
    const [w, h] = rect ? [rect.width, rect.height] : [400, 400]

    canvas.width = Math.max(0, Math.round(w * dpr))
    canvas.height = Math.max(0, Math.round(h * dpr))
    canvas_dims = { width: w, height: h, scale: Math.min(w, h) / 600 }

    ctx = canvas.getContext(`2d`)
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = `high`
    }
    render_once()
  }

  // Reactive dark mode detection for canvas text color
  let dark_mode = $state(is_dark_mode())
  $effect(() => watch_dark_mode((dark) => dark_mode = dark))
  const text_color = $derived(helpers.get_canvas_text_color(dark_mode))

  $effect(() => {
    if (!canvas) return

    // Initial setup
    update_canvas_size()

    // Watch for resize events - only update canvas, don't reset camera
    const resize_observer = new ResizeObserver(update_canvas_size)

    const container = canvas.parentElement
    if (container) {
      resize_observer.observe(container)
    }

    return () => { // Cleanup on unmount
      if (frame_id) cancelAnimationFrame(frame_id)
      if (pulse_frame_id) cancelAnimationFrame(pulse_frame_id)
      resize_observer.disconnect()
    }
  })

  // Fullscreen handling with camera reset
  let was_fullscreen = $state(fullscreen)
  $effect(() => {
    setup_fullscreen_effect(fullscreen, wrapper, (entering_fullscreen) => {
      if (entering_fullscreen !== was_fullscreen) {
        camera.center_x = 0
        camera.center_y = -50
        was_fullscreen = entering_fullscreen
      }
    })
    set_fullscreen_bg(wrapper, fullscreen, `--hull-3d-bg-fullscreen`)
  })

  // Performance: Cache canvas dimensions and formation energy range
  let canvas_dims = $state({ width: 600, height: 600, scale: 1 })
  const energy_range = $derived.by(() => {
    const energies = plot_entries.map((e) => e.e_form_per_atom ?? 0)
    const [min, max] = [Math.min(0, ...energies), Math.max(0, ...energies)]
    const z_scale = 0.75 / Math.max(max - min, 0.001)
    return { min, max, center: (min + max) / 2, z_scale }
  })

  // Performance: Pre-compute and cache all point projections + depth sorting
  const sorted_points_cache = $derived.by(() => {
    if (!canvas || plot_entries.length === 0) return []
    return plot_entries
      .filter((entry) => entry.visible)
      .map((entry) => ({
        entry,
        projected: project_3d_point(entry.x, entry.y, entry.z),
      }))
      .sort((a, b) => a.projected.depth - b.projected.depth)
  })

  let style = $derived(
    `--hull-stable-color:${merged_config.colors?.stable || `#0072B2`};
    --hull-unstable-color:${merged_config.colors?.unstable || `#E69F00`};
    --hull-edge-color:${merged_config.colors?.edge || `var(--text-color, #212121)`};
     --hull-text-color:${
      merged_config.colors?.annotation || `var(--text-color, #212121)`
    }`,
  )
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
  }}
  onmousemove={handle_mouse_move}
  onmouseup={() => (is_dragging = false)}
/>

<div
  {...rest}
  class="convex-hull-3d {rest.class ?? ``}"
  class:dragover={drag_over}
  style={`${style}; ${rest.style ?? ``}`}
  data-has-selection={selected_entry !== null}
  bind:this={wrapper}
  role="application"
  tabindex="-1"
  onkeydown={handle_keydown}
  ondrop={handle_file_drop}
  ondragover={(event) => {
    event.preventDefault()
    drag_over = true
  }}
  ondragleave={(event) => {
    event.preventDefault()
    drag_over = false
  }}
  aria-label="Ternary convex hull visualization"
>
  {@render children?.({
      stable_entries,
      unstable_entries,
      highlighted_entries,
      selected_entry,
    })}
  <h3 style="position: absolute; left: 1em; top: 1ex; margin: 0; font-weight: 500">
    {@html merged_controls.title || phase_stats?.chemical_system || ``}
  </h3>
  <canvas
    bind:this={canvas}
    tabindex="0"
    aria-label={merged_controls.title || phase_stats?.chemical_system || `3D Convex Hull`}
    onmousedown={handle_mouse_down}
    onmousemove={handle_hover}
    onclick={handle_click}
    onkeydown={handle_keydown}
    ondblclick={handle_double_click}
    onwheel={handle_wheel}
  ></canvas>

  <!-- Formation Energy Color Bar (bottom-left corner) -->
  {#if color_mode === `energy` && plot_entries.length > 0}
    {@const hull_distances = plot_entries
      .map((e) => e.e_above_hull)
      .filter((v): v is number => typeof v === `number`)}
    {@const min_energy = hull_distances.length > 0 ? Math.min(...hull_distances) : 0}
    {@const max_energy = hull_distances.length > 0 ? Math.max(...hull_distances, 0.1) : 0.1}
    <ColorBar
      title="Energy above hull (eV/atom)"
      range={[min_energy, max_energy]}
      {color_scale}
      wrapper_style="position: absolute; bottom: 2em; left: 1em; width: 200px;"
      bar_style="height: 12px;"
      title_style="margin-bottom: 4px;"
    />
  {/if}

  <!-- Formation Energy Faces Color Bar (bottom-right corner) -->
  <!-- Only show for uniform/formation_energy modes where face color relates to E_form -->
  {#if plot_entries.length > 0 && show_hull_faces &&
      (hull_face_color_mode === `uniform` ||
        hull_face_color_mode === `formation_energy`)}
    <ColorBar
      title="Formation energy (eV/atom)"
      color_scale_fn={e_form_color_scale_fn}
      color_scale_domain={e_form_range}
      range={e_form_range}
      wrapper_style="position: absolute; width: 200px; left: auto; right: 1em; bottom: 2em"
      bar_style="height: 12px;"
      title_style="margin-bottom: 4px;"
    />
  {/if}

  <!-- Control buttons (top-right corner) -->
  {#if controls_config.mode !== `never`}
    <section class="control-buttons {controls_config.class}">
      {#if controls_config.visible(`reset`)}
        <button
          type="button"
          onclick={reset_all}
          title="Reset view and settings"
          class="reset-camera-btn"
        >
          <Icon icon="Reset" />
        </button>
      {/if}

      {#if enable_info_pane && phase_stats && controls_config.visible(`info-pane`)}
        <ConvexHullInfoPane
          bind:pane_open={info_pane_open}
          {phase_stats}
          {stable_entries}
          {unstable_entries}
          {max_hull_dist_show_phases}
          {max_hull_dist_show_labels}
          {label_threshold}
          toggle_props={{ class: `info-btn` }}
        />
      {/if}

      {#if enable_fullscreen && controls_config.visible(`fullscreen`)}
        <button
          type="button"
          onclick={() => toggle_fullscreen(wrapper)}
          title="{fullscreen ? `Exit` : `Enter`} fullscreen"
          class="fullscreen-btn"
        >
          <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
        </button>
      {/if}

      <!-- Legend controls pane -->
      {#if controls_config.visible(`controls`)}
        <ConvexHullControls
          bind:controls_open={legend_pane_open}
          bind:color_mode
          bind:color_scale
          bind:show_stable
          bind:show_unstable
          bind:show_stable_labels
          bind:show_unstable_labels
          bind:max_hull_dist_show_phases
          bind:max_hull_dist_show_labels
          {max_hull_dist_in_data}
          {stable_entries}
          {unstable_entries}
          {camera}
          {merged_controls}
          toggle_props={{ class: `legend-controls-btn` }}
          {show_hull_faces}
          on_hull_faces_change={(value) => show_hull_faces = value}
          {hull_face_color}
          on_hull_face_color_change={(value) => hull_face_color = value}
          {hull_face_opacity}
          on_hull_face_opacity_change={(value) => hull_face_opacity = value}
          {hull_face_color_mode}
          on_hull_face_color_mode_change={(value) => hull_face_color_mode = value}
          bind:energy_source_mode
          {has_precomputed_e_form}
          {can_compute_e_form}
          {has_precomputed_hull}
          {can_compute_hull}
        />
      {/if}
    </section>
  {/if}

  <!-- Orientation gizmo (top-right, below control buttons) -->
  {#if gizmo && typeof WebGLRenderingContext !== `undefined`}
    <div class="gizmo-wrapper {controls_config.class}">
      <Canvas
        createRenderer={(cvs) => new WebGLRenderer({ canvas: cvs, alpha: true, antialias: true })}
      >
        <T.PerspectiveCamera
          makeDefault
          bind:ref={gizmo_cam_ref}
          position={gizmo_position(camera.elevation, camera.azimuth)}
          up={gizmo_up(camera.elevation, camera.azimuth)}
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

  {#if has_temp_data && temperature !== undefined}
    <TemperatureSlider {available_temperatures} bind:temperature />
  {/if}

  {#if gas_analysis.has_gas_dependent_elements && merged_gas_config}
    <GasPressureControls
      config={merged_gas_config}
      bind:pressures={gas_pressures}
      temperature={temperature ?? 300}
    />
  {/if}

  <!-- Hover tooltip -->
  {#if hover_data}
    {@const { entry, position } = hover_data}
    {@const entry_highlight = is_highlighted(entry) ? merged_highlight_style : undefined}
    {@const tooltip_style =
      `z-index: ${CONVEX_HULL_STYLE.z_index.tooltip}; backdrop-filter: blur(4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);`}
    <PlotTooltip
      x={position.x}
      y={position.y}
      offset={{ x: 10, y: -10 }}
      bg_color={get_point_color(entry)}
      fixed
      style={tooltip_style}
    >
      <ConvexHullTooltip
        {entry}
        {polymorph_stats_map}
        highlight_style={entry_highlight}
        {tooltip}
      />
    </PlotTooltip>
  {/if}

  <ClickFeedback bind:visible={copy_feedback.visible} position={copy_feedback.position} />
  <DragOverlay visible={drag_over} />

  {#if modal_open && selected_structure}
    <StructurePopup
      structure={selected_structure}
      place_right={modal_place_right}
      stats={{
        id: selected_entry?.entry_id,
        e_above_hull: selected_entry?.e_above_hull,
        e_form: selected_entry?.e_form_per_atom,
      }}
      onclose={close_structure_popup}
    />
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
  .gizmo-wrapper {
    position: absolute;
    top: 2.5em;
    right: 1ex;
    width: clamp(80px, 18cqmin, 110px);
    height: clamp(80px, 18cqmin, 110px);
    pointer-events: auto;
    transition: opacity 0.2s ease-in-out;
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
  .control-buttons {
    position: absolute;
    top: 1ex;
    right: 1ex;
    display: flex;
    gap: 8px;
    transition: opacity 0.2s ease-in-out;
  }
  .control-buttons.hover-visible {
    opacity: 0;
    pointer-events: none;
  }
  .convex-hull-3d:hover .control-buttons.hover-visible,
  .convex-hull-3d:focus-within .control-buttons.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .control-buttons.always-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .control-buttons button {
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    border-radius: 3px;
    color: var(--text-color, currentColor);
    transition: background-color 0.2s;
    display: flex;
    font-size: clamp(0.85em, 2cqmin, 2.5em);
  }
  .control-buttons button:hover {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
</style>
