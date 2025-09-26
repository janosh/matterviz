<script lang="ts">
  import type { AnyStructure, ElementSymbol } from '$lib'
  import { Icon, PD_DEFAULTS, toggle_fullscreen } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { contrast_color } from '$lib/colors'
  import { elem_symbol_to_name, get_electro_neg_formula } from '$lib/composition'
  import { format_fractional, format_num } from '$lib/labels'
  import { compute_4d_coords, TETRAHEDRON_VERTICES } from './barycentric-coords'
  import {
    build_entry_tooltip_text,
    compute_max_energy_threshold,
    default_controls,
    find_pd_entry_at_mouse,
    get_energy_color_scale,
    get_point_color_for_entry,
    parse_pd_entries_from_drop,
    PD_STYLE,
  } from './helpers'
  import PhaseDiagramControls from './PhaseDiagramControls.svelte'
  import PhaseDiagramInfoPane from './PhaseDiagramInfoPane.svelte'
  import StructurePopup from './StructurePopup.svelte'
  import {
    compute_formation_energy_per_atom,
    find_lowest_energy_unary_refs,
    get_phase_diagram_stats,
    process_pd_entries,
  } from './thermodynamics'
  import type {
    HoverData3D,
    PDControlsType,
    PhaseDiagramConfig,
    PhaseEntry,
    PlotEntry3D,
  } from './types'

  interface Props {
    entries: PhaseEntry[]
    controls?: Partial<PDControlsType>
    config?: Partial<PhaseDiagramConfig>
    on_point_click?: (entry: PlotEntry3D) => void
    on_point_hover?: (data: HoverData3D | null) => void
    fullscreen?: boolean
    enable_fullscreen?: boolean
    enable_info_pane?: boolean
    wrapper?: HTMLDivElement
    // Smart label defaults - hide labels if more than this many entries
    label_threshold?: number
    // Bindable visibility and interaction state
    show_stable?: boolean
    show_unstable?: boolean
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
    energy_source_mode?: `precomputed` | `on-the-fly` // whether to read formation and above hull distance from entries or compute them on the fly
  }
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
    color_mode = $bindable(`energy`),
    color_scale = $bindable(`interpolateViridis`),
    info_pane_open = $bindable(false),
    legend_pane_open = $bindable(false),
    energy_threshold = $bindable(0.1), // eV/atom above hull for showing entries
    show_elemental_polymorphs = $bindable(false),
    on_file_drop,
    enable_structure_preview = true,
    energy_source_mode = $bindable(`precomputed`),
  }: Props = $props()

  const merged_controls: PDControlsType = $derived({
    ...default_controls,
    ...controls,
  })

  const merged_config = $derived({
    width: 600,
    height: 600,
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
    ...config,
    margin: { top: 60, right: 60, bottom: 60, left: 60, ...(config.margin || {}) },
  })

  // Decide which energy source to use per entry (keep e_form and e_above_hull consistent)
  const has_precomputed_e_form = $derived(
    entries.length > 0 && entries.every((e) => typeof e.e_form_per_atom === `number`),
  )
  const has_precomputed_hull = $derived(
    entries.length > 0 && entries.every((e) => typeof e.e_above_hull === `number`),
  )

  // For quaternary, we currently do not compute e_above_hull on the fly (needs a 4D hull)
  // Only compute formation energies when explicitly requested via on-the-fly
  const unary_refs = $derived.by(() =>
    energy_source_mode === `on-the-fly`
      ? find_lowest_energy_unary_refs(entries)
      : ({} as Record<string, PhaseEntry>)
  )

  const can_compute_e_form = $derived.by(() => {
    if (energy_source_mode !== `on-the-fly`) return false
    const elements_in_entries = Array.from(
      new Set(entries.flatMap((e) => Object.keys(e.composition))),
    )
    return elements_in_entries.every((el) => Boolean(unary_refs[el]))
  })
  // Quaternary on-the-fly hull distances are not implemented yet
  const can_compute_hull = $derived(false)

  const use_on_the_fly = $derived(
    energy_source_mode === `on-the-fly` && can_compute_e_form && can_compute_hull,
  )

  const effective_entries = $derived.by(() => {
    if (!use_on_the_fly) return entries
    // on-the-fly: compute formation energy per atom where possible
    return entries.map((entry) => {
      const e_form = compute_formation_energy_per_atom(entry, unary_refs)
      if (e_form == null) return entry
      return { ...entry, e_form_per_atom: e_form }
    })
  })

  // Process phase diagram data with unified PhaseEntry interface using effective entries
  const processed_entries = $derived(effective_entries)

  const pd_data = $derived(process_pd_entries(processed_entries))

  const elements = $derived.by(() => {
    const all_elements = pd_data.elements

    if (all_elements.length > 4) {
      console.error(
        `PhaseDiagram4D: Dataset contains ${all_elements.length} elements, but quaternary diagrams require exactly 4. Found: [${
          all_elements.join(`, `)
        }]`,
      )
      return []
    }

    return all_elements
  })

  const plot_entries = $derived.by(() => {
    if (elements.length !== 4) {
      return []
    }

    try {
      const coords = compute_4d_coords(pd_data.entries, elements)
      // Filter by energy threshold and update visibility based on toggles
      const energy_filtered = coords.filter((entry: PlotEntry3D) => {
        // Handle elemental entries specially
        if (entry.is_element) {
          // Always include reference elemental entries (corner points of tetrahedron)
          if (entry.e_above_hull === 0 || entry.is_stable) return true
          // Include other elemental polymorphs only if toggle is enabled
          return show_elemental_polymorphs &&
            (entry.e_above_hull || 0) <= energy_threshold
        }
        // Include stable entries (e_above_hull = 0)
        if (
          entry.is_stable ||
          (entry.e_above_hull !== undefined && entry.e_above_hull <= 1e-6)
        ) return true
        // Include unstable entries within threshold
        return (entry.e_above_hull || 0) <= energy_threshold
      })
      return energy_filtered
        .map((entry: PlotEntry3D) => {
          const is_stable = entry.is_stable || entry.e_above_hull === 0
          // Update visibility based on current toggle states
          entry.visible = (is_stable && show_stable) || (!is_stable && show_unstable)
          return entry
        })
    } catch (error) {
      console.error(`Error computing quaternary coordinates:`, error)
      return []
    }
  })

  const stable_entries = $derived(
    plot_entries.filter((entry: PlotEntry3D) =>
      entry.is_stable || entry.e_above_hull === 0
    ),
  )

  const unstable_entries = $derived(
    plot_entries.filter((entry: PlotEntry3D) =>
      (entry.e_above_hull || 0) > 0 && !entry.is_stable
    ),
  )

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

  // Camera state - following Materials Project's 3D camera setup
  let camera = $state({
    rotation_x: PD_DEFAULTS.quaternary.camera_rotation_x,
    rotation_y: PD_DEFAULTS.quaternary.camera_rotation_y,
    zoom: PD_DEFAULTS.quaternary.camera_zoom,
    center_x: PD_DEFAULTS.quaternary.camera_center_x,
    center_y: PD_DEFAULTS.quaternary.camera_center_y,
  })

  // Interaction state
  let is_dragging = $state(false)
  let drag_started = $state(false)
  let last_mouse = $state({ x: 0, y: 0 })
  let hover_data = $state<HoverData3D | null>(null)
  let copy_feedback_visible = $state(false)
  let copy_feedback_position = $state({ x: 0, y: 0 })

  // Drag and drop state
  let drag_over = $state(false)

  // Structure popup state
  let modal_open = $state(false)
  let selected_structure = $state<AnyStructure | null>(null)
  let selected_entry = $state<PlotEntry3D | null>(null)
  let modal_place_right = $state(true)

  // Pulsating highlight for selected point
  let pulse_time = $state(0)
  let pulse_opacity = $derived(0.3 + 0.4 * Math.sin(pulse_time * 4))
  let pulse_frame_id = 0
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
    [show_stable, show_unstable, color_mode, color_scale, energy_threshold, show_elemental_polymorphs, camera.rotation_x, camera.rotation_y, camera.zoom, camera.center_x, camera.center_y, plot_entries]

    render_once()
  })

  // Visibility toggles are now bindable props

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
  function extract_structure_from_entry(entry: PlotEntry3D): AnyStructure | null {
    const original_entry = entries.find((orig_entry) =>
      orig_entry.entry_id === entry.entry_id
    )
    return original_entry?.structure as AnyStructure || null
  }

  const get_tooltip_text = (entry: PlotEntry3D) => build_entry_tooltip_text(entry)

  const reset_camera = () =>
    Object.assign(camera, {
      rotation_x: PD_DEFAULTS.quaternary.camera_rotation_x,
      rotation_y: PD_DEFAULTS.quaternary.camera_rotation_y,
      zoom: PD_DEFAULTS.quaternary.camera_zoom,
      center_x: PD_DEFAULTS.quaternary.camera_center_x,
      center_y: PD_DEFAULTS.quaternary.camera_center_y,
    })

  function reset_all() {
    reset_camera()
    fullscreen = PD_DEFAULTS.quaternary.fullscreen
    info_pane_open = PD_DEFAULTS.quaternary.info_pane_open
    legend_pane_open = PD_DEFAULTS.quaternary.legend_pane_open
    color_mode = PD_DEFAULTS.quaternary.color_mode
    color_scale = PD_DEFAULTS.quaternary.color_scale as D3InterpolateName
    show_stable = PD_DEFAULTS.quaternary.show_stable
    show_unstable = PD_DEFAULTS.quaternary.show_unstable
    show_stable_labels = PD_DEFAULTS.quaternary.show_stable_labels
    show_unstable_labels = PD_DEFAULTS.quaternary.show_unstable_labels
    energy_threshold = PD_DEFAULTS.quaternary.energy_threshold
    label_energy_threshold = PD_DEFAULTS.quaternary.label_energy_threshold
    show_elemental_polymorphs = PD_DEFAULTS.quaternary.show_elemental_polymorphs
  }

  const handle_keydown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName.match(/INPUT|TEXTAREA/)) return

    const actions: Record<string, () => void> = {
      r: reset_camera,
      b: () => color_mode = color_mode === `stability` ? `energy` : `stability`,
      s: () => show_stable = !show_stable,
      u: () => show_unstable = !show_unstable,
      l: () => show_stable_labels = !show_stable_labels,
    }
    actions[event.key.toLowerCase()]?.()
  }

  async function handle_file_drop(event: DragEvent): Promise<void> {
    drag_over = false
    const data = await parse_pd_entries_from_drop(event)
    if (data) on_file_drop?.(data)
  }

  async function copy_to_clipboard(text: string, position: { x: number; y: number }) {
    await navigator.clipboard.writeText(text)
    copy_feedback_position = position
    copy_feedback_visible = true
    setTimeout(() => copy_feedback_visible = false, 1500)
  }

  function get_point_color(entry: PlotEntry3D): string {
    return get_point_color_for_entry(
      entry,
      color_mode,
      merged_config.colors,
      energy_color_scale,
    )
  }

  // Cache energy color scale per frame/setting
  const energy_color_scale = $derived.by(() =>
    get_energy_color_scale(color_mode, color_scale, plot_entries)
  )

  const max_energy_threshold = $derived(() =>
    compute_max_energy_threshold(processed_entries)
  )

  // Phase diagram statistics
  const phase_stats = $derived.by(() =>
    get_phase_diagram_stats(processed_entries, elements, 4)
  )

  // 3D to 2D projection following Materials Project approach
  function project_3d_point(
    x: number,
    y: number,
    z: number,
  ): { x: number; y: number; depth: number } {
    if (!canvas) return { x: 0, y: 0, depth: 0 }

    // Center coordinates around tetrahedron/triangle centroid
    let centered_x = x
    let centered_y = y
    let centered_z = z

    // Tetrahedron centroid: average of vertices (1,0,0), (0.5,√3/2,0), (0.5,√3/6,√6/3), (0,0,0)
    const centroid_x = (1 + 0.5 + 0.5 + 0) / 4 // = 0.5
    const centroid_y = (0 + Math.sqrt(3) / 2 + Math.sqrt(3) / 6 + 0) / 4 // = √3/6
    const centroid_z = (0 + 0 + Math.sqrt(6) / 3 + 0) / 4 // = √6/12
    centered_x = x - centroid_x
    centered_y = y - centroid_y
    centered_z = z - centroid_z

    // Apply 3D transformations around the centered coordinates
    const cos_x = Math.cos(camera.rotation_x)
    const sin_x = Math.sin(camera.rotation_x)
    const cos_y = Math.cos(camera.rotation_y)
    const sin_y = Math.sin(camera.rotation_y)

    // Rotate around Y axis first
    const x1 = centered_x * cos_y - centered_z * sin_y
    const z1 = centered_x * sin_y + centered_z * cos_y

    // Then rotate around X axis
    const y2 = centered_y * cos_x - z1 * sin_x
    const z2 = centered_y * sin_x + z1 * cos_x

    // Apply perspective projection using actual canvas dimensions
    const display_width = canvas.clientWidth || 400
    const display_height = canvas.clientHeight || 400
    const scale = Math.min(display_width, display_height) * 0.6 * camera.zoom
    const center_x = display_width / 2 + camera.center_x
    const center_y = display_height / 2 + camera.center_y

    return {
      x: center_x + x1 * scale,
      y: center_y - y2 * scale, // Flip Y for canvas coordinates
      depth: z2, // For depth sorting
    }
  }

  function draw_structure_outline(): void {
    if (!ctx) return

    const styles = getComputedStyle(canvas)
    // Match gray dashed structure lines used in 3D
    ctx.strokeStyle = PD_STYLE.structure_line.color
    ctx.lineWidth = PD_STYLE.structure_line.line_width
    ctx.setLineDash(PD_STYLE.structure_line.dash)

    // Draw tetrahedron edges
    draw_tetrahedron()

    // Reset dash and stroke for subsequent drawings
    ctx.setLineDash([])
    ctx.strokeStyle = styles.getPropertyValue(`--pd-edge-color`) || `#212121`
  }

  function draw_tetrahedron(): void {
    if (!ctx) return

    const styles = getComputedStyle(canvas)

    // Convert vertices to Point3D objects
    const vertices = TETRAHEDRON_VERTICES.map(([x, y, z]) => ({ x, y, z }))

    // Tetrahedron edges (connecting vertices)
    const edges = [
      [0, 1],
      [0, 2],
      [0, 3], // From vertex 0
      [1, 2],
      [1, 3], // From vertex 1
      [2, 3], // From vertex 2
    ]

    // Draw edges
    ctx.beginPath()
    for (const [i, j] of edges) {
      const v1 = vertices[i]
      const v2 = vertices[j]

      const proj1 = project_3d_point(v1.x, v1.y, v1.z)
      const proj2 = project_3d_point(v2.x, v2.y, v2.z)

      ctx.moveTo(proj1.x, proj1.y)
      ctx.lineTo(proj2.x, proj2.y)
    }
    ctx.stroke()

    // Corner element labels: place just outside along line towards tetrahedron centroid
    if (elements.length === 4) {
      // Tetrahedron centroid in barycentric space maps to average of vertices
      const centroid = {
        x: (vertices[0].x + vertices[1].x + vertices[2].x + vertices[3].x) / 4,
        y: (vertices[0].y + vertices[1].y + vertices[2].y + vertices[3].y) / 4,
        z: (vertices[0].z + vertices[1].z + vertices[2].z + vertices[3].z) / 4,
      }

      ctx.fillStyle = styles.getPropertyValue(`--pd-annotation-color`) || `#212121`
      ctx.font = `bold 18px Arial`
      ctx.textAlign = `center`
      ctx.textBaseline = `middle`

      const distance = 0.06
      for (let idx = 0; idx < 4; idx++) {
        const vx = vertices[idx]
        // Direction from centroid to vertex
        const dir = {
          x: vx.x - centroid.x,
          y: vx.y - centroid.y,
          z: vx.z - centroid.z,
        }
        const len = Math.hypot(dir.x, dir.y, dir.z) || 1
        const label_pos = {
          x: vx.x + (dir.x / len) * distance,
          y: vx.y + (dir.y / len) * distance,
          z: vx.z + (dir.z / len) * distance,
        }
        const proj = project_3d_point(label_pos.x, label_pos.y, label_pos.z)
        ctx.fillText(elements[idx], proj.x, proj.y)
      }
    }
  }

  function draw_data_points(): void {
    if (!ctx || plot_entries.length === 0) return
    const styles = getComputedStyle(canvas)

    // Collect all points with depth for sorting
    const points_with_depth: Array<{
      entry: PlotEntry3D
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
      const container_scale = Math.min(display_width, display_height) / 600 // Scale factor based on 600px baseline

      const base_size = entry.size || (is_stable ? 6 : 4)
      const size = base_size * container_scale // Scale points with container size

      // Draw shadow/depth indicator first (also scale with container)
      const shadow_offset = Math.abs(entry.z) * 2 * container_scale
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

      // Draw pulsating highlight for selected entry (before main point)
      if (selected_entry && entry.entry_id === selected_entry.entry_id) {
        const highlight_size = size * (1.8 + 0.3 * Math.sin(pulse_time * 4))
        ctx.fillStyle = `rgba(102, 240, 255, ${pulse_opacity * 0.6})` // Light cyan with pulsing opacity
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
      ctx.lineWidth = 0.5 * container_scale // Scale line width with container

      ctx.beginPath()
      ctx.arc(projected.x, projected.y, size, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()

      // Draw labels based on controls (do not label elemental corners here; they are labeled near vertices)
      const should_show_label = merged_config.show_labels && (
        (is_stable && show_stable_labels) ||
        (!is_stable && show_unstable_labels &&
          (entry.e_above_hull || 0) <= label_energy_threshold)
      )

      if (should_show_label) {
        ctx.fillStyle = styles.getPropertyValue(`--pd-annotation-color`) || `#212121`

        // For compound entries, use name, formula, or entry_id as fallback
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

  function render_frame(): void {
    if (!ctx || !canvas) return

    const styles = getComputedStyle(canvas)

    // Use CSS dimensions for rendering (already scaled by DPR in context)
    const display_width = canvas.clientWidth || 600
    const display_height = canvas.clientHeight || 600

    // Clear canvas
    ctx.clearRect(0, 0, display_width, display_height)

    // Set background - use transparent to inherit from container
    ctx.fillStyle = `transparent`
    ctx.fillRect(0, 0, display_width, display_height)

    if (elements.length !== 4) {
      // Show error message
      ctx.fillStyle = styles.getPropertyValue(`--text-color`) || `#666`
      ctx.font = `16px Arial`
      ctx.textAlign = `center`
      ctx.textBaseline = `middle`

      ctx.fillText(
        `Quaternary phase diagram requires exactly 4 elements (got ${pd_data.elements.length})`,
        display_width / 2,
        display_height / 2,
      )
      return
    }

    // Draw tetrahedron outline
    draw_structure_outline()

    // Draw data points
    draw_data_points()
  }

  function handle_mouse_down(event: MouseEvent) {
    is_dragging = true
    drag_started = false
    last_mouse = { x: event.clientX, y: event.clientY }
  }

  const handle_mouse_move = (event: MouseEvent) => {
    if (!is_dragging) return
    const [dx, dy] = [event.clientX - last_mouse.x, event.clientY - last_mouse.y]

    // Detect if significant movement occurred (indicates actual drag)
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag_started = true

    // With Cmd/Ctrl held: pan the view instead of rotating
    if (event.metaKey || event.ctrlKey) {
      camera.center_x += dx
      camera.center_y += dy
    } else {
      camera.rotation_y -= dx * 0.005
      camera.rotation_x = Math.max(
        -Math.PI / 3,
        Math.min(Math.PI / 3, camera.rotation_x + dy * 0.005),
      )
    }
    last_mouse = { x: event.clientX, y: event.clientY }
  }

  const handle_mouse_up = () => is_dragging = false

  const handle_wheel = (event: WheelEvent) => {
    event.preventDefault()
    camera.zoom = Math.max(
      1.0,
      Math.min(15, camera.zoom * (event.deltaY > 0 ? 0.98 : 1.02)),
    )
  }

  const handle_hover = (event: MouseEvent) => {
    const entry = find_entry_at_mouse(event)
    hover_data = entry
      ? { entry, position: { x: event.clientX, y: event.clientY } }
      : null
    on_point_hover?.(hover_data)
  }

  const find_entry_at_mouse = (event: MouseEvent): PlotEntry3D | null =>
    find_pd_entry_at_mouse(
      canvas,
      event,
      plot_entries,
      (x: number, y: number, z: number) => {
        const p = project_3d_point(x, y, z)
        return { x: p.x, y: p.y }
      },
    )

  const handle_click = (event: MouseEvent) => {
    event.stopPropagation()
    // Don't trigger click if this was a drag operation
    if (drag_started) {
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
    } else if (modal_open) {
      close_structure_popup()
    }
  }

  // Decide side based on available viewport room
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
    camera.center_y = 20 // Slight offset to avoid legend overlap

    // Initial render
    render_once()

    return () => { // Cleanup on unmount
      if (frame_id) cancelAnimationFrame(frame_id)
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
  class="phase-diagram-4d"
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
  aria-label="Phase diagram visualization"
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

  <!-- Control buttons (top-right corner like Structure.svelte) -->
  {#if merged_controls.show}
    <section class="control-buttons">
      <button
        type="button"
        onclick={reset_all}
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
        bind:show_elemental_polymorphs
        bind:energy_threshold
        bind:label_energy_threshold
        max_energy_threshold={max_energy_threshold()}
        {stable_entries}
        {unstable_entries}
        {total_unstable_count}
        {camera}
        {merged_controls}
        toggle_props={{
          class: `legend-controls-btn`,
        }}
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
    {@const is_element = Object.keys(entry.composition).length === 1}
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
  .phase-diagram-4d {
    position: relative;
    width: 100%;
    height: var(--pd-height, 500px);
    background: var(--surface-bg, #f8f9fa);
    border-radius: 4px;
  }
  .phase-diagram-4d:fullscreen {
    border-radius: 0;
  }
  .phase-diagram-4d.dragover {
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
