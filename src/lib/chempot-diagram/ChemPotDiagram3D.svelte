<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { get_hill_formula } from '$lib/composition/format'
  import { extract_formula_elements } from '$lib/composition/parse'
  import type { PhaseData } from '$lib/convex-hull/types'
  import Icon from '$lib/Icon.svelte'
  import { set_fullscreen_bg, SettingsSection, toggle_fullscreen } from '$lib/layout'
  import { format_num } from '$lib/labels'
  import { convex_hull_2d, type Vec2 } from '$lib/math'
  import { ColorBar, ScatterPlot3DControls } from '$lib/plot'
  import type {
    AxisConfig3D,
    CameraProjection3D,
    DataSeries3D,
    DisplayConfig3D,
  } from '$lib/plot/types'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { Canvas, T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import ChemPotScene3D from './ChemPotScene3D.svelte'
  import { scaleLinear, scaleSequential } from 'd3-scale'
  import * as d3_sc from 'd3-scale-chromatic'
  import { onDestroy, onMount } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import * as THREE from 'three'
  import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
  import {
    apply_element_padding,
    build_axis_ranges,
    compute_chempot_diagram,
    dedup_points,
    formula_key_from_composition,
    get_3d_domain_simplexes_and_ann_loc,
    get_energy_per_atom,
    pad_domain_points,
  } from './compute'
  import { CHEMPOT_DEFAULTS } from './types'
  import type {
    ChemPotColorMode,
    ChemPotDiagramConfig,
    ChemPotHoverInfo,
    ChemPotHoverInfo3D,
  } from './types'

  let {
    entries = [],
    config = {},
    width = $bindable(800),
    height = $bindable(600),
    hover_info = $bindable<ChemPotHoverInfo | null>(null),
    render_local_tooltip = true,
  }: {
    entries: PhaseData[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
    hover_info?: ChemPotHoverInfo | null
    render_local_tooltip?: boolean
  } = $props()

  let formal_chempots_override = $state<boolean | null>(null)
  let label_stable_override = $state<boolean | null>(null)
  let element_padding_override = $state<number | null>(null)
  let default_min_limit_override = $state<number | null>(null)
  let draw_formula_meshes_override = $state<boolean | null>(null)
  let draw_formula_lines_override = $state<boolean | null>(null)
  const formal_chempots = $derived(
    formal_chempots_override ??
      (config.formal_chempots ?? CHEMPOT_DEFAULTS.formal_chempots),
  )
  const label_stable = $derived(
    label_stable_override ?? (config.label_stable ?? CHEMPOT_DEFAULTS.label_stable),
  )
  const element_padding = $derived(
    element_padding_override ??
      (config.element_padding ?? CHEMPOT_DEFAULTS.element_padding),
  )
  const default_min_limit = $derived(
    default_min_limit_override ??
      (config.default_min_limit ?? CHEMPOT_DEFAULTS.default_min_limit),
  )
  const formulas_to_draw = $derived(config.formulas_to_draw ?? [])
  const draw_formula_meshes = $derived(
    draw_formula_meshes_override ??
      (config.draw_formula_meshes ?? CHEMPOT_DEFAULTS.draw_formula_meshes),
  )
  const draw_formula_lines = $derived(
    draw_formula_lines_override ??
      (config.draw_formula_lines ?? CHEMPOT_DEFAULTS.draw_formula_lines),
  )
  let color_mode_override = $state<ChemPotColorMode | null>(null)
  let color_scale_override = $state<D3InterpolateName | null>(null)
  const color_mode = $derived(
    color_mode_override ?? (config.color_mode ?? CHEMPOT_DEFAULTS.color_mode),
  )
  const color_scale = $derived(
    color_scale_override ?? (config.color_scale ?? CHEMPOT_DEFAULTS.color_scale),
  )
  const show_tooltip = $derived(config.show_tooltip ?? CHEMPOT_DEFAULTS.show_tooltip)
  const tooltip_detail_level = $derived(
    config.tooltip_detail_level ?? CHEMPOT_DEFAULTS.tooltip_detail_level,
  )
  const formula_colors = $derived(
    config.formula_colors?.length
      ? config.formula_colors
      : CHEMPOT_DEFAULTS.formula_colors,
  )
  const effective_config = $derived({
    ...config,
    formal_chempots,
    label_stable,
    element_padding,
    default_min_limit,
    draw_formula_meshes,
    draw_formula_lines,
  })

  let wrapper = $state<HTMLDivElement>()
  let fullscreen = $state(false)
  let export_pane_open = $state(false)
  let copy_status = $state(false)
  let copy_timeout_id: ReturnType<typeof setTimeout> | null = null
  let container_width = $state(0)
  let container_height = $state(0)
  const base_aspect_ratio = $derived(height > 0 && width > 0 ? height / width : 1)
  const render_width = $derived(container_width > 0 ? container_width : width)
  const render_height = $derived(
    fullscreen
      ? (container_height > 0 ? container_height : height)
      : Math.round(render_width * base_aspect_ratio),
  )

  let mounted = $state(false)
  onMount(() => mounted = true)
  type OrbitControlsLike = {
    object: THREE.Camera
    target?: THREE.Vector3
    update?: () => void
    addEventListener: (event_name: string, callback: () => void) => void
    removeEventListener: (event_name: string, callback: () => void) => void
  }
  let orbit_controls_ref = $state<OrbitControlsLike | null>(null)
  // Backside tracking: axes/ticks/labels render on the far side from the camera
  // back[i] = backside data coordinate value for data axis i
  // Matches ScatterPlot3DScene pattern where pos tracks the opposite side from camera
  let back = $state([0, 0, 0])
  // Outward offset signs for tick/label placement (away from bounding box)
  let out_x = $state(-1) // sign for Three.js X (data axis 1) direction
  let out_y = $state(-1) // sign for Three.js Y (data axis 2) direction
  let camera_projection = $state<CameraProjection3D>(`orthographic`)
  let auto_rotate = $state(0)
  let display = $state<DisplayConfig3D>({
    show_axes: true,
    show_grid: true,
    show_axis_labels: true,
    show_bounding_box: false,
    projections: { xy: false, xz: false, yz: false },
    projection_opacity: 0.15,
    projection_scale: 0.5,
  })
  let x_axis = $state<AxisConfig3D>({ label: ``, range: [null, null] })
  let y_axis = $state<AxisConfig3D>({ label: ``, range: [null, null] })
  let z_axis = $state<AxisConfig3D>({ label: ``, range: [null, null] })

  // Plotly/pymatgen uses Z-up with x-axis projecting left in isometric view.
  // Three.js uses Y-up with X projecting right. To match pymatgen's visual layout:
  //   data[0] (plotly x, projects left)  → Three.js Z (projects left)
  //   data[1] (plotly y, projects right) → Three.js X (projects right)
  //   data[2] (plotly z, projects up)    → Three.js Y (projects up)
  function to_vec3(pt: number[]): THREE.Vector3 {
    return new THREE.Vector3(pt[1], pt[2], pt[0])
  }

  // Compute diagram data (requires >= 3 elements for 3D rendering)
  const diagram_data = $derived.by(() => {
    if (entries.length < 3) return null
    try {
      const data = compute_chempot_diagram(entries, effective_config)
      return data.elements.length >= 3 ? data : null
    } catch (err) {
      console.error(`ChemPotDiagram3D:`, err)
      return null
    }
  })

  const plot_elements = $derived(diagram_data?.elements.slice(0, 3) ?? [])
  const all_entry_elements = $derived.by(() =>
    Array.from(
      new SvelteSet(
        entries.flatMap((entry) =>
          Object.entries(entry.composition)
            .filter(([, amount]) => amount > 0)
            .map(([element]) => element)
        ),
      ),
    )
  )
  const is_projection_mode = $derived(
    plot_elements.length > 0 &&
      plot_elements.length < all_entry_elements.length &&
      plot_elements.every((element) => all_entry_elements.includes(element)),
  )

  // Process domains for rendering
  interface DomainRenderData {
    formula: string
    points_3d: number[][]
    ann_loc: number[]
    is_draw_formula: boolean
  }

  interface HoverMeshData {
    formula: string
    geometry: THREE.BufferGeometry
    info: ChemPotHoverInfo3D
  }

  interface FormulaEnergyStats {
    matching_entry_count: number
    min_energy_per_atom: number | null
    max_energy_per_atom: number | null
  }

  const render_domains = $derived.by((): DomainRenderData[] => {
    if (!diagram_data || plot_elements.length < 2) return []

    const dim = diagram_data.elements.length
    const indices = Array.from({ length: dim }, (_, idx) => idx)
    const new_lims = element_padding > 0
      ? apply_element_padding(
        diagram_data.domains,
        indices,
        element_padding,
        default_min_limit,
      )
      : null

    const result: DomainRenderData[] = []
    for (const [formula, pts] of Object.entries(diagram_data.domains)) {
      const padded = new_lims
        ? pad_domain_points(
          pts,
          indices,
          new_lims,
          default_min_limit,
          element_padding,
        )
        : pts
      if (padded.length < 2) continue
      const is_draw = formulas_to_draw.includes(formula)
      if (padded.length >= 3) {
        const { ann_loc } = get_3d_domain_simplexes_and_ann_loc(padded)
        result.push({ formula, points_3d: padded, ann_loc, is_draw_formula: is_draw })
      } else {
        const ann_loc = padded[0].map((_, col) =>
          padded.reduce((s, p) => s + p[col], 0) / padded.length
        )
        result.push({ formula, points_3d: padded, ann_loc, is_draw_formula: is_draw })
      }
    }
    return result
  })

  const entry_energy_stats_by_formula = $derived.by(
    (): SvelteMap<string, FormulaEnergyStats> => {
      const stats_by_formula = new SvelteMap<string, FormulaEnergyStats>()
      for (const entry of entries) {
        const formula_key = formula_key_from_composition(entry.composition)
        const energy_per_atom = get_energy_per_atom(entry)
        const existing = stats_by_formula.get(formula_key)
        if (!existing) {
          stats_by_formula.set(formula_key, {
            matching_entry_count: 1,
            min_energy_per_atom: energy_per_atom,
            max_energy_per_atom: energy_per_atom,
          })
          continue
        }
        stats_by_formula.set(formula_key, {
          matching_entry_count: existing.matching_entry_count + 1,
          min_energy_per_atom: Math.min(
            existing.min_energy_per_atom ?? energy_per_atom,
            energy_per_atom,
          ),
          max_energy_per_atom: Math.max(
            existing.max_energy_per_atom ?? energy_per_atom,
            energy_per_atom,
          ),
        })
      }
      return stats_by_formula
    },
  )

  // === Region coloring ===
  // Categorical palette for arity mode (element count)
  const arity_colors = [`#3498db`, `#2ecc71`, `#e67e22`, `#9b59b6`] as const

  // Find min and max of a numeric array (single pass, no allocation)
  function find_min_max(values: number[]): { min: number; max: number } | null {
    if (values.length === 0) return null
    let min = values[0], max = values[0]
    for (let idx = 1; idx < values.length; idx++) {
      if (values[idx] < min) min = values[idx]
      if (values[idx] > max) max = values[idx]
    }
    return { min, max }
  }

  // Build a sequential color scale from a D3 interpolator name
  function make_color_scale(
    values: number[],
    interpolator_name: D3InterpolateName,
  ): ((val: number) => string) | null {
    const finite = values.filter(Number.isFinite)
    const range = find_min_max(finite)
    if (!range) return null
    const interp = (d3_sc as unknown as Record<string, (t: number) => string>)[
      interpolator_name
    ] ??
      d3_sc.interpolateViridis
    return scaleSequential(interp).domain([
      range.min,
      Math.max(range.max, range.min + 1e-6),
    ])
  }

  // Per-domain color map keyed by formula
  const domain_colors = $derived.by((): SvelteMap<string, string> => {
    const colors = new SvelteMap<string, string>()
    if (color_mode === `none`) return colors

    if (color_mode === `arity`) {
      for (const domain of render_domains) {
        const n_elements = extract_formula_elements(domain.formula).length
        const idx = Math.min(n_elements, arity_colors.length) - 1
        colors.set(domain.formula, arity_colors[Math.max(0, idx)])
      }
      return colors
    }

    if (color_mode === `energy`) {
      const values: number[] = []
      const val_by_formula = new SvelteMap<string, number>()
      for (const domain of render_domains) {
        const stats = entry_energy_stats_by_formula.get(domain.formula)
        if (stats?.min_energy_per_atom != null) {
          values.push(stats.min_energy_per_atom)
          val_by_formula.set(domain.formula, stats.min_energy_per_atom)
        }
      }
      const scale = make_color_scale(values, color_scale)
      for (const domain of render_domains) {
        const val = val_by_formula.get(domain.formula)
        colors.set(domain.formula, val != null && scale ? scale(val) : `#999`)
      }
      return colors
    }

    if (color_mode === `formation_energy`) {
      const values: number[] = []
      const val_by_formula = new SvelteMap<string, number>()
      for (const domain of render_domains) {
        const formula_key = domain.formula
        // Find the minimum-energy entry matching this formula
        let best_e_form: number | undefined
        for (const entry of entries) {
          if (formula_key_from_composition(entry.composition) !== formula_key) {
            continue
          }
          if (entry.e_form_per_atom != null) {
            if (best_e_form === undefined || entry.e_form_per_atom < best_e_form) {
              best_e_form = entry.e_form_per_atom
            }
          }
        }
        if (best_e_form != null) {
          values.push(best_e_form)
          val_by_formula.set(formula_key, best_e_form)
        }
      }
      const scale = make_color_scale(values, color_scale)
      for (const domain of render_domains) {
        const val = val_by_formula.get(domain.formula)
        colors.set(domain.formula, val != null && scale ? scale(val) : `#999`)
      }
      return colors
    }

    if (color_mode === `entries`) {
      const values: number[] = []
      const val_by_formula = new SvelteMap<string, number>()
      for (const domain of render_domains) {
        const stats = entry_energy_stats_by_formula.get(domain.formula)
        const count = stats?.matching_entry_count ?? 0
        values.push(count)
        val_by_formula.set(domain.formula, count)
      }
      const scale = make_color_scale(values, color_scale)
      for (const domain of render_domains) {
        const val = val_by_formula.get(domain.formula) ?? 0
        colors.set(domain.formula, scale ? scale(val) : `#999`)
      }
      return colors
    }

    return colors
  })

  // Range and label for the color bar (null for none/arity which are categorical)
  const color_range = $derived.by(
    (): { min: number; max: number; label: string } | null => {
      if (color_mode === `none` || color_mode === `arity`) return null
      const values: number[] = []
      for (const domain of render_domains) {
        if (color_mode === `energy`) {
          const stats = entry_energy_stats_by_formula.get(domain.formula)
          if (stats?.min_energy_per_atom != null) {
            values.push(stats.min_energy_per_atom)
          }
        } else if (color_mode === `formation_energy`) {
          for (const entry of entries) {
            if (
              formula_key_from_composition(entry.composition) === domain.formula &&
              entry.e_form_per_atom != null
            ) {
              values.push(entry.e_form_per_atom)
              break
            }
          }
        } else if (color_mode === `entries`) {
          const stats = entry_energy_stats_by_formula.get(domain.formula)
          if (stats) values.push(stats.matching_entry_count)
        }
      }
      const range = find_min_max(values)
      if (!range) return null
      const labels: Record<string, string> = {
        energy: `Energy per atom (eV)`,
        formation_energy: `Formation energy (eV/atom)`,
        entries: `Entry count`,
      }
      return {
        min: range.min,
        max: Math.max(range.max, range.min + 1e-6),
        label: labels[color_mode] ?? ``,
      }
    },
  )

  // Compute data center and extent for camera positioning (in swizzled coords)
  const { data_center, data_extent } = $derived.by(() => {
    const pts = render_domains.flatMap((domain) => domain.points_3d)
    if (pts.length === 0) {
      return { data_center: new THREE.Vector3(0, 0, 0), data_extent: 10 }
    }
    // Compute center (swizzled: data[1]→X, data[2]→Y, data[0]→Z)
    let [sx, sy, sz] = [0, 0, 0]
    for (const pt of pts) {
      sx += pt[1]
      sy += pt[2]
      sz += pt[0]
    }
    const n = pts.length
    const center = new THREE.Vector3(sx / n, sy / n, sz / n)
    // Compute max distance from center
    let max_dist = 0
    for (const pt of pts) {
      const dist = Math.hypot(pt[1] - center.x, pt[2] - center.y, pt[0] - center.z)
      if (dist > max_dist) max_dist = dist
    }
    return { data_center: center, data_extent: Math.max(max_dist * 1.3, 1) }
  })

  // Compute domain boundary edges via axis-aligned 2D convex hull projection.
  // Each domain in a chem pot diagram is a convex polygon/polyhedron. We project
  // to 2D (trying all 3 axis-aligned planes) and use the best projection's
  // convex hull boundary. This reliably handles both flat and 3D domains.
  function get_domain_edges(
    pts: number[][],
  ): [number[], number[]][] {
    const unique = dedup_3d(pts)
    if (unique.length < 2) return []
    if (unique.length === 2) return [[unique[0], unique[1]]]
    if (unique.length === 3) {
      return [[unique[0], unique[1]], [unique[1], unique[2]], [unique[0], unique[2]]]
    }
    return get_2d_hull_edges(unique)
  }

  function polygon_area_2d(points_2d: Vec2[]): number {
    if (points_2d.length < 3) return 0
    let area_twice = 0
    for (let idx = 0; idx < points_2d.length; idx++) {
      const current = points_2d[idx]
      const next = points_2d[(idx + 1) % points_2d.length]
      area_twice += current[0] * next[1] - next[0] * current[1]
    }
    return Math.abs(area_twice) / 2
  }

  // Compute domain edges from the single best axis-aligned projection
  // (largest non-degenerate hull area). Unioning multiple projections can add
  // non-physical diagonals for nearly coplanar domains.
  // Called only from get_domain_edges with 4+ unique points
  function get_2d_hull_edges(
    pts: number[][],
  ): [number[], number[]][] {
    let selected_hull: Vec2[] = []
    let selected_coord_to_idx: SvelteMap<string, number> | null = null
    let selected_hull_area = -1

    for (const drop of [0, 1, 2]) {
      const axes = [0, 1, 2].filter((ax) => ax !== drop)

      // Skip this projection if points collapse to a line (near-zero range in
      // either projected axis). This avoids spurious edges from edge-on views.
      let min0 = Infinity, max0 = -Infinity, min1 = Infinity, max1 = -Infinity
      for (const pt of pts) {
        const v0 = pt[axes[0]], v1 = pt[axes[1]]
        if (v0 < min0) min0 = v0
        if (v0 > max0) max0 = v0
        if (v1 < min1) min1 = v1
        if (v1 > max1) max1 = v1
      }
      const range0 = max0 - min0, range1 = max1 - min1
      const max_2d_range = Math.max(range0, range1)
      if (max_2d_range < 1e-6 || Math.min(range0, range1) < max_2d_range * 0.01) {
        continue
      }

      // Build coordinate lookup for this projection
      const coord_to_idx = new SvelteMap<string, number>()
      const pts_2d: Vec2[] = []
      for (let idx = 0; idx < pts.length; idx++) {
        const p2 = [pts[idx][axes[0]], pts[idx][axes[1]]] as Vec2
        pts_2d.push(p2)
        const key = `${p2[0].toFixed(6)},${p2[1].toFixed(6)}`
        if (!coord_to_idx.has(key)) coord_to_idx.set(key, idx)
      }

      const hull = convex_hull_2d(pts_2d)
      if (hull.length < 3) continue
      const hull_area = polygon_area_2d(hull)
      if (hull_area <= selected_hull_area) continue
      selected_hull = hull
      selected_coord_to_idx = coord_to_idx
      selected_hull_area = hull_area
    }

    if (!selected_coord_to_idx || selected_hull.length < 3) return []

    const edges: [number[], number[]][] = []
    for (let idx = 0; idx < selected_hull.length; idx++) {
      const point_a = selected_hull[idx]
      const point_b = selected_hull[(idx + 1) % selected_hull.length]
      const point_a_idx = selected_coord_to_idx.get(
        `${point_a[0].toFixed(6)},${point_a[1].toFixed(6)}`,
      )
      const point_b_idx = selected_coord_to_idx.get(
        `${point_b[0].toFixed(6)},${point_b[1].toFixed(6)}`,
      )
      if (
        point_a_idx == null || point_b_idx == null || point_a_idx >= pts.length ||
        point_b_idx >= pts.length
      ) {
        console.warn(`get_2d_hull_edges: invalid edge`, {
          point_a,
          point_b,
          point_a_idx,
          point_b_idx,
        })
        continue
      }
      edges.push([pts[point_a_idx], pts[point_b_idx]])
    }

    return edges
  }

  // Build globally deduplicated edge geometry for domain boundaries using
  // 3D convex hull crease edges (not 2D projected hull).
  const edge_geometry = $derived.by(() => {
    if (is_projection_mode) {
      const all_points = render_domains
        .filter((domain) => !domain.is_draw_formula)
        .flatMap((domain) => domain.points_3d)
      const unique_points = dedup_3d(all_points)
      if (unique_points.length >= 4) {
        try {
          const hull_vectors = unique_points.map((point) => to_vec3(point))
          const hull_geometry = new ConvexGeometry(hull_vectors)
          const hull_edges = new THREE.EdgesGeometry(hull_geometry)
          hull_geometry.dispose()
          return hull_edges
        } catch {
          // Fall back to per-domain edges below.
        }
      }
    }

    const seen = new SvelteSet<string>()
    const positions: number[] = []
    for (const domain of render_domains) {
      if (domain.is_draw_formula) continue
      // Compute edges in swizzled (Three.js) coords since ConvexGeometry works there
      const swizzled = domain.points_3d.map((pt) => [pt[1], pt[2], pt[0]])
      for (const [pa, pb] of get_domain_edges(swizzled)) {
        const ka = pa.map((val) => val.toFixed(4)).join(`,`)
        const kb = pb.map((val) => val.toFixed(4)).join(`,`)
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
        if (seen.has(key)) continue
        seen.add(key)
        positions.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2])
      }
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(`position`, new THREE.Float32BufferAttribute(positions, 3))
    return geom
  })

  // Build a single opaque convex hull mesh from ALL domain vertices for depth
  // occlusion. This seamless surface writes to the depth buffer, hiding wireframe
  // edges on the back side. Using all vertices together avoids gaps between domains.
  const occlusion_hull_geometry = $derived.by((): THREE.BufferGeometry | null => {
    const all_pts = render_domains
      .filter((domain) => !domain.is_draw_formula)
      .flatMap((domain) => domain.points_3d)
    const unique = dedup_3d(all_pts)
    if (unique.length < 4) return null
    const vectors = unique.map((pt) => to_vec3(pt))
    try {
      return new ConvexGeometry(vectors)
    } catch {
      return null
    }
  })

  // Non-indexed hull geometry (stable — only changes when occlusion hull changes).
  // toNonIndexed gives each triangle its own 3 vertices for flat per-face coloring.
  const hull_base_geometry = $derived.by((): THREE.BufferGeometry | null => {
    if (!occlusion_hull_geometry) return null
    const geom = occlusion_hull_geometry.toNonIndexed()
    const pos = geom.getAttribute(`position`)
    const colors = new Float32Array(pos.count * 3).fill(0.965)
    geom.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3))
    return geom
  })

  // Per-face domain assignment (stable — only changes when geometry or domains change).
  // Uses actual vertex centroid (mean of points_3d) for robust nearest-face matching.
  const face_domain_map = $derived.by((): string[] => {
    if (!hull_base_geometry) return []
    const pos = hull_base_geometry.getAttribute(`position`)
    const n_faces = pos.count / 3

    // Domain vertex centroids in swizzled Three.js coords: data[1]→X, data[2]→Y, data[0]→Z
    const centroids = render_domains
      .filter((domain) => !domain.is_draw_formula && domain.points_3d.length > 0)
      .map((domain) => {
        let sx = 0, sy = 0, sz = 0
        for (const pt of domain.points_3d) {
          sx += pt[1]
          sy += pt[2]
          sz += pt[0]
        }
        const n_pts = domain.points_3d.length
        return {
          formula: domain.formula,
          cx: sx / n_pts,
          cy: sy / n_pts,
          cz: sz / n_pts,
        }
      })

    const result: string[] = []
    for (let face_idx = 0; face_idx < n_faces; face_idx++) {
      const base = face_idx * 3
      const fcx = (pos.getX(base) + pos.getX(base + 1) + pos.getX(base + 2)) / 3
      const fcy = (pos.getY(base) + pos.getY(base + 1) + pos.getY(base + 2)) / 3
      const fcz = (pos.getZ(base) + pos.getZ(base + 1) + pos.getZ(base + 2)) / 3
      let best_formula = ``
      let best_dist = Infinity
      for (const dc of centroids) {
        const dist = (fcx - dc.cx) ** 2 + (fcy - dc.cy) ** 2 + (fcz - dc.cz) ** 2
        if (dist < best_dist) {
          best_dist = dist
          best_formula = dc.formula
        }
      }
      result.push(best_formula)
    }
    return result
  })

  // Reactive color fill: updates vertex colors on the stable hull geometry.
  // Only runs when color_mode or domain_colors change — no geometry re-creation.
  const colored_hull_geometry = $derived.by((): THREE.BufferGeometry | null => {
    const geom = hull_base_geometry
    const mapping = face_domain_map
    if (!geom || mapping.length === 0) return geom

    const color_attr = geom.getAttribute(`color`) as THREE.BufferAttribute
    const use_colors = color_mode !== `none` && domain_colors.size > 0
    const fb = use_colors
      ? [0.91, 0.91, 0.91] // #e8e8e8
      : [0.965, 0.965, 0.965] // #f6f6f6

    // Cache parsed RGB per formula to avoid redundant THREE.Color allocations
    const rgb_cache = new SvelteMap<string, [number, number, number]>()
    for (const [formula, hex] of domain_colors) {
      const clr = new THREE.Color(hex)
      rgb_cache.set(formula, [clr.r, clr.g, clr.b])
    }

    for (let face_idx = 0; face_idx < mapping.length; face_idx++) {
      const rgb = use_colors ? rgb_cache.get(mapping[face_idx]) : null
      const [red, green, blue] = rgb ?? fb
      const base = face_idx * 3
      for (let vi = 0; vi < 3; vi++) color_attr.setXYZ(base + vi, red, green, blue)
    }
    color_attr.needsUpdate = true
    return geom
  })

  $effect(() => {
    const geom = hull_base_geometry
    return () => dispose_geometry(geom)
  })

  // Domains on the outer surface: annotation point NOT strictly inside the hull.
  // Interior domains are hidden behind the surface and shouldn't show labels.
  const surface_formulas = $derived.by((): SvelteSet<string> => {
    const on_surface = new SvelteSet<string>()
    if (!occlusion_hull_geometry) {
      for (const domain of render_domains) on_surface.add(domain.formula)
      return on_surface
    }
    // Raycast from each domain's centroid outward -- if it hits the hull,
    // the centroid is inside (interior domain). Use multiple ray directions
    // and count: if most hit, the point is interior.
    const raycaster = new THREE.Raycaster()
    const hull_mesh = new THREE.Mesh(occlusion_hull_geometry)
    const directions = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, -1),
    ]
    for (const domain of render_domains) {
      if (domain.is_draw_formula) {
        on_surface.add(domain.formula)
        continue
      }
      const origin = to_vec3(domain.ann_loc)
      // Count how many rays hit the hull from the centroid
      let hits = 0
      for (const dir of directions) {
        raycaster.set(origin, dir)
        if (raycaster.intersectObject(hull_mesh).length > 0) hits++
      }
      // If fewer than 4 of 6 rays hit, centroid is on or near the surface
      if (hits < 4) on_surface.add(domain.formula)
    }
    return on_surface
  })

  // Deduplicate 3D points within tolerance (reuses compute.ts dedup_points)
  function dedup_3d(pts: number[][], tol: number = 1e-4): number[][] {
    return dedup_points(pts, tol).unique
  }

  const controls_series = $derived<DataSeries3D[]>([
    {
      x: render_domains.flatMap((domain) =>
        domain.points_3d.map((point) => point[1])
      ),
      y: render_domains.flatMap((domain) =>
        domain.points_3d.map((point) => point[2])
      ),
      z: render_domains.flatMap((domain) =>
        domain.points_3d.map((point) => point[0])
      ),
      label: `domains`,
    },
  ])

  // Build formula overlay edge geometries (per formula, colored) using crease edges
  const formula_edge_data = $derived.by(() => {
    if (!draw_formula_lines || formulas_to_draw.length === 0) return []
    const result: { geometry: THREE.BufferGeometry; color: string }[] = []
    for (const domain of render_domains) {
      if (!domain.is_draw_formula) continue
      const color_idx = formulas_to_draw.indexOf(domain.formula) %
        formula_colors.length
      const swizzled = domain.points_3d.map((pt) => [pt[1], pt[2], pt[0]])
      const positions: number[] = []
      for (const [pa, pb] of get_domain_edges(swizzled)) {
        positions.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2])
      }
      const geom = new THREE.BufferGeometry()
      geom.setAttribute(`position`, new THREE.Float32BufferAttribute(positions, 3))
      result.push({ geometry: geom, color: formula_colors[color_idx] })
    }
    return result
  })

  // Build formula overlay mesh geometries (convex hull surface)
  const formula_mesh_data = $derived.by(() => {
    const result: { geometry: THREE.BufferGeometry; color: string }[] = []
    if (!draw_formula_meshes) return result
    for (const domain of render_domains) {
      if (!domain.is_draw_formula || domain.points_3d.length < 4) continue
      const color_idx = formulas_to_draw.indexOf(domain.formula) %
        formula_colors.length
      const unique = dedup_3d(domain.points_3d)
      if (unique.length < 4) continue
      const vectors = unique.map((pt) => to_vec3(pt))
      try {
        const geom = new ConvexGeometry(vectors)
        result.push({ geometry: geom, color: formula_colors[color_idx] })
      } catch {
        // Degenerate hull, skip
      }
    }
    return result
  })

  function get_touches_limits(
    points_3d: number[][],
    lims: [number, number][],
  ): string[] {
    const limit_tol = 1e-3
    const touches_limits: string[] = []
    for (
      let axis_idx = 0;
      axis_idx < Math.min(plot_elements.length, lims.length);
      axis_idx++
    ) {
      const [axis_min, axis_max] = lims[axis_idx]
      const axis_name = plot_elements[axis_idx] ?? `axis_${axis_idx}`
      const touches_min = points_3d.some((point) =>
        Math.abs(point[axis_idx] - axis_min) < limit_tol
      )
      const touches_max = points_3d.some((point) =>
        Math.abs(point[axis_idx] - axis_max) < limit_tol
      )
      if (touches_min) touches_limits.push(`${axis_name} lower bound`)
      if (touches_max) touches_limits.push(`${axis_name} upper bound`)
    }
    return touches_limits
  }

  function create_hover_geometry(
    points_3d: number[][],
  ): { geometry: THREE.BufferGeometry; n_vertices: number } | null {
    const unique_points = dedup_3d(points_3d)
    if (unique_points.length < 4) return null
    try {
      return {
        geometry: new ConvexGeometry(unique_points.map((point) => to_vec3(point))),
        n_vertices: unique_points.length,
      }
    } catch {
      return null
    }
  }

  const hover_mesh_data = $derived.by((): HoverMeshData[] => {
    if (!diagram_data) return []
    const result: HoverMeshData[] = []
    const lims = diagram_data.lims
    const energy_stats_by_formula = entry_energy_stats_by_formula

    for (const domain of render_domains) {
      if (domain.points_3d.length < 4) continue
      const hover_geometry = create_hover_geometry(domain.points_3d)
      if (!hover_geometry) continue
      const { geometry, n_vertices } = hover_geometry

      const swizzled_points = domain.points_3d.map((pt) => [pt[1], pt[2], pt[0]])
      const edge_count = get_domain_edges(swizzled_points).length
      const axis_ranges = build_axis_ranges(domain.points_3d, plot_elements)
      const touches_limits = get_touches_limits(domain.points_3d, lims)
      const energy_stats = energy_stats_by_formula.get(domain.formula) ?? {
        matching_entry_count: 0,
        min_energy_per_atom: null,
        max_energy_per_atom: null,
      }

      const info: ChemPotHoverInfo3D = {
        formula: domain.formula,
        view: `3d`,
        n_vertices,
        n_edges: edge_count,
        n_points: domain.points_3d.length,
        ann_loc: domain.ann_loc,
        axis_ranges,
        touches_limits,
        is_elemental: all_entry_elements.includes(domain.formula),
        is_draw_formula: domain.is_draw_formula,
        matching_entry_count: energy_stats.matching_entry_count,
        min_energy_per_atom: energy_stats.min_energy_per_atom,
        max_energy_per_atom: energy_stats.max_energy_per_atom,
      }

      result.push({
        formula: domain.formula,
        geometry,
        info,
      })
    }
    return result
  })

  function dispose_geometry(geometry: THREE.BufferGeometry | null | undefined): void {
    if (!geometry) return
    geometry.dispose()
  }

  function dispose_geometries(
    geometries: (THREE.BufferGeometry | null | undefined)[],
  ): void {
    for (const geometry of geometries) dispose_geometry(geometry)
  }

  $effect(() => {
    const geometry = edge_geometry
    return () => dispose_geometry(geometry)
  })

  $effect(() => {
    const geometry = occlusion_hull_geometry
    return () => dispose_geometry(geometry)
  })

  $effect(() => {
    const geometry = bounding_box_geometry
    return () => dispose_geometry(geometry)
  })

  $effect(() => {
    const geometries = formula_edge_data.map((data) => data.geometry)
    return () => dispose_geometries(geometries)
  })

  $effect(() => {
    const geometries = formula_mesh_data.map((data) => data.geometry)
    return () => dispose_geometries(geometries)
  })

  $effect(() => {
    const geometries = hover_mesh_data.map((data) => data.geometry)
    return () => dispose_geometries(geometries)
  })

  // === Grid, axes, ticks (matching ScatterPlot3D style) ===

  // Bounding box of all data points in DATA coordinates (before swizzle)
  const raw_data_bbox = $derived.by(() => {
    const pts = render_domains.flatMap((domain) => domain.points_3d)
    if (pts.length === 0) return { mins: [0, 0, 0], maxs: [1, 1, 1] }
    const mins = [Infinity, Infinity, Infinity]
    const maxs = [-Infinity, -Infinity, -Infinity]
    for (const pt of pts) {
      for (let dim = 0; dim < 3; dim++) {
        if (pt[dim] < mins[dim]) mins[dim] = pt[dim]
        if (pt[dim] > maxs[dim]) maxs[dim] = pt[dim]
      }
    }
    return { mins, maxs }
  })

  // Axis range controls are in swizzled axis order:
  // x-axis control -> data axis 1, y-axis control -> data axis 2, z-axis control -> data axis 0
  const data_bbox = $derived.by(() => {
    const mins = [...raw_data_bbox.mins]
    const maxs = [...raw_data_bbox.maxs]
    const range_by_data_axis: ([number | null, number | null] | undefined)[] = [
      z_axis.range,
      x_axis.range,
      y_axis.range,
    ]
    for (let axis_idx = 0; axis_idx < 3; axis_idx++) {
      const range = range_by_data_axis[axis_idx]
      if (!range) continue
      const [range_min, range_max] = range
      if (range_min !== null) mins[axis_idx] = range_min
      if (range_max !== null) maxs[axis_idx] = range_max
    }
    return { mins, maxs }
  })

  // Generate nice tick values for each data axis using D3
  function gen_ticks(min_val: number, max_val: number, count: number = 5): number[] {
    if (!isFinite(min_val) || !isFinite(max_val) || min_val === max_val) {
      return [min_val]
    }
    return scaleLinear().domain([min_val, max_val]).nice().ticks(count)
  }

  // Ticks in DATA coordinates for each of the 3 data axes
  const data_ticks = $derived([
    gen_ticks(data_bbox.mins[0], data_bbox.maxs[0]),
    gen_ticks(data_bbox.mins[1], data_bbox.maxs[1]),
    gen_ticks(data_bbox.mins[2], data_bbox.maxs[2]),
  ])

  // Niced ranges (from ticks) padded so the grid extends beyond the diagram.
  // For horizontal axes (0,1): pad both sides.
  // For vertical axis (2): use actual data range and round min down to an integer.
  const niced_range = $derived.by(() => {
    return [0, 1, 2].map((axis) => {
      const ticks = data_ticks[axis]
      const lo = ticks[0]
      const hi = ticks.at(-1) ?? lo
      const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1
      if (axis === 2) {
        const min_data = data_bbox.mins[2]
        const max_data = data_bbox.maxs[2]
        return [Math.floor(min_data), max_data] as [number, number]
      }
      return [lo - step, hi + step] as [number, number]
    })
  })

  // Helper to create a line geometry from two Vec3 arrays
  function make_line_geom(
    start: [number, number, number],
    end: [number, number, number],
  ): THREE.BufferGeometry {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(
      `position`,
      new THREE.BufferAttribute(new Float32Array([...start, ...end]), 3),
    )
    return geom
  }

  // Swizzle a data-coord triple to Three.js coords
  function swiz(d0: number, d1: number, d2: number): [number, number, number] {
    return [d1, d2, d0] // data[0]→Z, data[1]→X, data[2]→Y
  }

  const axis_colors = [`#e74c3c`, `#2ecc71`, `#3498db`] as const
  function chem_axis_label(data_axis: number): string {
    return formal_chempots
      ? `\u0394\u03BC(${plot_elements[data_axis]}) (eV)`
      : `\u03BC(${plot_elements[data_axis]}) (eV)`
  }

  // Proportional offsets for tick marks and labels, scaled to data extent
  const tick_size = $derived(data_extent * 0.015)
  const tick_label_dist = $derived(data_extent * 0.04)
  const axis_label_dist = $derived(data_extent * 0.08)

  // Place axis label just past the outer end of the axis (the end closer to 0).
  // In isometric 3D, the end near 0 projects outward at the front edge of the
  // bounding box, while the negative end projects inward toward the center.
  function outer_end(range: [number, number]): number {
    return Math.abs(range[0]) <= Math.abs(range[1]) ? range[0] : range[1]
  }
  // Direction from range center toward outer end (to extend the label beyond the grid)
  function outer_dir(range: [number, number]): number {
    const end = outer_end(range)
    const mid = (range[0] + range[1]) / 2
    return end >= mid ? 1 : -1
  }

  // Grid/axis configuration for each data axis.
  // Axes, ticks, and labels are placed on the backside (far from camera)
  // matching ScatterPlot3DScene's dynamic backside tracking pattern.
  const grid_config = $derived.by(() => {
    const [r0, r1, r2] = niced_range

    return [0, 1, 2].map((axis) => {
      const ticks = data_ticks[axis]
      const color = axis_colors[axis]
      const label = axis === 0
        ? (z_axis.label || chem_axis_label(0))
        : axis === 1
        ? (x_axis.label || chem_axis_label(1))
        : (y_axis.label || chem_axis_label(2))

      const tick_geoms: THREE.BufferGeometry[] = []
      const grid_geoms: THREE.BufferGeometry[] = []
      const tick_labels: { pos: [number, number, number]; text: string }[] = []
      let line_geom: THREE.BufferGeometry
      let label_pos: [number, number, number]

      if (axis === 0) {
        // Data axis 0 (Three.js Z, depth): axis at backside d1 and d2
        const ls = swiz(r0[0], back[1], back[2])
        const le = swiz(r0[1], back[1], back[2])
        line_geom = make_line_geom(ls, le)
        // Axis label past the outer end of the axis (near 0, projects outward)
        label_pos = swiz(
          outer_end(r0) + outer_dir(r0) * axis_label_dist,
          back[1] + out_x * tick_label_dist * 0.5,
          back[2] + out_y * tick_label_dist,
        )
        for (const val of ticks) {
          tick_geoms.push(make_line_geom(
            swiz(val, back[1], back[2]),
            swiz(val, back[1], back[2] + out_y * tick_size),
          ))
          grid_geoms.push(
            make_line_geom(swiz(val, r1[0], back[2]), swiz(val, r1[1], back[2])),
          )
          grid_geoms.push(
            make_line_geom(swiz(val, back[1], r2[0]), swiz(val, back[1], r2[1])),
          )
          tick_labels.push({
            pos: swiz(
              val,
              back[1] + out_x * tick_label_dist * 0.5,
              back[2] + out_y * tick_label_dist,
            ),
            text: format_num(val, `.3~g`),
          })
        }
      } else if (axis === 1) {
        // Data axis 1 (Three.js X, horizontal): axis at backside d0 and d2
        const ls = swiz(back[0], r1[0], back[2])
        const le = swiz(back[0], r1[1], back[2])
        line_geom = make_line_geom(ls, le)
        label_pos = swiz(
          back[0],
          outer_end(r1) + outer_dir(r1) * axis_label_dist,
          back[2] + out_y * tick_label_dist,
        )
        for (const val of ticks) {
          tick_geoms.push(make_line_geom(
            swiz(back[0], val, back[2]),
            swiz(back[0], val, back[2] + out_y * tick_size),
          ))
          grid_geoms.push(
            make_line_geom(swiz(r0[0], val, back[2]), swiz(r0[1], val, back[2])),
          )
          grid_geoms.push(
            make_line_geom(swiz(back[0], val, r2[0]), swiz(back[0], val, r2[1])),
          )
          tick_labels.push({
            pos: swiz(back[0], val, back[2] + out_y * tick_label_dist),
            text: format_num(val, `.3~g`),
          })
        }
      } else {
        // Data axis 2 (Three.js Y, vertical): axis at backside d0 and d1
        const ls = swiz(back[0], back[1], r2[0])
        const le = swiz(back[0], back[1], r2[1])
        line_geom = make_line_geom(ls, le)
        label_pos = swiz(
          back[0],
          back[1] + out_x * tick_label_dist,
          outer_end(r2) + outer_dir(r2) * axis_label_dist,
        )
        for (const val of ticks) {
          tick_geoms.push(make_line_geom(
            swiz(back[0], back[1], val),
            swiz(back[0], back[1] + out_x * tick_size, val),
          ))
          grid_geoms.push(
            make_line_geom(swiz(r0[0], back[1], val), swiz(r0[1], back[1], val)),
          )
          grid_geoms.push(
            make_line_geom(swiz(back[0], r1[0], val), swiz(back[0], r1[1], val)),
          )
          tick_labels.push({
            pos: swiz(back[0], back[1] + out_x * tick_label_dist, val),
            text: format_num(val, `.3~g`),
          })
        }
      }

      return {
        axis,
        color,
        label,
        line_geom,
        tick_geoms,
        grid_geoms,
        tick_labels,
        label_pos,
      }
    })
  })

  // Update backside positions when camera crosses axis planes.
  // Only updates when sign changes to avoid triggering geometry recreation every frame.
  function update_backside(): void {
    const cam = orbit_controls_ref?.object?.position
    if (!cam) return
    const [r0, r1, r2] = niced_range
    // swiz: data[0]→Z, data[1]→X, data[2]→Y
    const new_back_0 = cam.z > data_center.z ? r0[0] : r0[1]
    const new_back_1 = cam.x > data_center.x ? r1[0] : r1[1]
    const new_back_2 = cam.y > data_center.y ? r2[0] : r2[1]
    if (back[0] !== new_back_0 || back[1] !== new_back_1 || back[2] !== new_back_2) {
      back = [new_back_0, new_back_1, new_back_2]
      out_x = cam.x > data_center.x ? -1 : 1
      out_y = cam.y > data_center.y ? -1 : 1
    }
  }

  $effect(() => {
    const controls = orbit_controls_ref
    if (!controls) return
    if (controls.target) {
      controls.target.set(data_center.x, data_center.y, data_center.z)
    }
    controls.object?.lookAt(data_center)
    controls.update?.()
    controls.addEventListener(`change`, update_backside)
    update_backside()
    return () => controls.removeEventListener(`change`, update_backside)
  })

  $effect(() => {
    set_fullscreen_bg(wrapper, fullscreen, `--chempot-3d-bg-fullscreen`)
  })

  $effect(() => {
    const grid_geometries = grid_config
    return () => {
      for (const grid_item of grid_geometries) {
        dispose_geometry(grid_item.line_geom)
        for (const tick_geometry of grid_item.tick_geoms) {
          dispose_geometry(tick_geometry)
        }
        for (const line_geometry of grid_item.grid_geoms) {
          dispose_geometry(line_geometry)
        }
      }
    }
  })

  // Background planes at back sides of bounding box (camera-dependent)
  const bg_planes = $derived.by(() => {
    const [r0, r1, r2] = niced_range
    const s0 = r0[1] - r0[0], s1 = r1[1] - r1[0], s2 = r2[1] - r2[0]
    return [
      // XY plane (floor/ceiling): data axes 0,1 at backside d2
      {
        pos: swiz((r0[0] + r0[1]) / 2, (r1[0] + r1[1]) / 2, back[2]),
        rot: [-Math.PI / 2, 0, 0] as [number, number, number],
        size: [s1, s0] as [number, number],
      },
      // XZ plane (side wall): data axes 0,2 at backside d1
      {
        pos: swiz((r0[0] + r0[1]) / 2, back[1], (r2[0] + r2[1]) / 2),
        rot: [0, Math.PI / 2, 0] as [number, number, number],
        size: [s0, s2] as [number, number],
      },
      // YZ plane (back wall): data axes 1,2 at backside d0
      {
        pos: swiz(back[0], (r1[0] + r1[1]) / 2, (r2[0] + r2[1]) / 2),
        rot: [0, 0, 0] as [number, number, number],
        size: [s1, s2] as [number, number],
      },
    ]
  })

  const projection_planes = $derived.by(() => {
    const projections = display.projections
    if (!projections) return []
    const [r0, r1, r2] = niced_range
    const s0 = (r0[1] - r0[0]) * (display.projection_scale ?? 0.5)
    const s1 = (r1[1] - r1[0]) * (display.projection_scale ?? 0.5)
    const s2 = (r2[1] - r2[0]) * (display.projection_scale ?? 0.5)
    const planes: {
      key: string
      pos: [number, number, number]
      rot: [number, number, number]
      size: [number, number]
      color: string
    }[] = []
    if (projections.xy) {
      planes.push({
        key: `xy`,
        pos: swiz((r0[0] + r0[1]) / 2, (r1[0] + r1[1]) / 2, back[2]),
        rot: [-Math.PI / 2, 0, 0],
        size: [s1, s0],
        color: `#5dade2`,
      })
    }
    if (projections.xz) {
      planes.push({
        key: `xz`,
        pos: swiz((r0[0] + r0[1]) / 2, back[1], (r2[0] + r2[1]) / 2),
        rot: [0, Math.PI / 2, 0],
        size: [s0, s2],
        color: `#58d68d`,
      })
    }
    if (projections.yz) {
      planes.push({
        key: `yz`,
        pos: swiz(back[0], (r1[0] + r1[1]) / 2, (r2[0] + r2[1]) / 2),
        rot: [0, 0, 0],
        size: [s1, s2],
        color: `#f5b041`,
      })
    }
    return planes
  })

  const bounding_box_geometry = $derived.by(() => {
    const [r0, r1, r2] = niced_range
    const vertices = [
      swiz(r0[0], r1[0], r2[0]),
      swiz(r0[1], r1[0], r2[0]),
      swiz(r0[1], r1[1], r2[0]),
      swiz(r0[0], r1[1], r2[0]),
      swiz(r0[0], r1[0], r2[1]),
      swiz(r0[1], r1[0], r2[1]),
      swiz(r0[1], r1[1], r2[1]),
      swiz(r0[0], r1[1], r2[1]),
    ]
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ]
    const positions: number[] = []
    for (const [start_idx, end_idx] of edges) {
      const start = vertices[start_idx]
      const end = vertices[end_idx]
      positions.push(start[0], start[1], start[2], end[0], end[1], end[2])
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(`position`, new THREE.Float32BufferAttribute(positions, 3))
    return geom
  })

  function reset_controls(): void {
    formal_chempots_override = null
    label_stable_override = null
    element_padding_override = null
    default_min_limit_override = null
    draw_formula_meshes_override = null
    draw_formula_lines_override = null
    color_mode_override = null
    color_scale_override = null
  }

  function download_blob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const link = document.createElement(`a`)
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  let png_dpi = $state(150)

  function export_png_file(): void {
    if (!wrapper) return
    const gl_canvas = wrapper.querySelector(`canvas`)
    if (!(gl_canvas instanceof HTMLCanvasElement)) return

    // Composite WebGL canvas + HTML overlay labels into a single image
    const rect = gl_canvas.getBoundingClientRect()
    const scale = Math.min(png_dpi / 72, 10)
    const out = document.createElement(`canvas`)
    out.width = Math.round(rect.width * scale)
    out.height = Math.round(rect.height * scale)
    const ctx = out.getContext(`2d`)
    if (!ctx) return
    ctx.scale(scale, scale)

    // Draw the WebGL canvas as background
    ctx.drawImage(gl_canvas, 0, 0, rect.width, rect.height)

    // Draw all HTML overlay text (tick labels, axis labels, domain labels)
    const canvas_rect = gl_canvas.getBoundingClientRect()
    for (
      const el of wrapper.querySelectorAll(`.tick-label, .axis-label, .domain-label`)
    ) {
      const html_el = el as HTMLElement
      const style = getComputedStyle(html_el)
      if (style.display === `none` || style.visibility === `hidden`) continue
      const el_rect = html_el.getBoundingClientRect()
      const x = el_rect.left + el_rect.width / 2 - canvas_rect.left
      const y = el_rect.top + el_rect.height / 2 - canvas_rect.top
      ctx.font = style.font || `${style.fontSize} ${style.fontFamily}`
      ctx.fillStyle = style.color || `#333`
      ctx.textAlign = `center`
      ctx.textBaseline = `middle`
      ctx.fillText(html_el.textContent ?? ``, x, y)
    }

    out.toBlob((blob) => {
      if (!blob) return
      download_blob(blob, `chempot-${plot_elements.join(`-`)}.png`)
    }, `image/png`)
  }

  function get_json_string(): string {
    return JSON.stringify(
      {
        elements: diagram_data?.elements ?? [],
        domains: render_domains.map((domain) => ({
          formula: domain.formula,
          points_3d: domain.points_3d,
        })),
        lims: diagram_data?.lims ?? [],
      },
      null,
      2,
    )
  }

  function export_json_file(): void {
    download_blob(
      new Blob([get_json_string()], { type: `application/json` }),
      `chempot-${plot_elements.join(`-`)}.json`,
    )
  }

  async function copy_json(): Promise<void> {
    try {
      await navigator.clipboard.writeText(get_json_string())
      copy_status = true
    } catch (err) {
      copy_status = false
      console.error(`Failed to copy JSON to clipboard:`, err)
    }
    if (copy_timeout_id !== null) clearTimeout(copy_timeout_id)
    copy_timeout_id = setTimeout(() => {
      copy_status = false
      copy_timeout_id = null
    }, 1000)
  }

  onDestroy(() => {
    if (copy_timeout_id !== null) clearTimeout(copy_timeout_id)
  })

  function get_pointer_coords(
    raw_event: unknown,
  ): { clientX: number; clientY: number } | null {
    if (raw_event instanceof PointerEvent || raw_event instanceof MouseEvent) {
      return raw_event
    }
    if (!raw_event || typeof raw_event !== `object`) return null
    const event_obj = raw_event as {
      nativeEvent?: unknown
      srcEvent?: unknown
      clientX?: number
      clientY?: number
    }
    if (
      event_obj.nativeEvent instanceof PointerEvent ||
      event_obj.nativeEvent instanceof MouseEvent
    ) {
      return event_obj.nativeEvent
    }
    if (
      event_obj.srcEvent instanceof PointerEvent ||
      event_obj.srcEvent instanceof MouseEvent
    ) {
      return event_obj.srcEvent
    }
    if (
      typeof event_obj.clientX === `number` && typeof event_obj.clientY === `number`
    ) {
      return { clientX: event_obj.clientX, clientY: event_obj.clientY }
    }
    return null
  }

  function get_hover_pointer(raw_event: unknown): { x: number; y: number } | null {
    const pointer_event = get_pointer_coords(raw_event)
    if (!pointer_event || !wrapper) return null
    const bounds = wrapper.getBoundingClientRect()
    return {
      x: pointer_event.clientX - bounds.left + 4,
      y: pointer_event.clientY - bounds.top + 4,
    }
  }

  function handle_phase_hover(domain_data: HoverMeshData, raw_event: unknown): void {
    hover_info = {
      ...domain_data.info,
      pointer: get_hover_pointer(raw_event) ?? undefined,
    }
  }

  // Color mode cycling (keyboard shortcut 'c')
  const color_modes: ChemPotColorMode[] = [
    `none`,
    `energy`,
    `formation_energy`,
    `arity`,
    `entries`,
  ]
  function cycle_color_mode(): void {
    const idx = color_modes.indexOf(color_mode)
    color_mode_override = color_modes[(idx + 1) % color_modes.length]
  }
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = document.fullscreenElement === wrapper
  }}
