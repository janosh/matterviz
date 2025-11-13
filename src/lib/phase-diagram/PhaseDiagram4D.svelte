<script lang="ts">
  import type { AnyStructure } from '$lib'
  import { Icon, PD_DEFAULTS, toggle_fullscreen } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { contrast_color } from '$lib/colors'
  import { ClickFeedback, DragOverlay } from '$lib/feedback'
  import { ColorBar } from '$lib/plot'
  import {
    barycentric_to_tetrahedral,
    compute_4d_coords,
    TETRAHEDRON_VERTICES,
  } from './barycentric-coords'
  import * as helpers from './helpers'
  import type { BasePhaseDiagramProps, Hull3DProps } from './index'
  import { default_controls, default_pd_config, PD_STYLE } from './index'
  import PhaseDiagramControls from './PhaseDiagramControls.svelte'
  import PhaseDiagramInfoPane from './PhaseDiagramInfoPane.svelte'
  import PhaseEntryTooltip from './PhaseEntryTooltip.svelte'
  import StructurePopup from './StructurePopup.svelte'
  import type { Point4D } from './thermodynamics'
  import * as thermo from './thermodynamics'
  import type { HighlightStyle, HoverData3D, PhaseDiagramEntry } from './types'

  let {
    entries,
    controls = {},
    config = {},
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(false),
    enable_fullscreen = true,
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    show_hull_faces = $bindable(true),
    hull_face_opacity = $bindable(0.06),
    color_mode = $bindable(`energy`),
    color_scale = $bindable(`interpolateViridis`),
    info_pane_open = $bindable(false),
    legend_pane_open = $bindable(false),
    max_hull_dist_show_phases = $bindable(0.1), // eV/atom above hull for showing entries
    on_file_drop,
    enable_structure_preview = true,
    energy_source_mode = $bindable(`precomputed`),
    phase_stats = $bindable(null),
    stable_entries = $bindable([]),
    unstable_entries = $bindable([]),
    highlighted_entries = $bindable([]),
    highlight_style = {},
    selected_entry = $bindable(null),
    ...rest
  }: BasePhaseDiagramProps<PhaseDiagramEntry> & Hull3DProps & {
    on_point_hover?: (data: HoverData3D | null) => void
    // Bindable stable and unstable entries - computed internally but exposed for external use
    stable_entries?: PhaseDiagramEntry[]
    unstable_entries?: PhaseDiagramEntry[]
    // Highlighted entries with customizable visual effects
    highlighted_entries?: (string | PhaseDiagramEntry)[] // Array of entry IDs or full entries
    highlight_style?: HighlightStyle
    selected_entry?: PhaseDiagramEntry | null
  } = $props()

  const merged_controls = $derived({ ...default_controls, ...controls })
  const merged_config = $derived({
    ...default_pd_config,
    ...config,
    colors: { ...default_pd_config.colors, ...(config.colors || {}) },
    margin: { t: 60, r: 60, b: 60, l: 60, ...(config.margin || {}) },
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

  // Process phase diagram data with unified PhaseData interface using effective entries
  const processed_entries = $derived(effective_entries)

  const pd_data = $derived(thermo.process_pd_entries(processed_entries))

  const elements = $derived.by(() => {
    if (pd_data.elements.length > 4) {
      console.error(
        `PhaseDiagram4D: Dataset contains ${pd_data.elements.length} elements, but quaternary diagrams require exactly 4. Found: [${
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

      const valid_points = points_4d

      if (valid_points.length < 5) return [] // Need at least 5 points for 4D hull

      return thermo.compute_lower_hull_4d(valid_points)
    } catch (error) {
      console.error(`Error computing 4D hull:`, error)
      return []
    }
  })

  const plot_entries = $derived.by(() => {
    if (elements.length !== 4) return []

    try {
      const coords = compute_4d_coords(pd_data.entries, elements)

      // Compute or use precomputed hull distances
      const enriched = (() => {
        if (energy_mode === `on-the-fly` && hull_4d.length > 0) {
          // Build 4D points for distance calculation using barycentric coordinates
          // Track indices to map hull distances back to original coords
          const valid_entries: Array<{ entry: PhaseDiagramEntry; orig_idx: number }> =
            []
          coords.forEach((ent, idx) => {
            if (
              Number.isFinite(ent.e_form_per_atom) &&
              [ent.x, ent.y, ent.z].every(Number.isFinite)
            ) valid_entries.push({ entry: ent, orig_idx: idx })
          })

          const points_4d: Point4D[] = valid_entries
            .map(({ entry }) => {
              const amounts = elements.map((el) => entry.composition[el] || 0)
              const total = amounts.reduce((sum, amt) => sum + amt, 0)
              if (!(total > 0)) return { x: NaN, y: NaN, z: NaN, w: NaN }
              const [x, y, z] = amounts.map((amt) => amt / total)
              return { x, y, z, w: entry.e_form_per_atom! }
            })
            .filter((p) => [p.x, p.y, p.z, p.w].every(Number.isFinite))

          const e_hulls = thermo.compute_e_above_hull_4d(points_4d, hull_4d)

          // Map hull distances back to all coords
          return coords.map((entry, idx) => {
            const valid_idx = valid_entries.findIndex((v) => v.orig_idx === idx)
            return {
              ...entry,
              e_above_hull: valid_idx >= 0 ? e_hulls[valid_idx] : undefined,
            }
          })
        }
        return coords
      })()

      // Filter by energy threshold and update visibility based on toggles
      const energy_filtered = enriched.filter((entry: PhaseDiagramEntry) => {
        // Handle elemental entries specially
        if (entry.is_element) {
          // Always include reference elemental entries (corner points of tetrahedron)
          if (entry.e_above_hull === 0 || entry.is_stable) return true
          // Include other elemental polymorphs only if toggle is enabled AND e_above_hull is defined
          return typeof entry.e_above_hull === `number` &&
            entry.e_above_hull <= max_hull_dist_show_phases
        }
        // Include stable entries (treat near-zero as stable)
        if (
          entry.is_stable ||
          (entry.e_above_hull !== undefined && entry.e_above_hull <= 1e-6)
        ) return true
        // Include unstable entries within threshold
        return typeof entry.e_above_hull === `number` &&
          entry.e_above_hull <= max_hull_dist_show_phases
      })
      return energy_filtered
        .map((entry: PhaseDiagramEntry) => {
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

  // Stable and unstable entries exposed as bindable props
  $effect(() => {
    stable_entries = plot_entries.filter((entry: PhaseDiagramEntry) =>
      entry.is_stable || entry.e_above_hull === 0
    )
    unstable_entries = plot_entries.filter((entry: PhaseDiagramEntry) =>
      (entry.e_above_hull ?? 0) > 0 && !entry.is_stable
    )
  })

  let canvas: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null
  let frame_id = 0 // Performance optimization

  // Camera state - following Materials Project's 3D camera setup
  let camera = $state({
    rotation_x: PD_DEFAULTS.quaternary.camera_rotation_x,
    rotation_y: PD_DEFAULTS.quaternary.camera_rotation_y,
    zoom: PD_DEFAULTS.quaternary.camera_zoom,
    center_x: 0,
    center_y: 20, // Slight offset to avoid legend overlap
  })

  // Interaction state
  let is_dragging = $state(false)
  let drag_started = $state(false)
  let last_mouse = $state({ x: 0, y: 0 })
  let hover_data = $state<HoverData3D | null>(null)
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
  const is_highlighted = (entry: PhaseDiagramEntry): boolean =>
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
    [show_stable, show_unstable, show_hull_faces, color_mode, color_scale, max_hull_dist_show_phases, camera.rotation_x, camera.rotation_y, camera.zoom, camera.center_x, camera.center_y, plot_entries, hull_face_color, hull_face_opacity]

    render_once()
  })

  // Visibility toggles are now bindable props

  // Label controls with smart defaults based on entry count
  let show_stable_labels = $state(true)
  let show_unstable_labels = $state(false)
  let max_hull_dist_show_labels = $state(0.1) // eV/atom above hull for showing labels

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
    entry: PhaseDiagramEntry,
  ): AnyStructure | null {
    const orig_entry = entries.find((ent) => ent.entry_id === entry.entry_id)
    return orig_entry?.structure as AnyStructure || null
  }

  const reset_camera = () => {
    camera.rotation_x = PD_DEFAULTS.quaternary.camera_rotation_x
    camera.rotation_y = PD_DEFAULTS.quaternary.camera_rotation_y
    camera.zoom = PD_DEFAULTS.quaternary.camera_zoom
    camera.center_x = 0
    camera.center_y = 20 // Slight offset to avoid legend overlap
  }
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
    max_hull_dist_show_phases = PD_DEFAULTS.quaternary.max_hull_dist_show_phases
    max_hull_dist_show_labels = PD_DEFAULTS.quaternary.max_hull_dist_show_labels
    show_hull_faces = PD_DEFAULTS.quaternary.show_hull_faces
    hull_face_color = PD_DEFAULTS.quaternary.hull_face_color
    hull_face_opacity = PD_DEFAULTS.quaternary.hull_face_opacity
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

  async function copy_entry_data(
    entry: PhaseDiagramEntry,
    position: { x: number; y: number },
  ) {
    await helpers.copy_entry_to_clipboard(entry, position, (visible, pos) => {
      copy_feedback.visible = visible
      copy_feedback.position = pos
    })
  }

  const get_point_color = (entry: PhaseDiagramEntry): string =>
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
    phase_stats = thermo.get_phase_diagram_stats(processed_entries, elements, 4)
  })

  // Utility: convert hex color to rgba string with alpha
  function hex_to_rgba(hex: string, alpha: number): string {
    const normalized = hex.trim()
    const match = normalized.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    if (!match) return `rgba(0,0,0,${alpha})`
    const r = parseInt(match[1], 16)
    const g = parseInt(match[2], 16)
    const b = parseInt(match[3], 16)
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
  }

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

      ctx.fillStyle = styles.getPropertyValue(`--pd-text-color`) || `#212121`
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
        {
          x: number
          y: number
          depth: number
        },
      ]
      avg_depth: number
      avg_w: number // Average formation energy for coloring
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
        })
      }
    }

    // Sort by depth (back to front)
    triangles.sort((a, b) => a.avg_depth - b.avg_depth)

    // Determine alpha based on formation energy (more negative = more opaque)
    // Scale by user-controlled opacity
    const formation_energies = plot_entries.map((e) => e.e_form_per_atom ?? 0)
    const min_fe = Math.min(0, ...formation_energies)

    const norm_alpha = (w: number) => {
      const t = Math.max(0, Math.min(1, (0 - w) / Math.max(1e-6, 0 - min_fe)))
      // Use user-controlled opacity as the maximum
      return t * hull_face_opacity
    }

    // Draw each triangle
    for (const tri of triangles) {
      const [v0, v1, v2] = tri.vertices
      const alpha = norm_alpha(tri.avg_w)

      ctx.save()
      ctx.beginPath()
      ctx.moveTo(v0.x, v0.y)
      ctx.lineTo(v1.x, v1.y)
      ctx.lineTo(v2.x, v2.y)
      ctx.closePath()

      ctx.fillStyle = hex_to_rgba(hull_face_color, alpha)
      ctx.fill()

      // Edge lines more pronounced with higher opacity and thicker width
      ctx.strokeStyle = hex_to_rgba(
        hull_face_color,
        Math.min(0.4, hull_face_opacity * 4),
      )
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }
  }

  function draw_data_points(): void {
    if (!ctx || plot_entries.length === 0) return
    const styles = getComputedStyle(canvas)

    // Collect all points with depth for sorting
    const points_with_depth: {
      entry: PhaseDiagramEntry
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

      // Draw highlight for highlighted entries
      const is_entry_highlighted = is_highlighted(entry)
      if (is_entry_highlighted) {
        helpers.draw_highlight_effect(
          ctx,
          projected,
          size,
          container_scale,
          pulse_time,
          merged_highlight_style,
        )
      }

      // Draw main point with outline
      const point_color =
        is_entry_highlighted && merged_highlight_style.effect === `color`
          ? merged_highlight_style.color
          : color
      ctx.fillStyle = point_color
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
          (entry.e_above_hull ?? 0) <= max_hull_dist_show_labels)
      )

      if (should_show_label) {
        ctx.fillStyle = styles.getPropertyValue(`--pd-text-color`) || `#212121`

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

    // Draw convex hull faces (before points so they appear behind)
    draw_convex_hull_faces()

    // Draw data points (on top)
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

    // Mark as drag if any movement occurred
    if (dx !== 0 || dy !== 0) drag_started = true

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

  const find_entry_at_mouse = (event: MouseEvent): PhaseDiagramEntry | null =>
    helpers.find_pd_entry_at_mouse(
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
    if (container) resize_observer.observe(container)

    return () => { // Cleanup on unmount
      if (frame_id) cancelAnimationFrame(frame_id)
      resize_observer.disconnect()
    }
  })

  // Fullscreen handling with camera reset
  let was_fullscreen = $state(fullscreen)
  $effect(() => {
    helpers.setup_fullscreen_effect(fullscreen, wrapper, (entering_fullscreen) => {
      if (entering_fullscreen !== was_fullscreen) {
        camera.center_x = 0
        camera.center_y = 20
        was_fullscreen = entering_fullscreen
      }
    })
    helpers.set_fullscreen_bg(wrapper, fullscreen, `--pd-4d-bg-fullscreen`)
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
  onmouseup={() => is_dragging = false}
/>

<div
  {...rest}
  class="phase-diagram-4d {rest.class ?? ``}"
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
    <div
      class="tooltip"
      style:left="{position.x + 10}px;"
      style:top="{position.y - 10}px;"
      style:z-index={PD_STYLE.z_index.tooltip}
      style:background={get_point_color(entry)}
      {@attach contrast_color({ luminance_threshold: 0.49 })}
    >
      <PhaseEntryTooltip {entry} all_entries={entries} />
    </div>
  {/if}

  <!-- Click feedback notification -->
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
  .phase-diagram-4d {
    position: relative;
    container-type: size; /* enable cqh/cqw for responsive sizing */
    width: 100%;
    height: var(--pd-height, 500px);
    background: var(--pd-4d-bg, var(--pd-bg));
    border-radius: 4px;
  }
  .phase-diagram-4d:fullscreen {
    border-radius: 0;
    background: var(--pd-4d-bg-fullscreen, var(--pd-4d-bg, var(--pd-bg)));
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
    display: flex;
    font-size: clamp(1em, 2cqmin, 2.5em);
  }
  .control-buttons button:hover {
    background: var(--pane-btn-bg-hover, rgba(255, 255, 255, 0.2));
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
</style>
