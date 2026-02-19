<script lang="ts">
  import { type D3InterpolateName } from '$lib/colors'
  import { get_hill_formula } from '$lib/composition/format'
  import { extract_formula_elements } from '$lib/composition/parse'
  import TemperatureSlider from '$lib/convex-hull/TemperatureSlider.svelte'
  import type { PhaseData } from '$lib/convex-hull/types'
  import Icon from '$lib/Icon.svelte'
  import { format_num } from '$lib/labels'
  import { set_fullscreen_bg, SettingsSection, toggle_fullscreen } from '$lib/layout'
  import {
    convex_hull_2d,
    cross_3d,
    merge_coplanar_triangles,
    normalize_vec3,
    type Vec2,
    type Vec3,
  } from '$lib/math'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import { ColorBar, ScatterPlot3DControls } from '$lib/plot'
  import type {
    AxisConfig3D,
    CameraProjection3D,
    DataSeries3D,
    DisplayConfig3D,
  } from '$lib/plot/types'
  import { Canvas, T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { scaleLinear } from 'd3-scale'
  import { onDestroy, onMount } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import * as THREE from 'three'
  import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
  import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
  import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
  import ChemPotScene3D from './ChemPotScene3D.svelte'
  import { get_chempot_color_bar_config, make_chempot_color_scale } from './color'
  import {
    apply_element_padding,
    best_form_energy_for_formula,
    build_axis_ranges,
    compute_chempot_diagram,
    dedup_points,
    formula_key_from_composition,
    get_3d_domain_simplexes_and_ann_loc,
    get_energy_per_atom,
    get_min_entries_and_el_refs,
    pad_domain_points,
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
    ChemPotHoverInfo,
    ChemPotHoverInfo3D,
  } from './types'
  import { CHEMPOT_DEFAULTS } from './types'

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
    render_local_tooltip = true,
  }: {
    entries: PhaseData[]
    config?: ChemPotDiagramConfig
    width?: number
    height?: number
    temperature?: number
    interpolate_temperature?: boolean
    max_interpolation_gap?: number
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
  let formulas_to_draw_override = $state<string[] | null>(null)
  const formulas_to_draw = $derived(
    formulas_to_draw_override ?? (config.formulas_to_draw ?? []),
  )
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
  let reverse_color_scale_override = $state<boolean | null>(null)
  const color_mode = $derived(
    color_mode_override ?? (config.color_mode ?? `arity`),
  )
  const color_scale = $derived(
    color_scale_override ?? (config.color_scale ?? CHEMPOT_DEFAULTS.color_scale),
  )
  const reverse_color_scale = $derived(
    reverse_color_scale_override ??
      (config.reverse_color_scale ?? CHEMPOT_DEFAULTS.reverse_color_scale),
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

  let wrapper = $state<HTMLDivElement>()
  let fullscreen = $state(false)
  let export_pane_open = $state(false)
  let formula_picker_open = $state(false)
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
  let fixed_container_element = $state<HTMLElement | null>(null)
  let fixed_container_rect = $state<DOMRect | null>(null)
  let fixed_container_frame_id: number | null = null
  let orbit_controls_ref = $state<OrbitControls | undefined>(undefined)
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
  const projection_opacity = $derived(display.projection_opacity ?? 0.15)

  // Plotly/pymatgen uses Z-up with x-axis projecting left in isometric view.
  // Three.js uses Y-up with X projecting right. To match pymatgen's visual layout:
  //   data[0] (plotly x, projects left)  → Three.js Z (projects left)
  //   data[1] (plotly y, projects right) → Three.js X (projects right)
  //   data[2] (plotly z, projects up)    → Three.js Y (projects up)
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

  const show_temperature_slider = $derived(
    has_temp_data && available_temperatures.length > 0,
  )

  const projection_source_entries = $derived(
    get_projection_source_entries(entries, temp_filtered_entries),
  )

  const all_entry_elements = $derived.by(() =>
    Array.from(
      new SvelteSet(
        projection_source_entries.flatMap((entry) =>
          Object.entries(entry.composition)
            .filter(([, amount]) => amount > 0)
            .map(([element]) => element)
        ),
      ),
    ).sort()
  )
  const has_multinary_system = $derived(all_entry_elements.length > 3)
  let projection_elements_override = $state<string[] | null>(null)
  const config_projection_elements = $derived(
    normalize_projection_triplet(config.elements, all_entry_elements),
  )
  const projection_elements = $derived.by(() => {
    if (all_entry_elements.length < 3) return []
    if (!has_multinary_system) {
      return config_projection_elements ?? all_entry_elements.slice(0, 3)
    }
    const override_projection = normalize_projection_triplet(
      projection_elements_override ?? undefined,
      all_entry_elements,
    )
    if (override_projection) return override_projection
    if (config_projection_elements) return config_projection_elements
    return all_entry_elements.slice(0, 3)
  })
  const effective_config = $derived({
    ...config,
    elements: projection_elements.length === 3
      ? projection_elements
      : config.elements,
    formal_chempots,
    label_stable,
    element_padding,
    default_min_limit,
    draw_formula_meshes,
    draw_formula_lines,
  })
  const diagram_data = $derived.by(() => {
    if (temp_filtered_entries.length < 3) return null
    try {
      const data = compute_chempot_diagram(temp_filtered_entries, effective_config)
      return data.elements.length >= 3 ? data : null
    } catch (err) {
      console.error(`ChemPotDiagram3D:`, err)
      return null
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
    const seen_triplets = new SvelteSet<string>()
    const add_triplet = (candidate: string[] | null): void => {
      if (!candidate) return
      const key = candidate.join(`|`)
      if (seen_triplets.has(key)) return
      seen_triplets.add(key)
      presets.push(candidate)
    }
    add_triplet(config_projection_elements)
    add_triplet(plot_elements.length === 3 ? plot_elements : null)
    if (all_entry_elements.length >= 3) {
      const n_elements = all_entry_elements.length
      for (let first_idx = 0; first_idx < n_elements; first_idx++) {
        for (let second_idx = first_idx + 1; second_idx < n_elements; second_idx++) {
          for (let third_idx = second_idx + 1; third_idx < n_elements; third_idx++) {
            add_triplet([
              all_entry_elements[first_idx],
              all_entry_elements[second_idx],
              all_entry_elements[third_idx],
            ])
            if (presets.length >= 12) return presets
          }
        }
      }
    }
    return presets
  })
  const current_projection_key = $derived(plot_elements.join(`|`))
  let formula_filter_query = $state(``)
  const available_formulas = $derived.by(() =>
    Object.keys(diagram_data?.domains ?? {}).sort()
  )
  const filtered_formulas = $derived.by(() => {
    const query = formula_filter_query.trim().toLowerCase()
    if (!query) return available_formulas
    return available_formulas.filter((formula) =>
      formula.toLowerCase().includes(query)
    )
  })

  // Process domains for rendering
  interface DomainRenderData {
    formula: string
    points_3d: number[][]
    ann_loc: number[]
    label_loc: number[]
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
  type NumericColorMode = Exclude<ChemPotColorMode, `none` | `arity`>

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
      const label_loc = padded[0].map((_, col_idx) =>
        padded.reduce((sum, point) => sum + point[col_idx], 0) / padded.length
      )
      if (padded.length >= 3) {
        const { ann_loc } = get_3d_domain_simplexes_and_ann_loc(padded)
        result.push({
          formula,
          points_3d: padded,
          ann_loc,
          label_loc,
          is_draw_formula: is_draw,
        })
      } else {
        result.push({
          formula,
          points_3d: padded,
          ann_loc: label_loc,
          label_loc,
          is_draw_formula: is_draw,
        })
      }
    }
    return result
  })

  const entry_energy_stats_by_formula = $derived.by(
    (): SvelteMap<string, FormulaEnergyStats> => {
      const stats_by_formula = new SvelteMap<string, FormulaEnergyStats>()
      for (const entry of temp_filtered_entries) {
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

  // Original (non-renormalized) elemental references for formation energy computation.
  // diagram_data.el_refs may be renormalized to zero when formal_chempots is true,
  // so we compute our own from the raw entries to get true DFT reference energies.
  const raw_el_refs = $derived(
    get_min_entries_and_el_refs(temp_filtered_entries).el_refs,
  )

  const color_mode_labels: Record<NumericColorMode, string> = {
    energy: `Energy per atom (eV)`,
    formation_energy: `Formation energy (eV/atom)`,
    entries: `Entry count`,
  }
  function get_numeric_color_value(
    formula: string,
    active_color_mode: NumericColorMode,
  ): number | null {
    if (active_color_mode === `energy`) {
      return entry_energy_stats_by_formula.get(formula)?.min_energy_per_atom ?? null
    }
    if (active_color_mode === `formation_energy`) {
      return best_form_energy_for_formula(
        temp_filtered_entries,
        formula,
        raw_el_refs,
      ) ?? null
    }
    return entry_energy_stats_by_formula.get(formula)?.matching_entry_count ?? 0
  }
  const domain_color_values = $derived.by(
    (): { value_by_formula: SvelteMap<string, number>; values: number[] } | null => {
      if (color_mode === `none` || color_mode === `arity`) return null
      const active_color_mode = color_mode as NumericColorMode
      const value_by_formula = new SvelteMap<string, number>()
      const values: number[] = []
      for (const domain of render_domains) {
        const value = get_numeric_color_value(domain.formula, active_color_mode)
        if (value == null || !Number.isFinite(value)) continue
        values.push(value)
        value_by_formula.set(domain.formula, value)
      }
      return { value_by_formula, values }
    },
  )

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
    const values_payload = domain_color_values
    const scale = make_chempot_color_scale(
      values_payload?.values ?? [],
      color_scale,
      reverse_color_scale,
    )
    for (const domain of render_domains) {
      const value = values_payload?.value_by_formula.get(domain.formula)
      colors.set(domain.formula, value != null && scale ? scale(value) : `#999`)
    }
    return colors
  })

  // Range and label for the color bar (null for none/arity which are categorical)
  const color_range = $derived.by(
    (): { min: number; max: number; label: string } | null => {
      const values = domain_color_values?.values ?? []
      if (values.length === 0) return null
      let lo = values[0], hi = values[0]
      for (let idx = 1; idx < values.length; idx++) {
        if (values[idx] < lo) lo = values[idx]
        if (values[idx] > hi) hi = values[idx]
      }
      return {
        min: lo,
        max: Math.max(hi, lo + 1e-6),
        label: color_mode === `none` || color_mode === `arity`
          ? ``
          : color_mode_labels[color_mode],
      }
    },
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
  const render_axis_scale = $derived.by((): [number, number, number] => {
    const points = render_domains.flatMap((domain) => domain.points_3d)
    if (points.length === 0) return [1, 1, 1]
    let min0 = Infinity, max0 = -Infinity
    let min1 = Infinity, max1 = -Infinity
    let min2 = Infinity, max2 = -Infinity
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

  function to_render_xyz(point: number[]): [number, number, number] {
    const [scale_x, scale_y, scale_z] = render_axis_scale
    return [point[1] * scale_x, point[2] * scale_y, point[0] * scale_z]
  }

  // Compute data center and extent for camera positioning (in swizzled coords)
  const { data_center, data_extent } = $derived.by(() => {
    const points = render_domains.flatMap((domain) => domain.points_3d)
    if (points.length === 0) {
      return { data_center: new THREE.Vector3(0, 0, 0), data_extent: 10 }
    }
    // Compute center in rendered coordinates (swizzled + axis scaling).
    let [sum_x, sum_y, sum_z] = [0, 0, 0]
    for (const point_3d of points) {
      const [x_val, y_val, z_val] = to_render_xyz(point_3d)
      sum_x += x_val
      sum_y += y_val
      sum_z += z_val
    }
    const n_points = points.length
    const center = new THREE.Vector3(
      sum_x / n_points,
      sum_y / n_points,
      sum_z / n_points,
    )
    // Compute max distance from center
    let max_dist = 0
    for (const point of points) {
      const [x_val, y_val, z_val] = to_render_xyz(point)
      const dist = Math.hypot(x_val - center.x, y_val - center.y, z_val - center.z)
      if (dist > max_dist) max_dist = dist
    }
    return { data_center: center, data_extent: Math.max(max_dist * 1.3, 1) }
  })
  const default_camera_position = $derived<[number, number, number]>([
    data_center.x + data_extent,
    data_center.y + data_extent,
    data_center.z + data_extent,
  ])
  const default_camera_target = $derived<[number, number, number]>([
    data_center.x,
    data_center.y,
    data_center.z,
  ])
  const default_orthographic_zoom = $derived(
    Math.min(render_width, render_height) / (data_extent * 1.6),
  )
  let camera_position_override = $state<[number, number, number] | null>(null)
  let camera_target_override = $state<[number, number, number] | null>(null)
  let orthographic_zoom_override = $state<number | null>(null)
  const camera_position = $derived(
    camera_position_override ?? default_camera_position,
  )
  const camera_target = $derived(
    camera_target_override ?? default_camera_target,
  )
  const orthographic_zoom = $derived(
    orthographic_zoom_override ?? default_orthographic_zoom,
  )
  let last_data_center = $state<[number, number, number] | null>(null)
  let last_data_extent = $state<number | null>(null)

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
      const swizzled = domain.points_3d.map((point) => to_render_xyz(point))
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
    const src = occlusion_hull_geometry.toNonIndexed()
    const pos = src.getAttribute(`position`)
    const n_verts = pos.count
    const n_faces = n_verts / 3
    // Hull centroid for orienting face normals outward
    let hx = 0, hy = 0, hz = 0
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
    const colors = new Float32Array(merged.length).fill(0.965)
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
      .filter((d) => !d.is_draw_formula && d.points_3d.length > 0)
      .map((d) => {
        let sx = 0, sy = 0, sz = 0
        for (const pt of d.points_3d) {
          const [x_val, y_val, z_val] = to_render_xyz(pt)
          sx += x_val
          sy += y_val
          sz += z_val
        }
        const n = d.points_3d.length
        return { formula: d.formula, cx: sx / n, cy: sy / n, cz: sz / n }
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
      const round = (v: number): number => Math.round(v / tol)
      const vkey = (vert_idx: number): string =>
        `${round(pos.getX(vert_idx))},${round(pos.getY(vert_idx))},${
          round(pos.getZ(vert_idx))
        }`
      const ekey = (ka: string, kb: string): string =>
        ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
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
        normals.push(normalize_vec3(cross_3d(e1, e2)))
      }
      // Build edge → face adjacency
      const edge_faces = new SvelteMap<string, number[]>()
      for (let face_idx = 0; face_idx < n_faces; face_idx++) {
        const base = face_idx * 3
        const keys = [vkey(base), vkey(base + 1), vkey(base + 2)]
        for (
          const ek of [
            ekey(keys[0], keys[1]),
            ekey(keys[1], keys[2]),
            ekey(keys[0], keys[2]),
          ]
        ) {
          const list = edge_faces.get(ek)
          if (list) list.push(face_idx)
          else edge_faces.set(ek, [face_idx])
        }
      }
      // Union-find for coplanar adjacent faces
      const parent = Array.from({ length: n_faces }, (_, idx) => idx)
      const find = (x: number): number => {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]]
          x = parent[x]
        }
        return x
      }
      const union = (a_idx: number, b_idx: number): void => {
        const ra = find(a_idx), rb = find(b_idx)
        if (ra !== rb) parent[ra] = rb
      }
      for (const pair of edge_faces.values()) {
        if (pair.length !== 2) continue
        const [fa, fb] = pair
        const na = normals[fa], nb = normals[fb]
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

  // Reactive color fill: creates a cloned geometry with vertex colors applied.
  // Only runs when color_mode or domain_colors change — no mutation of hull_base_geometry.
  const colored_hull_geometry = $derived.by((): THREE.BufferGeometry | null => {
    const mapping = face_domain_map
    if (!hull_base_geometry || mapping.length === 0) return hull_base_geometry

    const geom = hull_base_geometry.clone()
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
      for (let vert_idx = 0; vert_idx < 3; vert_idx++) {
        color_attr.setXYZ(base + vert_idx, red, green, blue)
      }
    }
    color_attr.needsUpdate = true
    return geom
  })

  $effect(() => {
    const geom = hull_base_geometry
    return () => dispose_geometry(geom)
  })

  $effect(() => {
    const geom = colored_hull_geometry
    // Don't dispose if it's the same object as hull_base_geometry (no clone was made)
    if (geom && geom !== hull_base_geometry) return () => dispose_geometry(geom)
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
      const swizzled = domain.points_3d.map((point) => to_render_xyz(point))
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
        const geom = merge_coplanar_geometry(new ConvexGeometry(vectors))
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
      const verts = new Float32Array(vectors.flatMap((v) => [v.x, v.y, v.z]))
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
        const key = pt.map((val) => (Math.round(val / tol) * tol).toFixed(4)).join(
          `,`,
        )
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
    for (const [formula, set] of neighbors) result.set(formula, [...set].sort())
    return result
  })

  const hover_mesh_data = $derived.by((): HoverMeshData[] => {
    if (!diagram_data) return []
    const result: HoverMeshData[] = []
    const lims = diagram_data.lims
    const energy_stats_by_formula = entry_energy_stats_by_formula

    for (const domain of render_domains) {
      if (domain.points_3d.length < 3) continue
      const hover_geometry = create_hover_geometry(domain.points_3d)
      if (!hover_geometry) continue
      const { geometry, n_vertices } = hover_geometry

      const swizzled_points = domain.points_3d.map((point) => to_render_xyz(point))
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
    const [scale_x, scale_y, scale_z] = render_axis_scale
    return [d1 * scale_x, d2 * scale_y, d0 * scale_z] // data[0]→Z, data[1]→X, data[2]→Y
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

  function store_camera_view_state(): void {
    // Prime framing baseline on first user interaction so the next geometry
    // change can preserve zoom/center immediately (not only from second change).
    if (last_data_center === null) {
      last_data_center = [data_center.x, data_center.y, data_center.z]
    }
    if (last_data_extent === null) {
      last_data_extent = data_extent
    }
    const controls = orbit_controls_ref
    const controls_camera = controls?.object
    if (controls_camera) {
      camera_position_override = [
        controls_camera.position.x,
        controls_camera.position.y,
        controls_camera.position.z,
      ]
      if (controls_camera instanceof THREE.OrthographicCamera) {
        orthographic_zoom_override = controls_camera.zoom
      }
    }
    const controls_target = controls?.target
    if (controls_target) {
      camera_target_override = [
        controls_target.x,
        controls_target.y,
        controls_target.z,
      ]
    }
  }

  // Preserve user framing across temperature-driven geometry changes:
  // shift camera/target with domain center and keep orthographic zoom relative to extent.
  $effect(() => {
    if (camera_position_override && camera_target_override && last_data_center) {
      const [last_x, last_y, last_z] = last_data_center
      const delta_x = data_center.x - last_x
      const delta_y = data_center.y - last_y
      const delta_z = data_center.z - last_z
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
    if (
      orthographic_zoom_override !== null &&
      last_data_extent !== null &&
      last_data_extent > 0 &&
      data_extent > 0
    ) {
      orthographic_zoom_override *= last_data_extent / data_extent
    }
    last_data_center = [data_center.x, data_center.y, data_center.z]
    last_data_extent = data_extent
  })

  $effect(() => {
    const controls = orbit_controls_ref
    if (!controls) return
    const on_controls_change = (): void => {
      update_backside()
      store_camera_view_state()
    }
    controls.addEventListener(`change`, on_controls_change)
    update_backside()
    return () => controls.removeEventListener(`change`, on_controls_change)
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
    reverse_color_scale_override = null
    projection_elements_override = null
    formulas_to_draw_override = null
    formula_filter_query = ``
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
    const normalized = normalize_projection_triplet(
      next_projection,
      all_entry_elements,
    )
    if (normalized) projection_elements_override = normalized
  }

  function apply_projection_preset(preset_elements: string[]): void {
    const normalized = normalize_projection_triplet(
      preset_elements,
      all_entry_elements,
    )
    if (normalized) projection_elements_override = normalized
  }

  function toggle_formula_selection(formula: string): void {
    const selected_formulas = new SvelteSet(formulas_to_draw)
    if (selected_formulas.has(formula)) selected_formulas.delete(formula)
    else selected_formulas.add(formula)
    formulas_to_draw_override = [...selected_formulas]
  }

  function select_surface_formulas(): void {
    formulas_to_draw_override = render_domains
      .filter((domain) => surface_formulas.has(domain.formula))
      .map((domain) => domain.formula)
  }

  function select_neighbor_formulas(): void {
    if (hover_info?.view !== `3d`) return
    const neighbors = domain_neighbors.get(hover_info.formula) ?? []
    formulas_to_draw_override = [hover_info.formula, ...neighbors]
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
  const export_basename = $derived(`chempot-${plot_elements.join(`-`)}`)

  function get_view_settings(): Record<string, unknown> {
    const camera_position = orbit_controls_ref?.object?.position
    const camera_target = orbit_controls_ref?.target
    return {
      elements: plot_elements,
      camera_projection,
      auto_rotate,
      color_mode,
      color_scale,
      reverse_color_scale,
      camera_position: camera_position
        ? [camera_position.x, camera_position.y, camera_position.z]
        : null,
      camera_target: camera_target
        ? [camera_target.x, camera_target.y, camera_target.z]
        : null,
    }
  }

  interface OverlayTextItem {
    x: number
    y: number
    text: string
    font: string
    font_size: string
    font_family: string
    font_weight: string
    color: string
  }
  function get_overlay_text_items(canvas_rect: DOMRect): OverlayTextItem[] {
    if (!wrapper) return []
    const text_items: OverlayTextItem[] = []
    for (
      const element of wrapper.querySelectorAll(
        `.tick-label, .axis-label, .domain-label`,
      )
    ) {
      const html_element = element as HTMLElement
      const style = getComputedStyle(html_element)
      if (style.display === `none` || style.visibility === `hidden`) continue
      const element_rect = html_element.getBoundingClientRect()
      text_items.push({
        x: element_rect.left + element_rect.width / 2 - canvas_rect.left,
        y: element_rect.top + element_rect.height / 2 - canvas_rect.top,
        text: html_element.textContent ?? ``,
        font: style.font || `${style.fontSize} ${style.fontFamily}`,
        font_size: style.fontSize || `11px`,
        font_family: style.fontFamily || `sans-serif`,
        font_weight: style.fontWeight || `400`,
        color: style.color || `#333`,
      })
    }
    return text_items
  }

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
    for (const text_item of get_overlay_text_items(rect)) {
      ctx.font = text_item.font
      ctx.fillStyle = text_item.color
      ctx.textAlign = `center`
      ctx.textBaseline = `middle`
      ctx.fillText(text_item.text, text_item.x, text_item.y)
    }

    out.toBlob((blob) => {
      if (!blob) return
      download_blob(blob, `${export_basename}.png`)
    }, `image/png`)
  }

  function xml_escape(text: string): string {
    return text
      .replaceAll(`&`, `&amp;`)
      .replaceAll(`<`, `&lt;`)
      .replaceAll(`>`, `&gt;`)
      .replaceAll(`"`, `&quot;`)
      .replaceAll(`'`, `&#39;`)
  }

  function export_svg_file(): void {
    if (!wrapper) return
    const gl_canvas = wrapper.querySelector(`canvas`)
    if (!(gl_canvas instanceof HTMLCanvasElement)) return
    const canvas_rect = gl_canvas.getBoundingClientRect()
    if (canvas_rect.width === 0 || canvas_rect.height === 0) return
    const png_data_url = gl_canvas.toDataURL(`image/png`)
    const text_nodes = get_overlay_text_items(canvas_rect).map((text_item) =>
      `<text x="${text_item.x.toFixed(2)}" y="${
        text_item.y.toFixed(2)
      }" text-anchor="middle" dominant-baseline="central" fill="${
        xml_escape(text_item.color)
      }" font-size="${xml_escape(text_item.font_size)}" font-family="${
        xml_escape(text_item.font_family)
      }" font-weight="${xml_escape(text_item.font_weight)}">${
        xml_escape(text_item.text)
      }</text>`
    )
    const metadata = xml_escape(JSON.stringify(get_view_settings()))
    const svg = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas_rect.width}" height="${canvas_rect.height}" viewBox="0 0 ${canvas_rect.width} ${canvas_rect.height}">`,
      `<metadata>${metadata}</metadata>`,
      `<image href="${png_data_url}" x="0" y="0" width="${canvas_rect.width}" height="${canvas_rect.height}" />`,
      ...text_nodes,
      `</svg>`,
    ].join(``)
    download_blob(
      new Blob([svg], { type: `image/svg+xml` }),
      `${export_basename}.svg`,
    )
  }

  function export_view_json_file(): void {
    const json_text = JSON.stringify(get_view_settings(), null, 2)
    download_blob(
      new Blob([json_text], { type: `application/json` }),
      `${export_basename}-view.json`,
    )
  }

  function export_glb_file(): void {
    const gltf_exporter = new GLTFExporter()
    const export_root = new THREE.Group()
    if (colored_hull_geometry) {
      export_root.add(
        new THREE.Mesh(
          colored_hull_geometry.clone(),
          new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: color_mode === `none` ? 0.25 : 0.4,
            side: THREE.DoubleSide,
          }),
        ),
      )
    }
    export_root.add(
      new THREE.LineSegments(
        edge_geometry.clone(),
        new THREE.LineBasicMaterial({ color: 0x333333 }),
      ),
    )
    for (const { geometry, color } of formula_mesh_data) {
      export_root.add(
        new THREE.Mesh(
          geometry.clone(),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.13,
            side: THREE.DoubleSide,
          }),
        ),
      )
    }
    if (draw_formula_lines) {
      for (const { geometry, color } of formula_edge_data) {
        export_root.add(
          new THREE.LineSegments(
            geometry.clone(),
            new THREE.LineBasicMaterial({ color: new THREE.Color(color) }),
          ),
        )
      }
    }
    gltf_exporter.parse(
      export_root,
      (result) => {
        if (!(result instanceof ArrayBuffer)) return
        download_blob(
          new Blob([result], { type: `model/gltf-binary` }),
          `${export_basename}.glb`,
        )
      },
      (err) => {
        console.error(`Failed to export GLB:`, err)
      },
      { binary: true, onlyVisible: false },
    )
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
        view: get_view_settings(),
      },
      null,
      2,
    )
  }

  function export_json_file(): void {
    download_blob(
      new Blob([get_json_string()], { type: `application/json` }),
      `${export_basename}.json`,
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
    if (fixed_container_frame_id !== null) {
      cancelAnimationFrame(fixed_container_frame_id)
      fixed_container_frame_id = null
    }
  })

  function find_fixed_container_element(): HTMLElement | null {
    if (!wrapper) return null
    let ancestor_element: HTMLElement | null = wrapper.parentElement
    while (ancestor_element && ancestor_element !== document.documentElement) {
      const computed_style = getComputedStyle(ancestor_element)
      const contain_value = computed_style.contain
      const container_type_value = computed_style.getPropertyValue(`container-type`)
        .trim()
      const creates_fixed_containing_block = computed_style.transform !== `none` ||
        computed_style.perspective !== `none` ||
        computed_style.filter !== `none` ||
        computed_style.backdropFilter !== `none` ||
        contain_value.includes(`layout`) ||
        contain_value.includes(`paint`) ||
        contain_value.includes(`strict`) ||
        contain_value.includes(`content`) ||
        (container_type_value && container_type_value !== `normal`)
      if (creates_fixed_containing_block) return ancestor_element
      ancestor_element = ancestor_element.parentElement
    }
    return null
  }

  function refresh_fixed_container_rect(): void {
    fixed_container_rect = fixed_container_element?.getBoundingClientRect() ?? null
  }

  function queue_fixed_container_rect_refresh(): void {
    if (fixed_container_frame_id !== null) return
    fixed_container_frame_id = requestAnimationFrame(() => {
      fixed_container_frame_id = null
      refresh_fixed_container_rect()
    })
  }

  $effect(() => {
    fixed_container_element = find_fixed_container_element()
    refresh_fixed_container_rect()
  })

  onMount(() => {
    const handle_layout_change = (): void => queue_fixed_container_rect_refresh()
    window.addEventListener(`resize`, handle_layout_change)
    window.addEventListener(`scroll`, handle_layout_change, true)
    return () => {
      window.removeEventListener(`resize`, handle_layout_change)
      window.removeEventListener(`scroll`, handle_layout_change, true)
    }
  })

  let locked_hover_formula = $state<string | null>(null)

  function set_hover_info(domain_data: HoverMeshData, raw_event: unknown): void {
    hover_info = with_hover_pointer<ChemPotHoverInfo>(
      domain_data.info,
      raw_event,
      fixed_container_rect,
    )
  }

  function clear_hover_lock(): void {
    locked_hover_formula = null
    hover_info = null
  }

  function handle_phase_hover(domain_data: HoverMeshData, raw_event: unknown): void {
    if (locked_hover_formula && locked_hover_formula !== domain_data.formula) return
    set_hover_info(domain_data, raw_event)
  }

  function toggle_phase_lock(domain_data: HoverMeshData, raw_event: unknown): void {
    if (locked_hover_formula === domain_data.formula) {
      clear_hover_lock()
      return
    }
    locked_hover_formula = domain_data.formula
    set_hover_info(domain_data, raw_event)
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
    if (event.key === `Escape`) clear_hover_lock()
    else if (event.key === `c`) cycle_color_mode()
    else if (event.key === `f`) toggle_fullscreen(wrapper)
  }}
  onpointerdown={(event) => {
    const target = event.target
    if (
      locked_hover_formula &&
      (target === wrapper || target instanceof HTMLCanvasElement)
    ) {
      clear_hover_lock()
    }
  }}