/>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={wrapper}
  bind:clientWidth={container_width}
  bind:clientHeight={container_height}
  class="chempot-diagram-3d"
  class:fullscreen
  style:width={fullscreen ? `100vw` : `100%`}
  style:height={fullscreen ? `100vh` : `${render_height}px`}
  role="application"
  tabindex="0"
  onkeydown={(event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    ) return
    if (event.key === `c`) cycle_color_mode()
    else if (event.key === `f`) toggle_fullscreen(wrapper)
  }}
>
  <section class="control-buttons">
    <DraggablePane
      bind:show={export_pane_open}
      open_icon="Cross"
      closed_icon="Export"
      pane_props={{ class: `chempot-export-pane` }}
      toggle_props={{
        class: `chempot-export-toggle`,
        title: `Export chemical potential diagram`,
      }}
    >
      <h4>Export Image</h4>
      <label>
        PNG
        <button type="button" onclick={export_png_file} title="PNG ({png_dpi} DPI)">
          ⬇
        </button>
        &nbsp;(DPI: <input
          type="number"
          min={50}
          max={500}
          bind:value={png_dpi}
          title="Export resolution in dots per inch"
          style="margin: 0 0 0 2pt"
        />)
      </label>
      <h4>Export Data</h4>
      <label>
        JSON
        <button type="button" onclick={export_json_file} aria-label="Download JSON">
          ⬇
        </button>
        <button
          type="button"
          onclick={copy_json}
          aria-label="Copy JSON to clipboard"
        >
          {copy_status ? `✅` : `📋`}
        </button>
      </label>
    </DraggablePane>

    <ScatterPlot3DControls
      bind:x_axis
      bind:y_axis
      bind:z_axis
      bind:display
      bind:camera_projection
      bind:auto_rotate
      series={controls_series}
      toggle_props={{
        class: `chempot-controls-toggle`,
        title: `3D plot controls`,
      }}
      pane_props={{ class: `chempot-controls-pane` }}
    >
      <SettingsSection
        title="ChemPot"
        current_values={{
          formal_chempots,
          label_stable,
          element_padding,
          default_min_limit,
          draw_formula_meshes,
          draw_formula_lines,
          color_mode,
        }}
        on_reset={reset_controls}
      >
        <div class="chempot-checks">
          <label>
            <input
              type="checkbox"
              checked={formal_chempots}
              onchange={() => {
                formal_chempots_override = !formal_chempots
              }}
            /> Formal
          </label>
          <label>
            <input
              type="checkbox"
              checked={label_stable}
              onchange={() => {
                label_stable_override = !label_stable
              }}
            /> Labels
          </label>
          <label>
            <input
              type="checkbox"
              checked={draw_formula_meshes}
              onchange={() => {
                draw_formula_meshes_override = !draw_formula_meshes
              }}
            /> Meshes
          </label>
          <label>
            <input
              type="checkbox"
              checked={draw_formula_lines}
              onchange={() => {
                draw_formula_lines_override = !draw_formula_lines
              }}
            /> Lines
          </label>
        </div>
        <div class="chempot-nums">
          <label>
            Pad (eV)
            <input
              type="number"
              min="0"
              step="0.1"
              value={element_padding}
              oninput={(event) => {
                element_padding_override = Number(event.currentTarget.value)
              }}
            />
          </label>
          <label>
            Min (eV)
            <input
              type="number"
              max="0"
              step="1"
              value={default_min_limit}
              oninput={(event) => {
                default_min_limit_override = Number(
                  event.currentTarget.value,
                )
              }}
            />
          </label>
        </div>
        <div class="pane-row">
          <label for="chempot-color-mode">Color:</label>
          <select
            id="chempot-color-mode"
            value={color_mode}
            onchange={(event) => {
              color_mode_override = event.currentTarget
                .value as ChemPotColorMode
            }}
          >
            <option value="none">None</option>
            <option value="energy">Energy/atom</option>
            <option value="formation_energy">Formation E</option>
            <option value="arity">Element count</option>
            <option value="entries">Entry count</option>
          </select>
        </div>
        {#if color_mode !== `none` && color_mode !== `arity`}
          <div class="pane-row">
            <label for="chempot-color-scale">Scale:</label>
            <select
              id="chempot-color-scale"
              value={color_scale}
              onchange={(event) => {
                color_scale_override = event.currentTarget
                  .value as D3InterpolateName
              }}
            >
              <option value="interpolateViridis">Viridis</option>
              <option value="interpolatePlasma">Plasma</option>
              <option value="interpolateInferno">Inferno</option>
              <option value="interpolateMagma">Magma</option>
              <option value="interpolateCividis">Cividis</option>
              <option value="interpolateTurbo">Turbo</option>
              <option value="interpolateRdYlBu">RdYlBu</option>
              <option value="interpolateSpectral">Spectral</option>
            </select>
          </div>
        {/if}
      </SettingsSection>
    </ScatterPlot3DControls>

    <button
      type="button"
      onclick={() => toggle_fullscreen(wrapper)}
      title="{fullscreen ? `Exit` : `Enter`} fullscreen"
      class="fullscreen-btn"
    >
      <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
    </button>
  </section>
  {#if !diagram_data}
    <div class="error-state" role="alert" aria-live="polite">
      <p>Cannot compute chemical potential diagram.</p>
      <p>Need at least 2 elements with elemental reference entries.</p>
    </div>
  {:else if mounted && typeof WebGLRenderingContext !== `undefined`}
    <Canvas
      createRenderer={(cvs) =>
      new THREE.WebGLRenderer({
        canvas: cvs,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      })}
    >
      <ChemPotScene3D>
        {#if camera_projection === `orthographic`}
          <!-- Orthographic camera matching pymatgen's projection style -->
          <T.OrthographicCamera
            makeDefault
            position={[
              data_center.x + data_extent,
              data_center.y + data_extent,
              data_center.z + data_extent,
            ]}
            zoom={Math.min(render_width, render_height) / (data_extent * 1.6)}
            near={0.1}
            far={data_extent * 10}
          >
            <extras.OrbitControls
              bind:ref={orbit_controls_ref}
              enableRotate
              enableZoom
              enablePan
              autoRotate={auto_rotate > 0}
              autoRotateSpeed={auto_rotate}
              target={[data_center.x, data_center.y, data_center.z]}
            />
          </T.OrthographicCamera>
        {:else}
          <T.PerspectiveCamera
            makeDefault
            position={[
              data_center.x + data_extent,
              data_center.y + data_extent,
              data_center.z + data_extent,
            ]}
            fov={50}
            near={0.1}
            far={data_extent * 10}
          >
            <extras.OrbitControls
              bind:ref={orbit_controls_ref}
              enableRotate
              enableZoom
              enablePan
              autoRotate={auto_rotate > 0}
              autoRotateSpeed={auto_rotate}
              target={[data_center.x, data_center.y, data_center.z]}
            />
          </T.PerspectiveCamera>
        {/if}

        <!-- Ambient light for visibility -->
        <T.AmbientLight intensity={0.8} />
        <T.DirectionalLight position={[1, 1, 1]} intensity={0.5} />

        <!-- Vertex-colored hull for both plain and colored modes.
           {#key domain_colors} forces Threlte to re-create the mesh whenever
           colors change (covers color_mode, color_scale, and data updates),
           since on-demand rendering won't detect mutated vertex color buffers. -->
        {#if colored_hull_geometry}
          {#key domain_colors}
            <T.Mesh geometry={colored_hull_geometry}>
              <T.MeshBasicMaterial
                vertexColors
                transparent
                opacity={color_mode === `none` ? 0.28 : 0.7}
                side={THREE.DoubleSide}
                polygonOffset
                polygonOffsetFactor={1}
                polygonOffsetUnits={1}
              />
            </T.Mesh>
          {/key}
        {/if}

        <!-- Domain boundary edges (wireframe on top of opaque fills) -->
        <T.LineSegments geometry={edge_geometry}>
          <T.LineBasicMaterial color={0x333333} linewidth={1} />
        </T.LineSegments>

        <!-- Invisible pick meshes for per-phase hover tooltip -->
        {#each hover_mesh_data as domain_hover (domain_hover.formula)}
          <T.Mesh
            geometry={domain_hover.geometry}
            onpointerenter={(event: unknown) => handle_phase_hover(domain_hover, event)}
            onpointermove={(event: unknown) => handle_phase_hover(domain_hover, event)}
            onpointerleave={() => {
              if (hover_info?.formula === domain_hover.formula) hover_info = null
            }}
          >
            <T.MeshBasicMaterial
              transparent
              opacity={0}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </T.Mesh>
        {/each}

        <!-- Formula overlay meshes (semi-transparent colored fill) -->
        {#each formula_mesh_data as { geometry, color }, mesh_idx (mesh_idx)}
          <T.Mesh {geometry}>
            <T.MeshBasicMaterial
              color={new THREE.Color(color)}
              transparent
              opacity={0.13}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </T.Mesh>
        {/each}

        <!-- Formula overlay edges (colored, thicker) -->
        {#if draw_formula_lines}
          {#each formula_edge_data as { geometry, color }, edge_idx (edge_idx)}
            <T.LineSegments {geometry}>
              <T.LineBasicMaterial color={new THREE.Color(color)} linewidth={2} />
            </T.LineSegments>
          {/each}
        {/if}

        {#if display.show_grid}
          <!-- Background planes -->
          {#each bg_planes as plane, idx (idx)}
            <T.Mesh
              position={plane.pos}
              rotation={plane.rot}
              renderOrder={-1}
            >
              <T.PlaneGeometry args={plane.size} />
              <T.MeshBasicMaterial
                color="#888"
                opacity={0.04}
                transparent
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </T.Mesh>
          {/each}
        {/if}

        {#each projection_planes as plane (plane.key)}
          <T.Mesh position={plane.pos} rotation={plane.rot}>
            <T.PlaneGeometry args={plane.size} />
            <T.MeshBasicMaterial
              color={plane.color}
              opacity={display.projection_opacity ?? 0.15}
              transparent
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </T.Mesh>
        {/each}

        {#if display.show_bounding_box}
          <T.LineSegments geometry={bounding_box_geometry}>
            <T.LineBasicMaterial color="#666" opacity={0.6} transparent />
          </T.LineSegments>
        {/if}

        <!-- Axes, ticks, grid lines, and labels -->
        {#each grid_config as gc (gc.axis)}
          {#if display.show_axes}
            <!-- Main axis line -->
            <T.Line geometry={gc.line_geom}>
              <T.LineBasicMaterial color={gc.color} linewidth={2} />
            </T.Line>
            <!-- Tick marks -->
            {#each gc.tick_geoms as tick_geom, tdx (tdx)}
              <T.Line geometry={tick_geom}>
                <T.LineBasicMaterial color={gc.color} />
              </T.Line>
            {/each}
          {/if}
          {#if display.show_grid}
            <!-- Grid lines -->
            {#each gc.grid_geoms as grid_geom, gdx (gdx)}
              <T.Line geometry={grid_geom}>
                <T.LineBasicMaterial color="#888" opacity={0.3} transparent />
              </T.Line>
            {/each}
          {/if}
          {#if display.show_axis_labels}
            <!-- Tick labels (billboarded, always face camera) -->
            {#each gc.tick_labels as tick, tick_idx (tick_idx)}
              <extras.HTML
                position={tick.pos}
                center
                portal={wrapper}
                zIndexRange={[1, 0]}
              >
                <span class="tick-label">{tick.text}</span>
              </extras.HTML>
            {/each}
            <!-- Axis label -->
            <extras.HTML
              position={gc.label_pos}
              center
              portal={wrapper}
              zIndexRange={[1, 0]}
            >
              <span class="axis-label" style:color={gc.color}>{gc.label}</span>
            </extras.HTML>
          {/if}
        {/each}

        <!-- Domain labels (only for surface domains, not interior ones) -->
        {#if label_stable}
          {#each render_domains.filter((dom) => surface_formulas.has(dom.formula)) as
            domain
            (domain.formula)
          }
            <extras.HTML
              position={[domain.ann_loc[1], domain.ann_loc[2], domain.ann_loc[0]]}
              center
              portal={wrapper}
              zIndexRange={[1, 0]}
            >
              <span
                class="domain-label"
              >{@html get_hill_formula(domain.formula, false, ``)}</span>
            </extras.HTML>
          {/each}
        {/if}
      </ChemPotScene3D>
    </Canvas>
    {#if render_local_tooltip && show_tooltip && hover_info?.view === `3d`}
      <aside
        class="phase-tooltip"
        style:left="{hover_info.pointer?.x ?? 4}px"
        style:top="{hover_info.pointer?.y ?? 4}px"
      >
        <h4>{@html get_hill_formula(hover_info.formula, false, ``)}</h4>
        <div class="meta-row">
          {hover_info.is_elemental ? `Elemental phase` : `Compound phase`}
          {#if hover_info.is_draw_formula}
            <span> · Overlay target</span>
          {/if}
        </div>
        <div class="meta-row">
          Vertices: {hover_info.n_vertices} · Edges: {hover_info.n_edges} · Points:
          {hover_info.n_points}
        </div>
        <div class="meta-row">
          Entries: {hover_info.matching_entry_count}
          {#if hover_info.min_energy_per_atom !== null &&
          hover_info.max_energy_per_atom !== null}
            · E/atom: {format_num(hover_info.min_energy_per_atom, `.4~g`)}
            to {format_num(hover_info.max_energy_per_atom, `.4~g`)} eV
          {/if}
        </div>
        {#if tooltip_detail_level === `detailed`}
          <div class="ranges-title">Axis ranges</div>
          {#each hover_info.axis_ranges as axis_range (axis_range.element)}
            <div class="range-row">
              {axis_range.element}: {format_num(axis_range.min_val, `.4~g`)} to
              {format_num(axis_range.max_val, `.4~g`)} eV
            </div>
          {/each}
          <div class="meta-row">
            Centroid: ({
              hover_info.ann_loc.map((value) => format_num(value, `.3~g`)).join(
                `, `,
              )
            })
          </div>
          {#if hover_info.touches_limits.length > 0}
            <div class="ranges-title">Touches bounds</div>
            <div class="meta-row">{hover_info.touches_limits.join(`, `)}</div>
          {/if}
        {/if}
      </aside>
    {/if}
    <!-- Color bar for continuous modes -->
    {#if color_mode !== `none` && color_mode !== `arity` && color_range}
      <ColorBar
        title={color_range.label}
        range={[color_range.min, color_range.max]}
        {color_scale}
        wrapper_style="position: absolute; bottom: 16px; left: 1em; width: 200px; z-index: 10;"
        bar_style="height: 12px;"
        title_style="margin-bottom: 4px;"
      />
    {/if}
    <!-- Categorical legend for arity mode -->
    {#if color_mode === `arity`}
      <div class="arity-legend">
        {#each [`Unary`, `Binary`, `Ternary`, `4+`] as label, idx (label)}
          <span class="arity-item">
            <span class="arity-dot" style:background={arity_colors[idx]}></span>
            {label}
          </span>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .chempot-diagram-3d {
    position: relative;
  }
  .chempot-diagram-3d:fullscreen {
    background: var(--chempot-3d-bg-fullscreen, var(--bg-color, #fff));
    overflow: hidden;
  }
  /* Threlte <extras.HTML portal={wrapper}> appends absolutely-positioned divs
     directly to the wrapper. Without pointer-events: none, they intercept mouse
     events and prevent the Three.js raycaster from detecting hover meshes. */
  .chempot-diagram-3d > :global(div[style*='position: absolute'][style*='top: 0']) {
    pointer-events: none !important;
  }
  .control-buttons {
    position: absolute;
    top: 1ex;
    right: 1ex;
    display: flex;
    gap: 8px;
    z-index: 20;
  }
  .control-buttons > :global(button),
  .control-buttons > :global(.pane-toggle) {
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    border-radius: 3px;
    color: var(--text-color, currentColor);
    transition: background-color 0.2s;
    display: flex;
    font-size: clamp(0.75em, 1.5cqmin, 1em);
  }
  .control-buttons > :global(button:hover),
  .control-buttons > :global(.pane-toggle:hover) {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
  .chempot-diagram-3d :global(.draggable-pane label) {
    display: flex;
    align-items: center;
    gap: 4pt;
    font-size: 0.9em;
  }
  .chempot-diagram-3d :global(.chempot-checks) {
    display: flex;
    flex-wrap: wrap;
    gap: 1ex;
  }
  .chempot-diagram-3d :global(.chempot-nums) {
    display: flex;
    flex-wrap: wrap;
    gap: 1ex;
    margin: 4pt 0;
  }
  .chempot-diagram-3d :global(.chempot-nums input[type='number']) {
    width: 5em;
  }
  .chempot-diagram-3d :global(.draggable-pane select) {
    flex: 1;
    min-width: 0;
    padding: 2px 4px;
  }
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-color, #666);
  }
  :is(.axis-label, .tick-label) {
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
  }
  .axis-label {
    font: bold 13px sans-serif;
  }
  .tick-label {
    font-size: 10px;
    color: var(--text-color, #333);
  }
  .domain-label {
    font: 11px sans-serif;
    color: var(--text-color, #333);
    opacity: 0.7;
    white-space: nowrap;
    pointer-events: none;
  }
  .phase-tooltip {
    position: absolute;
    max-width: min(32rem, 92vw);
    background: color-mix(in srgb, var(--bg-color, #fff) 94%, black 6%);
    color: var(--text-color, #222);
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 6px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.35;
    pointer-events: none;
    z-index: 100;
  }
  .phase-tooltip h4 {
    margin: 0 0 4px;
    font-size: 13px;
  }
  .meta-row {
    margin: 1px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ranges-title {
    margin-top: 6px;
    font-weight: 600;
  }
  .range-row {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .arity-legend {
    position: absolute;
    bottom: 16px;
    left: 1em;
    display: flex;
    gap: 10px;
    font-size: 12px;
    z-index: 10;
    pointer-events: none;
  }
  .arity-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .arity-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
