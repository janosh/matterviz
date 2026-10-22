<script lang="ts">
  import { viewer_keys } from '#lib/shortcuts.js'
  import { ContentCut, Filter } from 'svelte-widgets/icons'
  import { get_formula_label_segments } from '#lib/composition/format.js'
  import { normalize_show_controls, type ShowControlsProp } from '#lib/controls.js'
  import TemperatureSlider from '#lib/convex-hull/TemperatureSlider.svelte'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import Spinner from 'svelte-widgets/Spinner.svelte'
  import type { ExportSection } from '#lib/io/index.js'
  import { json_source, type ExportSources } from '#lib/io/export.js'
  import ExportPane from '#lib/io/ExportPane.svelte'
  import { SettingsSection, ViewerChrome } from '#lib/layout/index.js'
  import LiveMessage from 'svelte-widgets/LiveMessage.svelte'
  import { ViewerPane } from '#lib/overlays/index.js'
  import { HIGHLIGHT } from '#lib/colors/index.js'
  import type { Vec3 } from '#lib/math.js'
  import { add, array_extent, clamp, merge_coplanar_triangles, subtract } from '#lib/math.js'
  import { ScatterPlot3DControls } from '#lib/plot/index.js'
  import type { ThreltePointerEvent } from '#lib/scene/index.js'
  import {
    clear_pan_offset,
    create_renderer,
    dispose_on_change,
    key_walk_root,
    wheel_zoom_gate,
    positions_geometry,
    webgpu_available,
  } from '#lib/scene/index.js'
  import type {
    AxisConfig3D,
    CameraProjection3D,
    DisplayConfig3D,
  } from '#lib/plot/core/types.js'
  import { get_3d_auto_ranges } from '#lib/plot/scatter-3d/scene-coords.js'
  import { Canvas } from '@threlte/core'
  import type { ComponentProps } from 'svelte'
  import { onDestroy, onMount, untrack } from 'svelte'
  import * as THREE from 'three/webgpu'
  import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
  import { rescale_zoom_to_fit } from './camera'
  import ChemPotControls from './ChemPotControls.svelte'
  import ChemPotLegend from './ChemPotLegend.svelte'
  import ChemPotScene3D from './ChemPotScene3D.svelte'
  import ChemPotSlices, { slice_label } from './ChemPotSlices.svelte'
  import ChemPotTooltip from './ChemPotTooltip.svelte'
  import { TooltipPin } from '#lib/tooltip/pin.svelte.js'
  import {
    CHEMPOT_COLOR_MODE_OPTIONS,
    container_pointer,
    create_chempot_state,
    domain_formula_text,
    highlight_key_of,
  } from './controls-state.svelte'
  import {
    chempot_png_blob,
    chempot_svg_string,
    export_glb_file,
    get_view_settings,
    occlude_tick_labels,
  } from './export'
  import type { VisibleDomainLabel } from './compute'
  import {
    assign_faces_to_domains,
    bbox_diagonal,
    build_axis_ranges,
    dedup_points,
    entry_elements,
    get_3d_domain_simplexes_and_ann_loc,
    get_ternary_combinations,
    get_touches_limits,
    get_visible_domain_labels,
    pad_domains,
    padded_floors,
    scale_to_font_range,
    strip_closing_faces,
    swizzle_to_render,
    vertex_mean,
  } from './compute'
  import type { ChemPotDiagramProps, ChemPotHoverInfo3D } from './types'
  import { CHEMPOT_DEFAULTS } from './types'

  type SceneProps = ComponentProps<typeof ChemPotScene3D>
  // Domain geometry in data coords, edges as point pairs so they swizzle with the current axis
  // stretch. Overlays are tracked separately (overlay_formulas) so toggling one never rebuilds
  // the outlines.
  type RenderDomain = SceneProps[`render_domains`][number] & {
    edges: [number[], number[]][]
    ann_loc: number[]
    label_font_size: number
  }
  type HoverMesh = SceneProps[`hover_meshes`][number]

  const edge_key = (key_a: string, key_b: string): string =>
    key_a < key_b ? `${key_a}|${key_b}` : `${key_b}|${key_a}`
  // rounded, so a vertex reached from different hyperplane triples (~1e-12 apart) keys once
  const point_key = (point: ArrayLike<number>): string =>
    Array.from(point, (val) => val.toFixed(4)).join(`,`)

  let {
    entries = [],
    show_controls,
    config = {},
    width = 800,
    height = 600,
    temperature = $bindable(),
    hover_info = $bindable(null),
    highlighted_formula = null,
    tooltip,
  }: ChemPotDiagramProps & {
    show_controls?: ShowControlsProp<
      `controls` | `fullscreen` | `export` | `formulas` | `slice`
    >
  } = $props()
  let wrapper = $state<HTMLDivElement>()
  let fullscreen = $state(false)
  // At most one pane open at a time
  let open_pane = $state<`controls` | `export` | `formulas` | `slice` | null>(null)
  const pane_open = (pane: NonNullable<typeof open_pane>) => ({
    get: () => open_pane === pane,
    set: (open: boolean) => {
      if (open) open_pane = pane
      else if (open_pane === pane) open_pane = null
    },
  })
  const [controls_pane, export_pane, formulas_pane, slice_pane] = (
    [`controls`, `export`, `formulas`, `slice`] as const
  ).map(pane_open)
  const controls_config = $derived(normalize_show_controls(show_controls))

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
    diagram_data,
    computing: diagram_computing,
    error: diagram_error,
    has_temp_data,
    available_temperatures,
    energy_stats: entry_energy_stats_by_formula,
    domain_colors,
    color_bar,
  } = $derived(chempot)
  const formulas_to_draw = $derived(chempot.resolve(`formulas_to_draw`))
  const draw_formula_meshes = $derived(chempot.resolve(`draw_formula_meshes`))
  const draw_formula_lines = $derived(chempot.resolve(`draw_formula_lines`))
  const formula_colors = $derived(
    config.formula_colors?.length ? config.formula_colors : CHEMPOT_DEFAULTS.formula_colors,
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

  const to_vec3 = (point: number[]): THREE.Vector3 =>
    new THREE.Vector3(...to_render_xyz(point))

  // Chemical system from every entry, not the temperature slice (which can miss elements)
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
  // Domains are projected polyhedra (not facets of one polytope) while an axis is shadowed
  const is_projection_mode = $derived((diagram_data?.shadow_elements.length ?? 0) > 0)
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

  // Outline (boundary edges) and label anchor per domain: planar domains (true ternaries) take
  // the PCA-projected 2D hull, quaternary+ polyhedra the crease edges of a 3D hull.
  function get_domain_outline(points_3d: number[][]) {
    const { simplex_indices, ann_loc, is_planar } =
      get_3d_domain_simplexes_and_ann_loc(points_3d)
    const planar_edges = simplex_indices.map(([idx_a, idx_b]): [number[], number[]] => [
      points_3d[idx_a],
      points_3d[idx_b],
    ])
    return { edges: is_planar ? planar_edges : hull_crease_edges(points_3d), ann_loc }
  }

  // Crease edges (dihedral > 1°) of the 3D convex hull of `points`; null for a degenerate hull
  function crease_geometry(points: THREE.Vector3[]): THREE.EdgesGeometry | null {
    try {
      const hull = new ConvexGeometry(points)
      const creases = new THREE.EdgesGeometry(hull)
      hull.dispose()
      return creases
    } catch {
      return null
    }
  }

  // Crease edges as point pairs in the input coordinates, empty for a degenerate hull
  function hull_crease_edges(points_3d: number[][]): [number[], number[]][] {
    const creases = crease_geometry(
      dedup_3d(points_3d).map(
        ([x_val, y_val, z_val]) => new THREE.Vector3(x_val, y_val, z_val),
      ),
    )
    if (!creases) return []
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
  }

  // While slicing, the unsliced shadow projection bounds every section: axes, camera and the
  // padded floor follow it, so a sweep moves the domains but not the view or the floor faces
  const frame_floors = $derived(
    chempot.frame_data &&
      padded_floors(chempot.frame_data.domains, [0, 1, 2], element_padding, default_min_limit),
  )
  const pad = (domains: Record<string, number[][]>) =>
    pad_domains(domains, [0, 1, 2], element_padding, default_min_limit, frame_floors)
  const render_domains = $derived.by((): RenderDomain[] => {
    if (!diagram_data || plot_elements.length < 2) return []
    const result: RenderDomain[] = []
    for (const [formula, padded] of Object.entries(pad(diagram_data.domains))) {
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
  const domain_points = $derived(render_domains.flatMap((domain) => domain.points_3d))

  // Formula overlays are cut out of the base edges and drawn in their own colour (their hull
  // faces wear it too, see colored_hull_geometry)
  const overlay_formulas = $derived(new Set(formulas_to_draw))
  const base_domains = $derived(
    render_domains.filter((domain) => !overlay_formulas.has(domain.formula)),
  )

  // Points the axes and camera frame (see frame_floors)
  const frame_points = $derived(
    chempot.frame_data ? Object.values(pad(chempot.frame_data.domains)).flat() : domain_points,
  )

  // Stretch short axes (up to 4x) for anisotropic systems. Rendered order: X=data[1],
  // Y=data[2], Z=data[0].
  const render_axis_scale = $derived.by((): Vec3 => {
    if (frame_points.length === 0) return [1, 1, 1]
    const spans = [1, 2, 0].map((axis) => {
      const [lower, upper] = array_extent(frame_points.map((point) => point[axis]))
      return Math.max(upper - lower, 1e-6)
    })
    const max_span = Math.max(...spans)
    return spans.map((span) => clamp(max_span / span, 1, 4)) as Vec3
  })

  // Swizzle a data-coord triple to Three.js coords; ChemPotScene3D frames the axes with the same
  const swiz = $derived(swizzle_to_render(render_axis_scale))
  const to_render_xyz = (point: number[]): Vec3 => swiz(point[0], point[1], point[2])

  // Compute data center and extent for camera positioning (in swizzled coords)
  const { data_center, data_extent } = $derived.by(() => {
    if (frame_points.length === 0) return { data_center: [0, 0, 0] as Vec3, data_extent: 10 }
    // Center and max distance from it, in rendered coordinates (swizzled + axis scaling)
    const rendered = frame_points.map(to_render_xyz)
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
  // A user gesture pins the view, else the defaults above re-apply when the data center moves
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

  // Globally deduplicated domain boundary edges (3D hull crease edges in projection mode)
  const edge_geometry = $derived.by(() => {
    if (is_projection_mode) {
      const unique_points = dedup_3d(base_domains.flatMap((domain) => domain.points_3d))
      // degenerate hulls fall back to the per-domain edges below
      const hull_edges =
        unique_points.length >= 4 && crease_geometry(unique_points.map(to_vec3))
      if (hull_edges) return hull_edges
    }

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
    return positions_geometry(positions)
  })

  // Coplanar-merged convex hull in render coords; null for < 4 points or a degenerate hull
  function render_hull_geometry(points_3d: number[][]): THREE.BufferGeometry | null {
    const unique_points = dedup_3d(points_3d)
    if (unique_points.length < 4) return null
    try {
      return merge_coplanar_geometry(new ConvexGeometry(unique_points.map(to_vec3)))
    } catch {
      return null
    }
  }

  // One seamless opaque hull over ALL domain vertices writes depth, hiding back-side wireframe
  // edges without gaps between domains
  const occlusion_hull_geometry = $derived(
    render_hull_geometry(render_domains.flatMap((domain) => domain.points_3d)),
  )

  // Non-indexed hull geometry with the artificial closing faces removed
  const hull_base_geometry = $derived.by((): THREE.BufferGeometry | null => {
    // occlusion_hull_geometry is non-indexed and strip_closing_faces never mutates its input
    const merged =
      occlusion_hull_geometry &&
      strip_closing_faces(occlusion_hull_geometry.getAttribute(`position`).array)
    if (!merged) return null
    const geom = positions_geometry(merged)
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
          to_render_domains(render_domains),
        )
      : [],
  )

  // Faces whose owner has no colour
  const HULL_FALLBACK_RGB = new THREE.Color(`#e8e8e8`).toArray() as Vec3

  // Clone of hull_base_geometry with each face in its owner's drawn colour. Without domain
  // colours (color_mode none) only overlay faces are recoloured, the rest keep the base grey.
  const colored_hull_geometry = $derived.by((): THREE.BufferGeometry | null => {
    const mapping = face_domain_map
    if (!hull_base_geometry || mapping.length === 0) return hull_base_geometry
    if (domain_colors.size === 0 && overlay_formulas.size === 0) return hull_base_geometry

    const geom = hull_base_geometry.clone()
    const color_attr = geom.getAttribute(`color`) as THREE.BufferAttribute

    const rgb_cache = new Map<string, Vec3 | undefined>()
    const rgb_of = (formula: string): Vec3 | undefined => {
      if (!rgb_cache.has(formula)) {
        const hex = drawn_color(formula)
        rgb_cache.set(formula, hex ? (new THREE.Color(hex).toArray() as Vec3) : undefined)
      }
      return rgb_cache.get(formula)
    }

    for (let face_idx = 0; face_idx < mapping.length; face_idx++) {
      const rgb = rgb_of(mapping[face_idx])
      if (!rgb && domain_colors.size === 0) continue
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
          segments: get_formula_label_segments(domain_formula_text(label.formula)),
        }))
      : [],
  )

  dispose_on_change(() => [hull_base_geometry])
  // Don't dispose colored hull if it's the same object as hull_base_geometry (no clone made)
  dispose_on_change(() =>
    colored_hull_geometry !== hull_base_geometry ? [colored_hull_geometry] : [],
  )

  // Domains on the outer surface of the full envelope, for the "Surface" overlay quick-select
  // (on demand: costs a hull). Raycasting fails here: FrontSide culling hides it from inside.
  function get_surface_formulas(): string[] {
    const envelope = render_hull_geometry(domain_points)
    const faces = envelope && strip_closing_faces(envelope.getAttribute(`position`).array)
    envelope?.dispose()
    // A domain is visible from outside exactly when it owns a face of the envelope
    if (!faces) return render_domains.map((domain) => domain.formula)
    const owners = assign_faces_to_domains(faces, to_render_domains(render_domains))
    return [...new Set(owners)].filter(Boolean)
  }

  const dedup_3d = (pts: number[][]): number[][] => dedup_points(pts).unique

  const controls_auto_ranges = $derived(
    get_3d_auto_ranges(
      [],
      frame_points.map(([coord_z, coord_x, coord_y]) => ({
        x: coord_x,
        y: coord_y,
        z: coord_z,
      })),
    ),
  )

  // Overlay geometry is cached per formula (it depends only on its points and the stretch), so
  // toggling one overlay builds one hull, not all. Evicted geometries are queued and disposed
  // by the effect after the mesh/edge deriveds, since the scene may still reference them
  // during the evicting flush; the teardown effect disposes the rest on unmount.
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
  // The colour a domain is drawn in: its overlay colour, else its domain colour
  const drawn_color = (formula: string): string | undefined =>
    overlay_formulas.has(formula) ? overlay_color(formula) : domain_colors.get(formula)

  // Formula overlay edges (crease edges, per formula)
  const domain_edge_geometry = (domain: RenderDomain): THREE.BufferGeometry =>
    positions_geometry(
      domain.edges.flatMap(([pt_a, pt_b]) => [...to_render_xyz(pt_a), ...to_render_xyz(pt_b)]),
    )
  const overlay_edge_geometries = memo_overlay_geometry(domain_edge_geometry)
  const formula_edge_data = $derived(
    overlay_edge_geometries(draw_formula_lines ? overlay_domains : []),
  )

  // Formula overlay meshes (convex hull surface, per formula)
  const overlay_mesh_geometries = memo_overlay_geometry((domain) =>
    domain_hull_geometry(domain.points_3d),
  )
  const formula_mesh_data = $derived(
    overlay_mesh_geometries(draw_formula_meshes ? overlay_domains : []),
  )
  // Runs after the deriveds above settle, so no mesh still points at a disposed geometry
  const dispose_evicted = () => {
    for (const geometry of evicted_geometries.splice(0)) geometry.dispose()
  }
  $effect(() => {
    void [formula_edge_data, formula_mesh_data]
    dispose_evicted()
    return dispose_evicted
  })

  // Merge coplanar ConvexGeometry triangles, removing diagonal edges across flat hull faces
  function merge_coplanar_geometry(geom: ConvexGeometry): THREE.BufferGeometry {
    const pos = geom.getAttribute(`position`)
    const result = positions_geometry(merge_coplanar_triangles(pos.array as Float32Array))
    result.computeVertexNormals()
    // Callers always pass a freshly created ConvexGeometry, so we own it
    geom.dispose()
    return result
  }

  // Convex hull of a domain's points; ConvexGeometry needs 4+ points, so 3 make a triangle
  function domain_hull_geometry(points_3d: number[][]): THREE.BufferGeometry | null {
    const unique_points = dedup_3d(points_3d)
    if (unique_points.length !== 3) return render_hull_geometry(unique_points)
    return positions_geometry(unique_points.flatMap(to_render_xyz))
  }

  // Domain adjacency: two domains are neighbors if they share any vertex (within tolerance)
  const domain_neighbors = $derived.by((): Map<string, string[]> => {
    const tol = 1e-4
    const vertex_owners = new Map<string, string[]>()
    for (const domain of render_domains) {
      for (const point of domain.points_3d) {
        const key = point.map((val) => (Math.round(val / tol) * tol).toFixed(4)).join(`,`)
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

  // Hull triangle indices per owning domain: exactly the surface each domain is drawn on
  const owned_faces = $derived.by((): Map<string, number[]> => {
    const owned = new Map<string, number[]>()
    for (const [face_idx, owner] of face_domain_map.entries()) {
      const faces = owned.get(owner) ?? []
      faces.push(face_idx)
      owned.set(owner, faces)
    }
    return owned
  })
  // Hover info per domain the hull shows a face of: the scene picks the drawn hull itself, so a
  // domain buried inside the envelope (projection mode) is never reported
  const hover_mesh_data = $derived.by((): HoverMesh[] => {
    if (!diagram_data) return []
    const { lims } = diagram_data
    const drawn = render_domains.filter(({ formula }) => owned_faces.has(formula))
    return drawn.map((domain) => {
      const { formula, points_3d } = domain
      const info: ChemPotHoverInfo3D = {
        formula,
        view: `3d`,
        n_vertices: dedup_3d(points_3d).length,
        n_edges: domain.edges.length,
        n_points: points_3d.length,
        ann_loc: domain.ann_loc,
        axis_ranges: build_axis_ranges(points_3d, plot_elements),
        touches_limits: get_touches_limits(points_3d, lims, plot_elements),
        is_elemental: all_entry_elements.includes(formula),
        is_draw_formula: overlay_formulas.has(formula),
        matching_entry_count: 0,
        min_energy_per_atom: null,
        max_energy_per_atom: null,
        ...entry_energy_stats_by_formula.get(formula),
        // buried domains share vertices but cannot be hovered, so they are no neighbours here
        neighbors: (domain_neighbors.get(formula) ?? []).filter((other) =>
          owned_faces.has(other),
        ),
      }
      return { formula, info }
    })
  })

  const highlight_key = $derived(highlight_key_of(hover_info?.formula, highlighted_formula))
  // The highlighted domain as drawn (HoverHighlight): the hull faces it owns, i.e. exactly the
  // face shown in its colour, so the face lights up rather than turning a foreign colour. A
  // domain owning no hull face (buried inside a projected envelope) gets its crease edges.
  const highlight = $derived.by(() => {
    const domain = render_domains.find(({ formula }) => formula === highlight_key)
    if (!domain) return null
    const { formula } = domain
    const color = drawn_color(formula) ?? HIGHLIGHT.emphasis
    const faces = owned_faces.get(formula)
    return faces
      ? { formula, color, faces }
      : { formula, color, edges: domain_edge_geometry(domain) }
  })

  dispose_on_change(() => [edge_geometry])
  dispose_on_change(() => [highlight?.edges])
  dispose_on_change(() => [occlusion_hull_geometry])

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

  function schedule_label_occlusion_update(): void {
    if (typeof requestAnimationFrame === `undefined`) return
    if (label_occlusion_frame !== null) cancelAnimationFrame(label_occlusion_frame)
    label_occlusion_frame = requestAnimationFrame(() => {
      label_occlusion_frame = null
      if (wrapper) tick_labels_occluded = occlude_tick_labels(wrapper)
    })
  }

  // OrbitControls fires `change` only past its own epsilon, so a mid-gesture change is real
  // movement (a bare click emits only start/end). Auto-rotation's `change` has no `start`.
  let gesture_active = false
  const on_gesture_edge = (event: { type: string }): void => {
    gesture_active = event.type === `start`
    // Prime the framing baseline so the next geometry change already preserves zoom/center
    if (gesture_active) last_data_center ??= [...data_center]
    else gesture_had_input = false
  }

  // With auto-rotation, `change` fires every frame, so intent must come from the input itself.
  // Capture phase on the wrapper: OrbitControls dispatches start/change/end synchronously
  // inside the wheel event, so a canvas listener would land after all three.
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
    // Written straight to the camera, else controls.update() below runs on the stale pose
    controls_camera.position.set(...default_camera_position)
    controls.target.set(...default_camera_target)
    if (controls_camera instanceof THREE.OrthographicCamera) {
      controls_camera.zoom = default_orthographic_zoom
      controls_camera.updateProjectionMatrix()
    }
    clear_pan_offset(controls_camera)
    controls.update()
  }

  // Preserve user framing across geometry changes: shift camera/target with the domain center
  // and keep orthographic zoom relative to extent
  $effect(() => {
    // Re-runs on every OrbitControls `change`; nothing to do while the baselines are unchanged
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
    // A zero fit means the container has no size yet; keep the last real one as baseline
    if (default_orthographic_zoom > 0) last_default_zoom = default_orthographic_zoom
  })

  $effect(() => {
    const controls = orbit_controls_ref
    if (!controls) return
    const on_controls_change = (): void => {
      // Once pinned keep tracking; before that only a live gesture may pin (reading allocates,
      // and auto-rotation fires this every frame)
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

  // Controls, panes and a pinned tooltip (word selection) own their own double-click, but passive render overlays must not
  // swallow reset. `closest` handles clicks reported by a control's child.
  const handle_dblclick = ({ target }: MouseEvent): void => {
    const on_chrome =
      target instanceof Element &&
      target.closest(`button, input, select, .draggable-pane, .plot-tooltip`)
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
    apply_projection_preset(next_projection)
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
    // the hoverable ones, as the tooltip lists them
    chempot.set(`formulas_to_draw`, [hover_info.formula, ...hover_info.neighbors])
  }

  const export_basename = $derived(`chempot-${plot_elements.join(`-`)}`)

  const current_view_settings = (): Record<string, unknown> =>
    get_view_settings({
      elements: plot_elements,
      camera_projection,
      auto_rotate,
      color_mode,
      color_scale,
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

  const export_sources: ExportSources = {
    png: (png_dpi) => chempot_png_blob(wrapper, png_dpi),
    svg: () => chempot_svg_string(wrapper, current_view_settings()),
    json: json_source(export_json_payload),
  }
  const export_sections: ExportSection[] = [
    {
      title: `Extras`,
      items: [
        {
          label: `View`,
          hint: `Camera and display settings as JSON`,
          on_download: ({ filename, save }) =>
            save(
              JSON.stringify(current_view_settings(), null, 2),
              `${filename}-view.json`,
              `application/json`,
            ),
        },
        {
          label: `GLB`,
          on_download: ({ filename, save }) =>
            export_glb_file(
              {
                hull_geometry: colored_hull_geometry,
                hull_opacity,
                edge_geometry,
                formula_meshes: formula_mesh_data,
                formula_edges: formula_edge_data,
              },
              filename,
              save,
            ),
        },
      ],
    },
  ]

  onDestroy(() => {
    if (label_occlusion_frame !== null) cancelAnimationFrame(label_occlusion_frame)
  })

  const pin = new TooltipPin<string>({ on_unpin: () => (hover_info = null) })
  const tooltip_pointer = pin.anchored(() => hover_info?.pointer)
  const key_walk = key_walk_root() // the domains, by keyboard (see KeyWalk)
  const wheel_gate = wheel_zoom_gate()

  function set_hover_info(domain_data: HoverMesh, event: ThreltePointerEvent): void {
    hover_info = {
      ...domain_data.info,
      pointer: container_pointer(event.nativeEvent, wrapper),
    }
  }

  function handle_phase_hover(domain_data: HoverMesh, event: ThreltePointerEvent): void {
    if (pin.allows(domain_data.formula)) set_hover_info(domain_data, event)
  }

  // Stops both Threlte's dispatch to farther hits and the DOM event the wrapper listens to
  function toggle_phase_pin(domain_data: HoverMesh, event: ThreltePointerEvent): void {
    event.stopPropagation()
    event.nativeEvent.stopPropagation()
    pin.toggle(domain_data.formula)
    if (pin.value) set_hover_info(domain_data, event)
  }

  function handle_phase_leave(domain_data: HoverMesh): void {
    if (!pin.value && hover_info?.formula === domain_data.formula) hover_info = null
  }

  // A pinned tooltip re-reads its domain after recomputes, unpinning once the domain is gone
  $effect(() => {
    const meshes = hover_mesh_data
    untrack(() => {
      if (!pin.value) return
      const current = meshes.find(({ formula }) => formula === pin.value)
      if (!current) pin.unpin()
      else if (hover_info) hover_info = { ...current.info, pointer: hover_info.pointer }
    })
  })

  // A wheel zoom shifts the domains under a still cursor with no pointerleave to clear the tooltip
  function handle_camera_start(): void {
    if (!pin.value) hover_info = null
  }

  // Color mode cycling (keyboard shortcut 'c')
  const color_modes = CHEMPOT_COLOR_MODE_OPTIONS.map(([value]) => value)
  function cycle_color_mode(): void {
    const idx = color_modes.indexOf(color_mode)
    chempot.set(`color_mode`, color_modes[(idx + 1) % color_modes.length])
  }

  const changed_controls = $derived([
    ...chempot.changed_keys,
    ...(camera_position_override !== null ? [`camera`] : []),
    ...(projection_elements_override !== null ? [`projection`] : []),
    ...(formula_filter_query ? [`formula_filter`] : []),
  ])
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
  {@attach viewer_keys(() => ({
    c: cycle_color_mode,
    r: reset_camera_view,
    Escape: pin.unpin,
  }))}
  {@attach key_walk.attach}
  {@attach wheel_gate}
  onpointerdown={({ target }) => {
    if (target === wrapper || target instanceof HTMLCanvasElement) pin.unpin()
  }}
  onpointermovecapture={mark_input}
  onwheelcapture={mark_input}
  ondblclick={handle_dblclick}
>
  <LiveMessage message={key_walk.message} />
  <ViewerChrome
    {controls_config}
    bind:fullscreen
    {wrapper}
    fullscreen_bg_css_var="--chempot-3d-bg-fullscreen"
  >
    {#if controls_config.visible(`export`)}
      <ExportPane
        filename={export_basename}
        bind:export_pane_open={export_pane.get, export_pane.set}
        sources={export_sources}
        sections={export_sections}
        pane_props={{ class: `chempot-export-pane` }}
        toggle_props={{
          class: `chempot-export-toggle`,
          title: `Export chemical potential diagram`,
        }}
      />
    {/if}
    {#if controls_config.visible(`formulas`)}
      <ViewerPane
        bind:open={formulas_pane.get, formulas_pane.set}
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
                {domain_formula_text(formula)}
              </label>
            {/each}
          {/if}
        </div>
      </ViewerPane>
    {/if}

    {#if controls_config.visible(`slice`) && chempot.slice_elements.length > 0}
      <ViewerPane
        bind:open={slice_pane.get, slice_pane.set}
        pane_name="chemical potential slices"
        class_prefix="chempot-slice"
        closed_icon={ContentCut}
      >
        <h4>Slices</h4>
        <ChemPotSlices
          elements={chempot.slice_elements}
          slices={chempot.slices}
          ranges={chempot.slice_ranges}
          curves={chempot.slice_curves}
          set_slice={chempot.set_slice}
          measure_label="Area (eV²)"
          {formal_chempots}
          colors={drawn_color}
          formulas={formulas_to_draw}
        />
      </ViewerPane>
    {/if}

    <ScatterPlot3DControls
      show_controls={controls_config.visible(`controls`)}
      bind:controls_open={controls_pane.get, controls_pane.set}
      bind:x_axis
      bind:y_axis
      bind:z_axis
      bind:display
      bind:camera_projection
      bind:auto_rotate
      auto_ranges={controls_auto_ranges}
      shortcut_scopes={[`viewer`, `camera`, `chempot-3d`]}
      toggle_props={{
        class: `chempot-controls-toggle`,
        style: `position: static`,
        title: `3D plot controls`,
      }}
      pane_props={{ class: `chempot-controls-pane` }}
    >
      <SettingsSection
        title="ChemPot"
        changed_keys={changed_controls}
        labels={{ reset_section: (title) => `Clear ${title.toLowerCase()} overrides` }}
        on_reset={reset_controls}
      >
        {#if has_multinary_system && plot_elements.length === 3}
          <div class="pane-row projection-axes">
            {#each [`x`, `y`, `z`] as axis, axis_idx (axis)}
              <label for="chempot-proj-{axis}">{axis.toUpperCase()}:</label>
              <select
                id="chempot-proj-{axis}"
                value={plot_elements[axis_idx]}
                onchange={(event) => set_projection_axis(axis_idx, event.currentTarget.value)}
              >
                {#each all_entry_elements as element_name (element_name)}
                  <option value={element_name}>{element_name}</option>
                {/each}
              </select>
            {/each}
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
      <EmptyState>
        <p>Cannot compute chemical potential diagram.</p>
        <p>{diagram_error ?? `Need at least 2 elements with elemental reference entries.`}</p>
      </EmptyState>
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
          face_owners={face_domain_map}
          on_domain_hover={handle_phase_hover}
          on_domain_press={toggle_phase_pin}
          on_domain_leave={handle_phase_leave}
          on_camera_start={handle_camera_start}
          {highlight}
          formula_meshes={formula_mesh_data}
          formula_edges={formula_edge_data}
          domain_labels={scene_domain_labels}
          label_scale={zoom_scale}
        />
      </Canvas>
    </div>
    <ChemPotLegend
      {color_mode}
      {color_bar}
      formulas={render_domains.map((domain) => domain.formula)}
      style="bottom: 16px; left: 1em"
    />
    {@render slice_label(chempot.slices, formal_chempots)}
  {/if}
  {#if tooltip !== false && hover_info?.view === `3d`}
    <ChemPotTooltip
      {hover_info}
      pointer={tooltip_pointer.current}
      pinned={pin.value === hover_info.formula}
      {tooltip}
      bg_color={drawn_color(hover_info.formula)}
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
    /* overlays the scene: in flow it pushes the fixed-height viewer's canvas out of its box */
    position: absolute;
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
</style>