>
  <section>
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
      <div class="export-row">
        <label>
          SVG
          <button type="button" onclick={export_svg_file} title="SVG snapshot export">
            ⬇
          </button>
        </label>
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
      </div>
      <h4>Export Data</h4>
      <div class="export-row">
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
        <label>
          View
          <button
            type="button"
            onclick={export_view_json_file}
            aria-label="Download view JSON"
          >
            ⬇
          </button>
        </label>
        <label>
          GLB
          <button type="button" onclick={export_glb_file} aria-label="Download GLB">
            ⬇
          </button>
        </label>
      </div>
    </DraggablePane>
    <DraggablePane
      bind:show={formula_picker_open}
      open_icon="Cross"
      closed_icon="Filter"
      pane_props={{ class: `chempot-formula-pane` }}
      toggle_props={{
        class: `chempot-formula-toggle`,
        title: `Formula overlays`,
      }}
    >
      <h4>Formula Overlays</h4>
      <div class="overlay-actions">
        <button type="button" onclick={() => formulas_to_draw_override = []}>
          Clear
        </button>
        <button type="button" onclick={select_surface_formulas}>Surface</button>
        <button type="button" onclick={select_neighbor_formulas}>Neighbors</button>
      </div>
      <label class="overlay-search">
        Search:
        <input
          type="text"
          placeholder="Formula filter"
          bind:value={formula_filter_query}
        />
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
                checked={formulas_to_draw.includes(formula)}
                onchange={() => toggle_formula_selection(formula)}
              />
              <span
                class="formula-color-dot"
                style:background={formula_colors[
                  (formula_overlay_idx >= 0 ? formula_overlay_idx : formula_idx) %
                  formula_colors.length
                ]}
              ></span>
              {get_hill_formula(formula, true, ``)}
            </label>
          {/each}
        {/if}
      </div>
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
          color_scale,
          reverse_color_scale,
        }}
        on_reset={reset_controls}
      >
        {#if has_multinary_system && plot_elements.length === 3}
          <div class="projection-controls">
            <div class="pane-row">
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
          </div>
        {/if}
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
            <option value="formation_energy">Formation energy</option>
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
            <label>
              <input
                type="checkbox"
                checked={reverse_color_scale}
                onchange={() => {
                  reverse_color_scale_override = !reverse_color_scale
                }}
              /> Rev
            </label>
          </div>
        {/if}
      </SettingsSection>
    </ScatterPlot3DControls>

    <button
      type="button"
      onclick={() => toggle_fullscreen(wrapper)}
      title="{fullscreen ? `Exit` : `Enter`} fullscreen"
    >
      <Icon icon="{fullscreen ? `Exit` : ``}Fullscreen" />
    </button>
  </section>
  {#if show_temperature_slider && temperature !== undefined}
    <TemperatureSlider
      class="chempot-temp-slider"
      {available_temperatures}
      bind:temperature
    />
  {/if}
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
            position={camera_position}
            zoom={orthographic_zoom}
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
              target={camera_target}
            />
          </T.OrthographicCamera>
        {:else}
          <T.PerspectiveCamera
            position={camera_position}
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
              target={camera_target}
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
                opacity={color_mode === `none` ? 0.25 : 0.4}
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
            onpointerdown={(event: unknown) => toggle_phase_lock(domain_hover, event)}
            onpointerleave={() => {
              if (
                !locked_hover_formula &&
                hover_info?.formula === domain_hover.formula
              ) {
                hover_info = null
              }
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

        {#each projection_planes as plane (`${plane.key}-${projection_opacity}`)}
          <T.Mesh position={plane.pos} rotation={plane.rot}>
            <T.PlaneGeometry args={plane.size} />
            <T.MeshBasicMaterial
              color={plane.color}
              opacity={projection_opacity}
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
          {#each render_domains.filter((d) => surface_formulas.has(d.formula)) as
            domain
            (domain.formula)
          }
            <extras.HTML
              position={swiz(domain.label_loc[0], domain.label_loc[1], domain.label_loc[2])}
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
    <!-- Color bar for continuous modes -->
    {#if color_mode !== `none` && color_mode !== `arity` && color_range}
      {@const color_bar_config = get_chempot_color_bar_config(
      color_scale,
      reverse_color_scale,
    )}
      <ColorBar
        title={color_range.label}
        range={[color_range.min, color_range.max]}
        color_scale_fn={color_bar_config.color_scale_fn}
        color_scale_domain={color_bar_config.color_scale_domain}
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
            <span style:background={arity_colors[idx]}></span>
            {label}
          </span>
        {/each}
      </div>
    {/if}
  {/if}
  {#if render_local_tooltip && show_tooltip && hover_info?.view === `3d`}
    <aside
      class="phase-tooltip"
      style:left="{hover_info.pointer?.x ?? 4}px"
      style:top="{hover_info.pointer?.y ?? 4}px"
    >
      <h4>{@html get_hill_formula(hover_info.formula, false, ``)}</h4>
      {#if locked_hover_formula === hover_info.formula}
        <p>Pinned · Press Esc to unlock</p>
      {/if}
      <p>
        Vertices: {hover_info.n_vertices} · Edges: {hover_info.n_edges} · Points:
        {hover_info.n_points}
      </p>
      <p>
        Entries: {hover_info.matching_entry_count}
        {#if hover_info.min_energy_per_atom !== null &&
          hover_info.max_energy_per_atom !== null}
          · E/atom: {format_num(hover_info.min_energy_per_atom, `.4~g`)}
          to {format_num(hover_info.max_energy_per_atom, `.4~g`)} eV
        {/if}
      </p>
      {#if tooltip_detail_level === `detailed`}
        <h5>Axis ranges</h5>
        {#each hover_info.axis_ranges as axis_range (axis_range.element)}
          <p>
            {axis_range.element}: {format_num(axis_range.min_val, `.4~g`)} to
            {format_num(axis_range.max_val, `.4~g`)} eV
          </p>
        {/each}
        <p>
          Centroid: ({
            hover_info.ann_loc.map((value) => format_num(value, `.3~g`)).join(
              `, `,
            )
          })
        </p>
        {#if hover_info.touches_limits.length > 0}
          <h5>Touches bounds</h5>
          <p>{hover_info.touches_limits.join(`, `)}</p>
        {/if}
      {/if}
    </aside>
  {/if}
</div>

<style>
  .chempot-diagram-3d {
    position: relative;
    overflow: clip;
  }
  .chempot-diagram-3d:fullscreen {
    background: var(--chempot-3d-bg-fullscreen, var(--bg-color, #fff));
  }
  /* Threlte <extras.HTML portal={wrapper}> appends absolutely-positioned divs
     directly to the wrapper. Without pointer-events: none, they intercept mouse
     events and prevent the Three.js raycaster from detecting hover meshes. */
  .chempot-diagram-3d > :global(div[style*='position: absolute'][style*='top: 0']) {
    pointer-events: none !important;
  }
  .chempot-diagram-3d > section {
    position: absolute;
    top: 1ex;
    right: 1ex;
    display: flex;
    gap: 8px;
    z-index: 20;
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
  .chempot-diagram-3d :global(.export-row) {
    display: flex;
    flex-wrap: wrap;
    gap: 4pt 10pt;
    margin: 0 0 4pt;
  }
  .chempot-diagram-3d :global(.export-row > label) {
    margin: 0;
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
  .chempot-diagram-3d :global(.projection-controls) {
    margin: 0 0 6pt;
  }
  .chempot-diagram-3d :global(.projection-controls .pane-row) {
    display: grid;
    grid-template-columns:
      auto minmax(4.5em, 1fr) auto minmax(4.5em, 1fr) auto minmax(4.5em, 1fr);
    align-items: center;
    gap: 3pt;
  }
  .chempot-diagram-3d :global(.projection-presets) {
    margin-top: 4pt;
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
    gap: 4pt;
    margin: 0 0 4pt;
  }
  .chempot-diagram-3d :global(.overlay-actions button) {
    border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
    border-radius: 3px;
    padding: 2px 6px;
    background: transparent;
    cursor: pointer;
    color: var(--text-color, currentColor);
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
    max-height: min(42vh, 18rem);
    overflow: auto;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    border-radius: 4px;
    padding: 4pt;
  }
  .chempot-diagram-3d :global(.formula-list label) {
    display: flex;
    align-items: center;
    gap: 5pt;
    margin: 2pt 0;
  }
  .chempot-diagram-3d :global(.formula-color-dot) {
    width: 0.65em;
    height: 0.65em;
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
    position: fixed;
    max-width: min(32rem, 92vw);
    background: var(
      --tooltip-bg,
      light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.9))
    );
    color: var(--tooltip-text, var(--text-color, #222));
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
  .phase-tooltip p {
    margin: 1px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .phase-tooltip h5 {
    margin-top: 6px;
    margin-bottom: 0;
    font-size: 12px;
    font-weight: 600;
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
