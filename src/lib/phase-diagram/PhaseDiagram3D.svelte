<script lang="ts">
  import type { AnyStructure, ElementSymbol } from '$lib'
  import { Icon, is_unary_entry, PD_DEFAULTS, toggle_fullscreen } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { contrast_color } from '$lib/colors'
  import { elem_symbol_to_name, get_electro_neg_formula } from '$lib/composition'
  import { format_fractional, format_num } from '$lib/labels'
  import { ColorBar } from '$lib/plot'
  import { SvelteMap } from 'svelte/reactivity'
  import {
    get_ternary_3d_coordinates,
    get_triangle_centroid,
    get_triangle_edges,
    get_triangle_vertical_edges,
    TRIANGLE_VERTICES,
  } from './barycentric-coords'
  import * as helpers from './helpers'
  import type { BasePhaseDiagramProps, Hull3DProps } from './index'
  import { default_controls, default_pd_config, PD_STYLE } from './index'
  import PhaseDiagramControls from './PhaseDiagramControls.svelte'
  import PhaseDiagramInfoPane from './PhaseDiagramInfoPane.svelte'
  import StructurePopup from './StructurePopup.svelte'
  import * as thermo from './thermodynamics'
  import type { HoverData3D, Point3D, TernaryPlotEntry } from './types'

  let {
    entries,
    controls = {},
    config = {},
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(false),
    enable_fullscreen = true,
    enable_info_pane = true,
    wrapper = $bindable(undefined),
    label_threshold = 50,
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    show_hull_faces = $bindable(true),
    hull_face_opacity = $bindable(0.3),
    color_mode = $bindable(`energy`),
    color_scale = $bindable(`interpolateViridis`),
    info_pane_open = $bindable(false),
    legend_pane_open = $bindable(false),
    max_hull_dist_show_phases = $bindable(0.5), // eV/atom above hull for showing entries
    on_file_drop,
    enable_structure_preview = true,
    energy_source_mode = $bindable(`precomputed`),
    phase_stats = $bindable(null),
    stable_entries = $bindable([]),
    unstable_entries = $bindable([]),
    ...rest
  }: BasePhaseDiagramProps<TernaryPlotEntry> & Hull3DProps & {
    // Bindable stable and unstable entries - computed internally but exposed for external use
    stable_entries?: TernaryPlotEntry[]
    unstable_entries?: TernaryPlotEntry[]
  } = $props()

  const merged_controls = $derived({ ...default_controls, ...controls })
  const merged_config = $derived({
    ...default_pd_config,
    ...config,
    colors: { ...default_pd_config.colors, ...(config.colors || {}) },
    margin: { t: 40, r: 40, b: 60, l: 60, ...(config.margin || {}) },
  })

  let { // Compute energy mode information
    has_precomputed_e_form,
    has_precomputed_hull,
    can_compute_e_form,
    can_compute_hull,
    energy_mode,
    unary_refs,
  } = $derived(
    helpers.compute_energy_mode_info(
      entries,
      thermo.find_lowest_energy_unary_refs,
      energy_source_mode,
    ),
  )

  const effective_entries = $derived(
    helpers.get_effective_entries(
      entries,
      energy_mode,
      unary_refs,
      thermo.compute_e_form_per_atom,
    ),
  )

  // Process phase diagram data with unified PhaseEntry interface using effective entries
  const processed_entries = $derived(effective_entries)
  const pd_data = $derived(thermo.process_pd_entries(processed_entries))

  const elements = $derived.by(() => {
    if (pd_data.elements.length > 3) {
      console.error(
        `PhaseDiagram3D: Dataset contains ${pd_data.elements.length} elements, but ternary diagrams require exactly 3. Found: [${
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

  // 2) Final plot entries: enrich coords with e_above_hull from cached hull model, then filter/map
  const plot_entries = $derived.by(() => {
    if (coords_entries.length === 0) return []

    // Compute or use precomputed hull distances
    const enriched = (() => {
      if (energy_mode === `on-the-fly`) {
        const pts = coords_entries.map((e) => ({ x: e.x, y: e.y, z: e.z }))
        const e_hulls = thermo.compute_e_above_hull_for_points(pts, hull_model)
        return coords_entries.map((e, idx) => ({ ...e, e_above_hull: e_hulls[idx] }))
      }
      return coords_entries
    })()

    const energy_filtered = enriched.filter((entry: TernaryPlotEntry) =>
      (entry.e_above_hull ?? 0) <= max_hull_dist_show_phases
    )

    return energy_filtered.map((entry: TernaryPlotEntry) => {
      const is_stable = entry.is_stable || entry.e_above_hull === 0
      return {
        ...entry,
        visible: (is_stable && show_stable) || (!is_stable && show_unstable),
      }
    })
  })

  $effect(() => {
    stable_entries = plot_entries.filter((entry: TernaryPlotEntry) =>
      entry.is_stable || entry.e_above_hull === 0
    )
    unstable_entries = plot_entries.filter((entry: TernaryPlotEntry) =>
      typeof entry.e_above_hull === `number` && entry.e_above_hull > 0 &&
      !entry.is_stable
    )
  })

  // Compute lower convex hull faces (triangles) for 3D rendering (low energy hull only)
  type HullTriangle = {
    vertices: [Point3D, Point3D, Point3D]
    normal: Point3D
    centroid: Point3D
  }
  const hull_faces = $derived.by((): HullTriangle[] => {
    if (coords_entries.length === 0) {
      return []
    }
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

  // Total counts based on hull-enriched entries
  const total_unstable_count = $derived(
    plot_entries.filter((entry) =>
      typeof entry.e_above_hull === `number` && entry.e_above_hull > 0 &&
      !entry.is_stable
    ).length,
  )

  // Canvas rendering
  let canvas: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null

  // Performance optimization
  let frame_id = 0
  let pulse_frame_id = 0

  const camera_default = {
    elevation: PD_DEFAULTS.ternary.camera_elevation,
    azimuth: PD_DEFAULTS.ternary.camera_azimuth,
    zoom: PD_DEFAULTS.ternary.camera_zoom,
    center_x: 0,
    center_y: -50, // Shift up to better show the formation energy funnel
  }
  let camera = $state({ ...camera_default })

  // Interaction state
  let is_dragging = $state(false)
  let drag_started = $state(false)
  let last_mouse = $state({ x: 0, y: 0 })
  let hover_data = $state<HoverData3D<TernaryPlotEntry> | null>(null)
  let copy_feedback_visible = $state(false)
  let copy_feedback_position = $state({ x: 0, y: 0 })

  // Drag and drop state
  let drag_over = $state(false)

  // Structure popup state
  let modal_open = $state(false)
  let selected_structure = $state<AnyStructure | null>(null)
  let selected_entry = $state<TernaryPlotEntry | null>(null)
  let modal_place_right = $state(true)

  // Hull face color (customizable via controls)
  let hull_face_color = $state(`#4caf50`)

  // Utility: convert hex color to rgba string with alpha
  function hex_to_rgba(hex: string, alpha: number): string {
    const normalized = hex.trim()
    const m = normalized.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    if (!m) return `rgba(0,0,0,${alpha})`
    const r = parseInt(m[1], 16)
    const g = parseInt(m[2], 16)
    const b = parseInt(m[3], 16)
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
  }

  // Pulsating highlight for selected point
  let pulse_time = $state(0)
  let pulse_opacity = $derived(0.3 + 0.4 * Math.sin(pulse_time * 4))
  $effect(() => {
    if (!selected_entry) return
    const reduce = globalThis.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches
    if (reduce) return
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
    [show_stable, show_unstable, show_hull_faces, color_mode, color_scale, max_hull_dist_show_phases, show_stable_labels, show_unstable_labels, max_hull_dist_show_labels, camera.elevation, camera.azimuth, camera.zoom, camera.center_x, camera.center_y, plot_entries, hull_face_color, hull_face_opacity]

    render_once()
  })

  // Label controls with smart defaults based on entry count
  let show_stable_labels = $state(true)
  let show_unstable_labels = $state(false)
  let max_hull_dist_show_labels = $state(0.1) // eV/atom above hull for showing labels

  // Function to extract structure data from a phase diagram entry
  function extract_structure_from_entry(
    entry: TernaryPlotEntry,
  ): AnyStructure | null {
    const original_entry = entries.find((orig_entry) =>
      orig_entry.entry_id === entry.entry_id
    )
    return original_entry?.structure as AnyStructure || null
  }

  const reset_camera = () => Object.assign(camera, camera_default)
  function reset_all() {
    reset_camera()
    fullscreen = PD_DEFAULTS.ternary.fullscreen
    info_pane_open = PD_DEFAULTS.ternary.info_pane_open
    legend_pane_open = PD_DEFAULTS.ternary.legend_pane_open
    color_mode = PD_DEFAULTS.ternary.color_mode
    color_scale = PD_DEFAULTS.ternary.color_scale as D3InterpolateName
    show_stable = PD_DEFAULTS.ternary.show_stable
    show_unstable = PD_DEFAULTS.ternary.show_unstable
    show_stable_labels = PD_DEFAULTS.ternary.show_stable_labels
    show_unstable_labels = PD_DEFAULTS.ternary.show_unstable_labels
    max_hull_dist_show_labels = PD_DEFAULTS.ternary.max_hull_dist_show_labels
    max_hull_dist_show_phases = PD_DEFAULTS.ternary.max_hull_dist_show_phases
    show_hull_faces = PD_DEFAULTS.ternary.show_hull_faces
    hull_face_color = PD_DEFAULTS.ternary.hull_face_color
    hull_face_opacity = PD_DEFAULTS.ternary.hull_face_opacity
  }

  const handle_keydown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName.match(/INPUT|TEXTAREA/)) return

    const actions: Record<string, () => void> = {
      r: reset_camera,
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
    const data = await helpers.parse_pd_entries_from_drop(event)
    if (data) on_file_drop?.(data)
  }

  async function copy_to_clipboard(text: string, position: { x: number; y: number }) {
    await navigator.clipboard.writeText(text)
    copy_feedback_position = position
    copy_feedback_visible = true
    setTimeout(() => copy_feedback_visible = false, 1500)
  }

  const get_point_color = (entry: TernaryPlotEntry): string =>
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

  const max_hull_dist_in_data = $derived(
    helpers.calc_max_hull_dist_in_data(processed_entries),
  )

  // Phase diagram statistics - compute internally and expose via bindable prop
  $effect(() => {
    phase_stats = thermo.get_phase_diagram_stats(processed_entries, elements, 3)
  })

  // 3D to 2D projection for ternary diagrams
  function project_3d_point(
    x: number,
    y: number,
    z: number,
  ): { x: number; y: number; depth: number } {
    if (!canvas) return { x: 0, y: 0, depth: 0 }

    // Center coordinates around the volumetric center of the phase diagram
    const triangle_centroid = get_triangle_centroid()

    // Calculate the energy center (middle of formation energy range)
    const formation_energies = plot_entries.map((e) => e.e_form)
    const e_form_min = Math.min(0, ...formation_energies)
    const e_form_max = Math.max(0, ...formation_energies)
    const energy_center = (e_form_min + e_form_max) / 2

    let centered_x = x - triangle_centroid.x
    let centered_y = y - triangle_centroid.y

    const triangle_height = 1.5 // arbitrary choice, picked for visual appeal
    const z_depth_ratio = 0.5 // Z-axis depth as fraction of triangle height (tune for visual balance)
    const target_z_range = triangle_height * z_depth_ratio // Target Z range in coordinate units
    const energy_range = e_form_max - e_form_min
    const z_scale = target_z_range / Math.max(energy_range, 0.001) // Avoid division by zero
    let centered_z = (z - energy_center) * z_scale

    // Apply 3D transformations with fixed z-axis pointing up
    // Convert camera angles from degrees to radians
    const elevation_rad = (camera.elevation * Math.PI) / 180
    const azimuth_rad = (camera.azimuth * Math.PI) / 180

    // Apply azimuth rotation around z-axis (keeps z-axis vertical)
    const cos_azimuth = Math.cos(azimuth_rad)
    const sin_azimuth = Math.sin(azimuth_rad)

    const x1 = centered_x * cos_azimuth - centered_y * sin_azimuth
    const y1 = centered_x * sin_azimuth + centered_y * cos_azimuth
    const z1 = centered_z // z unchanged by azimuth rotation

    // Apply elevation rotation around the horizontal axis (tilting up/down)
    // Flip the elevation to fix upside-down diagram
    const cos_elevation = Math.cos(-elevation_rad) // Negative to flip
    const sin_elevation = Math.sin(-elevation_rad)

    const x2 = x1 // x unchanged by elevation
    const y2 = y1 * cos_elevation - z1 * sin_elevation
    const z2 = y1 * sin_elevation + z1 * cos_elevation

    // Apply perspective projection using actual canvas dimensions
    const display_width = canvas.clientWidth || 400
    const display_height = canvas.clientHeight || 400
    const scale = Math.min(display_width, display_height) * 0.6 * camera.zoom
    const center_x = display_width / 2 + camera.center_x
    const center_y = display_height / 2 + camera.center_y

    return {
      x: center_x + x2 * scale,
      y: center_y - y2 * scale, // Flip Y for canvas coordinates
      depth: z2, // For depth sorting
    }
  }

  function draw_structure_outline(): void {
    if (!ctx) return

    // Set consistent style for all triangle structure lines
    ctx.strokeStyle = PD_STYLE.structure_line.color
    ctx.lineWidth = PD_STYLE.structure_line.line_width
    ctx.setLineDash(PD_STYLE.structure_line.dash) // Dashed lines for all structure lines

    // Draw triangle base and vertical edges
    draw_triangle_structure()
  }

  function draw_triangle_structure(): void {
    if (!ctx) return

    // Get formation energy range for vertical edges
    const formation_energies = plot_entries.map((e) => e.e_form)
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
    ctx.strokeStyle = styles.getPropertyValue(`--pd-edge-color`) || `#212121`
    ctx.setLineDash([]) // Reset line dash for other drawing operations
  }

  function draw_element_labels(): void {
    if (!ctx || elements.length !== 3) return

    ctx.save()
    const styles = getComputedStyle(canvas)

    // Draw element labels outside triangle corners
    const centroid = get_triangle_centroid()
    ctx.fillStyle = styles.getPropertyValue(`--pd-text-color`) || `#212121`
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

  function draw_convex_hull_faces(): void {
    if (!ctx || !show_hull_faces || hull_faces.length === 0) return

    // Normalize alpha by formation energy: 0 eV -> 0 alpha, min E_form -> hull_face_opacity
    const formation_energies = plot_entries.map((e) => e.e_form)
    const min_fe = Math.min(0, ...formation_energies)
    const norm_alpha = (z: number) => {
      const t = Math.max(0, Math.min(1, (0 - z) / Math.max(1e-6, 0 - min_fe)))
      return t * hull_face_opacity
    }

    // Sort faces by depth for proper rendering
    const faces_with_depth = hull_faces.map((tri) => {
      const centroid_proj = project_3d_point(
        tri.centroid.x,
        tri.centroid.y,
        tri.centroid.z,
      )
      return { tri, depth: centroid_proj.depth }
    })

    faces_with_depth.sort((a, b) => a.depth - b.depth) // Back to front

    // Draw each face (lower hull only)
    for (const { tri } of faces_with_depth) {
      const [p1, p2, p3] = tri.vertices

      const proj1 = project_3d_point(p1.x, p1.y, p1.z)
      const proj2 = project_3d_point(p2.x, p2.y, p2.z)
      const proj3 = project_3d_point(p3.x, p3.y, p3.z)

      // Build per-face linear gradient in screen space matching linear variation of formation energy
      const a1 = norm_alpha(p1.z)
      const a2 = norm_alpha(p2.z)
      const a3 = norm_alpha(p3.z)

      // Solve a*x + b*y + c = alpha at the three projected vertices
      const x1 = proj1.x, y1 = proj1.y
      const x2 = proj2.x, y2 = proj2.y
      const x3 = proj3.x, y3 = proj3.y
      const det = x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)
      let a = 0, b = 0, c = (a1 + a2 + a3) / 3
      if (Math.abs(det) > 1e-9) {
        a = (a1 * (y2 - y3) + a2 * (y3 - y1) + a3 * (y1 - y2)) / det
        b = (a1 * (x3 - x2) + a2 * (x1 - x3) + a3 * (x2 - x1)) / det
        c = (a1 * (x2 * y3 - x3 * y2) + a2 * (x3 * y1 - x1 * y3) +
          a3 * (x1 * y2 - x2 * y1)) /
          det
      }

      // Gradient direction is the screen-space gradient of alpha
      const mag = Math.hypot(a, b)
      // Fallback: uniform if nearly flat
      if (mag < 1e-9) {
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(proj1.x, proj1.y)
        ctx.lineTo(proj2.x, proj2.y)
        ctx.lineTo(proj3.x, proj3.y)
        ctx.closePath()
        ctx.fillStyle = hex_to_rgba(hull_face_color, (a1 + a2 + a3) / 3)
        ctx.fill()
        ctx.strokeStyle = hull_face_color
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.restore()
      } else {
        const vx = a / mag
        const vy = b / mag
        const cx = (x1 + x2 + x3) / 3
        const cy = (y1 + y2 + y3) / 3
        const alpha_c = a * cx + b * cy + c
        const alpha_min = Math.min(a1, a2, a3)
        const alpha_max = Math.max(a1, a2, a3)
        const s_min = (alpha_min - alpha_c) / mag
        const s_max = (alpha_max - alpha_c) / mag
        const gx0 = cx + vx * s_min
        const gy0 = cy + vy * s_min
        const gx1 = cx + vx * s_max
        const gy1 = cy + vy * s_max

        const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1)
        grad.addColorStop(0, hex_to_rgba(hull_face_color, alpha_min))
        grad.addColorStop(1, hex_to_rgba(hull_face_color, alpha_max))

        ctx.save()
        ctx.beginPath()
        ctx.moveTo(proj1.x, proj1.y)
        ctx.lineTo(proj2.x, proj2.y)
        ctx.lineTo(proj3.x, proj3.y)
        ctx.closePath()
        ctx.fillStyle = grad
        ctx.fill()
        ctx.strokeStyle = hull_face_color
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  // Formation energy color bar helpers
  const e_form_range = $derived.by((): [number, number] => {
    const energies = plot_entries.map((e) => e.e_form)
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
      return hex_to_rgba(hull_face_color, alpha)
    }
  })

  function draw_data_points(): void {
    if (!ctx || plot_entries.length === 0) return

    // Collect all points with depth for sorting
    const points_with_depth: {
      entry: TernaryPlotEntry
      projected: { x: number; y: number; depth: number }
    }[] = []

    for (const entry of plot_entries) {
      // Skip invisible points
      if (!entry.visible) continue

      const projected = project_3d_point(entry.x, entry.y, entry.z)
      points_with_depth.push({ entry, projected })
    }

    // Sort by depth (back to front for proper rendering)
    points_with_depth.sort((a, b) => a.projected.depth - b.projected.depth)

    // Draw points with enhanced 3D visualization
    for (const { entry, projected } of points_with_depth) {
      const is_stable = entry.is_stable || entry.e_above_hull === 0

      // Use shared color function for consistency
      const color = get_point_color(entry)

      // Make point size relative to container size for responsive scaling
      const display_width = canvas.clientWidth || 600
      const display_height = canvas.clientHeight || 600
      const container_scale = Math.min(display_width, display_height) / 600

      const base_size = entry.size || (is_stable ? 6 : 4)
      const size = base_size * container_scale

      // Draw shadow/depth indicator first
      const shadow_offset = Math.abs(entry.z) * 0.1 * container_scale
      ctx.fillStyle = `rgba(0, 0, 0, 0.2)`
      ctx.beginPath()
      ctx.arc(
        projected.x + shadow_offset,
        projected.y + shadow_offset,
        size * 0.8,
        0,
        2 * Math.PI,
      )
      ctx.fill()

      // Draw pulsating highlight for selected entry
      if (selected_entry && entry.entry_id === selected_entry.entry_id) {
        const highlight_size = size * (1.8 + 0.3 * Math.sin(pulse_time * 4))
        ctx.fillStyle = `rgba(102, 240, 255, ${pulse_opacity * 0.6})`
        ctx.strokeStyle = `rgba(102, 240, 255, ${pulse_opacity})`
        ctx.lineWidth = 2 * container_scale
        ctx.beginPath()
        ctx.arc(projected.x, projected.y, highlight_size, 0, 2 * Math.PI)
        ctx.fill()
        ctx.stroke()
      }

      // Draw main point with outline
      ctx.fillStyle = color
      ctx.strokeStyle = is_stable ? `#ffffff` : `#000000`
      ctx.lineWidth = 0.5 * container_scale

      ctx.beginPath()
      ctx.arc(projected.x, projected.y, size, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
    }
  }

  function draw_hull_labels(): void {
    if (!ctx || !merged_config.show_labels) return

    // Find the lowest energy (most stable) entry at each unique composition
    const composition_map = new SvelteMap<string, TernaryPlotEntry>()

    for (const entry of plot_entries) {
      if (!entry.visible || entry.is_element) continue // Skip unary phases as requested

      // Create a composition key for grouping
      const comp_key = Object.entries(entry.composition)
        .filter(([, amt]) => amt > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([el, amt]) => `${el}${amt.toFixed(3)}`)
        .join(``)

      // Keep only the entry with lowest formation energy for this composition
      const existing = composition_map.get(comp_key)
      if (
        !existing || (entry.e_form_per_atom ?? 0) < (existing.e_form_per_atom ?? 0)
      ) {
        composition_map.set(comp_key, entry)
      }
    }

    // Draw labels for hull points (lowest energy at each composition)
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue(`--pd-text-color`) ||
      `#212121`
    ctx.font = `12px Arial`
    ctx.textAlign = `center`
    ctx.textBaseline = `top`

    const display_width = canvas.clientWidth || 600
    const display_height = canvas.clientHeight || 600
    const container_scale = Math.min(display_width, display_height) / 600

    for (const entry of composition_map.values()) {
      const is_stable_point = entry.is_stable || (entry.e_above_hull ?? 0) <= 1e-6
      const can_label_stable = is_stable_point && show_stable_labels
      const can_label_unstable = !is_stable_point && show_unstable_labels &&
        (typeof entry.e_above_hull === `number` &&
          entry.e_above_hull <= max_hull_dist_show_labels)
      if (!(can_label_stable || can_label_unstable)) continue

      const projected = project_3d_point(entry.x, entry.y, entry.z)

      // Generate label from composition
      let formula = entry.reduced_formula || entry.name || ``

      if (!formula) {
        // Format composition as element fractions
        formula = Object.entries(entry.composition)
          .filter(([, amt]) => amt > 0)
          .sort(([el1], [el2]) =>
            elements.indexOf(el1 as ElementSymbol) -
            elements.indexOf(el2 as ElementSymbol)
          )
          .map(([element, amount]) => {
            if (Math.abs(amount - 1) < 1e-6) return element
            return `${element}${format_num(amount, `.2~`)}`
          })
          .join(``)
      }

      // Position label below the point with sufficient spacing
      const label_offset = 16 * container_scale
      ctx.fillText(formula, projected.x, projected.y + label_offset)
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
      // Show error message
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue(`--text-color`) ||
        `#666`
      ctx.font = `16px Arial`
      ctx.textAlign = `center`
      ctx.textBaseline = `middle`

      ctx.fillText(
        `Ternary phase diagram requires exactly 3 elements (got ${pd_data.elements.length})`,
        display_width / 2,
        display_height / 2,
      )
      return
    }

    // Draw triangle structure first
    draw_structure_outline()

    // Draw convex hull faces (before points so they appear behind)
    draw_convex_hull_faces()

    // Draw data points last (on top)
    draw_data_points()

    // Draw hull labels after points
    draw_hull_labels()

    // Draw element labels on top of everything
    draw_element_labels()
  }

  function handle_mouse_down(event: MouseEvent) {
    is_dragging = true
    drag_started = false
    last_mouse = { x: event.clientX, y: event.clientY }
  }

  const handle_mouse_move = (event: MouseEvent) => {
    if (is_dragging) {
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

  const find_entry_at_mouse = (event: MouseEvent): TernaryPlotEntry | null =>
    helpers.find_pd_entry_at_mouse(
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
    if (entry) {
      on_point_click?.(entry)

      if (enable_structure_preview) {
        const structure = extract_structure_from_entry(entry)
        if (structure) {
          selected_structure = structure
          selected_entry = entry
          modal_place_right = helpers.calculate_modal_side(wrapper)
          modal_open = true
        }
      }
    } else if (modal_open) close_structure_popup()
  }

  function close_structure_popup() {
    modal_open = false
    selected_structure = null
    selected_entry = null
  }

  const handle_double_click = (event: MouseEvent) => {
    const entry = find_entry_at_mouse(event)
    if (entry) {
      copy_to_clipboard(helpers.build_entry_tooltip_text(entry), {
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

  // Update canvas dimensions helper
  function update_canvas_size() {
    if (!canvas) return

    const dpr = globalThis.devicePixelRatio || 1
    const container = canvas.parentElement

    // Update canvas size based on current container
    if (container) {
      const rect = container.getBoundingClientRect()
      const w = Math.max(0, Math.round(rect.width * dpr))
      const h = Math.max(0, Math.round(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    } else {
      canvas.width = 400 * dpr
      canvas.height = 400 * dpr
    }

    ctx = canvas.getContext(`2d`)
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = `high`
    }

    render_once()
  }

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

  // Fullscreen handling with camera reset on transitions
  let was_fullscreen = $state(fullscreen)
  $effect(() => {
    helpers.setup_fullscreen_effect(fullscreen, wrapper, (entering_fullscreen) => {
      // Reset camera only on fullscreen transitions
      if (entering_fullscreen !== was_fullscreen) {
        camera.center_x = 0
        camera.center_y = -50
        was_fullscreen = entering_fullscreen
      }
    })
  })

  let style = $derived(
    `--pd-stable-color:${merged_config.colors?.stable || `#0072B2`};
    --pd-unstable-color:${merged_config.colors?.unstable || `#E69F00`};
    --pd-edge-color:${merged_config.colors?.edge || `var(--text-color, #212121)`};
     --pd-text-color:${
      merged_config.colors?.annotation || `var(--text-color, #212121)`
    }`,
  )
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
  }}
  onmousemove={handle_mouse_move}
  onmouseup={() => [is_dragging, drag_started] = [false, false]}
/>

<div
  {...rest}
  class="phase-diagram-3d {rest.class ?? ``}"
  class:dragover={drag_over}
  style={`${style}; ${rest.style ?? ``}`}
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
  aria-label="Ternary phase diagram visualization"
>
  <h3 style="position: absolute; left: 1em; top: 1ex; margin: 0">
    {phase_stats?.chemical_system}
  </h3>
  <canvas
    bind:this={canvas}
    onmousedown={handle_mouse_down}
    onmousemove={handle_hover}
    onclick={handle_click}
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
  {#if plot_entries.length > 0}
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
  {#if merged_controls.show}
    <section class="control-buttons">
      <button
        type="button"
        onclick={reset_all}
        title="Reset view and settings"
        class="reset-camera-btn"
      >
        <Icon icon="Reset" />
      </button>

      {#if enable_info_pane && phase_stats}
        <PhaseDiagramInfoPane
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

      {#if enable_fullscreen}
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
      <PhaseDiagramControls
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
        {total_unstable_count}
        {camera}
        {merged_controls}
        toggle_props={{ class: `legend-controls-btn` }}
        {show_hull_faces}
        on_hull_faces_change={(value) => show_hull_faces = value}
        {hull_face_color}
        on_hull_face_color_change={(value) => hull_face_color = value}
        {hull_face_opacity}
        on_hull_face_opacity_change={(value) => hull_face_opacity = value}
        bind:energy_source_mode
        {has_precomputed_e_form}
        {can_compute_e_form}
        {has_precomputed_hull}
        {can_compute_hull}
      />
    </section>
  {/if}

  <!-- Hover tooltip -->
  {#if hover_data}
    {@const { entry, position } = hover_data}
    {@const is_element = is_unary_entry(entry)}
    {@const elem_symbol = is_element ? Object.keys(entry.composition)[0] : ``}
    <div
      class="tooltip"
      style:left="{position.x + 10}px;"
      style:top="{position.y - 10}px;"
      style:z-index={PD_STYLE.z_index.tooltip}
      style:background={get_point_color(entry)}
      {@attach contrast_color({ luminance_threshold: 0.49 })}
    >
      <div class="tooltip-title">
        {@html get_electro_neg_formula(entry.composition)}{
          is_element
          ? ` (${elem_symbol_to_name[elem_symbol as ElementSymbol] ?? ``})`
          : ``
        }
      </div>

      <div>
        E<sub>above hull</sub>: {format_num(entry.e_above_hull ?? 0, `.3~`)} eV/atom
      </div>
      <div>
        E<sub>form</sub>: {format_num(entry.e_form_per_atom ?? 0, `.3~`)} eV/atom
      </div>
      {#if entry.entry_id}
        <div>ID: {entry.entry_id}</div>
      {/if}

      <!-- Show fractional composition for multi-element compounds -->
      {#if !is_element}
        {@const total = Object.values(entry.composition).reduce((sum, amt) => sum + amt, 0)}
        {@const fractions = Object.entries(entry.composition)
        .filter(([, amt]) => amt > 0)
        .map(([el, amt]) => `${el}=${format_fractional(amt / total)}`)}
        {#if fractions.length > 1}
          {fractions.join(` | `)}
        {/if}
      {/if}
    </div>
  {/if}

  <!-- Copy feedback notification -->
  {#if copy_feedback_visible}
    <div
      class="copy-feedback"
      style:left="{copy_feedback_position.x}px"
      style:top="{copy_feedback_position.y}px"
    >
      <Icon icon="Check" />
    </div>
  {/if}

  <!-- Drag over overlay -->
  {#if drag_over}
    <div class="drag-overlay">
      <div class="drag-message">
        <Icon icon="Info" />
        <span>Drop JSON file to load phase diagram data</span>
      </div>
    </div>
  {/if}

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
  .phase-diagram-3d {
    position: relative;
    width: 100%;
    height: var(--pd-height, 500px);
    background: var(--surface-bg, #f8f9fa);
    border-radius: 4px;
  }
  .phase-diagram-3d:fullscreen {
    border-radius: 0;
  }
  .phase-diagram-3d.dragover {
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
  .control-buttons {
    position: absolute;
    top: 1ex;
    right: 1ex;
    display: flex;
    gap: 8px;
  }
  .control-buttons button {
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    border-radius: 3px;
    color: var(--text-color, currentColor);
    transition: background-color 0.2s;
  }
  .control-buttons button:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  .tooltip {
    position: fixed;
    padding: 5px 8px;
    border-radius: 4px;
    font-size: 12px;
    pointer-events: none;
    backdrop-filter: blur(4px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .copy-feedback {
    position: fixed;
    width: 24px;
    height: 24px;
    background: var(--success-color, #4caf50);
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translate(-50%, -50%);
    z-index: 1;
    animation: copy-success 1.5s ease-out forwards;
  }
  @keyframes copy-success {
    0% {
      transform: translate(-50%, -50%) scale(0);
      opacity: 0;
    }
    20% {
      transform: translate(-50%, -50%) scale(1.2);
      opacity: 1;
    }
    40% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0;
    }
  }

  .drag-overlay {
    position: absolute;
    inset: 0;
    background: rgba(25, 118, 210, 0.1);
    border: 2px dashed var(--accent-color, #1976d2);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .drag-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--accent-color, #1976d2);
    font-weight: 600;
    font-size: 1.1em;
  }
</style>
