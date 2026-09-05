<script lang="ts">
  import { DEFAULT_PNG_DPI } from '$lib/constants'
  import { is_editable_event_target, is_modifier_chord } from 'svelte-widgets/utils'
  import { Filter } from 'svelte-widgets/icons'
  import { get_electro_neg_formula, get_formula_label_segments } from '$lib/composition/format'
  import type { FormulaLabelSegment } from '$lib/composition/format'
  import { normalize_show_controls } from '$lib/controls'
  import TemperatureSlider from '$lib/convex-hull/TemperatureSlider.svelte'
  import type { PhaseData } from '$lib/convex-hull/types'
  import { Spinner } from 'svelte-widgets'
  import type { ExportSection } from '$lib/io'
  import ExportPane from '$lib/io/ExportPane.svelte'
  import { SettingsSection, ViewerChrome } from '$lib/layout'
  import { ViewerPane } from '$lib/overlays'
  import type { Vec3 } from '$lib/math'
  import { add, array_extent, clamp, merge_coplanar_triangles, subtract } from '$lib/math'
  import { ScatterPlot3DControls } from '$lib/plot'
  import type { ThreltePointerEvent } from '$lib/scene'
  import {
    clear_pan_offset,
    create_renderer,
    dispose_on_change,
    webgpu_available,
  } from '$lib/scene'
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
  import { SvelteSet } from 'svelte/reactivity'
  import * as THREE from 'three/webgpu'
  import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
  import { rescale_zoom_to_fit } from './camera'
  import ChemPotControls from './ChemPotControls.svelte'
  import ChemPotLegend from './ChemPotLegend.svelte'
  import ChemPotScene3D from './ChemPotScene3D.svelte'
  import ChemPotTooltip from './ChemPotTooltip.svelte'
  import {
    CHEMPOT_COLOR_MODE_OPTIONS,
    container_pointer,
    create_chempot_state,
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
  import type { VisibleDomainLabel } from './compute'
  import {
    apply_element_padding,
    assign_faces_to_domains,
    bbox_diagonal,
    build_axis_ranges,
    dedup_points,
    entry_elements,
    get_3d_domain_simplexes_and_ann_loc,
    get_ternary_combinations,
    get_touches_limits,
    get_visible_domain_labels,
    pad_domain_points,
    scale_to_font_range,
    strip_closing_faces,
    swizzle_to_render,
    vertex_mean,
  } from './compute'
  import type { ChemPotDiagramConfig, ChemPotHoverInfo, ChemPotHoverInfo3D } from './types'
  import { CHEMPOT_DEFAULTS } from './types'

  type SceneProps = ComponentProps<typeof ChemPotScene3D>
  // Domain geometry in data coords. Boundary edges are kept as point pairs so edge/hover
  // geometry can swizzle them with whatever axis stretch is current. Which domains are drawn
  // as formula overlays is tracked separately (overlay_formulas) so toggling an overlay never
  // rebuilds the outlines or hover hulls.
  type RenderDomain = SceneProps[`render_domains`][number] & {
    edges: [number[], number[]][]
    ann_loc: number[]
    label_font_size: number
  }
  type HoverMesh = SceneProps[`hover_meshes`][number]

  const edge_key = (key_a: string, key_b: string): string =>
    key_a < key_b ? `${key_a}|${key_b}` : `${key_b}|${key_a}`

  let {
    entries = [],
    config = {},
    width = 800,
    height = 600,
    // Auto-corrected to a valid available temperature when needed.
    temperature = $bindable<number | undefined>(undefined),
    hover_info = $bindable<ChemPotHoverInfo | null>(null),
  }: {
    entries: PhaseData[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
    temperature?: number
    hover_info?: ChemPotHoverInfo | null
  } = $props()
  let wrapper = $state<HTMLDivElement>()
  let fullscreen = $state(false)
  let controls_open = $state(false)
  let export_pane_open = $state(false)
  const controls_config = normalize_show_controls(undefined)

  const chempot = create_chempot_state({
    entries: () => entries,
    config: () => config,
    temperature: { get: () => temperature, set: (value) => (temperature = value) },
    min_elements: 3,
    elements: () => (projection_elements.length === 3 ? projection_elements : config.elements),
    formulas: () => render_domains.map((domain) => domain.formula),
    extra_keys: [`formulas_to_draw`, `draw_formula_meshes`, `draw_formula_lines`],
    custom_defaults: { color_mode: `arity`, formulas_to_draw: [] },
    label: `ChemPotDiagram3D`,
  })
  const {
    formal_chempots,
    label_stable,
    element_padding,
    default_min_limit,
    color_mode,
    color_scale,
    reverse_color_scale,
    diagram_data,
    computing: diagram_computing,
    error: diagram_error,
    entries: temp_filtered_entries,
    has_temp_data,
    available_temperatures,
    energy_stats: entry_energy_stats_by_formula,
    domain_colors,
    color_range,
  } = $derived(chempot)
  const formulas_to_draw = $derived(chempot.resolve(`formulas_to_draw`))
  const draw_formula_meshes = $derived(chempot.resolve(`draw_formula_meshes`))
  const draw_formula_lines = $derived(chempot.resolve(`draw_formula_lines`))
  const formula_colors = $derived(
    config.formula_colors?.length ? config.formula_colors : CHEMPOT_DEFAULTS.formula_colors,
  )

  const formula_label_segments = (formula: string): FormulaLabelSegment[] =>
    get_formula_label_segments(
      get_electro_neg_formula(formula, { plain_text: true, delim: ``, amount_format: `.3~s` }),
    )

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

  // The chemical system comes from every entry, not the temperature slice: a slice can be
  // empty or miss an element, and the projection axes must stay selectable either way
  const all_entry_elements = $derived(entry_elements(entries))
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
  function get_domain_outline(points_3d: number[][]) {
    const { simplex_indices, ann_loc, is_planar } =
      get_3d_domain_simplexes_and_ann_loc(points_3d)
    const planar_edges = simplex_indices.map(([idx_a, idx_b]): [number[], number[]] => [
      points_3d[idx_a],
      points_3d[idx_b],
    ])
    return { edges: is_planar ? planar_edges : hull_crease_edges(points_3d), ann_loc }
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

  // Formula overlays are cut out of the base hull/edges and drawn in their own colour
  const overlay_formulas = $derived(new SvelteSet(formulas_to_draw))
  const base_domains = $derived(
    render_domains.filter((domain) => !overlay_formulas.has(domain.formula)),
  )

  // Stretch short axes (up to 4x) to improve screen-space utilization for highly anisotropic
  // systems. Mapping is in rendered axis order: X=data[1], Y=data[2], Z=data[0].
  const render_axis_scale = $derived.by((): Vec3 => {
    const points = render_domains.flatMap((domain) => domain.points_3d)
    if (points.length === 0) return [1, 1, 1]
    const spans = [1, 2, 0].map((axis) => {
      const [lo, hi] = array_extent(points.map((point) => point[axis]))
      return Math.max(hi - lo, 1e-6)
    })
    const max_span = Math.max(...spans)
    return spans.map((span) => clamp(max_span / span, 1, 4)) as Vec3
  })

  // Swizzle a data-coord triple to Three.js coords; ChemPotScene3D frames the axes with the same
  const swiz = $derived(swizzle_to_render(render_axis_scale))
  const to_render_xyz = (point: number[]): Vec3 => swiz(point[0], point[1], point[2])

  // Compute data center and extent for camera positioning (in swizzled coords)
  const { data_center, data_extent } = $derived.by(() => {
    const points = render_domains.flatMap((domain) => domain.points_3d)
    if (points.length === 0) return { data_center: [0, 0, 0] as Vec3, data_extent: 10 }
    // Center and max distance from it, in rendered coordinates (swizzled + axis scaling)
    const rendered = points.map(to_render_xyz)
    const center = vertex_mean(rendered)
    let max_dist = 0
    for (const [x_val, y_val, z_val] of rendered) {
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
  // A user gesture pins the view; the defaults above would otherwise re-apply through the
  // camera props whenever a temperature/padding/formal toggle moves the data center
  let camera_position_override = $state<Vec3 | null>(null)
  let camera_target_override = $state<Vec3 | null>(null)
  let orthographic_zoom_override = $state<number | null>(null)
  const camera_position = $derived(camera_position_override ?? default_camera_position)
  const camera_target = $derived(camera_target_override ?? default_camera_target)
  const orthographic_zoom = $derived(orthographic_zoom_override ?? default_orthographic_zoom)
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
      const unique_points = dedup_3d(base_domains.flatMap((domain) => domain.points_3d))
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

    // round so a shared edge whose endpoints came from different hyperplane triples
    // (equal to ~1e-12, not bit-identical) is still drawn once
    const point_key = (point: number[]) => point.map((val) => val.toFixed(4)).join(`,`)
    const seen = new Set<string>()
    const positions: number[] = []
    for (const domain of base_domains) {
      for (const [pt_a, pt_b] of domain.edges) {
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

  // Coplanar-merged convex hull of the points in render coords; null for fewer than four
  // distinct points or a degenerate hull (ConvexGeometry throws)
  function render_hull_geometry(points_3d: number[][]): THREE.BufferGeometry | null {
    const unique_points = dedup_3d(points_3d)
    if (unique_points.length < 4) return null
    try {
      return merge_coplanar_geometry(new ConvexGeometry(unique_points.map(to_vec3)))
    } catch {
      return null
    }
  }

  // Build a single opaque convex hull mesh from ALL domain vertices for depth
  // occlusion. This seamless surface writes to the depth buffer, hiding wireframe
  // edges on the back side. Using all vertices together avoids gaps between domains.
  const occlusion_hull_geometry = $derived(
    render_hull_geometry(base_domains.flatMap((domain) => domain.points_3d)),
  )

  // Non-indexed hull geometry with the artificial closing faces removed
  const hull_base_geometry = $derived.by((): THREE.BufferGeometry | null => {
    // occlusion_hull_geometry is non-indexed and strip_closing_faces never mutates its input
    const merged =
      occlusion_hull_geometry &&
      strip_closing_faces(occlusion_hull_geometry.getAttribute(`position`).array)
    if (!merged) return null
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(`position`, new THREE.Float32BufferAttribute(merged, 3))
    const base_rgb = new THREE.Color(`#f6f6f6`).toArray()
    const colors = Float32Array.from({ length: merged.length }, (_, idx) => base_rgb[idx % 3])
    geom.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3))
    return geom
  })

  // Domains in render coords (swizzle and axis stretch are linear, so planes stay planes)
  const to_render_domains = (domains: RenderDomain[]) =>
    domains
      .filter((domain) => domain.points_3d.length > 0)
      .map((domain) => ({
        formula: domain.formula,
        points: domain.points_3d.map(to_render_xyz) as number[][],
      }))

  // Per-face domain assignment (stable — only changes when geometry or domains change)
  const face_domain_map = $derived.by((): string[] =>
    hull_base_geometry
      ? assign_faces_to_domains(
          hull_base_geometry.getAttribute(`position`).array,
          to_render_domains(base_domains),
        )
      : [],
  )

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
    const rgb_cache = new Map<string, Vec3>()
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
      .filter((domain) => overlay_formulas.has(domain.formula))
      .map(domain_label)
    const font_size_by_formula = new Map(
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

  // Domains on the outer surface of the full envelope (all domains, overlays included), used by
  // the "Surface" overlay quick-select. On demand: costs a convex hull plus a plane test per
  // domain and face, and only a button click reads it. Raycasting instead is broken — FrontSide
  // culling means rays fired from inside the hull hit nothing and every domain scores 0.
  function get_surface_formulas(): string[] {
    const envelope = render_hull_geometry(render_domains.flatMap((domain) => domain.points_3d))
    const faces = envelope && strip_closing_faces(envelope.getAttribute(`position`).array)
    envelope?.dispose()
    // A domain is visible from outside exactly when it owns a face of the envelope
    if (!faces) return render_domains.map((domain) => domain.formula)
    const owners = assign_faces_to_domains(faces, to_render_domains(render_domains))
    return [...new Set(owners)].filter(Boolean)
  }

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

  // Overlay geometry is per domain and depends only on that domain's points and the axis
  // stretch, so it is cached per formula and kept while the formula stays an overlay:
  // toggling one overlay builds one hull instead of every overlay's (k + 1 ConvexGeometry
  // builds per toggle with k overlays, now 2 — the other is the base occlusion hull).
  // Geometries evicted from the cache (formula un-drawn, domain or stretch changed) are
  // queued in `evicted_geometries` and disposed by the effect after the mesh/edge data
  // deriveds: the scene meshes may still reference them during the flush that evicts them.
  // The teardown effect disposes whatever is left on unmount.
  const evicted_geometries: THREE.BufferGeometry[] = []
  type OverlayGeometry = { geometry: THREE.BufferGeometry; color: string }
  function memo_overlay_geometry(
    build: (domain: RenderDomain) => THREE.BufferGeometry | null,
  ): (domains: RenderDomain[]) => OverlayGeometry[] {
    type Entry = {
      domain: RenderDomain
      swiz: typeof swiz
      geometry: THREE.BufferGeometry | null
    }
    let cache = new Map<string, Entry>()
    $effect(() => () => {
      for (const { geometry } of cache.values()) geometry?.dispose()
      cache.clear()
    })
    return (domains) => {
      const next = new Map<string, Entry>()
      const result: OverlayGeometry[] = []
      for (const domain of domains) {
        const cached = cache.get(domain.formula)
        const entry =
          cached?.domain === domain && cached.swiz === swiz
            ? cached
            : { domain, swiz, geometry: build(domain) }
        next.set(domain.formula, entry)
        if (entry.geometry) {
          result.push({ geometry: entry.geometry, color: overlay_color(domain.formula) })
        }
      }
      for (const [formula, entry] of cache) {
        if (next.get(formula) !== entry && entry.geometry) {
          evicted_geometries.push(entry.geometry)
        }
      }
      cache = next
      return result
    }
  }
  const overlay_domains = $derived(
    render_domains.filter((domain) => overlay_formulas.has(domain.formula)),
  )
  const overlay_color = (formula: string): string =>
    formula_colors[formulas_to_draw.indexOf(formula) % formula_colors.length]

  // Formula overlay edges (crease edges, per formula)
  const overlay_edge_geometries = memo_overlay_geometry((domain) => {
    const positions = domain.edges.flatMap(([pt_a, pt_b]) => [
      ...to_render_xyz(pt_a),
      ...to_render_xyz(pt_b),
    ])
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(`position`, new THREE.Float32BufferAttribute(positions, 3))
    return geom
  })
  const formula_edge_data = $derived(
    overlay_edge_geometries(draw_formula_lines ? overlay_domains : []),
  )

  // Formula overlay meshes (convex hull surface, per formula)
  const overlay_mesh_geometries = memo_overlay_geometry((domain) =>
    render_hull_geometry(domain.points_3d),
  )
  const formula_mesh_data = $derived(
    overlay_mesh_geometries(draw_formula_meshes ? overlay_domains : []),
  )
  // Runs after the deriveds above settle (and the scene has the new lists), so no mesh
  // still points at a geometry when it is disposed
  const dispose_evicted = () => {
    for (const geometry of evicted_geometries.splice(0)) geometry.dispose()
  }
  $effect(() => {
    void [formula_edge_data, formula_mesh_data]
    dispose_evicted()
    return dispose_evicted
  })

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
    const geometry = render_hull_geometry(unique_points)
    return geometry && { geometry, n_vertices: unique_points.length }
  }

  // Domain adjacency: two domains are neighbors if they share any vertex (within tolerance)
  const domain_neighbors = $derived.by((): Map<string, string[]> => {
    const tol = 1e-4
    const vertex_owners = new Map<string, string[]>()
    for (const domain of render_domains) {
      for (const pt of domain.points_3d) {
        const key = pt.map((val) => (Math.round(val / tol) * tol).toFixed(4)).join(`,`)
        const owners = vertex_owners.get(key)
        if (owners) {
          if (!owners.includes(domain.formula)) owners.push(domain.formula)
        } else vertex_owners.set(key, [domain.formula])
      }
    }
    const neighbors = new Map<string, Set<string>>()
    for (const domain of render_domains) neighbors.set(domain.formula, new Set())
    for (const owners of vertex_owners.values()) {
      if (owners.length < 2) continue
      for (let idx = 0; idx < owners.length; idx++) {
        for (let jdx = idx + 1; jdx < owners.length; jdx++) {
          neighbors.get(owners[idx])?.add(owners[jdx])
          neighbors.get(owners[jdx])?.add(owners[idx])
        }
      }
    }
    return new Map(
      [...neighbors].map(([formula, set]) => [formula, [...set].toSorted()] as const),
    )
  })

  // Pick hulls depend only on the geometry; the hover info attached to them is rebuilt
  // separately below so overlay/colour toggles never re-run ConvexGeometry
  const hover_geometries = $derived.by(() => {
    const result: {
      domain: RenderDomain
      geometry: THREE.BufferGeometry
      n_vertices: number
    }[] = []
    for (const domain of render_domains) {
      if (domain.points_3d.length < 3) continue
      const hover_geometry = create_hover_geometry(domain.points_3d)
      if (hover_geometry) result.push({ domain, ...hover_geometry })
    }
    return result
  })

  const hover_mesh_data = $derived.by((): HoverMesh[] => {
    if (!diagram_data) return []
    const result: HoverMesh[] = []
    const lims = diagram_data.lims
    const energy_stats_by_formula = entry_energy_stats_by_formula

    for (const { domain, geometry, n_vertices } of hover_geometries) {
      const axis_ranges = build_axis_ranges(domain.points_3d, plot_elements)
      const touches_limits = get_touches_limits(domain.points_3d, lims, plot_elements)
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
        is_draw_formula: overlay_formulas.has(domain.formula),
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
  // formula_edge_data/formula_mesh_data geometries are owned by their per-formula caches
  dispose_on_change(() => hover_geometries.map((data) => data.geometry))

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
    clear_pan_offset(controls_camera)
    controls.update()
  }

  // Preserve user framing across temperature-driven geometry changes:
  // shift camera/target with domain center and keep orthographic zoom relative to extent.
  $effect(() => {
    // Reading the overrides re-runs this on every OrbitControls `change` (per frame while
    // dragging or auto-rotating); with the framing baselines unchanged there is nothing to do.
    const baseline_center = last_data_center
    const same_center =
      baseline_center !== null &&
      data_center.every((coord, axis) => coord === baseline_center[axis])
    if (same_center && default_orthographic_zoom === last_default_zoom) return
    if (
      camera_position_override &&
      camera_target_override &&
      baseline_center &&
      !same_center
    ) {
      const delta = subtract(data_center, baseline_center)
      camera_position_override = add(camera_position_override, delta)
      camera_target_override = add(camera_target_override, delta)
    }
    const rescaled_zoom = rescale_zoom_to_fit(
      orthographic_zoom_override,
      last_default_zoom,
      default_orthographic_zoom,
    )
    if (rescaled_zoom !== orthographic_zoom_override)
      orthographic_zoom_override = rescaled_zoom
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
    chempot.reset()
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
    chempot.set(
      `formulas_to_draw`,
      overlay_formulas.has(formula)
        ? formulas_to_draw.filter((drawn) => drawn !== formula)
        : [...formulas_to_draw, formula],
    )
  }

  const select_surface_formulas = (): void =>
    chempot.set(`formulas_to_draw`, get_surface_formulas())

  function select_neighbor_formulas(): void {
    if (hover_info?.view !== `3d`) return
    const neighbors = domain_neighbors.get(hover_info.formula) ?? []
    chempot.set(`formulas_to_draw`, [hover_info.formula, ...neighbors])
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

  function set_hover_info(domain_data: HoverMesh, event: ThreltePointerEvent): void {
    hover_info = {
      ...domain_data.info,
      pointer: container_pointer(event.nativeEvent, wrapper),
    }
  }

  function clear_hover_lock(): void {
    locked_hover_formula = null
    hover_info = null
  }

  function handle_phase_hover(domain_data: HoverMesh, event: ThreltePointerEvent): void {
    if (locked_hover_formula && locked_hover_formula !== domain_data.formula) return
    set_hover_info(domain_data, event)
  }

  // Stops both Threlte's dispatch to farther hits and the DOM event the wrapper listens to
  function toggle_phase_lock(domain_data: HoverMesh, event: ThreltePointerEvent): void {
    event.stopPropagation()
    event.nativeEvent.stopPropagation()
    if (locked_hover_formula === domain_data.formula) {
      clear_hover_lock()
      return
    }
    locked_hover_formula = domain_data.formula
    set_hover_info(domain_data, event)
  }

  function handle_phase_leave(domain_data: HoverMesh): void {
    if (!locked_hover_formula && hover_info?.formula === domain_data.formula) hover_info = null
  }

  // A wheel zoom shifts the domains under a still cursor with no pointerleave to clear the tooltip
  function handle_camera_start(): void {
    if (!locked_hover_formula) hover_info = null
  }

  // Color mode cycling (keyboard shortcut 'c')
  const color_modes = CHEMPOT_COLOR_MODE_OPTIONS.map(([value]) => value)
  function cycle_color_mode(): void {
    const idx = color_modes.indexOf(color_mode)
    chempot.set(`color_mode`, color_modes[(idx + 1) % color_modes.length])
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
    // `f` is owned by FullscreenButton; chords stay the browser's (Cmd/Ctrl+F = find)
    if (is_editable_event_target(event.target) || is_modifier_chord(event)) return
    if (event.repeat) return // holding `c` would spin through color modes
    if (event.key === `Escape`) clear_hover_lock()
    else if (event.key === `c`) cycle_color_mode()
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
  <ViewerChrome
    {controls_config}
    bind:fullscreen
    {wrapper}
    fullscreen_bg_css_var="--chempot-3d-bg-fullscreen"
  >
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
        <button type="button" onclick={() => chempot.set(`formulas_to_draw`, [])}>
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
              {get_electro_neg_formula(formula, {
                plain_text: true,
                delim: ``,
                amount_format: `.3~s`,
              })}
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
          ...chempot.values,
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
        <ChemPotControls values={chempot} set={chempot.set}>
          <label>
            <input
              type="checkbox"
              checked={draw_formula_meshes}
              onchange={() => chempot.set(`draw_formula_meshes`, !draw_formula_meshes)}
            /> Meshes
          </label>
          <label>
            <input
              type="checkbox"
              checked={draw_formula_lines}
              onchange={() => chempot.set(`draw_formula_lines`, !draw_formula_lines)}
            /> Lines
          </label>
        </ChemPotControls>
      </SettingsSection>
    </ScatterPlot3DControls>
  </ViewerChrome>
  {#if has_temp_data && temperature !== undefined}
    <TemperatureSlider
      class="chempot-temp-slider"
      {available_temperatures}
      interpolate_temperature={config.interpolate_temperature}
      bind:temperature
    />
  {/if}
  {#if !diagram_data}
    {#if diagram_computing}
      <Spinner
        text="Computing chemical potential domains..."
        style="width: 100%; justify-content: center; min-height: 200px; margin: 0; --spinner-size: 1.2em"
      />
    {:else}
      <div class="error-state" role="alert" aria-live="polite">
        <p>Cannot compute chemical potential diagram.</p>
        <p>{diagram_error ?? `Need at least 2 elements with elemental reference entries.`}</p>
      </div>
    {/if}
  {:else if mounted && webgpu_available()}
    {#if diagram_computing}
      <Spinner
        text="Computing chemical potential domains..."
        style="position: absolute; inset: 0; justify-content: center; margin: 0; z-index: 5; --spinner-size: 1.2em"
      />
    {/if}
    <div class={[`scene`, { stale: diagram_computing }]}>
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
          on_camera_start={handle_camera_start}
          formula_meshes={formula_mesh_data}
          formula_edges={formula_edge_data}
          domain_labels={scene_domain_labels}
          label_scale={zoom_scale}
        />
      </Canvas>
    </div>
    <ChemPotLegend
      {color_mode}
      {color_scale}
      {reverse_color_scale}
      {color_range}
      formulas={render_domains.map((domain) => domain.formula)}
      style="bottom: 16px; left: 1em"
    />
  {/if}
  {#if chempot.show_tooltip && hover_info?.view === `3d`}
    <ChemPotTooltip
      {hover_info}
      pinned={locked_hover_formula === hover_info.formula}
      detail_level={chempot.tooltip_detail_level}
      constrain_to={{ width: container_width, height: container_height }}
    />
  {/if}
</div>

<style>
  .chempot-diagram-3d {
    position: relative;
    container-type: size;
  }
  .scene {
    height: 100%;
    transition: opacity 0.2s ease;
    &.stale {
      opacity: 0.45;
    }
  }
  .chempot-diagram-3d:fullscreen {
    background: var(--chempot-3d-bg-fullscreen, var(--bg-color, #fff));
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
</style>
