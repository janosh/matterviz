<script lang="ts">
  import { DEFAULT_PNG_DPI } from '$lib/constants'
  import { Filter } from 'svelte-widgets/icons'
  import type { D3InterpolateName } from '$lib/colors'
  import { get_electro_neg_formula, get_formula_label_segments } from '$lib/composition/format'
  import type { FormulaLabelSegment } from '$lib/composition/format'
  import { extract_formula_elements } from '$lib/composition/parse'
  import TemperatureSlider from '$lib/convex-hull/TemperatureSlider.svelte'
  import type { PhaseData } from '$lib/convex-hull/types'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import type { ExportSection } from '$lib/io'
  import ExportPane from '$lib/io/ExportPane.svelte'
  import { FullscreenButton, SettingsSection } from '$lib/layout'
  import { ViewerPane } from '$lib/overlays'
  import type { Vec2, Vec3 } from '$lib/math'
  import { cross_3d, merge_coplanar_triangles, normalize_vec } from '$lib/math'
  import { ColorBar, ScatterPlot3DControls } from '$lib/plot'
  import { create_renderer, dispose_on_change, webgpu_available } from '$lib/scene'
  import { pad_rect, rects_overlap } from '$lib/plot/core/layout'
  import type {
    AxisConfig3D,
    CameraProjection3D,
    DataSeries3D,
    DisplayConfig3D,
  } from '$lib/plot/core/types'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps } from 'svelte'
  import { onDestroy, onMount } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import * as THREE from 'three/webgpu'
  import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
  import { compute_chempot_async } from './async-compute.svelte'
  import ChemPotScene3D from './ChemPotScene3D.svelte'
  import ChemPotTooltip from './ChemPotTooltip.svelte'
  import { ARITY_COLORS, get_chempot_interpolator, get_domain_color_data } from './color'
  import { rescale_zoom_to_fit } from './camera'
  import {
    CHEMPOT_COLOR_MODE_OPTIONS,
    CHEMPOT_COLOR_SCALE_OPTIONS,
    create_chempot_overrides,
  } from './controls-state.svelte'
  import {
    export_glb_file,
    export_json_file,
    export_png_file,
    export_svg_file,
    export_view_json_file,
    get_json_string,
    get_view_settings,
  } from './export'
  import {
    apply_element_padding,
    bbox_diagonal,
    build_axis_ranges,
    dedup_points,
    get_3d_domain_simplexes_and_ann_loc,
    get_energy_stats_by_formula,
    get_min_entries_and_el_refs,
    get_ternary_combinations,
    get_visible_domain_labels,
    pad_domain_points,
    scale_to_font_range,
    swizzle_to_render,
    type VisibleDomainLabel,
  } from './compute'
  import { with_hover_pointer } from './pointer'
  import {
    get_projection_source_entries,
    get_temp_filter_payload,
    get_valid_temperature,
  } from './temperature'
  import type {
    ChemPotColorMode,
    ChemPotDiagramConfig,
    ChemPotDiagramData,
    ChemPotHoverInfo,
    ChemPotHoverInfo3D,
  } from './types'
  import { CHEMPOT_DEFAULTS } from './types'

  type SceneProps = ComponentProps<typeof ChemPotScene3D>
  // Boundary edges are kept in data coords (point pairs) so edge/hover geometry can swizzle
  // them with whatever axis stretch is current
  type RenderDomain = SceneProps[`render_domains`][number] & { edges: [number[], number[]][] }
  type HoverMesh = SceneProps[`hover_meshes`][number]

  const edge_key = (key_a: string, key_b: string): string =>
    key_a < key_b ? `${key_a}|${key_b}` : `${key_b}|${key_a}`

  let {
    entries = [],
    config = {},
    width = $bindable(800),
    height = $bindable(600),
    // Auto-corrected to a valid available temperature when needed.
    temperature = $bindable<number | undefined>(undefined),
    interpolate_temperature = CHEMPOT_DEFAULTS.interpolate_temperature,
    max_interpolation_gap = CHEMPOT_DEFAULTS.max_interpolation_gap,
    hover_info = $bindable<ChemPotHoverInfo | null>(null),
    wrapper = $bindable(),
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    controls_open = $bindable(false),
    export_pane_open = $bindable(false),
  }: {
    entries: PhaseData[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
    temperature?: number
    interpolate_temperature?: boolean
    max_interpolation_gap?: number
    hover_info?: ChemPotHoverInfo | null
    // bindable: top-level wrapper element
    wrapper?: HTMLDivElement
    // bindable: fullscreen state
    fullscreen?: boolean
    // show/hide the fullscreen button
    fullscreen_toggle?: boolean
    // bindable: whether the controls pane is currently open
    controls_open?: boolean
    // bindable: whether the export pane is currently open
    export_pane_open?: boolean
  } = $props()

  // Control overrides (override ?? config ?? default, cleared by Reset)
  const overrides = create_chempot_overrides(
    () => config,
    [
      `formal_chempots`,
      `label_stable`,
      `element_padding`,
      `default_min_limit`,
      `formulas_to_draw`,
      `draw_formula_meshes`,
      `draw_formula_lines`,
      `color_mode`,
      `color_scale`,
      `reverse_color_scale`,
    ],
    { color_mode: `arity`, formulas_to_draw: [] },
  )
  const formal_chempots = $derived(overrides.resolve(`formal_chempots`))
  const label_stable = $derived(overrides.resolve(`label_stable`))
  const element_padding = $derived(overrides.resolve(`element_padding`))
  const default_min_limit = $derived(overrides.resolve(`default_min_limit`))
  const formulas_to_draw = $derived(overrides.resolve(`formulas_to_draw`))
  const draw_formula_meshes = $derived(overrides.resolve(`draw_formula_meshes`))
  const draw_formula_lines = $derived(overrides.resolve(`draw_formula_lines`))
  const color_mode = $derived(overrides.resolve(`color_mode`))
  const color_scale = $derived(overrides.resolve(`color_scale`))
  const reverse_color_scale = $derived(overrides.resolve(`reverse_color_scale`))
  const show_tooltip = $derived(config.show_tooltip ?? CHEMPOT_DEFAULTS.show_tooltip)
  const tooltip_detail_level = $derived(
    config.tooltip_detail_level ?? CHEMPOT_DEFAULTS.tooltip_detail_level,
  )
  const formula_colors = $derived(
    config.formula_colors?.length ? config.formula_colors : CHEMPOT_DEFAULTS.formula_colors,
  )

  const formula_label_segments = (formula: string): FormulaLabelSegment[] =>
    get_formula_label_segments(get_electro_neg_formula(formula, true, ``, `.3~s`))

  function normalize_projection_triplet(
    maybe_triplet: string[] | undefined,
    available_elements: string[],
  ): string[] | null {
    if (!maybe_triplet || maybe_triplet.length !== 3) return null
    const deduped = Array.from(new Set(maybe_triplet))
    if (deduped.length !== 3) return null
    if (deduped.some((element) => !available_elements.includes(element))) return null
    return deduped
  }

  let formula_picker_open = $state(false)

  // Mutual exclusion: only one pane open at a time.
  // Separate effects so each reacts to its own pane opening independently —
  // a single $derived ternary would create priority ordering where opening
  // a "lower" pane while a "higher" one is open fails silently.
  $effect(() => {
    if (export_pane_open) {
      formula_picker_open = false
      controls_open = false
    }
  })
  $effect(() => {
    if (formula_picker_open) {
      export_pane_open = false
      controls_open = false
    }
  })
  $effect(() => {
    if (controls_open) {
      export_pane_open = false
      formula_picker_open = false
    }
  })
  let container_width = $state(0)
  let container_height = $state(0)
  const base_aspect_ratio = $derived(height > 0 && width > 0 ? height / width : 1)
  const render_width = $derived(container_width > 0 ? container_width : width)
  const render_height = $derived(
    fullscreen
      ? container_height > 0
        ? container_height
        : height
      : Math.round(render_width * base_aspect_ratio),
  )

  let mounted = $state(false)
  onMount(() => (mounted = true))
  let orbit_controls_ref = $state<SceneProps[`orbit_controls`]>()
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

  function to_vec3(pt: number[]): THREE.Vector3 {
    const [x_val, y_val, z_val] = to_render_xyz(pt)
    return new THREE.Vector3(x_val, y_val, z_val)
  }

  // Compute diagram data (requires >= 3 elements for 3D rendering)
  const { has_temp_data, available_temperatures, temp_filtered_entries } = $derived(
    get_temp_filter_payload(entries, temperature, config, {
      interpolate_temperature,
      max_interpolation_gap,
    }),
  )

  // Keep bound temperature aligned with available data points.
  $effect(() => {
    const next_temperature = get_valid_temperature(
      temperature,
      has_temp_data,
      available_temperatures,
    )
    if (next_temperature !== temperature) temperature = next_temperature
  })

  const show_temperature_slider = $derived(has_temp_data && available_temperatures.length > 0)

  const projection_source_entries = $derived(
    get_projection_source_entries(entries, temp_filtered_entries),
  )

  const all_entry_elements = $derived.by(() => {
    const elements = projection_source_entries.flatMap((entry) =>
      Object.entries(entry.composition)
        .filter(([, amount]) => amount > 0)
        .map(([element]) => element),
    )
    return Array.from(new SvelteSet(elements)).toSorted()
  })
  const has_multinary_system = $derived(all_entry_elements.length > 3)
  let projection_elements_override = $state<string[] | null>(null)
  const config_projection_elements = $derived(
    normalize_projection_triplet(config.elements, all_entry_elements),
  )
  const projection_elements = $derived.by(() => {
    if (all_entry_elements.length < 3) return []
    // User-picked projection axes only apply to multinary (4+ element) systems
    const override_projection = has_multinary_system
      ? normalize_projection_triplet(
          projection_elements_override ?? undefined,
          all_entry_elements,
        )
      : null
    return override_projection ?? config_projection_elements ?? all_entry_elements.slice(0, 3)
  })
  const effective_config = $derived({
    ...config,
    elements: projection_elements.length === 3 ? projection_elements : config.elements,
    formal_chempots,
    label_stable,
    element_padding,
    default_min_limit,
    draw_formula_meshes,
    draw_formula_lines,
  })
  let diagram_data = $state<ChemPotDiagramData | null>(null)
  let diagram_computing = $state(false)
  $effect(() => {
    if (temp_filtered_entries.length < 3) {
      diagram_data = null
      diagram_computing = false
      return
    }
    let cancelled = false
    diagram_computing = true
    compute_chempot_async(temp_filtered_entries, effective_config)
      .then((data) => {
        if (cancelled) return
        diagram_data = data.elements.length >= 3 ? data : null
        diagram_computing = false
      })
      .catch((err) => {
        if (cancelled) return
        console.error(`ChemPotDiagram3D:`, err)
        diagram_data = null
        diagram_computing = false
      })
    return () => {
      cancelled = true
    }
  })

  const plot_elements = $derived(diagram_data?.elements ?? projection_elements)
  const is_projection_mode = $derived(
    plot_elements.length > 0 &&
      plot_elements.length < all_entry_elements.length &&
      plot_elements.every((element) => all_entry_elements.includes(element)),
  )
  const projection_presets = $derived.by(() => {
    const presets: string[][] = []
    const seen = new Set<string>()
    const add_triplet = (candidate: string[] | null): void => {
      if (!candidate) return
      const key = candidate.join(`|`)
      if (seen.has(key)) return
      seen.add(key)
      presets.push(candidate)
    }
    add_triplet(config_projection_elements)
    add_triplet(plot_elements.length === 3 ? plot_elements : null)
    for (const combo of get_ternary_combinations(all_entry_elements)) {
      add_triplet(combo)
      if (presets.length >= 12) break
    }
    return presets
  })
  const current_projection_key = $derived(plot_elements.join(`|`))
  let formula_filter_query = $state(``)
  const available_formulas = $derived(Object.keys(diagram_data?.domains ?? {}).toSorted())
  const filtered_formulas = $derived.by(() => {
    const query = formula_filter_query.trim().toLowerCase()
    if (!query) return available_formulas
    return available_formulas.filter((formula) => formula.toLowerCase().includes(query))
  })

  // Outline (boundary edges) and label anchor per domain. Planar domains (every domain of a
  // true ternary lies on its entry's hyperplane) take the PCA-projected 2D hull; projections
  // of quaternary+ systems yield polyhedra, whose crease edges come from a 3D hull instead.
  // Cached by vertex content: domains recur unchanged across control toggles that rebuild
  // render_domains (colors, overlays), and the hulls are the costly part.
  const domain_outline_cache = new Map<
    string,
    { edges: [number[], number[]][]; ann_loc: number[] }
  >()
  function get_domain_outline(points_3d: number[][]) {
    const cache_key = points_3d.map((point) => point.join(`,`)).join(`;`)
    const cached = domain_outline_cache.get(cache_key)
    if (cached) return cached
    const { simplex_indices, ann_loc, is_planar } =
      get_3d_domain_simplexes_and_ann_loc(points_3d)
    const planar_edges = simplex_indices.map(([idx_a, idx_b]): [number[], number[]] => [
      points_3d[idx_a],
      points_3d[idx_b],
    ])
    const outline = { edges: is_planar ? planar_edges : hull_crease_edges(points_3d), ann_loc }
    domain_outline_cache.set(cache_key, outline)
    return outline
  }

  // Crease edges (dihedral angle > 1°) of the 3D convex hull, as point pairs in the input
  // coordinates. Degenerate hulls (ConvexGeometry throws) fall back to an empty outline.
  function hull_crease_edges(points_3d: number[][]): [number[], number[]][] {
    try {
      const hull = new ConvexGeometry(
        dedup_3d(points_3d).map(
          ([x_val, y_val, z_val]) => new THREE.Vector3(x_val, y_val, z_val),
        ),
      )
      const creases = new THREE.EdgesGeometry(hull)
      hull.dispose()
      const coords = creases.getAttribute(`position`).array
      creases.dispose()
      const edges: [number[], number[]][] = []
      for (let offset = 0; offset + 5 < coords.length; offset += 6) {
        edges.push([
          [coords[offset], coords[offset + 1], coords[offset + 2]],
          [coords[offset + 3], coords[offset + 4], coords[offset + 5]],
        ])
      }
      return edges
    } catch {
      return []
    }
  }

  const render_domains = $derived.by((): RenderDomain[] => {
    if (!diagram_data || plot_elements.length < 2) return []

    const dim = diagram_data.elements.length
    const indices = Array.from({ length: dim }, (_, idx) => idx)
    const new_lims =
      element_padding > 0
        ? apply_element_padding(
            diagram_data.domains,
            indices,
            element_padding,
            default_min_limit,
          )
        : null

    const result: RenderDomain[] = []
    for (const [formula, pts] of Object.entries(diagram_data.domains)) {
      const padded = new_lims
        ? pad_domain_points(pts, indices, new_lims, default_min_limit, element_padding)
        : pts
      if (padded.length < 2) continue
      const { edges, ann_loc } = get_domain_outline(padded)
      result.push({
        formula,
        points_3d: padded,
        edges,
        ann_loc,
        is_draw_formula: formulas_to_draw.includes(formula),
        label_font_size: bbox_diagonal(padded),
      })
    }
    const fonts = scale_to_font_range(
      result.map((render_domain) => render_domain.label_font_size),
      9,
      15,
    )
    for (let idx = 0; idx < result.length; idx++) result[idx].label_font_size = fonts[idx]
    return result
  })

  const entry_energy_stats_by_formula = $derived(
    get_energy_stats_by_formula(temp_filtered_entries),
  )

  // === Region coloring ===
  // Original (non-renormalized) elemental references for formation energy computation.
  // diagram_data.el_refs may be renormalized to zero when formal_chempots is true,
  // so we compute our own from the raw entries to get true DFT reference energies.
  const raw_el_refs = $derived(get_min_entries_and_el_refs(temp_filtered_entries).el_refs)

  const { colors: domain_colors, color_range } = $derived(
    get_domain_color_data({
      formulas: render_domains.map((domain) => domain.formula),
      color_mode,
      color_scale,
      reverse_color_scale,
      entries: temp_filtered_entries,
      el_refs: raw_el_refs,
      energy_stats: entry_energy_stats_by_formula,
    }),
  )

  const arity_legend_labels = $derived.by((): string[] => {
    let has_four_plus_regions = false
    for (const domain of render_domains) {
      if (extract_formula_elements(domain.formula).length >= 4) {
        has_four_plus_regions = true
        break
      }
    }
    return has_four_plus_regions
      ? [`Unary`, `Binary`, `Ternary`, `4+`]
      : [`Unary`, `Binary`, `Ternary`]
  })

  // Stretch short axes to improve screen-space utilization for highly anisotropic systems.
  // Mapping is in rendered axis order: X=data[1], Y=data[2], Z=data[0].
  const render_axis_scale = $derived.by((): Vec3 => {
    const points = render_domains.flatMap((domain) => domain.points_3d)
    if (points.length === 0) return [1, 1, 1]
    let min0 = Infinity,
      max0 = -Infinity
    let min1 = Infinity,
      max1 = -Infinity
    let min2 = Infinity,
      max2 = -Infinity
    for (const point of points) {
      if (point[0] < min0) min0 = point[0]
      if (point[0] > max0) max0 = point[0]
      if (point[1] < min1) min1 = point[1]
      if (point[1] > max1) max1 = point[1]
      if (point[2] < min2) min2 = point[2]
      if (point[2] > max2) max2 = point[2]
    }
    const span_x = Math.max(max1 - min1, 1e-6) // render X from data axis 1
    const span_y = Math.max(max2 - min2, 1e-6) // render Y from data axis 2
    const span_z = Math.max(max0 - min0, 1e-6) // render Z from data axis 0
    const max_span = Math.max(span_x, span_y, span_z)
    return [
      Math.min(Math.max(max_span / span_x, 1), 4),
      Math.min(Math.max(max_span / span_y, 1), 4),
      Math.min(Math.max(max_span / span_z, 1), 4),
    ]
  })

  // Swizzle a data-coord triple to Three.js coords; ChemPotScene3D frames the axes with the same
  const swiz = $derived(swizzle_to_render(render_axis_scale))
  const to_render_xyz = (point: number[]): Vec3 => swiz(point[0], point[1], point[2])

  // Compute data center and extent for camera positioning (in swizzled coords)
  const { data_center, data_extent } = $derived.by(() => {
    const points = render_domains.flatMap((domain) => domain.points_3d)
    if (points.length === 0) return { data_center: [0, 0, 0] as Vec3, data_extent: 10 }
    // Compute center in rendered coordinates (swizzled + axis scaling).
    let [sum_x, sum_y, sum_z] = [0, 0, 0]
    for (const point_3d of points) {
      const [x_val, y_val, z_val] = to_render_xyz(point_3d)
      sum_x += x_val
      sum_y += y_val
      sum_z += z_val
    }
    const n_points = points.length
    const center: Vec3 = [sum_x / n_points, sum_y / n_points, sum_z / n_points]
    // Compute max distance from center
    let max_dist = 0
    for (const point of points) {
      const [x_val, y_val, z_val] = to_render_xyz(point)
      const dist = Math.hypot(x_val - center[0], y_val - center[1], z_val - center[2])
      if (dist > max_dist) max_dist = dist
    }
    return { data_center: center, data_extent: Math.max(max_dist * 1.3, 1) }
  })
  const default_camera_position = $derived<Vec3>([
    data_center[0] + data_extent,
    data_center[1] + data_extent,
    data_center[2] + data_extent,
  ])
  const default_camera_target = $derived<Vec3>([...data_center])
  const default_orthographic_zoom = $derived(
    Math.min(render_width, render_height) / (data_extent * 1.6),
  )
  let camera_position_override = $state<Vec3 | null>(null)
  let camera_target_override = $state<Vec3 | null>(null)
  let orthographic_zoom_override = $state<number | null>(null)
  const camera_position = $derived(camera_position_override ?? default_camera_position)
  const camera_target = $derived(camera_target_override ?? default_camera_target)
  const orthographic_zoom = $derived(orthographic_zoom_override ?? default_orthographic_zoom)
  // Label scale factor: zoom relative to default, so labels grow/shrink with zoom
  // Labels scale sub-linearly with zoom so they grow but don't dominate when zoomed in
  const zoom_scale = $derived(
    default_orthographic_zoom > 0
      ? Math.sqrt(orthographic_zoom / default_orthographic_zoom)
      : 1,
  )
  let last_data_center: Vec3 | null = null
  let last_default_zoom: number | null = null

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
      for (const [pt_a, pt_b] of domain.edges) {
        // round so a shared edge whose endpoints came from different hyperplane triples
        // (equal to ~1e-12, not bit-identical) is still drawn once
        const point_key = (point: number[]) => point.map((val) => val.toFixed(4)).join(`,`)
        const key = edge_key(point_key(pt_a), point_key(pt_b))
        if (seen.has(key)) continue
        seen.add(key)
        positions.push(...to_render_xyz(pt_a), ...to_render_xyz(pt_b))
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
    try {
      const all_points: number[][] = []
      for (const domain of render_domains) {
        if (domain.is_draw_formula) continue
        all_points.push(...domain.points_3d)
      }
      const unique_points = dedup_3d(all_points)
      if (unique_points.length < 4) return null
      const vectors = unique_points.map((point) => to_vec3(point))
      return merge_coplanar_geometry(new ConvexGeometry(vectors))
    } catch {
      return null
    }
  })

  // Non-indexed hull geometry with artificial closing faces removed.
  // The convex hull includes faces that close the diagram at the lower axis
  // limits — flat walls and diagonal closing triangles. These are artificial
  // (they depend on how far we extend the axes) and clutter the view.
  // We detect them via their outward-pointing face normal: closing faces have
  // normals pointing entirely toward the negative octant (all components ≤ 0),
  // while meaningful domain boundaries always have at least one positive
  // normal component (pointing toward 0 eV / the elemental reference).
  const hull_base_geometry = $derived.by((): THREE.BufferGeometry | null => {
    if (!occlusion_hull_geometry) return null
    // merge_coplanar_geometry already returns non-indexed geometry, so read its positions
    // directly (the filter below builds a fresh buffer and never mutates this one)
    const pos = occlusion_hull_geometry.getAttribute(`position`)
    const n_verts = pos.count
    const n_faces = n_verts / 3
    // Hull centroid for orienting face normals outward
    let hx = 0,
      hy = 0,
      hz = 0
    for (let vert_idx = 0; vert_idx < n_verts; vert_idx++) {
      hx += pos.getX(vert_idx)
      hy += pos.getY(vert_idx)
      hz += pos.getZ(vert_idx)
    }
    hx /= n_verts
    hy /= n_verts
    hz /= n_verts
    const kept: number[] = []
    for (let face_idx = 0; face_idx < n_faces; face_idx++) {
      const base = face_idx * 3
      const va: Vec3 = [pos.getX(base), pos.getY(base), pos.getZ(base)]
      const vb: Vec3 = [pos.getX(base + 1), pos.getY(base + 1), pos.getZ(base + 1)]
      const vc: Vec3 = [pos.getX(base + 2), pos.getY(base + 2), pos.getZ(base + 2)]
      // Face normal via cross product of two edges
      let normal = cross_3d(
        [vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]],
        [vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]],
      )
      // Orient outward (away from hull centroid)
      const dx = (va[0] + vb[0] + vc[0]) / 3 - hx
      const dy = (va[1] + vb[1] + vc[1]) / 3 - hy
      const dz = (va[2] + vb[2] + vc[2]) / 3 - hz
      if (normal[0] * dx + normal[1] * dy + normal[2] * dz < 0) {
        normal = [-normal[0], -normal[1], -normal[2]]
      }
      // Closing faces point entirely toward negative octant (all ≤ 0).
      // Meaningful domain faces always have at least one positive component.
      if (normal[0] <= 0 && normal[1] <= 0 && normal[2] <= 0) continue
      kept.push(...va, ...vb, ...vc)
    }
    // Re-merge coplanar faces after the filter — the closing-face removal
    // can expose new coplanar adjacencies or leave fragments that should be
    // merged into cleaner fan triangulations.
    const merged = merge_coplanar_triangles(new Float32Array(kept))
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(`position`, new THREE.Float32BufferAttribute(merged, 3))
    const base_rgb = new THREE.Color(`#f6f6f6`).toArray()
    const colors = Float32Array.from({ length: merged.length }, (_, idx) => base_rgb[idx % 3])
    geom.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3))
    return geom
  })

  // Per-face domain assignment (stable — only changes when geometry or domains change).
  // Uses actual vertex centroid (mean of points_3d) for robust nearest-face matching.
  const face_domain_map = $derived.by((): string[] => {
    if (!hull_base_geometry) return []
    const pos = hull_base_geometry.getAttribute(`position`)
    const n_faces = pos.count / 3

    // Domain vertex centroids in render coords (swizzled + axis stretch), matching hull_base_geometry.
    const centroids = render_domains
      .filter((domain) => !domain.is_draw_formula && domain.points_3d.length > 0)
      .map((domain) => {
        let sx = 0,
          sy = 0,
          sz = 0
        for (const pt of domain.points_3d) {
          const [x_val, y_val, z_val] = to_render_xyz(pt)
          sx += x_val
          sy += y_val
          sz += z_val
        }
        const n_points = domain.points_3d.length
        return {
          formula: domain.formula,
          cx: sx / n_points,
          cy: sy / n_points,
          cz: sz / n_points,
        }
      })

    // Assign each face to the nearest domain centroid
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

    // Unify coplanar adjacent faces to the majority domain so that fan
    // triangulation edges within a single hull face don't create visible
    // color boundaries. Build adjacency via shared edge keys, group
    // coplanar neighbors, then assign each group to its most-common domain.
    if (n_faces > 1) {
      const tol = 1e-3
      const round = (val: number): number => Math.round(val / tol)
      const vkey = (vert_idx: number): string =>
        `${round(pos.getX(vert_idx))},${round(pos.getY(vert_idx))},${round(
          pos.getZ(vert_idx),
        )}`
      // Compute face normals
      const normals: Vec3[] = []
      for (let face_idx = 0; face_idx < n_faces; face_idx++) {
        const base = face_idx * 3
        const e1: Vec3 = [
          pos.getX(base + 1) - pos.getX(base),
          pos.getY(base + 1) - pos.getY(base),
          pos.getZ(base + 1) - pos.getZ(base),
        ]
        const e2: Vec3 = [
          pos.getX(base + 2) - pos.getX(base),
          pos.getY(base + 2) - pos.getY(base),
          pos.getZ(base + 2) - pos.getZ(base),
        ]
        normals.push(normalize_vec(cross_3d(e1, e2)))
      }
      // Build edge → face adjacency
      const edge_faces = new SvelteMap<string, number[]>()
      for (let face_idx = 0; face_idx < n_faces; face_idx++) {
        const base = face_idx * 3
        const keys = [vkey(base), vkey(base + 1), vkey(base + 2)]
        for (const ek of [
          edge_key(keys[0], keys[1]),
          edge_key(keys[1], keys[2]),
          edge_key(keys[0], keys[2]),
        ]) {
          const list = edge_faces.get(ek)
          if (list) list.push(face_idx)
          else edge_faces.set(ek, [face_idx])
        }
      }
      // Union-find for coplanar adjacent faces
      const parent = Array.from({ length: n_faces }, (_, idx) => idx)
      const find = (node: number): number => {
        while (parent[node] !== node) {
          parent[node] = parent[parent[node]]
          node = parent[node]
        }
        return node
      }
      const union = (a_idx: number, b_idx: number): void => {
        const ra = find(a_idx),
          rb = find(b_idx)
        if (ra !== rb) parent[ra] = rb
      }
      for (const pair of edge_faces.values()) {
        if (pair.length !== 2) continue
        const [fa, fb] = pair
        const na = normals[fa],
          nb = normals[fb]
        if (Math.abs(na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]) > 1 - tol) {
          union(fa, fb)
        }
      }
      // Assign majority domain to each coplanar group
      const groups = new SvelteMap<number, number[]>()
      for (let face_idx = 0; face_idx < n_faces; face_idx++) {
        const root = find(face_idx)
        const grp = groups.get(root)
        if (grp) grp.push(face_idx)
        else groups.set(root, [face_idx])
      }
      for (const members of groups.values()) {
        if (members.length < 2) continue
        // Find most common domain in this group
        const counts = new SvelteMap<string, number>()
        for (const member_idx of members) {
          counts.set(result[member_idx], (counts.get(result[member_idx]) ?? 0) + 1)
        }
        let majority = result[members[0]]
        let max_count = 0
        for (const [formula, count] of counts) {
          if (count > max_count) {
            max_count = count
            majority = formula
          }
        }
        for (const member_idx of members) result[member_idx] = majority
      }
    }

    return result
  })

  // Faces no domain claims. Hoisted because a THREE.Color per recompute is pure waste.
  const HULL_FALLBACK_RGB = new THREE.Color(`#e8e8e8`).toArray() as Vec3

  // Reactive color fill: creates a cloned geometry with vertex colors applied.
  // Only runs when color_mode or domain_colors change — no mutation of hull_base_geometry.
  const colored_hull_geometry = $derived.by((): THREE.BufferGeometry | null => {
    const mapping = face_domain_map
    if (!hull_base_geometry || mapping.length === 0) return hull_base_geometry
    if (color_mode === `none` || domain_colors.size === 0) return hull_base_geometry

    const geom = hull_base_geometry.clone()
    const color_attr = geom.getAttribute(`color`) as THREE.BufferAttribute

    // Cache parsed RGB per formula to avoid redundant THREE.Color allocations
    const rgb_cache = new SvelteMap<string, Vec3>()
    for (const [formula, hex] of domain_colors) {
      const clr = new THREE.Color(hex)
      rgb_cache.set(formula, [clr.r, clr.g, clr.b])
    }

    for (let face_idx = 0; face_idx < mapping.length; face_idx++) {
      const rgb = rgb_cache.get(mapping[face_idx])
      const [red, green, blue] = rgb ?? HULL_FALLBACK_RGB
      const base = face_idx * 3
      for (let vert_idx = 0; vert_idx < 3; vert_idx++) {
        color_attr.setXYZ(base + vert_idx, red, green, blue)
      }
    }
    color_attr.needsUpdate = true
    return geom
  })

  // Uncolored hulls read as a faint envelope; colored ones have to carry their hue
  const hull_opacity = $derived(color_mode === `none` ? 0.25 : 0.4)

  const domain_label = (domain: RenderDomain): VisibleDomainLabel => ({
    formula: domain.formula,
    position: swiz(domain.ann_loc[0], domain.ann_loc[1], domain.ann_loc[2]),
    label_font_size: domain.label_font_size,
  })

  const visible_domain_labels = $derived.by((): VisibleDomainLabel[] => {
    if (!hull_base_geometry || face_domain_map.length === 0) {
      return render_domains.map(domain_label)
    }

    const pos = hull_base_geometry.getAttribute(`position`)
    const pinned_labels = render_domains
      .filter((domain) => domain.is_draw_formula)
      .map(domain_label)
    const font_size_by_formula = new SvelteMap(
      render_domains.map((domain) => [domain.formula, domain.label_font_size]),
    )
    return get_visible_domain_labels(
      pos.array,
      face_domain_map,
      font_size_by_formula,
      pinned_labels,
    )
  })

  // Pre-format the formulas so the scene component only has to place the labels
  const scene_domain_labels = $derived(
    label_stable
      ? visible_domain_labels.map((label) => ({
          ...label,
          segments: formula_label_segments(label.formula),
        }))
      : [],
  )

  dispose_on_change(() => [hull_base_geometry])
  // Don't dispose colored hull if it's the same object as hull_base_geometry (no clone made)
  dispose_on_change(() =>
    colored_hull_geometry !== hull_base_geometry ? [colored_hull_geometry] : [],
  )

  // Domains on the outer surface (used by the "Surface" formula overlay quick-select).
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
  const dedup_3d = (pts: number[][], tol: number = 1e-4): number[][] =>
    dedup_points(pts, tol).unique

  const controls_series = $derived<DataSeries3D[]>([
    {
      x: render_domains.flatMap((domain) => domain.points_3d.map((point) => point[1])),
      y: render_domains.flatMap((domain) => domain.points_3d.map((point) => point[2])),
      z: render_domains.flatMap((domain) => domain.points_3d.map((point) => point[0])),
      label: `domains`,
    },
  ])

  // Build formula overlay edge geometries (per formula, colored) using crease edges
  const formula_edge_data = $derived.by(() => {
    if (!draw_formula_lines || formulas_to_draw.length === 0) return []
    const result: { geometry: THREE.BufferGeometry; color: string }[] = []
    for (const domain of render_domains) {
      if (!domain.is_draw_formula) continue
      const color_idx = formulas_to_draw.indexOf(domain.formula) % formula_colors.length
      const positions = domain.edges.flatMap(([pt_a, pt_b]) => [
        ...to_render_xyz(pt_a),
        ...to_render_xyz(pt_b),
      ])
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
      const color_idx = formulas_to_draw.indexOf(domain.formula) % formula_colors.length
      const unique = dedup_3d(domain.points_3d)
      if (unique.length < 4) continue
      const vectors = unique.map((pt) => to_vec3(pt))
      try {
        const geom = merge_coplanar_geometry(new ConvexGeometry(vectors))
        result.push({ geometry: geom, color: formula_colors[color_idx] })
      } catch {
        // Degenerate hull, skip
      }
    }
    return result
  })

  function get_touches_limits(points_3d: number[][], lims: Vec2[]): string[] {
    const limit_tol = 1e-3
    const touches_limits: string[] = []
    for (
      let axis_idx = 0;
      axis_idx < Math.min(plot_elements.length, lims.length);
      axis_idx++
    ) {
      const [axis_min, axis_max] = lims[axis_idx]
      const axis_name = plot_elements[axis_idx] ?? `axis_${axis_idx}`
      const touches_min = points_3d.some(
        (point) => Math.abs(point[axis_idx] - axis_min) < limit_tol,
      )
      const touches_max = points_3d.some(
        (point) => Math.abs(point[axis_idx] - axis_max) < limit_tol,
      )
      if (touches_min) touches_limits.push(`${axis_name} lower bound`)
      if (touches_max) touches_limits.push(`${axis_name} upper bound`)
    }
    return touches_limits
  }

  // Post-process ConvexGeometry to merge coplanar triangles, eliminating
  // internal diagonal edges across flat faces of the convex hull.
  function merge_coplanar_geometry(geom: THREE.BufferGeometry): THREE.BufferGeometry {
    const non_indexed = geom.index ? geom.toNonIndexed() : geom
    const pos = non_indexed.getAttribute(`position`)
    const merged = merge_coplanar_triangles(pos.array as Float32Array)
    const result = new THREE.BufferGeometry()
    result.setAttribute(`position`, new THREE.Float32BufferAttribute(merged, 3))
    result.computeVertexNormals()
    // Dispose intermediate geometry from toNonIndexed() (avoid double-dispose if same object)
    if (non_indexed !== geom) non_indexed.dispose()
    // Callers always pass a freshly created ConvexGeometry, so we own it
    geom.dispose()
    return result
  }

  function create_hover_geometry(
    points_3d: number[][],
  ): { geometry: THREE.BufferGeometry; n_vertices: number } | null {
    const unique_points = dedup_3d(points_3d)
    if (unique_points.length < 3) return null
    // For exactly 3 unique points (planar/degenerate domain), create a triangle
    // geometry directly since ConvexGeometry requires 4+ points for a 3D hull
    if (unique_points.length === 3) {
      const geom = new THREE.BufferGeometry()
      const vectors = unique_points.map((pt) => to_vec3(pt))
      const verts = new Float32Array(vectors.flatMap((vec) => [vec.x, vec.y, vec.z]))
      geom.setAttribute(`position`, new THREE.Float32BufferAttribute(verts, 3))
      geom.setIndex([0, 1, 2, 2, 1, 0]) // both winding orders for double-sided pick
      geom.computeVertexNormals()
      return { geometry: geom, n_vertices: 3 }
    }
    try {
      return {
        geometry: merge_coplanar_geometry(
          new ConvexGeometry(unique_points.map((point) => to_vec3(point))),
        ),
        n_vertices: unique_points.length,
      }
    } catch {
      return null
    }
  }

  // Domain adjacency: two domains are neighbors if they share any vertex (within tolerance)
  const domain_neighbors = $derived.by((): SvelteMap<string, string[]> => {
    const tol = 1e-4
    const vertex_owners = new SvelteMap<string, string[]>()
    for (const domain of render_domains) {
      for (const pt of domain.points_3d) {
        const key = pt.map((val) => (Math.round(val / tol) * tol).toFixed(4)).join(`,`)
        const owners = vertex_owners.get(key)
        if (owners) {
          if (!owners.includes(domain.formula)) owners.push(domain.formula)
        } else vertex_owners.set(key, [domain.formula])
      }
    }
    const neighbors = new SvelteMap<string, SvelteSet<string>>()
    for (const domain of render_domains) {
      neighbors.set(domain.formula, new SvelteSet())
    }
    for (const owners of vertex_owners.values()) {
      if (owners.length < 2) continue
      for (let idx = 0; idx < owners.length; idx++) {
        for (let jdx = idx + 1; jdx < owners.length; jdx++) {
          neighbors.get(owners[idx])?.add(owners[jdx])
          neighbors.get(owners[jdx])?.add(owners[idx])
        }
      }
    }
    const result = new SvelteMap<string, string[]>()
    for (const [formula, set] of neighbors) result.set(formula, [...set].toSorted())
    return result
  })

  const hover_mesh_data = $derived.by((): HoverMesh[] => {
    if (!diagram_data) return []
    const result: HoverMesh[] = []
    const lims = diagram_data.lims
    const energy_stats_by_formula = entry_energy_stats_by_formula

    for (const domain of render_domains) {
      if (domain.points_3d.length < 3) continue
      const hover_geometry = create_hover_geometry(domain.points_3d)
      if (!hover_geometry) continue
      const { geometry, n_vertices } = hover_geometry

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
        n_edges: domain.edges.length,
        n_points: domain.points_3d.length,
        ann_loc: domain.ann_loc,
        axis_ranges,
        touches_limits,
        is_elemental: all_entry_elements.includes(domain.formula),
        is_draw_formula: domain.is_draw_formula,
        matching_entry_count: energy_stats.matching_entry_count,
        min_energy_per_atom: energy_stats.min_energy_per_atom,
        max_energy_per_atom: energy_stats.max_energy_per_atom,
        neighbors: domain_neighbors.get(domain.formula) ?? [],
      }

      result.push({
        formula: domain.formula,
        geometry,
        info,
      })
    }
    return result
  })

  dispose_on_change(() => [edge_geometry])
  dispose_on_change(() => [occlusion_hull_geometry])
  dispose_on_change(() => formula_edge_data.map((data) => data.geometry))
  dispose_on_change(() => formula_mesh_data.map((data) => data.geometry))
  dispose_on_change(() => hover_mesh_data.map((data) => data.geometry))

  let label_occlusion_frame: number | null = null
  let tick_labels_occluded = false
  const has_occluding_domain_labels = $derived(
    label_stable && visible_domain_labels.length > 0,
  )
  const can_update_label_occlusion = $derived(
    mounted &&
      display.show_axis_labels &&
      Number.isFinite(zoom_scale) &&
      container_width > 0 &&
      container_height > 0,
  )

  function update_label_occlusion(): void {
    if (!wrapper) return
    const tick_labels = Array.from(wrapper.querySelectorAll<HTMLElement>(`.axis-tick-label`))
    tick_labels_occluded = false
    for (const tick_label of tick_labels) {
      tick_label.style.visibility = ``
    }
    const domain_rects = Array.from(wrapper.querySelectorAll<HTMLElement>(`.domain-label`))
      .filter((label_el) => {
        const style = getComputedStyle(label_el)
        return style.display !== `none` && style.visibility !== `hidden`
      })
      .map((label_el) => pad_rect(label_el.getBoundingClientRect(), 1))
    if (domain_rects.length === 0) return

    for (const tick_label of tick_labels) {
      const style = getComputedStyle(tick_label)
      if (style.display === `none` || style.visibility === `hidden`) continue
      const tick_rect = tick_label.getBoundingClientRect()
      if (domain_rects.some((domain_rect) => rects_overlap(tick_rect, domain_rect))) {
        tick_label.style.visibility = `hidden`
        tick_labels_occluded = true
      }
    }
  }

  function schedule_label_occlusion_update(): void {
    if (typeof requestAnimationFrame === `undefined`) return
    if (label_occlusion_frame !== null) cancelAnimationFrame(label_occlusion_frame)
    label_occlusion_frame = requestAnimationFrame(() => {
      label_occlusion_frame = null
      update_label_occlusion()
    })
  }

  // OrbitControls dispatches `change` only once the camera has moved past its own epsilon, so
  // any change arriving mid-gesture is real movement — measured: a bare click emits start/end
  // with no change at all. Auto-rotation drives `change` with no `start`, and must not pin.
  let gesture_active = false
  const on_gesture_edge = (event: { type: string }): void => {
    gesture_active = event.type === `start`
    // Prime the framing baseline on first interaction so the next geometry change can
    // preserve zoom/center immediately (not only from the second change).
    if (gesture_active) last_data_center ??= [...data_center]
    else gesture_had_input = false
  }

  // With auto-rotation on, `change` fires every frame, so a bare click's `start` would be
  // enough to pin the framing for good. Intent has to come from the input itself. Capture
  // phase on the wrapper, because OrbitControls dispatches start/change/end synchronously
  // inside the wheel event and a listener on the canvas would land after all three.
  let gesture_had_input = false
  // a wheel always counts; a pointer only with a button held, since hovering is not a gesture
  const mark_input = (event: Event): void => {
    if (!(event instanceof PointerEvent) || event.buttons > 0) gesture_had_input = true
  }

  // Drop the pinned view and hand framing back to the derived defaults.
  function reset_camera_view(): void {
    camera_position_override = null
    camera_target_override = null
    orthographic_zoom_override = null
    last_data_center = null
    gesture_active = false
    gesture_had_input = false
    const controls = orbit_controls_ref
    if (!controls) return
    const controls_camera = controls.object
    // Written straight to the camera rather than left to the props: the defaults are known
    // synchronously, and controls.update() below would otherwise run against the stale pose.
    controls_camera.position.set(...default_camera_position)
    controls.target.set(...default_camera_target)
    if (controls_camera instanceof THREE.OrthographicCamera) {
      controls_camera.zoom = default_orthographic_zoom
      controls_camera.updateProjectionMatrix()
    }
    controls.update()
  }

  // Preserve user framing across temperature-driven geometry changes:
  // shift camera/target with domain center and keep orthographic zoom relative to extent.
  $effect(() => {
    if (camera_position_override && camera_target_override && last_data_center) {
      const [last_x, last_y, last_z] = last_data_center
      const delta_x = data_center[0] - last_x
      const delta_y = data_center[1] - last_y
      const delta_z = data_center[2] - last_z
      if (delta_x !== 0 || delta_y !== 0 || delta_z !== 0) {
        camera_position_override = [
          camera_position_override[0] + delta_x,
          camera_position_override[1] + delta_y,
          camera_position_override[2] + delta_z,
        ]
        camera_target_override = [
          camera_target_override[0] + delta_x,
          camera_target_override[1] + delta_y,
          camera_target_override[2] + delta_z,
        ]
      }
    }
    orthographic_zoom_override = rescale_zoom_to_fit(
      orthographic_zoom_override,
      last_default_zoom,
      default_orthographic_zoom,
    )
    last_data_center = [...data_center]
    // A zero fit means the container has no size yet; keep the last real one as the baseline
    // so the pinned zoom resumes from it rather than losing a rescale step.
    if (default_orthographic_zoom > 0) last_default_zoom = default_orthographic_zoom
  })

  $effect(() => {
    const controls = orbit_controls_ref
    if (!controls) return
    const on_controls_change = (): void => {
      // Once pinned keep tracking; before that only a live gesture may pin. Reading allocates
      // two arrays, and auto-rotation fires this every frame, so stay out of that path.
      if (camera_position_override || (gesture_active && gesture_had_input)) {
        const { object: cam, target } = controls
        camera_position_override = [cam.position.x, cam.position.y, cam.position.z]
        camera_target_override = [target.x, target.y, target.z]
        // a perspective camera dollies instead, leaving zoom at 1
        if (cam instanceof THREE.OrthographicCamera) orthographic_zoom_override = cam.zoom
      }
      if (has_occluding_domain_labels) schedule_label_occlusion_update()
    }
    controls.addEventListener(`start`, on_gesture_edge)
    controls.addEventListener(`change`, on_controls_change)
    controls.addEventListener(`end`, on_gesture_edge)
    controls.update()
    return () => {
      controls.removeEventListener(`start`, on_gesture_edge)
      controls.removeEventListener(`change`, on_controls_change)
      controls.removeEventListener(`end`, on_gesture_edge)
    }
  })

  $effect(() => {
    if (!can_update_label_occlusion) return
    if (!has_occluding_domain_labels && !tick_labels_occluded) return
    schedule_label_occlusion_update()
  })

  function reset_controls(): void {
    overrides.reset()
    projection_elements_override = null
    formula_filter_query = ``
    reset_camera_view()
  }

  // Controls and panes own their own double-click, but passive render overlays must not
  // swallow reset. `closest` handles clicks reported by a control's child.
  const handle_dblclick = ({ target }: MouseEvent): void => {
    const on_chrome =
      target instanceof Element && target.closest(`button, input, select, .draggable-pane`)
    if (!on_chrome) reset_camera_view()
  }

  function set_projection_axis(axis_idx: number, element: string): void {
    if (!all_entry_elements.includes(element)) return
    const next_projection = [...plot_elements]
    if (next_projection.length !== 3) return
    const current_owner_idx = next_projection.indexOf(element)
    if (current_owner_idx !== -1 && current_owner_idx !== axis_idx) {
      next_projection[current_owner_idx] = next_projection[axis_idx]
    }
    next_projection[axis_idx] = element
    const normalized = normalize_projection_triplet(next_projection, all_entry_elements)
    if (normalized) projection_elements_override = normalized
  }

  function apply_projection_preset(preset_elements: string[]): void {
    const normalized = normalize_projection_triplet(preset_elements, all_entry_elements)
    if (normalized) projection_elements_override = normalized
  }

  function toggle_formula_selection(formula: string): void {
    const selected_formulas = new SvelteSet(formulas_to_draw)
    if (selected_formulas.has(formula)) selected_formulas.delete(formula)
    else selected_formulas.add(formula)
    overrides.set(`formulas_to_draw`, [...selected_formulas])
  }

  function select_surface_formulas(): void {
    overrides.set(
      `formulas_to_draw`,
      render_domains
        .filter((domain) => surface_formulas.has(domain.formula))
        .map((domain) => domain.formula),
    )
  }

  function select_neighbor_formulas(): void {
    if (hover_info?.view !== `3d`) return
    const neighbors = domain_neighbors.get(hover_info.formula) ?? []
    overrides.set(`formulas_to_draw`, [hover_info.formula, ...neighbors])
  }

  let png_dpi = $state(DEFAULT_PNG_DPI)
  const export_basename = $derived(`chempot-${plot_elements.join(`-`)}`)

  const current_view_settings = (): Record<string, unknown> =>
    get_view_settings({
      elements: plot_elements,
      camera_projection,
      auto_rotate,
      color_mode,
      color_scale,
      reverse_color_scale,
      camera_position: orbit_controls_ref?.object?.position ?? null,
      camera_target: orbit_controls_ref?.target ?? null,
      orthographic_zoom: camera_projection === `orthographic` ? orthographic_zoom : null,
    })

  const export_json_payload = (): Record<string, unknown> => ({
    elements: diagram_data?.elements ?? [],
    domains: render_domains.map((domain) => ({
      formula: domain.formula,
      points_3d: domain.points_3d,
    })),
    lims: diagram_data?.lims ?? [],
    view: current_view_settings(),
  })

  const export_sections = $derived<ExportSection[]>([
    {
      title: `Export Image`,
      items: [
        {
          label: `SVG`,
          on_download: () =>
            export_svg_file(wrapper, export_basename, current_view_settings()),
        },
        {
          label: `PNG`,
          show_dpi: true,
          on_download: () => export_png_file(wrapper, export_basename, png_dpi),
        },
      ],
    },
    {
      title: `Export Data`,
      items: [
        {
          label: `JSON`,
          on_download: () => export_json_file(export_json_payload(), export_basename),
          copy_text: () => get_json_string(export_json_payload()),
        },
        {
          label: `View`,
          on_download: () => export_view_json_file(current_view_settings(), export_basename),
        },
        {
          label: `GLB`,
          on_download: () =>
            export_glb_file(
              {
                hull_geometry: colored_hull_geometry,
                hull_opacity,
                edge_geometry,
                formula_meshes: formula_mesh_data,
                formula_edges: formula_edge_data,
              },
              export_basename,
            ),
        },
      ],
    },
  ])

  onDestroy(() => {
    if (label_occlusion_frame !== null) cancelAnimationFrame(label_occlusion_frame)
  })

  let locked_hover_formula = $state<string | null>(null)

  function set_hover_info(domain_data: HoverMesh, raw_event: unknown): void {
    hover_info = with_hover_pointer<ChemPotHoverInfo>(
      domain_data.info,
      raw_event,
      wrapper?.getBoundingClientRect() ?? null,
    )
  }

  function clear_hover_lock(): void {
    locked_hover_formula = null
    hover_info = null
  }

  function stop_phase_pointer_event(raw_event: unknown): void {
    const event = raw_event as
      | { nativeEvent?: { stopPropagation?: () => void }; stopPropagation?: () => void }
      | null
      | undefined
    event?.stopPropagation?.()
    event?.nativeEvent?.stopPropagation?.()
  }

  function handle_phase_hover(domain_data: HoverMesh, raw_event: unknown): void {
    if (locked_hover_formula && locked_hover_formula !== domain_data.formula) return
    set_hover_info(domain_data, raw_event)
  }

  function toggle_phase_lock(domain_data: HoverMesh, raw_event: unknown): void {
    stop_phase_pointer_event(raw_event)
    if (locked_hover_formula === domain_data.formula) {
      clear_hover_lock()
      return
    }
    locked_hover_formula = domain_data.formula
    set_hover_info(domain_data, raw_event)
  }

  function handle_phase_leave(domain_data: HoverMesh): void {
    if (!locked_hover_formula && hover_info?.formula === domain_data.formula) hover_info = null
  }

  // Color mode cycling (keyboard shortcut 'c')
  const color_modes = CHEMPOT_COLOR_MODE_OPTIONS.map(([value]) => value)
  function cycle_color_mode(): void {
    const idx = color_modes.indexOf(color_mode)
    overrides.set(`color_mode`, color_modes[(idx + 1) % color_modes.length])
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={wrapper}
  bind:clientWidth={container_width}
  bind:clientHeight={container_height}
  class={['chempot-diagram-3d', { fullscreen }]}
  style="width: {fullscreen ? `100vw` : `100%`}; height: {fullscreen
    ? `100vh`
    : `${render_height}px`}"
  role="application"
  tabindex="0"
  onkeydown={(event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
      return
    if (event.key === `Escape`) clear_hover_lock()
    else if (event.key === `c`) cycle_color_mode()
    else if (event.key === `f` && fullscreen_toggle) fullscreen = !fullscreen
  }}
  onpointerdown={(event) => {
    const target = event.target
    if (locked_hover_formula && (target === wrapper || target instanceof HTMLCanvasElement)) {
      clear_hover_lock()
    }
  }}
  onpointermovecapture={mark_input}
  onwheelcapture={mark_input}
  ondblclick={handle_dblclick}
