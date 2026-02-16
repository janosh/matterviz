<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import {
    add_alpha,
    is_dark_mode,
    PLOT_COLORS,
    vesta_hex,
    watch_dark_mode,
  } from '$lib/colors'
  import { normalize_show_controls } from '$lib/controls'
  import { ClickFeedback, DragOverlay, Spinner } from '$lib/feedback'
  import Icon from '$lib/Icon.svelte'
  import {
    set_fullscreen_bg,
    setup_fullscreen_effect,
    toggle_fullscreen,
  } from '$lib/layout'
  import { ColorBar, PlotTooltip } from '$lib/plot'
  import { DEFAULTS } from '$lib/settings'
  import type { AnyStructure } from '$lib/structure'
  import {
    barycentric_to_tetrahedral,
    compute_4d_coords,
    TETRAHEDRON_VERTICES,
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
  import type { Point4D } from './thermodynamics'
  import * as thermo from './thermodynamics'
  import type {
    ConvexHullEntry,
    HighlightStyle,
    HoverData3D,
    HullFaceColorMode,
  } from './types'

  let {
    entries = [],
    controls = {},
    config = {},
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(DEFAULTS.convex_hull.quaternary.fullscreen),
    enable_fullscreen = true,
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(DEFAULTS.convex_hull.quaternary.show_stable),
    show_unstable = $bindable(DEFAULTS.convex_hull.quaternary.show_unstable),
    show_hull_faces = $bindable(DEFAULTS.convex_hull.quaternary.show_hull_faces),
    hull_face_opacity = $bindable(DEFAULTS.convex_hull.quaternary.hull_face_opacity),
    hull_face_color_mode = $bindable(
      DEFAULTS.convex_hull.quaternary.hull_face_color_mode as HullFaceColorMode,
    ),
    element_colors = vesta_hex,
    color_mode = $bindable(DEFAULTS.convex_hull.quaternary.color_mode),
    color_scale = $bindable(
      DEFAULTS.convex_hull.quaternary.color_scale as D3InterpolateName,
    ),
    info_pane_open = $bindable(DEFAULTS.convex_hull.quaternary.info_pane_open),
    legend_pane_open = $bindable(DEFAULTS.convex_hull.quaternary.legend_pane_open),
    max_hull_dist_show_phases = $bindable(
      DEFAULTS.convex_hull.quaternary.max_hull_dist_show_phases,
    ),
    max_hull_dist_show_labels = $bindable(
      DEFAULTS.convex_hull.quaternary.max_hull_dist_show_labels,
    ),
    show_stable_labels = $bindable(
      DEFAULTS.convex_hull.quaternary.show_stable_labels,
    ),
    show_unstable_labels = $bindable(
      DEFAULTS.convex_hull.quaternary.show_unstable_labels,
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
    margin: { t: 60, r: 60, b: 60, l: 60, ...(config.margin || {}) },
  })

  // Reactive dark mode detection for canvas text color
  let dark_mode = $state(is_dark_mode())
  $effect(() => watch_dark_mode((dark) => dark_mode = dark))
  const text_color = $derived(helpers.get_canvas_text_color(dark_mode))

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
    if (pd_data.elements.length > 4) {
      console.error(
        `ConvexHull4D: Dataset contains ${pd_data.elements.length} elements, but quaternary diagrams require exactly 4. Found: [${
          pd_data.elements.join(`, `)
        }]`,
      )
      return []
    }
    return pd_data.elements
  })

  // Compute 4D hull for visualization (always compute when we have formation energies)
  const hull_4d = $derived.by(() => {
    if (elements.length !== 4) return []

    try {
      // Get coords with formation energies
      const coords = compute_4d_coords(pd_data.entries, elements)

      // Convert to 4D points for hull computation using barycentric coordinates (composition fractions)
      const points_4d: Point4D[] = coords
        .filter(
          (ent) =>
            Number.isFinite(ent.e_form_per_atom) &&
            [ent.x, ent.y, ent.z].every(Number.isFinite),
        )
        .map((ent) => {
          const amounts = elements.map((el) => ent.composition[el] || 0)
          const total = amounts.reduce((sum, amt) => sum + amt, 0)
          if (!(total > 0)) return { x: NaN, y: NaN, z: NaN, w: NaN }
          const [x, y, z] = amounts.map((amt) => amt / total)
          return { x, y, z, w: ent.e_form_per_atom! }
        })
        .filter((p) => [p.x, p.y, p.z, p.w].every(Number.isFinite))

      if (points_4d.length < 5) return [] // Need at least 5 points for 4D hull

      return thermo.compute_lower_hull_4d(points_4d)
    } catch (error) {
      console.error(`Error computing 4D hull:`, error)
      return []
    }
  })

  // Enrich coords with e_above_hull (before filtering)
  const all_enriched_entries = $derived.by(() => {
    if (elements.length !== 4) return []
    try {
      const coords = compute_4d_coords(pd_data.entries, elements)
      if (energy_mode !== `on-the-fly` || hull_4d.length === 0) return coords

      // Build 4D points, tracking original indices for mapping hull distances back
      const valid = coords.flatMap((entry, idx) => {
        if (
          !Number.isFinite(entry.e_form_per_atom) ||
          ![entry.x, entry.y, entry.z].every(Number.isFinite)
        ) return []
        const amounts = elements.map((el) => entry.composition[el] || 0)
        const total = amounts.reduce((s, a) => s + a, 0)
        if (!(total > 0)) return []
        const [x, y, z] = amounts.map((a) => a / total)
        return [x, y, z].every(Number.isFinite)
          ? [{ idx, pt: { x, y, z, w: entry.e_form_per_atom! } }]
          : []
      })
      const e_hulls = thermo.compute_e_above_hull_4d(valid.map((v) => v.pt), hull_4d)
      const hull_map = new Map(valid.map((v, hi) => [v.idx, e_hulls[hi]]))
      return coords.map((entry, idx) => ({
        ...entry,
        e_above_hull: hull_map.get(idx),
      }))
    } catch (err) {
      console.error(`Error computing quaternary coordinates:`, err)
      return []
    }
  })

  // Auto threshold: show all for few entries, use default for many, interpolate between
  const max_hull_dist_in_data = $derived(
    helpers.calc_max_hull_dist_in_data(all_enriched_entries),
  )
  const auto_default_threshold = $derived(helpers.compute_auto_hull_dist_threshold(
    all_enriched_entries.length,
    max_hull_dist_in_data,
    DEFAULTS.convex_hull.quaternary.max_hull_dist_show_phases,
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
    all_enriched_entries.filter((entry) => {
      // Always include stable entries and elemental reference points
      if (entry.is_stable || (entry.e_above_hull ?? Infinity) <= 1e-6) return true
      return typeof entry.e_above_hull === `number` &&
        entry.e_above_hull <= max_hull_dist_show_phases
    }).map((entry) => {
      const is_stable = entry.is_stable || entry.e_above_hull === 0
      return {
        ...entry,
        visible: (is_stable && show_stable) || (!is_stable && show_unstable),
      }
    }),
  )

  // Stable and unstable entries exposed as bindable props
  $effect(() => {
    stable_entries = plot_entries.filter((entry: ConvexHullEntry) =>
      entry.is_stable || entry.e_above_hull === 0
    )
    unstable_entries = plot_entries.filter((entry: ConvexHullEntry) =>
      (entry.e_above_hull ?? 0) > 0 && !entry.is_stable
    )
  })

  let canvas: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null
  let frame_id = 0 // Performance optimization

  // Camera state - following Materials Project's 3D camera setup
  let camera = $state({
    rotation_x: DEFAULTS.convex_hull.quaternary.camera_rotation_x,
    rotation_y: DEFAULTS.convex_hull.quaternary.camera_rotation_y,
    zoom: DEFAULTS.convex_hull.quaternary.camera_zoom,
    center_x: 0,
    center_y: 20, // Slight offset to avoid legend overlap
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

  // Pulsating highlight for selected point and highlighted entries
  let pulse_time = $state(0)
  let pulse_opacity = $derived(0.3 + 0.4 * Math.sin(pulse_time * 4))
  let pulse_frame_id = 0

  // Merge highlight style with defaults
  const merged_highlight_style = $derived(
    helpers.merge_highlight_style(highlight_style),
  )

  // Helper to check if entry is highlighted
  const is_highlighted = (entry: ConvexHullEntry): boolean =>
    helpers.is_entry_highlighted(entry, highlighted_entries)

  $effect(() => {
    if (!selected_entry && !highlighted_entries.length) return
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
    [show_hull_faces, color_mode, color_scale, camera.rotation_x, camera.rotation_y, camera.zoom, camera.center_x, camera.center_y, plot_entries, hull_face_color, hull_face_opacity, hull_face_color_mode, element_colors, text_color, elements]

    render_once()
  })

  // Visibility toggles are now bindable props

  // Smart label defaults - hide labels if too many entries
  $effect(() => {
    const total_entries = effective_entries.length
    if (total_entries > label_threshold) {
      show_stable_labels = false
      show_unstable_labels = false
    } else {
      // For smaller datasets, show stable labels by default
      show_stable_labels = true
      show_unstable_labels = false
    }
  })

  // Function to extract structure data from a convex hull entry
  function extract_structure_from_entry(
    entry: ConvexHullEntry,
  ): AnyStructure | null {
    const orig_entry = entries.find((ent) => ent.entry_id === entry.entry_id)
    return orig_entry?.structure as AnyStructure || null
  }

  const reset_camera = () => {
    camera.rotation_x = DEFAULTS.convex_hull.quaternary.camera_rotation_x
    camera.rotation_y = DEFAULTS.convex_hull.quaternary.camera_rotation_y
    camera.zoom = DEFAULTS.convex_hull.quaternary.camera_zoom
    camera.center_x = 0
    camera.center_y = 20 // Slight offset to avoid legend overlap
  }
  function reset_all() {
    reset_camera()
    fullscreen = DEFAULTS.convex_hull.quaternary.fullscreen
    info_pane_open = DEFAULTS.convex_hull.quaternary.info_pane_open
    legend_pane_open = DEFAULTS.convex_hull.quaternary.legend_pane_open
    color_mode = DEFAULTS.convex_hull.quaternary.color_mode
    color_scale = DEFAULTS.convex_hull.quaternary.color_scale as D3InterpolateName
    show_stable = DEFAULTS.convex_hull.quaternary.show_stable
    show_unstable = DEFAULTS.convex_hull.quaternary.show_unstable
    show_stable_labels = DEFAULTS.convex_hull.quaternary.show_stable_labels
    show_unstable_labels = DEFAULTS.convex_hull.quaternary.show_unstable_labels
    // Use auto-computed threshold based on entry count instead of static default
    max_hull_dist_show_phases = auto_default_threshold
    max_hull_dist_show_labels =
      DEFAULTS.convex_hull.quaternary.max_hull_dist_show_labels
    show_hull_faces = DEFAULTS.convex_hull.quaternary.show_hull_faces
    hull_face_color = DEFAULTS.convex_hull.quaternary.hull_face_color
    hull_face_opacity = DEFAULTS.convex_hull.quaternary.hull_face_opacity
    hull_face_color_mode = DEFAULTS.convex_hull.quaternary
      .hull_face_color_mode as HullFaceColorMode
  }

  const handle_keydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    // Skip if focus is on an interactive element that handles Enter natively
    const interactive_selector =
      `input,textarea,select,button,a,[contenteditable="true"],[role="button"],[tabindex]:not([tabindex="-1"])`
    if (target.matches(interactive_selector) && target !== canvas) return

    // Prevent double handling from canvas + wrapper bubbling
    if (event.target !== event.currentTarget && event.currentTarget !== canvas) return

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
    phase_stats = thermo.get_convex_hull_stats(plot_entries, elements, 4)
  })

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

    // Apply perspective projection using cached canvas dimensions for consistency
    const scale = Math.min(canvas_dims.width, canvas_dims.height) * 0.6 * camera.zoom
    const center_x = canvas_dims.width / 2 + camera.center_x
    const center_y = canvas_dims.height / 2 + camera.center_y

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
    ctx.strokeStyle = CONVEX_HULL_STYLE.structure_line.color
    ctx.lineWidth = CONVEX_HULL_STYLE.structure_line.line_width
    ctx.setLineDash(CONVEX_HULL_STYLE.structure_line.dash)

    // Draw tetrahedron edges
    draw_tetrahedron()

    // Reset dash and stroke for subsequent drawings
    ctx.setLineDash([])
    ctx.strokeStyle = styles.getPropertyValue(`--hull-edge-color`) || `#212121`
  }

  function draw_tetrahedron(): void {
    if (!ctx) return

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

      ctx.fillStyle = text_color
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

  // Draw convex hull faces connecting stable points
  function draw_convex_hull_faces(): void {
    if (!ctx || !show_hull_faces || hull_4d.length === 0) return

    // Get stable points to determine which hull facets to draw
    const stable_points = plot_entries.filter((e) =>
      e.is_stable || e.e_above_hull === 0
    )
    if (stable_points.length === 0) return

    // Each tetrahedral facet has 4 triangular faces - we need to draw these
    // Collect all triangular faces with depth for sorting
    type TriangleFace = {
      vertices: [
        { x: number; y: number; depth: number },
        { x: number; y: number; depth: number },
        { x: number; y: number; depth: number },
      ]
      avg_depth: number
      avg_w: number // Average formation energy for coloring
      tet_idx: number // Tetrahedron index for facet_index mode
      centroid_bary: number[] // Barycentric centroid [el0, el1, el2, el3] for dominant_element mode
    }

    const triangles: TriangleFace[] = []

    for (let tet_idx = 0; tet_idx < hull_4d.length; tet_idx++) {
      const tet = hull_4d[tet_idx]
      const [p0, p1, p2, p3] = tet.vertices

      // Convert barycentric coordinates to tetrahedral 3D coordinates
      const tet0 = barycentric_to_tetrahedral([
        p0.x,
        p0.y,
        p0.z,
        1 - p0.x - p0.y - p0.z,
      ])
      const tet1 = barycentric_to_tetrahedral([
        p1.x,
        p1.y,
        p1.z,
        1 - p1.x - p1.y - p1.z,
      ])
      const tet2 = barycentric_to_tetrahedral([
        p2.x,
        p2.y,
        p2.z,
        1 - p2.x - p2.y - p2.z,
      ])
      const tet3 = barycentric_to_tetrahedral([
        p3.x,
        p3.y,
        p3.z,
        1 - p3.x - p3.y - p3.z,
      ])

      // Project to 2D screen space
      const proj0 = project_3d_point(tet0.x, tet0.y, tet0.z)
      const proj1 = project_3d_point(tet1.x, tet1.y, tet1.z)
      const proj2 = project_3d_point(tet2.x, tet2.y, tet2.z)
      const proj3 = project_3d_point(tet3.x, tet3.y, tet3.z)

      // Compute tetrahedron centroid in barycentric coords (for dominant_element mode)
      // All 4 faces share the same tetrahedron, so they get the same color for facet_index
      const tet_centroid_bary = [
        (p0.x + p1.x + p2.x + p3.x) / 4,
        (p0.y + p1.y + p2.y + p3.y) / 4,
        (p0.z + p1.z + p2.z + p3.z) / 4,
        ((1 - p0.x - p0.y - p0.z) + (1 - p1.x - p1.y - p1.z) +
          (1 - p2.x - p2.y - p2.z) + (1 - p3.x - p3.y - p3.z)) / 4,
      ]

      // Each tetrahedron has 4 triangular faces
      const faces: [typeof proj0, typeof proj1, typeof proj2, number][] = [
        [proj0, proj1, proj2, (p0.w + p1.w + p2.w) / 3],
        [proj0, proj1, proj3, (p0.w + p1.w + p3.w) / 3],
        [proj0, proj2, proj3, (p0.w + p2.w + p3.w) / 3],
        [proj1, proj2, proj3, (p1.w + p2.w + p3.w) / 3],
      ]

      for (const [v0, v1, v2, avg_w] of faces) {
        triangles.push({
          vertices: [v0, v1, v2],
          avg_depth: (v0.depth + v1.depth + v2.depth) / 3,
          avg_w,
          tet_idx,
          centroid_bary: tet_centroid_bary,
        })
      }
    }

    // Sort by depth (back to front)
    triangles.sort((a, b) => a.avg_depth - b.avg_depth)

    // Lazy computation for uniform mode: normalize alpha by formation energy
    let norm_alpha: ((w: number) => number) | null = null
    if (hull_face_color_mode === `uniform`) {
      const formation_energies = plot_entries.map((e) => e.e_form_per_atom ?? 0)
      const min_fe = Math.min(0, ...formation_energies)
      norm_alpha = (w: number) => {
        const t = Math.max(0, Math.min(1, (0 - w) / Math.max(1e-6, 0 - min_fe)))
        return t * hull_face_opacity
      }
    }

    // Lazy computation for formation_energy mode
    let energy_face_scale: ((val: number) => string) | null = null
    let min_w = 0
    if (hull_face_color_mode === `formation_energy`) {
      const all_avg_w = triangles.map((tri) => tri.avg_w)
      min_w = Math.min(...all_avg_w)
      energy_face_scale = helpers.get_energy_color_scale(
        `energy`,
        color_scale,
        all_avg_w.map((w) => ({ e_above_hull: w - min_w })), // Normalize to 0-based
      )
    }

    // Helper to get face color based on mode
    const get_face_color = (tri: TriangleFace): string => {
      if (hull_face_color_mode === `uniform`) {
        return hull_face_color
      }
      if (hull_face_color_mode === `formation_energy`) {
        return energy_face_scale!(tri.avg_w - min_w)
      }
      if (hull_face_color_mode === `dominant_element`) {
        // Find element with highest fraction
        const max_idx = tri.centroid_bary.indexOf(Math.max(...tri.centroid_bary))
        const el = elements[max_idx]
        return element_colors[el] ?? `#888888`
      }
      if (hull_face_color_mode === `facet_index`) {
        return PLOT_COLORS[tri.tet_idx % PLOT_COLORS.length]
      }
      return hull_face_color
    }

    // Draw each triangle
    for (const tri of triangles) {
      const [v0, v1, v2] = tri.vertices
      // Uniform mode uses variable opacity; other modes use fixed opacity
      const alpha = hull_face_color_mode === `uniform`
        ? norm_alpha!(tri.avg_w)
        : hull_face_opacity
      const face_color = get_face_color(tri)

      ctx.save()
      ctx.beginPath()
      ctx.moveTo(v0.x, v0.y)
      ctx.lineTo(v1.x, v1.y)
      ctx.lineTo(v2.x, v2.y)
      ctx.closePath()

      ctx.fillStyle = add_alpha(face_color, alpha)
      ctx.fill()

      // Edge lines more pronounced with higher opacity
      ctx.strokeStyle = add_alpha(face_color, Math.min(0.4, alpha * 4))
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }
  }

  function draw_data_points(): void {
    if (!ctx || sorted_points_cache.length === 0) return

    for (const { entry, projected } of sorted_points_cache) {
      const is_stable = entry.is_stable || entry.e_above_hull === 0
      const is_entry_highlighted = is_highlighted(entry)
      const color = get_point_color(entry)
      const size = (entry.size || (is_stable ? 6 : 4)) * canvas_dims.scale
      const marker = entry.marker || `circle`

      // Shadow
      const shadow_offset = Math.abs(entry.z) * 2 * canvas_dims.scale
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

      // Labels
      const should_label = merged_config.show_labels && (
        (is_stable && show_stable_labels) ||
        (!is_stable && show_unstable_labels &&
          (entry.e_above_hull ?? 0) <= max_hull_dist_show_labels)
      )
      if (should_label) {
        ctx.fillStyle = text_color
        const label = helpers.get_entry_label(entry, elements)
        const font_size = Math.round(12 * canvas_dims.scale)
        ctx.font = `${font_size}px Arial`
        ctx.textAlign = `center`
        ctx.textBaseline = `middle`
        ctx.fillText(label, projected.x, projected.y + size + 6 * canvas_dims.scale)
      }
    }
  }

  function render_frame(): void {
    if (!ctx || !canvas) return

    // Use CSS dimensions for rendering (already scaled by DPR in context)
    const display_width = canvas.clientWidth || 600
    const display_height = canvas.clientHeight || 600

    ctx.clearRect(0, 0, display_width, display_height) // Clear canvas

    ctx.fillStyle = `transparent` // Set background - use transparent to inherit from container
    ctx.fillRect(0, 0, display_width, display_height)

    if (elements.length !== 4) {
      if (elements.length > 0) {
        ctx.fillStyle = text_color
        ctx.font = `16px Arial`
        ctx.textAlign = `center`
        ctx.textBaseline = `middle`
        ctx.fillText(
          `Quaternary convex hull requires exactly 4 elements (got ${elements.length})`,
          display_width / 2,
          display_height / 2,
        )
      }
      return
    }

    draw_structure_outline() // Draw tetrahedron outline

    draw_convex_hull_faces() // Draw convex hull faces (before points so they appear behind)

    draw_data_points() // Draw data points (on top)
  }

  function handle_mouse_down(event: MouseEvent) {
    is_dragging = true
    drag_started = false
    hover_data = null
    on_point_hover?.(null)
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
      camera.rotation_y += dx * 0.005
      camera.rotation_x = Math.max(
        -Math.PI / 3,
        Math.min(Math.PI / 3, camera.rotation_x + dy * 0.005),
      )
    }
    last_mouse = { x: event.clientX, y: event.clientY }
  }

  const handle_wheel = (event: WheelEvent) => {
    event.preventDefault()
    camera.zoom = Math.max(
      1.0,
      Math.min(15, camera.zoom * (event.deltaY > 0 ? 0.98 : 1.02)),
    )
  }

  const handle_hover = (event: MouseEvent) => {
    if (is_dragging) return
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
        const p = project_3d_point(x, y, z)
        return { x: p.x, y: p.y }
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

  $effect(() => {
    if (!canvas) return

    // Initial setup
    update_canvas_size()

    // Watch for resize events - only update canvas, don't reset camera
    const resize_observer = new ResizeObserver(update_canvas_size)

    const container = canvas.parentElement
    if (container) resize_observer.observe(container)

    return () => { // Cleanup on unmount
      if (frame_id) cancelAnimationFrame(frame_id)
      resize_observer.disconnect()
    }
  })

  // Fullscreen handling with camera reset
  let was_fullscreen = $state(fullscreen)
  $effect(() => {
    setup_fullscreen_effect(fullscreen, wrapper, (entering_fullscreen) => {
      if (entering_fullscreen !== was_fullscreen) {
        camera.center_x = 0
        camera.center_y = 20
        was_fullscreen = entering_fullscreen
      }
    })
    set_fullscreen_bg(wrapper, fullscreen, `--hull-4d-bg-fullscreen`)
  })

  // Performance: Cache canvas dimensions and pre-compute sorted point projections
  let canvas_dims = $state({ width: 600, height: 600, scale: 1 })
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
  onmouseup={() => [is_dragging, drag_started] = [false, false]}
/>

<div
  {...rest}
  class="convex-hull-4d {rest.class ?? ``}"
  class:dragover={drag_over}
  style={`${style}; ${rest.style ?? ``}`}
  data-has-selection={selected_entry !== null}
  data-has-hover={hover_data !== null}
  data-is-dragging={is_dragging}
  data-rotation-y={camera.rotation_y.toFixed(4)}
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
  aria-label="Convex hull visualization"
>
  {@render children?.({
      stable_entries,
      unstable_entries,
      highlighted_entries,
      selected_entry,
    })}
  <h3 style="position: absolute; left: 1em; top: 1ex; margin: 0">
    {@html merged_controls.title || phase_stats?.chemical_system || ``}
  </h3>

  <canvas
    bind:this={canvas}
    tabindex="0"
    aria-label={merged_controls.title || phase_stats?.chemical_system || `4D Convex Hull`}
    onmousedown={handle_mouse_down}
    onmousemove={handle_hover}
    onclick={handle_click}
    onkeydown={handle_keydown}
    ondblclick={handle_double_click}
    onwheel={handle_wheel}
  ></canvas>

  {#if entries.length === 0}
    <Spinner
      text="Loading data..."
      style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center"
    />
  {/if}

  <!-- Energy above hull Color Bar -->
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

  <!-- Control buttons (top-right corner like Structure.svelte) -->
  {#if controls_config.mode !== `never`}
    <section class="control-buttons {controls_config.class}">
      {#if controls_config.visible(`reset`)}
        <button
          type="button"
          onclick={reset_all}
          title="Reset camera view (R key)"
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

  <!-- Copy-to-clipboard feedback (double-click on point) -->
  <ClickFeedback bind:visible={copy_feedback.visible} position={copy_feedback.position} />

  <!-- Drag over overlay -->
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
  .convex-hull-4d {
    position: relative;
    container-type: size; /* enable cqh/cqw for responsive sizing */
    width: 100%;
    height: var(--hull-height, 500px);
    background: var(--hull-4d-bg, var(--hull-bg));
    border-radius: var(--hull-border-radius, var(--border-radius, 3pt));
  }
  .convex-hull-4d:fullscreen {
    border-radius: 0;
    background: var(--hull-4d-bg-fullscreen, var(--hull-4d-bg, var(--hull-bg)));
    overflow: hidden;
  }
  .convex-hull-4d.dragover {
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
    transition: opacity 0.2s ease-in-out;
  }
  .control-buttons.hover-visible {
    opacity: 0;
    pointer-events: none;
  }
  .convex-hull-4d:hover .control-buttons.hover-visible,
  .convex-hull-4d:focus-within .control-buttons.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .control-buttons.always-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .control-buttons :global(.draggable-pane) {
    z-index: 1001 !important;
  }
  .control-buttons :global(button) {
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    border-radius: 3px;
    color: var(--text-color, currentColor);
    transition: background-color 0.2s;
    display: flex;
    font-size: clamp(0.85em, 2cqmin, 1.3em);
  }
  .control-buttons :global(button):hover {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
</style>
