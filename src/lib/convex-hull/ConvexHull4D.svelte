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
  import { sanitize_html } from '$lib/sanitize'
  import { Spinner } from '$lib/feedback'
  import { ColorBar } from '$lib/plot'
  import { create_pulse_animation } from '$lib/effects.svelte'
  import { DEFAULTS } from '$lib/settings'
  import type { AnyStructure } from '$lib/structure'
  import {
    barycentric_to_tetrahedral,
    compute_4d_coords,
    TETRAHEDRON_VERTICES,
  } from './barycentric-coords'
  import { create_canvas_interactions } from './canvas-interactions.svelte'
  import ConvexHullChrome from './ConvexHullChrome.svelte'
  import GasPressureControls from './GasPressureControls.svelte'
  import * as helpers from './helpers'
  import { create_hull_data_pipeline } from './hull-state.svelte'
  import type { BaseConvexHullProps, Hull3DProps } from './index'
  import { CONVEX_HULL_STYLE, default_controls, default_hull_config } from './index'
  import TemperatureSlider from './TemperatureSlider.svelte'
  import type { Point4D } from './thermodynamics'
  import * as thermo from './thermodynamics'
  import type { ConvexHullEntry, HighlightStyle, HullFaceColorMode, PhaseData } from './types'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'
  import { compute_hull_stability } from './helpers'

  let {
    entries = [],
    controls = {},
    config = {},
    show_controls,
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(DEFAULTS.convex_hull.quaternary.fullscreen),
    fullscreen_toggle = true,
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(DEFAULTS.convex_hull.quaternary.show_stable),
    show_unstable = $bindable(DEFAULTS.convex_hull.quaternary.show_unstable),
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = $bindable([]),
    show_hull_faces = $bindable(DEFAULTS.convex_hull.quaternary.show_hull_faces),
    hull_face_opacity = $bindable(DEFAULTS.convex_hull.quaternary.hull_face_opacity),
    hull_face_color_mode = $bindable(
      DEFAULTS.convex_hull.quaternary.hull_face_color_mode as HullFaceColorMode,
    ),
    element_colors = vesta_hex,
    color_mode = $bindable(DEFAULTS.convex_hull.quaternary.color_mode),
    color_scale = $bindable(DEFAULTS.convex_hull.quaternary.color_scale as D3InterpolateName),
    info_pane_open = $bindable(DEFAULTS.convex_hull.quaternary.info_pane_open),
    controls_open = $bindable(DEFAULTS.convex_hull.quaternary.legend_pane_open),
    max_hull_dist_show_phases = $bindable(
      DEFAULTS.convex_hull.quaternary.max_hull_dist_show_phases,
    ),
    max_hull_dist_show_labels = $bindable(
      DEFAULTS.convex_hull.quaternary.max_hull_dist_show_labels,
    ),
    show_stable_labels = $bindable(DEFAULTS.convex_hull.quaternary.show_stable_labels),
    show_unstable_labels = $bindable(DEFAULTS.convex_hull.quaternary.show_unstable_labels),
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
    margin: { t: 60, r: 60, b: 60, l: 60, ...config.margin },
  })

  // Reactive dark mode detection for canvas text color
  let dark_mode = $state(is_dark_mode())
  $effect(() => watch_dark_mode((dark) => (dark_mode = dark)))
  const text_color = $derived(helpers.get_canvas_text_color(dark_mode))

  // Shared reactive data pipeline (temperature → gas → energy mode → hull data → threshold)
  // Explicit generic breaks the circular type inference through the all_enriched_entries thunk
  const hull_data = create_hull_data_pipeline<ConvexHullEntry>({
    dim: 4,
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
  const merged_gas_config = $derived(hull_data.merged_gas_config)
  const pd_data = $derived(hull_data.pd_data)
  const elements = $derived(hull_data.elements)
  const plot_entries = $derived(hull_data.plot_entries)

  // Compute 4D hull for visualization (always compute when we have formation energies)
  const hull_4d = $derived.by(() => {
    if (elements.length !== 4) return []

    try {
      // Get coords with formation energies, excluding entries that don't participate in hull
      const coords = compute_4d_coords(pd_data.entries, elements).filter(
        (ent) => !ent.exclude_from_hull,
      )

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
          return { x, y, z, w: ent.e_form_per_atom ?? NaN }
        })
        .filter((point) => [point.x, point.y, point.z, point.w].every(Number.isFinite))

      if (points_4d.length < 5) return [] // Need at least 5 points for 4D hull

      return thermo.compute_lower_hull_4d(points_4d)
    } catch (error) {
      console.error(`Error computing 4D hull:`, error)
      return []
    }
  })

  // Enrich coords with e_above_hull (before filtering)
  // Explicit return type breaks circular type inference with the hull_data pipeline
  const all_enriched_entries = $derived.by((): ConvexHullEntry[] => {
    if (elements.length !== 4) return []
    try {
      const coords = compute_4d_coords(pd_data.entries, elements)
      if (hull_data.energy_mode !== `on-the-fly` || hull_4d.length === 0) return coords

      // Build 4D points, tracking original indices for mapping hull distances back
      const valid = coords.flatMap((entry, idx) => {
        if (
          !Number.isFinite(entry.e_form_per_atom) ||
          ![entry.x, entry.y, entry.z].every(Number.isFinite)
        )
          return []
        const amounts = elements.map((el) => entry.composition[el] || 0)
        const total = amounts.reduce((sum, amt) => sum + amt, 0)
        if (!(total > 0)) return []
        const [x, y, z] = amounts.map((amt) => amt / total)
        return [x, y, z].every(Number.isFinite)
          ? [{ idx, pt: { x, y, z, w: entry.e_form_per_atom ?? NaN } }]
          : []
      })
      const raw_dists = thermo.compute_e_above_hull_4d(
        valid.map((item) => item.pt),
        hull_4d,
      )
      const hull_map = new Map(valid.map((item, hull_idx) => [item.idx, raw_dists[hull_idx]]))
      // missing/non-finite distance (no energy or point outside hull projection) -> unknown
      return coords.map((entry, idx) => ({
        ...entry,
        ...compute_hull_stability(hull_map.get(idx), entry.exclude_from_hull),
      }))
    } catch (err) {
      console.error(`Error computing quaternary coordinates:`, err)
      return []
    }
  })

  let canvas: HTMLCanvasElement | undefined = undefined
  let ctx: CanvasRenderingContext2D | null = null

  // Camera state - following Materials Project's 3D camera setup
  let camera = $state({
    rotation_x: DEFAULTS.convex_hull.quaternary.camera_rotation_x,
    rotation_y: DEFAULTS.convex_hull.quaternary.camera_rotation_y,
    zoom: DEFAULTS.convex_hull.quaternary.camera_zoom,
    center_x: 0,
    center_y: 20, // Slight offset to avoid legend overlap
  })

  // Shared canvas-interaction scaffold (mouse/keyboard handlers, hover/drag/popup
  // state, canvas sizing, render scheduler). Rotation math + keydown actions stay local.
  const interactions = create_canvas_interactions({
    wheel_clamp: [1.0, 15],
    fullscreen_bg_var: `--hull-4d-bg-fullscreen`,
    canvas: () => canvas,
    wrapper: () => wrapper,
    ctx: () => ctx,
    set_ctx: (context) => (ctx = context),
    set_canvas_dims: (dims) => (canvas_dims = dims),
    visible_entries: () => hull_data.visible_entries,
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
        camera.rotation_y += dx * 0.005
        camera.rotation_x = Math.max(
          -Math.PI / 3,
          Math.min(Math.PI / 3, camera.rotation_x - dy * 0.005),
        )
      }
    },
    // Reset pan center when entering/exiting fullscreen
    on_fullscreen_change: () => {
      camera.center_x = 0
      camera.center_y = 20
    },
    actions: () => ({
      r: reset_camera,
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

  // Pulsating highlight for selected point and highlighted entries
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
    void [show_hull_faces, color_mode, color_scale, camera.rotation_x, camera.rotation_y, camera.zoom, camera.center_x, camera.center_y, plot_entries, hull_data.visible_entries, hull_face_color, hull_face_opacity, hull_face_color_mode, element_colors, text_color, elements] // track reactively

    render_once()
  })

  // Visibility toggles are now bindable props

  // Smart label defaults: hide labels for large datasets. Applied once per dataset
  // (keyed on the entries prop) so later entry-count changes from temperature/gas
  // filtering don't clobber the user's label toggles.
  let label_defaults_applied_for: PhaseData[] | null = null
  $effect(() => {
    if (label_defaults_applied_for === entries) return
    label_defaults_applied_for = entries
    show_stable_labels = hull_data.effective_entries.length <= label_threshold
    show_unstable_labels = false
  })

  // function (not const) so the create_canvas_interactions options above can reference it
  function extract_structure_from_entry(entry: ConvexHullEntry): AnyStructure | null {
    return helpers.extract_structure_from_entry(entries, entry)
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
    controls_open = DEFAULTS.convex_hull.quaternary.legend_pane_open
    color_mode = DEFAULTS.convex_hull.quaternary.color_mode
    color_scale = DEFAULTS.convex_hull.quaternary.color_scale as D3InterpolateName
    show_stable = DEFAULTS.convex_hull.quaternary.show_stable
    show_unstable = DEFAULTS.convex_hull.quaternary.show_unstable
    hidden_categories = []
    show_stable_labels = DEFAULTS.convex_hull.quaternary.show_stable_labels
    show_unstable_labels = DEFAULTS.convex_hull.quaternary.show_unstable_labels
    // Use auto-computed threshold based on entry count instead of static default
    max_hull_dist_show_phases = hull_data.auto_default_threshold
    max_hull_dist_show_labels = DEFAULTS.convex_hull.quaternary.max_hull_dist_show_labels
    show_hull_faces = DEFAULTS.convex_hull.quaternary.show_hull_faces
    hull_face_color = DEFAULTS.convex_hull.quaternary.hull_face_color
    hull_face_opacity = DEFAULTS.convex_hull.quaternary.hull_face_opacity
    hull_face_color_mode = DEFAULTS.convex_hull.quaternary
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
    let [centered_x, centered_y, centered_z] = [x, y, z]

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
    if (!ctx || !canvas) return

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
    for (const [start, end] of edges) {
      const v1 = vertices[start]
      const v2 = vertices[end]

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
        const { x: cx, y: cy, z: cz } = centroid
        const dir = { x: vx.x - cx, y: vx.y - cy, z: vx.z - cz }
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
    const stable_points = plot_entries.filter(helpers.entry_is_stable)
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
      const tet0 = barycentric_to_tetrahedral([p0.x, p0.y, p0.z, 1 - p0.x - p0.y - p0.z])
      const tet1 = barycentric_to_tetrahedral([p1.x, p1.y, p1.z, 1 - p1.x - p1.y - p1.z])
      const tet2 = barycentric_to_tetrahedral([p2.x, p2.y, p2.z, 1 - p2.x - p2.y - p2.z])
      const tet3 = barycentric_to_tetrahedral([p3.x, p3.y, p3.z, 1 - p3.x - p3.y - p3.z])

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
        (1 -
          p0.x -
          p0.y -
          p0.z +
          (1 - p1.x - p1.y - p1.z) +
          (1 - p2.x - p2.y - p2.z) +
          (1 - p3.x - p3.y - p3.z)) /
          4,
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
    let norm_alpha: ((energy: number) => number) | null = null
    if (hull_face_color_mode === `uniform`) {
      norm_alpha = (energy: number) => {
        const frac = Math.max(
          0,
          Math.min(1, (0 - energy) / Math.max(1e-6, 0 - formation_energy_min)),
        )
        return frac * hull_face_opacity
      }
    }

    // Lazy computation for formation_energy mode
    let energy_face_scale: ((val: number) => string) | null = null
    let min_w = 0
    if (hull_face_color_mode === `formation_energy`) {
      const all_avg_w = triangles.map((tri) => tri.avg_w)
      min_w = helpers.array_min(all_avg_w)
      energy_face_scale = helpers.get_energy_color_scale(
        `energy`,
        color_scale,
        all_avg_w.map((energy) => ({ e_above_hull: energy - min_w })), // Normalize to 0-based
      )
    }

    // Helper to get face color based on mode
    const get_face_color = (tri: TriangleFace): string => {
      if (hull_face_color_mode === `uniform`) {
        return hull_face_color
      }
      if (hull_face_color_mode === `formation_energy`) {
        return energy_face_scale?.(tri.avg_w - min_w) ?? hull_face_color
      }
      if (hull_face_color_mode === `dominant_element`) {
        // Find element with highest fraction
        const max_idx = tri.centroid_bary.indexOf(helpers.array_max(tri.centroid_bary))
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
      const alpha =
        hull_face_color_mode === `uniform`
          ? (norm_alpha?.(tri.avg_w) ?? hull_face_opacity)
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
    helpers.draw_hull_points(ctx, sorted_points_cache, {
      scale: canvas_dims.scale,
      shadow_factor: 2,
      selected_entry,
      is_highlighted,
      get_point_color,
      highlight_style: merged_highlight_style,
      pulse_time: pulse.time,
      pulse_opacity,
    })

    if (!merged_config.show_labels) return

    const label_entries = helpers.get_composition_label_entries(
      sorted_points_cache
        .map(({ entry }) => entry)
        .filter((entry) => {
          if (entry.is_element) return false
          const is_stable = helpers.entry_is_stable(entry)
          return (
            (is_stable && show_stable_labels) ||
            (!is_stable &&
              show_unstable_labels &&
              (entry.e_above_hull ?? 0) <= max_hull_dist_show_labels)
          )
        }),
    )

    ctx.fillStyle = text_color
    ctx.font = `${Math.round(12 * canvas_dims.scale)}px Arial`
    ctx.textAlign = `center`
    ctx.textBaseline = `middle`

    for (const entry of label_entries) {
      const is_stable = helpers.entry_is_stable(entry)
      const size = (entry.size || (is_stable ? 6 : 4)) * canvas_dims.scale
      const projected = project_3d_point(entry.x, entry.y, entry.z)
      const label = helpers.get_entry_label(entry, elements)
      ctx.fillText(label, projected.x, projected.y + size + 6 * canvas_dims.scale)
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

  // Performance: Cache canvas dimensions and formation energy minimum
  let canvas_dims = $state({ width: 600, height: 600, scale: 1 })
  const formation_energy_min = $derived.by(() => {
    let min_energy = 0
    for (const entry of all_enriched_entries) {
      min_energy = Math.min(min_energy, entry.e_form_per_atom ?? 0)
    }
    return min_energy
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
  class={[`convex-hull-4d`, rest.class]}
  class:dragover={interactions.drag_over}
  style={`${style}; ${rest.style ?? ``}`}
  data-has-selection={selected_entry !== null}
  data-has-hover={interactions.hover_data !== null}
  data-is-dragging={interactions.is_dragging}
  data-rotation-x={camera.rotation_x.toFixed(4)}
  data-rotation-y={camera.rotation_y.toFixed(4)}
  bind:this={wrapper}
  role="application"
  tabindex="-1"
  {...interactions.wrapper_handlers}
  aria-label="Convex hull visualization"
>
  {@render children?.({
    stable_entries,
    unstable_entries,
    highlighted_entries,
    selected_entry,
  })}
  <h3 style="position: absolute; left: 1em; top: 1ex; margin: 0">
    {@html sanitize_html(merged_controls.title || phase_stats?.chemical_system || ``)}
  </h3>

  <canvas
    bind:this={canvas}
    tabindex="0"
    aria-label={merged_controls.title || phase_stats?.chemical_system || `4D Convex Hull`}
    {...interactions.canvas_handlers}
  ></canvas>

  {#if entries.length === 0}
    <Spinner
      text="Loading data..."
      style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center"
    />
  {/if}

  <!-- Energy above hull Color Bar -->
  {#if color_mode === `energy` && plot_entries.length > 0}
    <ColorBar
      title="Energy above hull (eV/atom)"
      range={helpers.hull_distance_range(plot_entries)}
      {color_scale}
      wrapper_style="position: absolute; bottom: 2em; left: 1em; width: 200px;"
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

  {#if hull_data.has_temp_data && temperature !== undefined}
    <TemperatureSlider
      available_temperatures={hull_data.available_temperatures}
      bind:temperature
    />
  {/if}

  {#if hull_data.gas_analysis.has_gas_dependent_elements && merged_gas_config}
    <GasPressureControls
      config={merged_gas_config}
      bind:pressures={gas_pressures}
      temperature={temperature ?? 300}
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
</style>