>
  <section>
    <ExportPane
      bind:export_pane_open
      bind:png_dpi
      sections={export_sections}
      pane_props={{ class: `chempot-export-pane` }}
      toggle_props={{
        class: `chempot-export-toggle`,
        title: `Export chemical potential diagram`,
      }}
    />
    <ViewerPane
      bind:open={formula_picker_open}
      pane_name="formula overlays"
      class_prefix="chempot-formula"
      closed_icon={Filter}
    >
      <h4>Formula Overlays</h4>
      <div class="overlay-actions">
        <button type="button" onclick={() => overrides.set(`formulas_to_draw`, [])}>
          Clear
        </button>
        <button type="button" onclick={select_surface_formulas}>Surface</button>
        <button type="button" onclick={select_neighbor_formulas}>Neighbors</button>
      </div>
      <label class="overlay-search">
        Search:
        <input type="text" placeholder="Formula filter" bind:value={formula_filter_query} />
      </label>
      <div class="formula-list">
        {#if filtered_formulas.length === 0}
          <div class="formula-empty">No matching formulas</div>
        {:else}
          {#each filtered_formulas as formula, formula_idx (formula)}
            {@const formula_overlay_idx = formulas_to_draw.indexOf(formula)}
            <label>
              <input
                type="checkbox"
                checked={formula_overlay_idx !== -1}
                onchange={() => toggle_formula_selection(formula)}
              />
              <span
                class="formula-color-dot"
                style:background={formula_colors[
                  (formula_overlay_idx >= 0 ? formula_overlay_idx : formula_idx) %
                    formula_colors.length
                ]}
              ></span>
              {get_electro_neg_formula(formula, true, ``, `.3~s`)}
            </label>
          {/each}
        {/if}
      </div>
    </ViewerPane>

    <ScatterPlot3DControls
      bind:controls_open
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
          color_scale,
          reverse_color_scale,
          // a pinned camera is exactly the state Reset undoes, so it has to count as a change
          // or the affordance never appears for it
          camera_pinned: camera_position_override !== null,
        }}
        on_reset={reset_controls}
      >
        {#if has_multinary_system && plot_elements.length === 3}
          <div class="pane-row projection-axes">
            <label for="chempot-proj-x">X:</label>
            <select
              id="chempot-proj-x"
              value={plot_elements[0]}
              onchange={(event) => set_projection_axis(0, event.currentTarget.value)}
            >
              {#each all_entry_elements as element_name (element_name)}
                <option value={element_name}>{element_name}</option>
              {/each}
            </select>
            <label for="chempot-proj-y">Y:</label>
            <select
              id="chempot-proj-y"
              value={plot_elements[1]}
              onchange={(event) => set_projection_axis(1, event.currentTarget.value)}
            >
              {#each all_entry_elements as element_name (element_name)}
                <option value={element_name}>{element_name}</option>
              {/each}
            </select>
            <label for="chempot-proj-z">Z:</label>
            <select
              id="chempot-proj-z"
              value={plot_elements[2]}
              onchange={(event) => set_projection_axis(2, event.currentTarget.value)}
            >
              {#each all_entry_elements as element_name (element_name)}
                <option value={element_name}>{element_name}</option>
              {/each}
            </select>
          </div>
          <div class="projection-presets">
            {#each projection_presets as preset_elements (preset_elements.join(`|`))}
              <button
                type="button"
                class:selected={preset_elements.join(`|`) === current_projection_key}
                onclick={() => apply_projection_preset(preset_elements)}
                title="Switch projection"
              >
                {preset_elements.join(`-`)}
              </button>
            {/each}
          </div>
        {/if}
        <div class="chempot-checks">
          <label>
            <input
              type="checkbox"
              checked={formal_chempots}
              onchange={() => overrides.set(`formal_chempots`, !formal_chempots)}
            /> Formal
          </label>
          <label>
            <input
              type="checkbox"
              checked={label_stable}
              onchange={() => overrides.set(`label_stable`, !label_stable)}
            /> Labels
          </label>
          <label>
            <input
              type="checkbox"
              checked={draw_formula_meshes}
              onchange={() => overrides.set(`draw_formula_meshes`, !draw_formula_meshes)}
            /> Meshes
          </label>
          <label>
            <input
              type="checkbox"
              checked={draw_formula_lines}
              onchange={() => overrides.set(`draw_formula_lines`, !draw_formula_lines)}
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
              oninput={(event) =>
                overrides.set(`element_padding`, Number(event.currentTarget.value))}
            />
          </label>
          <label>
            Min (eV)
            <input
              type="number"
              max="0"
              step="1"
              value={default_min_limit}
              oninput={(event) =>
                overrides.set(`default_min_limit`, Number(event.currentTarget.value))}
            />
          </label>
        </div>
        <div class="pane-row">
          <label for="chempot-color-mode">Color:</label>
          <select
            id="chempot-color-mode"
            value={color_mode}
            onchange={(event) =>
              overrides.set(`color_mode`, event.currentTarget.value as ChemPotColorMode)}
          >
            {#each CHEMPOT_COLOR_MODE_OPTIONS as [value, label] (value)}
              <option {value}>{label}</option>
            {/each}
          </select>
        </div>
        {#if color_mode !== `none` && color_mode !== `arity`}
          <div class="pane-row">
            <label for="chempot-color-scale">Scale:</label>
            <select
              id="chempot-color-scale"
              value={color_scale}
              onchange={(event) =>
                overrides.set(`color_scale`, event.currentTarget.value as D3InterpolateName)}
            >
              {#each CHEMPOT_COLOR_SCALE_OPTIONS as [value, label] (value)}
                <option {value}>{label}</option>
              {/each}
            </select>
            <label>
              <input
                type="checkbox"
                checked={reverse_color_scale}
                onchange={() => overrides.set(`reverse_color_scale`, !reverse_color_scale)}
              /> Rev
            </label>
          </div>
        {/if}
      </SettingsSection>
    </ScatterPlot3DControls>

    {#if fullscreen_toggle}
      <FullscreenButton bind:fullscreen {wrapper} bg_css_var="--chempot-3d-bg-fullscreen" />
    {/if}
  </section>
  {#if show_temperature_slider && temperature !== undefined}
    <TemperatureSlider class="chempot-temp-slider" {available_temperatures} bind:temperature />
  {/if}
  {#if diagram_computing}
    <Spinner
      text="Computing chemical potential domains..."
      style="width: 100%; justify-content: center; min-height: 200px; margin: 0; --spinner-size: 1.2em"
    />
  {:else if !diagram_data}
    <div class="error-state" role="alert" aria-live="polite">
      <p>Cannot compute chemical potential diagram.</p>
      <p>Need at least 2 elements with elemental reference entries.</p>
    </div>
  {:else if mounted && webgpu_available()}
    <Canvas createRenderer={create_renderer}>
      <ChemPotScene3D
        bind:orbit_controls={orbit_controls_ref}
        {render_domains}
        {render_axis_scale}
        {plot_elements}
        {formal_chempots}
        {x_axis}
        {y_axis}
        {z_axis}
        {display}
        {data_center}
        {data_extent}
        {camera_position}
        {camera_target}
        {camera_projection}
        {orthographic_zoom}
        {auto_rotate}
        hull_geometry={colored_hull_geometry}
        {hull_opacity}
        {edge_geometry}
        hover_meshes={hover_mesh_data}
        on_domain_hover={handle_phase_hover}
        on_domain_press={toggle_phase_lock}
        on_domain_leave={handle_phase_leave}
        formula_meshes={formula_mesh_data}
        formula_edges={formula_edge_data}
        domain_labels={scene_domain_labels}
        label_scale={zoom_scale}
      />
    </Canvas>
    <!-- Color bar for continuous modes -->
    {#if color_range}
      <ColorBar
        title={color_range.label}
        range={[color_range.min, color_range.max]}
        scale={{ interpolator: get_chempot_interpolator(color_scale, reverse_color_scale) }}
        wrapper_style="position: absolute; bottom: 16px; left: 1em; width: 200px; z-index: 10;"
        bar_style="height: 12px;"
        title_style="margin-bottom: 4px;"
      />
    {/if}
    <!-- Categorical legend for arity mode -->
    {#if color_mode === `arity`}
      <div class="arity-legend">
        {#each arity_legend_labels as label, idx (label)}
          <span>
            <span style:background={ARITY_COLORS[idx]}></span>
            {label}
          </span>
        {/each}
      </div>
    {/if}
  {/if}
  {#if show_tooltip && hover_info?.view === `3d`}
    <ChemPotTooltip
      {hover_info}
      pinned={locked_hover_formula === hover_info.formula}
      detail_level={tooltip_detail_level}
      constrain_to={{ width: container_width, height: container_height }}
    />
  {/if}
</div>

<style>
  .chempot-diagram-3d {
    position: relative;
    container-type: size;
  }
  .chempot-diagram-3d:fullscreen {
    background: var(--chempot-3d-bg-fullscreen, var(--bg-color, #fff));
  }
  .chempot-diagram-3d > section {
    position: absolute;
    top: 1ex;
    right: 1ex;
    display: flex;
    gap: 8px;
    z-index: 20;
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
  }
  .chempot-diagram-3d:hover > section,
  .chempot-diagram-3d:focus-within > section,
  .chempot-diagram-3d > section:has(:global(.pane-open)) {
    opacity: 1;
    pointer-events: auto;
  }
  @media (hover: none) {
    .chempot-diagram-3d > section {
      opacity: 1;
      pointer-events: auto;
    }
  }
  .chempot-diagram-3d > section > :global(button),
  .chempot-diagram-3d > section > :global(.pane-toggle) {
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
  .chempot-diagram-3d > section > :global(button:hover),
  .chempot-diagram-3d > section > :global(.pane-toggle:hover) {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
  .chempot-diagram-3d :global(.chempot-temp-slider) {
    top: var(--chempot-temp-slider-top, calc(1ex + 108px));
    right: 4px;
    z-index: 11;
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
  .chempot-diagram-3d :global(.projection-axes) {
    display: grid;
    grid-template-columns: auto minmax(4.5em, 1fr) auto minmax(4.5em, 1fr) auto minmax(
        4.5em,
        1fr
      );
    align-items: center;
    gap: 3pt;
  }
  .chempot-diagram-3d :global(.projection-presets) {
    margin: 4pt 0 6pt;
    display: flex;
    flex-wrap: wrap;
    gap: 4pt;
  }
  .chempot-diagram-3d :global(.projection-presets button) {
    border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
    border-radius: 3px;
    padding: 1px 5px;
    background: transparent;
    cursor: pointer;
    font-size: 0.85em;
    color: var(--text-color, currentColor);
  }
  .chempot-diagram-3d :global(.projection-presets button.selected) {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }
  .chempot-diagram-3d :global(.overlay-actions) {
    display: flex;
    gap: 3pt;
    margin: 0 0 4pt;
  }
  .chempot-diagram-3d :global(.overlay-actions button) {
    border: none;
    border-radius: 3px;
    padding: 2px 6px;
    background: color-mix(in srgb, currentColor 10%, transparent);
    cursor: pointer;
    color: var(--text-color, currentColor);
    font-size: 0.85em;
  }
  .chempot-diagram-3d :global(.overlay-search) {
    display: flex;
    align-items: center;
    gap: 4pt;
    margin: 0 0 4pt;
  }
  .chempot-diagram-3d :global(.overlay-search input) {
    width: 100%;
    min-width: 10em;
  }
  .chempot-diagram-3d :global(.formula-list) {
    display: flex;
    flex-wrap: wrap;
    gap: 3pt;
    max-height: min(42vh, 18rem);
    overflow: auto;
    padding: 2pt 0;
  }
  .chempot-diagram-3d :global(.formula-list label) {
    display: inline-flex;
    align-items: center;
    gap: 3pt;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 0.88em;
    cursor: pointer;
    background: color-mix(in srgb, currentColor 6%, transparent);
  }
  .chempot-diagram-3d :global(.formula-list label:has(input:checked)) {
    background: color-mix(in srgb, currentColor 16%, transparent);
  }
  .chempot-diagram-3d :global(.formula-list input[type='checkbox']) {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .chempot-diagram-3d :global(.formula-list label:has(input:focus-visible)) {
    outline: 2px solid Highlight;
    outline-offset: 1px;
  }
  .chempot-diagram-3d :global(.formula-color-dot) {
    width: 0.55em;
    height: 0.55em;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .chempot-diagram-3d :global(.formula-empty) {
    font-size: 0.9em;
    opacity: 0.7;
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
  .arity-legend > span {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .arity-legend > span > span {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
