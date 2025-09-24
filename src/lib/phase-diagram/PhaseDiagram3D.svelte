<script lang="ts">
  import type { AnyStructure, ElementSymbol } from '$lib'
  import { Icon, toggle_fullscreen } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { contrast_color } from '$lib/colors'
  import { elem_symbol_to_name, get_electro_neg_formula } from '$lib/composition'
  import { format_fractional, format_num } from '$lib/labels'
  import { ColorBar } from '$lib/plot'
  import { scaleSequential } from 'd3-scale'
  import * as d3_sc from 'd3-scale-chromatic'
  import { SvelteMap } from 'svelte/reactivity'
  import { compute_lower_hull_triangles } from './convex-hull'
  import PhaseDiagramControls from './PhaseDiagramControls.svelte'
  import PhaseDiagramInfoPane from './PhaseDiagramInfoPane.svelte'
  import StructurePopup from './StructurePopup.svelte'
  import {
    compute_ternary_3d_coordinates,
    get_triangle_centroid,
    get_triangle_edges,
    get_triangle_vertical_edges,
    TRIANGLE_VERTICES,
  } from './ternary'
  import type {
    HoverData3D,
    PDLegendConfig,
    PhaseDiagramConfig,
    PhaseEntry,
    Point3D,
    TernaryPlotEntry,
  } from './types'
  import { process_pd_data } from './utils'

  interface Props {
    entries: PhaseEntry[]
    legend?: Partial<PDLegendConfig>
    config?: Partial<PhaseDiagramConfig>
    on_point_click?: (entry: TernaryPlotEntry) => void
    on_point_hover?: (data: HoverData3D<TernaryPlotEntry> | null) => void
    fullscreen?: boolean
    enable_fullscreen?: boolean
    enable_info_pane?: boolean
    wrapper?: HTMLDivElement
    // Smart label defaults - hide labels if more than this many entries
    label_threshold?: number
    // Bindable visibility and interaction state
    show_stable?: boolean
    show_unstable?: boolean
    show_hull_faces?: boolean
    color_mode?: `stability` | `energy`
    color_scale?: D3InterpolateName
    info_pane_open?: boolean
    // Legend pane visibility
    legend_pane_open?: boolean
    // Energy threshold for showing unstable entries (eV/atom above hull)
    energy_threshold?: number
    // Show all elemental polymorphs or just reference corners
    show_elemental_polymorphs?: boolean
    // Callback for when JSON files are dropped
    on_file_drop?: (entries: PhaseEntry[]) => void
    // Enable structure preview overlay when hovering over entries with structure data
    enable_structure_preview?: boolean
  }
  let {
    entries,
    legend = {},
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
    color_mode = $bindable(`energy`),
    color_scale = $bindable(`interpolateViridis`),
    info_pane_open = $bindable(false),
    legend_pane_open = $bindable(false),
    energy_threshold = $bindable(0.5), // eV/atom above hull for showing entries
    show_elemental_polymorphs = $bindable(true),
    on_file_drop,
    enable_structure_preview = true,
  }: Props = $props()

  const default_legend: PDLegendConfig = {
    title: ``,
    show: true,
    position: `top-right`,
    width: 280,
    show_counts: true,
    show_color_toggle: true,
    show_label_controls: true,
  }
  const merged_legend: PDLegendConfig = $derived({ ...default_legend, ...legend })

  // Default configuration
  const default_config: PhaseDiagramConfig = {
    width: 600,
    height: 600,
    margin: { top: 60, right: 60, bottom: 60, left: 60 },
    unstable_threshold: 0.2,
    show_labels: true,
    show_hull: true,
    enable_zoom: true,
    enable_pan: true,
    enable_hover: true,
    point_size: 8,
    line_width: 2,
    font_size: 12,
    colors: {
      stable: `#0072B2`,
      unstable: `#E69F00`,
      hull_line: `var(--accent-color, #1976D2)`,
      background: `transparent`,
      text: `var(--text-color, #212121)`,
      edge: `var(--text-color, #212121)`,
      tooltip_bg: `var(--tooltip-bg, rgba(0, 0, 0, 0.85))`,
      tooltip_text: `var(--tooltip-text, white)`,
      annotation: `var(--text-color, #212121)`,
    },
  }

  const merged_config = $derived({
    ...default_config,
    ...config,
    margin: { ...default_config.margin, ...(config.margin || {}) },
  })

  // Process phase diagram data with unified PhaseEntry interface
  const processed_entries = $derived(entries)
  const pd_data = $derived(process_pd_data(processed_entries))

  const elements = $derived.by(() => {
    const all_elements = pd_data.elements

    if (all_elements.length > 3) {
      console.error(
        `PhaseDiagram3D: Dataset contains ${all_elements.length} elements, but ternary diagrams require exactly 3. Found: [${
          all_elements.join(`, `)
        }]`,
      )
      return []
    }

    return all_elements
  })

  const plot_entries = $derived.by(() => {
    if (elements.length !== 3) {
      return []
    }

    try {
      const coords = compute_ternary_3d_coordinates(pd_data.entries, elements)
      console.log(
        `PhaseDiagram3D: ${coords.length} ternary coords for ${elements.join(`-`)}`,
      )

      // Filter by energy threshold and update visibility based on toggles
      const energy_filtered = coords.filter((entry: TernaryPlotEntry) => {
        // Include all entries within energy threshold
        // For elemental entries, show all polymorphs (not just references)
        return (entry.e_above_hull || 0) <= energy_threshold
      })
      return energy_filtered
        .map((entry: TernaryPlotEntry) => {
          const is_stable = entry.is_stable || entry.e_above_hull === 0
          // Update visibility based on current toggle states
          entry.visible = (is_stable && show_stable) || (!is_stable && show_unstable)
          return entry
        })
    } catch (error) {
      console.error(`Error computing ternary coordinates:`, error)
      return []
    }
  })

  const stable_entries = $derived(
    plot_entries.filter((entry: TernaryPlotEntry) =>
      entry.is_stable || entry.e_above_hull === 0
    ),
  )

  const unstable_entries = $derived(
    plot_entries.filter((entry: TernaryPlotEntry) =>
      (entry.e_above_hull || 0) > 0 && !entry.is_stable
    ),
  )

  // Compute lower convex hull faces (triangles) for 3D rendering (low energy hull only)
  type HullTriangle = {
    vertices: [Point3D, Point3D, Point3D]
    normal: Point3D
    centroid: Point3D
  }
  const hull_faces = $derived.by((): HullTriangle[] => {
    if (plot_entries.length === 0) return []
    const points = plot_entries.map((e) => ({ x: e.x, y: e.y, z: e.z }))
    try {
      return compute_lower_hull_triangles(points)
    } catch (error) {
      console.error(`Error computing convex hull:`, error)
      return []
    }
  })

  // Total counts before energy threshold filtering
  const total_unstable_count = $derived(
    processed_entries.filter((entry) =>
      (entry.e_above_hull || 0) > 0 && !entry.is_stable
    ).length,
  )

  // Canvas rendering
  let canvas: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null

  // Performance optimization
  let frame_id = 0
  let pulse_frame_id = 0

  const camera_default = {
    elevation: 45, // Elevation angle in degrees (0 = side view, 90 = top view)
    azimuth: 60, // Azimuth angle in degrees (rotation around z-axis)
    zoom: 1.5, // Good zoom to see the funnel shape
    center_x: 0,
    center_y: -50, // Shift up to better center the funnel
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
    [show_stable, show_unstable, show_hull_faces, color_mode, color_scale, energy_threshold, show_elemental_polymorphs, camera.elevation, camera.azimuth, camera.zoom, camera.center_x, camera.center_y, plot_entries]

    render_once()
  })

  // Label controls with smart defaults based on entry count
  let show_stable_labels = $state(true)
  let show_unstable_labels = $state(false)
  let label_energy_threshold = $state(0.1) // eV/atom above hull for showing labels

  // Smart label defaults - hide labels if too many entries
  $effect(() => {
    const total_entries = processed_entries.length
    if (total_entries > label_threshold) {
      show_stable_labels = false
      show_unstable_labels = false
    } else {
      // For smaller datasets, show stable labels by default
      show_stable_labels = true
      show_unstable_labels = false
    }
  })

  // Function to extract structure data from a phase diagram entry
  function extract_structure_from_entry(
    entry: TernaryPlotEntry,
  ): AnyStructure | null {
    const original_entry = entries.find((orig_entry) =>
      orig_entry.entry_id === entry.entry_id
    )
    return original_entry?.structure as AnyStructure || null
  }

  const get_tooltip_text = (entry: TernaryPlotEntry) => {
    const is_element = Object.keys(entry.composition).length === 1
    const elem_symbol = is_element ? Object.keys(entry.composition)[0] : ``

    let text = is_element
      ? `${elem_symbol} (${elem_symbol_to_name[elem_symbol as ElementSymbol]})\n`
      : `${entry.name || entry.reduced_formula}\n`

    // Add fractional composition for compounds
    if (!is_element) {
      const total = Object.values(entry.composition).reduce(
        (sum, amt) => sum + amt,
        0,
      )
      const fractions = Object.entries(entry.composition)
        .filter(([, amt]) => amt > 0)
        .map(([el, amt]) => `${el}: ${format_fractional(amt / total)}`)
      if (fractions.length > 1) text += `Composition: ${fractions.join(`, `)}\n`
    }

    if (entry.e_above_hull !== undefined) {
      const e_hull_str = format_num(entry.e_above_hull, `.3~`)
      text += `E above hull: ${e_hull_str} eV/atom\n`
    }
    if (entry.e_form_per_atom !== undefined) {
      const e_form_str = format_num(entry.e_form_per_atom, `.3~`)
      text += `Formation Energy: ${e_form_str} eV/atom`
    }
    if (entry.entry_id) text += `\nID: ${entry.entry_id}`
    return text
  }

  const reset_camera = () => Object.assign(camera, camera_default)

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
    event.preventDefault()
    drag_over = false

    try {
      const file = event.dataTransfer?.files?.[0]
      if (!file?.name.endsWith(`.json`)) return

      const data = JSON.parse(await file.text()) as PhaseEntry[]
      if (!Array.isArray(data) || data.length === 0) return
      if (!data[0].composition || !data[0].energy) return

      on_file_drop?.(data)
    } catch (error) {
      console.error(`Error parsing dropped file:`, error)
    }
  }

  async function copy_to_clipboard(text: string, position: { x: number; y: number }) {
    await navigator.clipboard.writeText(text)
    copy_feedback_position = position
    copy_feedback_visible = true
    setTimeout(() => copy_feedback_visible = false, 1500)
  }

  function get_point_color(entry: TernaryPlotEntry): string {
    const is_stable = entry.is_stable || entry.e_above_hull === 0

    if (color_mode === `stability`) {
      return is_stable
        ? (merged_config.colors?.stable || `#0072B2`)
        : (merged_config.colors?.unstable || `#E69F00`)
    }

    return energy_color_scale ? energy_color_scale(entry.e_above_hull || 0) : `#666`
  }

  // Cache energy color scale per frame/setting
  const energy_color_scale = $derived.by(() => {
    if (color_mode !== `energy` || plot_entries.length === 0) return null
    const distances = plot_entries.map((e) => e.e_above_hull ?? 0)
    const lo = Math.min(...distances)
    const hi_raw = Math.max(...distances, 0.1)
    const hi = Math.max(hi_raw, lo + 1e-6)
    const interpolator =
      (d3_sc as unknown as Record<string, (t: number) => string>)[color_scale] ||
      d3_sc.interpolateViridis
    return scaleSequential(interpolator).domain([lo, hi])
  })

  const max_energy_threshold = $derived(() =>
    processed_entries.length === 0 ? 0.5 : Math.max(
      0.1,
      Math.max(...processed_entries.map((e) => e.e_above_hull || 0)) + 0.001,
    )
  )

  // Phase diagram statistics
  const phase_stats = $derived.by(() => {
    if (!processed_entries || processed_entries.length === 0) return null

    // Count entries by composition complexity
    const composition_counts = [1, 2, 3].map((target_count) =>
      processed_entries.filter((e) =>
        Object.keys(e.composition).filter((el) => e.composition[el] > 0).length ===
          target_count
      ).length
    )
    const [unary, binary, ternary] = composition_counts

    // Stability counts
    const stable_count = processed_entries.filter((e) =>
      e.is_stable || (e.e_above_hull ?? 0) < 1e-6
    ).length
    const unstable_count = processed_entries.length - stable_count

    // Energy statistics
    const energies = processed_entries
      .map((e) => e.e_form_per_atom || e.energy_per_atom)
      .filter((e): e is number => e != null)

    const energy_range = energies.length > 0
      ? {
        min: Math.min(...energies),
        max: Math.max(...energies),
        avg: energies.reduce((a, b) => a + b, 0) / energies.length,
      }
      : { min: 0, max: 0, avg: 0 }

    // Hull distance statistics
    const hull_distances = processed_entries
      .map((e) => e.e_above_hull || 0)
      .filter((e) => e >= 0)

    const hull_distance = hull_distances.length > 0
      ? {
        max: Math.max(...hull_distances),
        avg: hull_distances.reduce((a, b) => a + b, 0) / hull_distances.length,
      }
      : { max: 0, avg: 0 }

    return {
      total: processed_entries.length,
      unary,
      binary,
      ternary,
      quaternary: 0, // Not applicable for ternary
      stable: stable_count,
      unstable: unstable_count,
      energy_range,
      hull_distance,
      elements: elements.length,
      chemical_system: elements.join(`-`),
    }
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
    const formation_energies = plot_entries.map((e) => e.formation_energy)
    const min_formation_energy = Math.min(0, ...formation_energies)
    const max_formation_energy = Math.max(0, ...formation_energies)
    const energy_center = (min_formation_energy + max_formation_energy) / 2

    let centered_x = x - triangle_centroid.x
    let centered_y = y - triangle_centroid.y

    // Scale the z-coordinate to be proportional to the triangle size
    // Formation energies are typically -5 to 0 eV/atom, so scale to triangle height
    const triangle_height = Math.sqrt(3) / 2 // Height of equilateral triangle with side 1
    let centered_z = (z - energy_center) * triangle_height / 3 // Center around energy midpoint

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
    ctx.strokeStyle = `rgba(128, 128, 128, 0.6)` // Gray color for all structure lines
    ctx.lineWidth = 2
    ctx.setLineDash([3, 3]) // Dashed lines for all structure lines

    // Draw triangle base and vertical edges
    draw_triangle_structure()
  }

  function draw_triangle_structure(): void {
    if (!ctx) return

    // Get formation energy range for vertical edges
    const formation_energies = plot_entries.map((e) => e.formation_energy)
    const min_formation_energy = Math.min(0, ...formation_energies) // Include 0 for elemental references
    const max_formation_energy = Math.max(0, ...formation_energies) // Include 0 for elemental references

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
      min_formation_energy,
      max_formation_energy,
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
      const proj1 = project_3d_point(v1.x, v1.y, min_formation_energy) // Bottom triangle at most negative energy
      const proj2 = project_3d_point(v2.x, v2.y, min_formation_energy)

      ctx.moveTo(proj1.x, proj1.y)
      ctx.lineTo(proj2.x, proj2.y)
    }
    ctx.stroke()

    // Reset stroke style to default for other elements (like element labels)
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue(`--pd-edge-color`) ||
      `#212121`
    ctx.setLineDash([]) // Reset line dash for other drawing operations

    // Draw element labels outside triangle corners
    const centroid = get_triangle_centroid()
    ctx.fillStyle =
      getComputedStyle(canvas).getPropertyValue(`--pd-annotation-color`) || `#212121`
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
  }

  function draw_convex_hull_faces(): void {
    if (!ctx || !show_hull_faces || hull_faces.length === 0) return

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

      // Lighting based on face normal
      const light_dir = { x: 0.5, y: -0.5, z: 1 }
      const dot_product = tri.normal.x * light_dir.x +
        tri.normal.y * light_dir.y +
        tri.normal.z * light_dir.z

      const lighting_factor = Math.max(0.3, Math.abs(dot_product))

      // Lower hull is considered stable; use stable color
      const alpha = 0.3 * lighting_factor

      ctx.fillStyle = `rgba(0, 114, 178, ${alpha})`

      ctx.beginPath()
      ctx.moveTo(proj1.x, proj1.y)
      ctx.lineTo(proj2.x, proj2.y)
      ctx.lineTo(proj3.x, proj3.y)
      ctx.closePath()
      ctx.fill()

      ctx.strokeStyle = `rgba(0, 114, 178, 0.6)`
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  function draw_data_points(): void {
    if (!ctx || plot_entries.length === 0) {
      return
    }

    // Collect all points with depth for sorting
    const points_with_depth: Array<{
      entry: TernaryPlotEntry
      projected: { x: number; y: number; depth: number }
    }> = []

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

      // Draw labels based on controls - but not for elemental entries
      // Corner element labels are drawn separately in draw_triangle_structure()
      const should_show_label = merged_config.show_labels && !entry.is_element && (
        (is_stable && show_stable_labels) ||
        (!is_stable && show_unstable_labels &&
          (entry.e_above_hull || 0) <= label_energy_threshold)
      )

      if (should_show_label) {
        ctx.fillStyle =
          getComputedStyle(canvas).getPropertyValue(`--pd-annotation-color`) ||
          `#212121`

        const label = entry.name || entry.reduced_formula || entry.entry_id ||
          `Unknown`
        const font_size = Math.round(12 * container_scale)
        ctx.font = `${font_size}px Arial`
        ctx.textAlign = `center`
        ctx.textBaseline = `middle`
        ctx.fillText(label, projected.x, projected.y + size + 6 * container_scale)
      }
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
    ctx.fillStyle =
      getComputedStyle(canvas).getPropertyValue(`--pd-annotation-color`) || `#212121`
    ctx.font = `10px Arial`
    ctx.textAlign = `center`
    ctx.textBaseline = `top`

    const display_width = canvas.clientWidth || 600
    const display_height = canvas.clientHeight || 600
    const container_scale = Math.min(display_width, display_height) / 600

    for (const entry of composition_map.values()) {
      const is_stable_point = entry.is_stable || (entry.e_above_hull || 0) <= 1e-6
      const can_label_stable = is_stable_point && show_stable_labels
      const can_label_unstable = !is_stable_point && show_unstable_labels &&
        (entry.e_above_hull || 0) <= label_energy_threshold
      if (!(can_label_stable || can_label_unstable)) continue

      const projected = project_3d_point(entry.x, entry.y, entry.z)

      // Generate simplified formula from composition
      let formula = entry.reduced_formula || entry.name || ``

      if (!formula) {
        // Generate reduced formula from composition
        const composition_elements = Object.entries(entry.composition)
          .filter(([, amt]) => amt > 0)
          .sort(([el1], [el2]) =>
            elements.indexOf(el1 as ElementSymbol) -
            elements.indexOf(el2 as ElementSymbol)
          )

        // Find GCD to reduce the formula
        const amounts = composition_elements.map(([, amt]) =>
          Math.round(amt * 1000) / 1000
        )
        const gcd_val = amounts.reduce((a, b) => {
          // Simple GCD for fractional numbers (scaled by 1000)
          const scale = 1000
          let a_int = Math.round(a * scale)
          let b_int = Math.round(b * scale)
          while (b_int !== 0) {
            const temp = b_int
            b_int = a_int % b_int
            a_int = temp
          }
          return a_int / scale
        })

        formula = composition_elements
          .map(([element, amount]) => {
            const reduced_amount = Math.round((amount / gcd_val) * 100) / 100
            return reduced_amount === 1 ? element : `${element}${reduced_amount}`
          })
          .join(``)
      }

      // Position label below the point
      const label_offset = 12 * container_scale
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
  }

  function handle_mouse_down(event: MouseEvent) {
    is_dragging = true
    drag_started = false
    last_mouse = { x: event.clientX, y: event.clientY }
  }

  const handle_mouse_move = (event: MouseEvent) => {
    if (is_dragging) {
      const [dx, dy] = [event.clientX - last_mouse.x, event.clientY - last_mouse.y]

      // Detect if significant movement occurred (indicates actual drag)
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag_started = true

      // With Cmd/Ctrl held: pan the view instead of rotating
      if (event.metaKey || event.ctrlKey) {
        camera.center_x += dx
        camera.center_y += dy
      } else {
        // Horizontal drag -> azimuth rotation around z-axis
        camera.azimuth -= dx * 0.3 // Convert pixels to degrees

        // Vertical drag -> elevation angle (full range)
        camera.elevation = camera.elevation + dy * 0.3 // No constraints - allow full rotation
      }

      last_mouse = { x: event.clientX, y: event.clientY }
    }
  }

  const handle_mouse_up = () => is_dragging = false

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

  const find_entry_at_mouse = (event: MouseEvent) => {
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const mouse_x = event.clientX - rect.left
    const mouse_y = event.clientY - rect.top

    const container_scale =
      Math.min(canvas.clientWidth || 600, canvas.clientHeight || 600) / 600
    return plot_entries.find((entry) => {
      if (!entry.visible) return false
      const projected = project_3d_point(entry.x, entry.y, entry.z)
      const distance = Math.sqrt(
        (mouse_x - projected.x) ** 2 + (mouse_y - projected.y) ** 2,
      )
      const base = entry.size ??
        ((entry.is_stable || entry.e_above_hull === 0) ? 6 : 4)
      return distance < base * container_scale + 5
    }) || null
  }

  const handle_click = (event: MouseEvent) => {
    event.stopPropagation()
    if (drag_started) { // Don't trigger click if this was a drag operation
      drag_started = false
      return
    }

    const entry = find_entry_at_mouse(event)
    if (entry) {
      on_point_click?.(entry)

      if (enable_structure_preview) {
        const structure = extract_structure_from_entry(entry)
        if (structure) {
          selected_structure = structure
          selected_entry = entry
          calculate_modal_side()
          modal_open = true
        }
      }
    } else if (modal_open) close_structure_popup()
  }

  // Decide side based on available viewport room; modal is absolutely positioned
  function calculate_modal_side() {
    if (!wrapper) return
    const rect = wrapper.getBoundingClientRect()
    const viewport_width = globalThis.innerWidth
    const space_on_right = viewport_width - rect.right
    const space_on_left = rect.left
    modal_place_right = space_on_right >= space_on_left
  }

  function close_structure_popup() {
    modal_open = false
    selected_structure = null
    selected_entry = null
  }

  const handle_double_click = (event: MouseEvent) => {
    const entry = find_entry_at_mouse(event)
    if (entry) {
      copy_to_clipboard(get_tooltip_text(entry), {
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

  $effect(() => {
    // Include fullscreen in dependencies to trigger re-setup when entering/exiting fullscreen
    fullscreen = fullscreen

    if (!canvas) return

    const dpr = globalThis.devicePixelRatio || 1
    const container = canvas.parentElement

    // Update canvas size based on current container (handles fullscreen changes)
    if (container) {
      const rect = container.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
    } else {
      canvas.width = 400 * dpr
      canvas.height = 400 * dpr
    }

    ctx = canvas.getContext(`2d`)
    if (ctx) {
      ctx.scale(dpr, dpr)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = `high`
    }

    // Reset camera position to center when canvas size changes significantly (like fullscreen)
    camera.center_x = 0
    camera.center_y = -50 // Shift up to better show the formation energy funnel

    // Initial render
    render_once()

    return () => { // Cleanup on unmount
      if (frame_id) cancelAnimationFrame(frame_id)
      if (pulse_frame_id) cancelAnimationFrame(pulse_frame_id)
    }
  })

  // Fullscreen handling
  $effect(() => {
    if (typeof window !== `undefined`) {
      if (fullscreen && !document.fullscreenElement && wrapper) {
        wrapper.requestFullscreen().catch(console.error)
      } else if (!fullscreen && document.fullscreenElement) {
        document.exitFullscreen()
      }
    }
  })

  let style = $derived(
    `--pd-stable-color:${merged_config.colors?.stable || `#0072B2`};
    --pd-unstable-color:${merged_config.colors?.unstable || `#E69F00`};
    --pd-edge-color:${merged_config.colors?.edge || `var(--text-color, #212121)`};
     --pd-annotation-color:${
      merged_config.colors?.annotation || `var(--text-color, #212121)`
    }`,
  )
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
  }}
  onmousemove={handle_mouse_move}
  onmouseup={handle_mouse_up}
/>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="phase-diagram-3d"
  class:dragover={drag_over}
  {style}
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
  <h3 style="position: absolute; left: 1em; top: 1ex; margin: 0; z-index: 10">
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
    {@const formation_energies = plot_entries.map((e) => e.e_above_hull ?? 0)}
    {@const min_energy = Math.min(...formation_energies)}
    {@const max_energy = Math.max(...formation_energies, 0.1)}
    <div class="color-bar-container">
      <ColorBar
        title="Energy above hull (eV/atom)"
        range={[min_energy, max_energy]}
        {color_scale}
        orientation="horizontal"
        tick_labels={4}
        wrapper_style="width: 200px;"
        bar_style="height: 12px;"
        title_style="font-size: 0.8em; margin-bottom: 4px;"
      />
    </div>
  {/if}

  <!-- Control buttons (top-right corner) -->
  {#if merged_legend.show}
    <section class="control-buttons">
      <button
        type="button"
        onclick={reset_camera}
        title="Reset camera view (R key)"
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
          {energy_threshold}
          {label_energy_threshold}
          {label_threshold}
          toggle_props={{
            class: `info-btn`,
          }}
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
        show_elemental_polymorphs="hide-control"
        bind:energy_threshold
        bind:label_energy_threshold
        max_energy_threshold={max_energy_threshold()}
        {plot_entries}
        {stable_entries}
        {unstable_entries}
        {total_unstable_count}
        {camera}
        {merged_legend}
        toggle_props={{
          class: `legend-controls-btn`,
        }}
        {show_hull_faces}
        on_hull_faces_change={(value) => show_hull_faces = value}
      />
    </section>
  {/if}

  <!-- Hover tooltip -->
  {#if hover_data}
    {@const { entry, position } = hover_data}
    {@const is_element = Object.keys(entry.composition).length === 1}
    {@const elem_symbol = is_element ? Object.keys(entry.composition)[0] : ``}
    <div
      class="tooltip"
      style:left="{position.x + 10}px;"
      style:top="{position.y - 10}px;"
      style:background={get_point_color(entry)}
      {@attach contrast_color()}
    >
      <div class="tooltip-title">
        {@html get_electro_neg_formula(entry.composition)}
      </div>
      {#if is_element}
        <div class="element-name">
          {elem_symbol_to_name[elem_symbol as ElementSymbol]}
        </div>
      {/if}

      <div>
        E<sub>above hull</sub>: {format_num(entry.e_above_hull || 0, `.3~`)} eV/atom
      </div>
      <div>
        Formation Energy: {format_num(entry.e_form_per_atom || 0, `.3~`)} eV/atom
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
    z-index: 1000;
  }
  .control-buttons :global(.draggable-pane) {
    z-index: 1001 !important;
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
  .color-bar-container {
    position: absolute;
    bottom: 1em;
    left: 1em;
    z-index: 1000;
  }
  .tooltip {
    position: fixed;
    padding: 5px 8px;
    border-radius: 4px;
    font-size: 12px;
    pointer-events: none;
    z-index: 1000;
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
    z-index: 10000;
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
    z-index: 1000;
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
