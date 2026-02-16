<script lang="ts">
  import type { PhaseData } from '$lib/convex-hull/types'
  import Icon from '$lib/Icon.svelte'
  import { toggle_fullscreen } from '$lib/layout'
  import { format_num } from '$lib/labels'
  import { convex_hull_2d, type Vec2 } from '$lib/math'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { Canvas, T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import ChemPotScene3D from './ChemPotScene3D.svelte'
  import { scaleLinear } from 'd3-scale'
  import { onDestroy, onMount } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import * as THREE from 'three'
  import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
  import {
    apply_element_padding,
    build_axis_ranges,
    compute_chempot_diagram,
    formula_key_from_composition,
    get_3d_domain_simplexes_and_ann_loc,
    get_energy_per_atom,
    pad_domain_points,
  } from './compute'
  import { CHEMPOT_DEFAULTS } from './types'
  import type {
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
  let controls_open = $state(false)
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
  const dynamic_axis_angle_deg = $state<number[]>([0, 0, 90])

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
    simplex_indices: number[][]
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
        const { simplex_indices, ann_loc } = get_3d_domain_simplexes_and_ann_loc(
          padded,
        )
        result.push({
          formula,
          points_3d: padded,
          simplex_indices,
          ann_loc,
          is_draw_formula: is_draw,
        })
      } else {
        const center = padded[0].map((_, col) =>
          padded.reduce((s, p) => s + p[col], 0) / padded.length
        )
        result.push({
          formula,
          points_3d: padded,
          simplex_indices: [[0, 1]],
          ann_loc: center,
          is_draw_formula: is_draw,
        })
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

  // Compute data center and extent for camera positioning (in swizzled coords)
  const { data_center, data_extent } = $derived.by(() => {
    const pts = render_domains.flatMap((d) => d.points_3d)
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
      ) ?? 0
      const point_b_idx = selected_coord_to_idx.get(
        `${point_b[0].toFixed(6)},${point_b[1].toFixed(6)}`,
      ) ?? 0
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
        const ka = pa.map((v) => v.toFixed(4)).join(`,`)
        const kb = pb.map((v) => v.toFixed(4)).join(`,`)
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
      .filter((d) => !d.is_draw_formula)
      .flatMap((d) => d.points_3d)
    const unique = dedup_3d(all_pts)
    if (unique.length < 4) return null
    const vectors = unique.map((pt) => to_vec3(pt))
    try {
      return new ConvexGeometry(vectors)
    } catch {
      return null
    }
  })

  // Deduplicate 3D points within tolerance
  function dedup_3d(pts: number[][], tol: number = 1e-4): number[][] {
    const unique: number[][] = []
    for (const pt of pts) {
      if (!unique.some((u) => u.every((v, idx) => Math.abs(v - pt[idx]) < tol))) {
        unique.push(pt)
      }
    }
    return unique
  }

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
  const data_bbox = $derived.by(() => {
    const pts = render_domains.flatMap((d) => d.points_3d)
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
  const axis_label_standoff = [0.25, 0.45, 0.45] as const

  // Grid/axis configuration for each data axis
  // Each axis has: line geometry, tick geometries, grid geometries, label positions
  const grid_config = $derived.by(() => {
    const [r0, r1, r2] = niced_range
    // Back-side positions for grid planes (minimums in data coords)
    const b0 = r0[0], b1 = r1[0], b2 = r2[0]
    // Front-side positions for axes/ticks (maximums, facing the camera)
    const f0 = r0[1], f1 = r1[1]

    return [0, 1, 2].map((axis) => {
      const ticks = data_ticks[axis]
      const color = axis_colors[axis]
      const label = formal_chempots
        ? `\u0394\u03BC(${plot_elements[axis]}) (eV)`
        : `\u03BC(${plot_elements[axis]}) (eV)`

      let line_start: [number, number, number]
      let line_end: [number, number, number]
      const tick_geoms: THREE.BufferGeometry[] = []
      const grid_geoms: THREE.BufferGeometry[] = []
      const tick_labels: { pos: [number, number, number]; text: string }[] = []
      let label_pos: [number, number, number]

      if (axis === 0) {
        // Data axis 0 (Li/plotly-x): front-bottom edge at max data[1], min data[2]
        line_start = swiz(r0[0], f1, b2)
        line_end = swiz(r0[1], f1, b2)
        label_pos = swiz((r0[0] + r0[1]) / 2, f1 + axis_label_standoff[0], b2)
        for (const val of ticks) {
          tick_geoms.push(make_line_geom(swiz(val, f1, b2), swiz(val, f1 + 0.15, b2)))
          // Grid lines stay on back planes
          grid_geoms.push(make_line_geom(swiz(val, r1[0], b2), swiz(val, r1[1], b2)))
          grid_geoms.push(make_line_geom(swiz(val, b1, r2[0]), swiz(val, b1, r2[1])))
          tick_labels.push({
            pos: swiz(val, f1 + 0.4, b2),
            text: format_num(val, `.3~g`),
          })
        }
      } else if (axis === 1) {
        // Data axis 1 (Fe/plotly-y): front-bottom edge at max data[0], min data[2]
        line_start = swiz(f0, r1[0], b2)
        line_end = swiz(f0, r1[1], b2)
        label_pos = swiz(f0 + axis_label_standoff[1], (r1[0] + r1[1]) / 2, b2)
        for (const val of ticks) {
          tick_geoms.push(make_line_geom(swiz(f0, val, b2), swiz(f0 + 0.15, val, b2)))
          grid_geoms.push(make_line_geom(swiz(r0[0], val, b2), swiz(r0[1], val, b2)))
          grid_geoms.push(make_line_geom(swiz(b0, val, r2[0]), swiz(b0, val, r2[1])))
          tick_labels.push({
            pos: swiz(f0 + 0.4, val, b2),
            text: format_num(val, `.3~g`),
          })
        }
      } else {
        // Data axis 2 (O/plotly-z, vertical): front-left edge at max data[0], min data[1]
        line_start = swiz(f0, b1, r2[0])
        line_end = swiz(f0, b1, r2[1])
        label_pos = swiz(f0 + axis_label_standoff[2], b1, (r2[0] + r2[1]) / 2)
        for (const val of ticks) {
          tick_geoms.push(make_line_geom(swiz(f0, b1, val), swiz(f0 + 0.15, b1, val)))
          grid_geoms.push(make_line_geom(swiz(r0[0], b1, val), swiz(r0[1], b1, val)))
          grid_geoms.push(make_line_geom(swiz(b0, r1[0], val), swiz(b0, r1[1], val)))
          tick_labels.push({
            pos: swiz(f0 + 0.4, b1, val),
            text: format_num(val, `.3~g`),
          })
        }
      }

      return {
        axis,
        color,
        label,
        axis_line_start: line_start,
        axis_line_end: line_end,
        line_geom: make_line_geom(line_start, line_end),
        tick_geoms,
        grid_geoms,
        tick_labels,
        label_pos,
      }
    })
  })

  function update_axis_label_angles(camera: THREE.Camera): void {
    if (grid_config.length < 3) return
    for (const axis_config of grid_config) {
      const start_ndc = new THREE.Vector3(...axis_config.axis_line_start).project(
        camera,
      )
      const end_ndc = new THREE.Vector3(...axis_config.axis_line_end).project(camera)
      let angle_deg = Math.atan2(end_ndc.y - start_ndc.y, end_ndc.x - start_ndc.x) *
        180 / Math.PI
      if (angle_deg > 90) angle_deg -= 180
      else if (angle_deg < -90) angle_deg += 180
      dynamic_axis_angle_deg[axis_config.axis] = angle_deg
    }
  }

  $effect(() => {
    const controls = orbit_controls_ref
    if (!controls) return
    if (controls.target) {
      controls.target.set(data_center.x, data_center.y, data_center.z)
    }
    controls.object.lookAt(data_center)
    controls.update?.()
    const handle_controls_change = (): void => {
      update_axis_label_angles(controls.object)
    }
    controls.addEventListener(`change`, handle_controls_change)
    handle_controls_change()
    return () => controls.removeEventListener(`change`, handle_controls_change)
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

  // Background planes at back sides of bounding box (in swizzled coords)
  const bg_planes = $derived.by(() => {
    const [r0, r1, r2] = niced_range
    const b0 = r0[0], b1 = r1[0], b2 = r2[0]
    const s0 = r0[1] - r0[0], s1 = r1[1] - r1[0], s2 = r2[1] - r2[0]
    return [
      // XY plane (floor): data axes 0,1 at data axis 2 = b2
      {
        pos: swiz((r0[0] + r0[1]) / 2, (r1[0] + r1[1]) / 2, b2),
        rot: [-Math.PI / 2, 0, 0] as [number, number, number],
        size: [s1, s0] as [number, number],
      },
      // XZ plane (back wall): data axes 0,2 at data axis 1 = b1
      {
        pos: swiz((r0[0] + r0[1]) / 2, b1, (r2[0] + r2[1]) / 2),
        rot: [0, Math.PI / 2, 0] as [number, number, number],
        size: [s0, s2] as [number, number],
      },
      // YZ plane (side wall): data axes 1,2 at data axis 0 = b0
      {
        pos: swiz(b0, (r1[0] + r1[1]) / 2, (r2[0] + r2[1]) / 2),
        rot: [0, 0, 0] as [number, number, number],
        size: [s1, s2] as [number, number],
      },
    ]
  })

  function reset_controls(): void {
    formal_chempots_override = null
    label_stable_override = null
    element_padding_override = null
    default_min_limit_override = null
    draw_formula_meshes_override = null
    draw_formula_lines_override = null
  }

  function download_blob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const link = document.createElement(`a`)
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  function export_png_file(): void {
    const canvas = wrapper?.querySelector(`canvas`)
    if (!(canvas instanceof HTMLCanvasElement)) return
    canvas.toBlob((blob) => {
      if (!blob) return
      download_blob(blob, `chempot-diagram-3d.png`)
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
      `chempot-diagram-3d.json`,
    )
  }

  async function copy_json(): Promise<void> {
    await navigator.clipboard.writeText(get_json_string())
    copy_status = true
    if (copy_timeout_id !== null) clearTimeout(copy_timeout_id)
    copy_timeout_id = setTimeout(() => {
      copy_status = false
      copy_timeout_id = null
    }, 1000)
  }

  onDestroy(() => {
    if (copy_timeout_id !== null) clearTimeout(copy_timeout_id)
    // Dispose GPU geometries created in $derived blocks
    edge_geometry?.dispose()
    occlusion_hull_geometry?.dispose()
    for (const { geometry } of formula_edge_data) geometry.dispose()
    for (const { geometry } of formula_mesh_data) geometry.dispose()
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
      x: pointer_event.clientX - bounds.left + 12,
      y: pointer_event.clientY - bounds.top + 12,
    }
  }

  function handle_phase_hover(domain_data: HoverMeshData, raw_event: unknown): void {
    hover_info = {
      ...domain_data.info,
      pointer: get_hover_pointer(raw_event) ?? undefined,
    }
  }
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = document.fullscreenElement === wrapper
  }}
/>

<div
  bind:this={wrapper}
  bind:clientWidth={container_width}
  bind:clientHeight={container_height}
  class="chempot-diagram-3d"
  class:fullscreen
  style:width={fullscreen ? `100vw` : `100%`}
  style:height={fullscreen ? `100vh` : `${render_height}px`}
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
        <button type="button" onclick={export_png_file} aria-label="Download PNG">
          ⬇
        </button>
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

    <DraggablePane
      bind:show={controls_open}
      open_icon="Cross"
      closed_icon="Settings"
      pane_props={{ class: `chempot-controls-pane` }}
      toggle_props={{ class: `chempot-controls-toggle`, title: `Chemical potential controls` }}
    >
      <h4>ChemPot Controls</h4>
      <label>
        <span>Formal chempots:</span>
        <input
          type="checkbox"
          checked={formal_chempots}
          onchange={(event) => {
            const target = event.currentTarget as HTMLInputElement
            formal_chempots_override = target.checked
          }}
        />
      </label>
      <label>
        <span>Label stable phases:</span>
        <input
          type="checkbox"
          checked={label_stable}
          onchange={(event) => {
            const target = event.currentTarget as HTMLInputElement
            label_stable_override = target.checked
          }}
        />
      </label>
      <label>
        <span>Element padding (eV):</span>
        <input
          type="number"
          min="0"
          step="0.1"
          value={element_padding}
          oninput={(event) => {
            const target = event.currentTarget as HTMLInputElement
            element_padding_override = Number(target.value)
          }}
        />
      </label>
      <label>
        <span>Default min limit (eV):</span>
        <input
          type="number"
          max="0"
          step="1"
          value={default_min_limit}
          oninput={(event) => {
            const target = event.currentTarget as HTMLInputElement
            default_min_limit_override = Number(target.value)
          }}
        />
      </label>
      <label>
        <span>Draw overlay meshes:</span>
        <input
          type="checkbox"
          checked={draw_formula_meshes}
          onchange={(event) => {
            const target = event.currentTarget as HTMLInputElement
            draw_formula_meshes_override = target.checked
          }}
        />
      </label>
      <label>
        <span>Draw overlay lines:</span>
        <input
          type="checkbox"
          checked={draw_formula_lines}
          onchange={(event) => {
            const target = event.currentTarget as HTMLInputElement
            draw_formula_lines_override = target.checked
          }}
        />
      </label>
      <button type="button" onclick={reset_controls}>Reset to config defaults</button>
    </DraggablePane>

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
    <Canvas>
      <ChemPotScene3D>
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
            target={[data_center.x, data_center.y, data_center.z]}
          />
        </T.OrthographicCamera>

        <!-- Ambient light for visibility -->
        <T.AmbientLight intensity={0.8} />
        <T.DirectionalLight position={[1, 1, 1]} intensity={0.5} />

        <!-- Opaque convex hull of all domain vertices for depth occlusion.
           This seamless surface writes to the depth buffer so wireframe edges
           on the back side are hidden by WebGL depth testing. -->
        {#if occlusion_hull_geometry}
          <T.Mesh geometry={occlusion_hull_geometry}>
            <T.MeshBasicMaterial
              color={0xf6f6f6}
              transparent
              opacity={0.28}
              side={THREE.DoubleSide}
              polygonOffset
              polygonOffsetFactor={1}
              polygonOffsetUnits={1}
            />
          </T.Mesh>
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

        <!-- Axes, ticks, grid lines, and labels -->
        {#each grid_config as gc (gc.axis)}
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
          <!-- Grid lines -->
          {#each gc.grid_geoms as grid_geom, gdx (gdx)}
            <T.Line geometry={grid_geom}>
              <T.LineBasicMaterial color="#888" opacity={0.3} transparent />
            </T.Line>
          {/each}
          <!-- Tick labels -->
          {#each gc.tick_labels as tick (tick.text)}
            <extras.HTML
              position={tick.pos}
              center
              portal={wrapper}
              zIndexRange={[1, 0]}
            >
              <span
                class="tick-label"
                style:transform={`rotate(${dynamic_axis_angle_deg[gc.axis]}deg)`}
              >
                {tick.text}
              </span>
            </extras.HTML>
          {/each}
          <!-- Axis label -->
          <extras.HTML
            position={gc.label_pos}
            center
            portal={wrapper}
            zIndexRange={[1, 0]}
          >
            <span
              class="axis-label"
              style:color={gc.color}
              style:transform={`rotate(${dynamic_axis_angle_deg[gc.axis]}deg)`}
            >
              {gc.label}
            </span>
          </extras.HTML>
        {/each}

        <!-- Domain labels -->
        {#if label_stable}
          {#each render_domains as domain (domain.formula)}
            <extras.HTML
              position={[domain.ann_loc[1], domain.ann_loc[2], domain.ann_loc[0]]}
              center
              portal={wrapper}
              zIndexRange={[1, 0]}
            >
              <span class="domain-label">{domain.formula}</span>
            </extras.HTML>
          {/each}
        {/if}
      </ChemPotScene3D>
    </Canvas>
    {#if render_local_tooltip && show_tooltip && hover_info?.view === `3d`}
      <aside
        class="phase-tooltip"
        style:left={`${hover_info.pointer?.x ?? 12}px`}
        style:top={`${hover_info.pointer?.y ?? 12}px`}
      >
        <h4>{hover_info.formula}</h4>
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
  {/if}
</div>

<style>
  .chempot-diagram-3d {
    position: relative;
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
    font-size: clamp(0.85em, 2cqmin, 1.3em);
  }
  .control-buttons > :global(button:hover),
  .control-buttons > :global(.pane-toggle:hover) {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
  .chempot-diagram-3d :global(.draggable-pane label) {
    display: flex;
    align-items: center;
    gap: 6pt;
    margin: 4pt 0;
    font-size: 0.95em;
  }
  .chempot-diagram-3d :global(.draggable-pane label > span) {
    min-width: 10em;
  }
  .chempot-diagram-3d :global(.draggable-pane input[type='number']) {
    width: 6em;
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
    display: inline-block;
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
</style>
