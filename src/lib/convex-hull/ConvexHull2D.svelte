<script lang="ts">
  import type {
    AnyStructure,
    CompositionType,
    D3SymbolName,
    ElementSymbol,
    UserContentProps,
  } from '$lib'
  import { DEFAULTS, Icon, is_unary_entry } from '$lib'
  import type { D3InterpolateName } from '$lib/colors'
  import { ClickFeedback, DragOverlay } from '$lib/feedback'
  import { symbol_map } from '$lib/labels'
  import { set_fullscreen_bg, setup_fullscreen_effect } from '$lib/layout'
  import type {
    AxisConfig,
    ScatterHandlerEvent,
    ScatterHandlerProps,
  } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import ConvexHullControls from './ConvexHullControls.svelte'
  import ConvexHullInfoPane from './ConvexHullInfoPane.svelte'
  import * as helpers from './helpers'
  import type { BaseConvexHullProps } from './index'
  import { CONVEX_HULL_STYLE, default_controls, default_hull_config } from './index'
  import PhaseEntryTooltip from './PhaseEntryTooltip.svelte'
  import StructurePopup from './StructurePopup.svelte'
  import * as thermo from './thermodynamics'
  import type {
    ConvexHullEntry,
    HighlightStyle,
    HoverData3D,
    PhaseData,
  } from './types'

  // Binary convex hull rendered as energy vs composition (x in [0, 1])
  let {
    entries,
    controls = {},
    config = {},
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(false),
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(true),
    show_unstable = $bindable(true),
    color_mode = $bindable(`energy`),
    color_scale = $bindable(`interpolateViridis`),
    info_pane_open = $bindable(false),
    legend_pane_open = $bindable(false),
    max_hull_dist_show_phases = $bindable(0.1),
    max_hull_dist_show_labels = $bindable(0.1),
    show_stable_labels = $bindable(true),
    show_unstable_labels = $bindable(false),
    on_file_drop,
    enable_structure_preview = true,
    energy_source_mode = $bindable(`precomputed`),
    phase_stats = $bindable(null),
    display = $bindable({ x_grid: false, y_grid: false }),
    stable_entries = $bindable([]),
    unstable_entries = $bindable([]),
    highlighted_entries = $bindable([]),
    highlight_style = {},
    x_axis = {},
    y_axis = {},
    selected_entry = $bindable(null),
    children,
    ...rest
  }: BaseConvexHullProps<ConvexHullEntry> & {
    highlight_style?: HighlightStyle
    x_axis?: AxisConfig
    y_axis?: AxisConfig
  } = $props()

  const merged_controls = $derived({ ...default_controls, ...controls })
  const merged_config = $derived({
    ...default_hull_config,
    point_size: 6, // Binary diagrams use slightly smaller points
    ...config,
    colors: { ...default_hull_config.colors, ...(config.colors || {}) },
    margin: { t: 40, r: 40, b: 60, l: 60, ...(config.margin || {}) },
  })

  // Merge highlight style with defaults (consistent with 3D/4D)
  const merged_highlight_style = $derived(
    helpers.merge_highlight_style(highlight_style),
  )

  // Helper to check if entry is highlighted
  const is_highlighted = (entry: ConvexHullEntry): boolean =>
    helpers.is_entry_highlighted(entry, highlighted_entries)

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

  // Process data and element set
  const pd_data = $derived(thermo.process_hull_entries(effective_entries))

  const polymorph_stats_map = $derived(
    helpers.compute_all_polymorph_stats(effective_entries),
  ) // Pre-compute polymorph stats once for O(1) tooltip lookups

  const elements = $derived.by(() => {
    if (pd_data.elements.length > 2) {
      console.error(
        `ConvexHull2D: Dataset contains ${pd_data.elements.length} elements, but binary diagrams require exactly 2. Found: [${
          pd_data.elements.join(`, `)
        }]`,
      )
      return []
    }
    return pd_data.elements
  })

  // Coordinate computation ----------------------------------------------------
  function compute_binary_coordinates(
    raw_entries: PhaseData[],
    elems: ElementSymbol[],
  ): ConvexHullEntry[] {
    if (elems.length !== 2) return []
    const [el1, el2] = elems
    const coords: ConvexHullEntry[] = []
    for (const entry of raw_entries) {
      // Require formation energy per atom to place along y
      const e_form = entry.e_form_per_atom
      if (typeof e_form !== `number`) continue
      const total = Object.values(entry.composition).reduce((s, v) => s + v, 0)
      if (total <= 0) continue
      const frac_b = (entry.composition[el2] || 0) / total
      const is_element = is_unary_entry(entry)
      coords.push({ ...entry, x: frac_b, y: e_form, z: 0, is_element, visible: true })
    }
    // Ensure elemental references at x=0 and x=1 with y=0 to close the hull
    const el_a: ConvexHullEntry | undefined = coords.find((e) =>
      e.is_element && e.x === 0
    )
    const el_b: ConvexHullEntry | undefined = coords.find((e) =>
      e.is_element && e.x === 1
    )
    if (!el_a) {
      coords.push({
        composition: { [el1]: 1 } as CompositionType,
        energy: 0,
        x: 0,
        y: 0,
        z: 0,
        is_element: true,
        visible: true,
      })
    }
    if (!el_b) {
      coords.push({
        composition: { [el2]: 1 } as CompositionType,
        energy: 0,
        x: 1,
        y: 0,
        z: 0,
        is_element: true,
        visible: true,
      })
    }
    return coords
  }

  // Lower hull and above-hull distances --------------------------------------
  type HullVertex = { x: number; y: number }

  function compute_lower_hull(points: HullVertex[]): HullVertex[] {
    // Andrew's monotone chain for lower hull
    const sorted = [...points].sort((p1, p2) => (p1.x - p2.x) || (p1.y - p2.y))
    const lower: HullVertex[] = []
    const cross = (o: HullVertex, a: HullVertex, b: HullVertex) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    for (const p of sorted) {
      while (
        lower.length >= 2 &&
        cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
      ) lower.pop()
      lower.push(p)
    }
    return lower
  }

  function interpolate_on_hull(hull: HullVertex[], x: number): number | null {
    if (hull.length < 2) return null
    if (x <= hull[0].x) return hull[0].y
    if (x >= hull[hull.length - 1].x) return hull[hull.length - 1].y
    for (let i = 0; i < hull.length - 1; i++) {
      const p1 = hull[i]
      const p2 = hull[i + 1]
      if (x >= p1.x && x <= p2.x) {
        const t = (x - p1.x) / Math.max(1e-12, p2.x - p1.x)
        return p1.y * (1 - t) + p2.y * t
      }
    }
    return null
  }

  const coords_entries = $derived.by(() => {
    if (elements.length !== 2) return []
    try {
      return compute_binary_coordinates(pd_data.entries, elements)
    } catch (error) {
      console.error(`Error computing binary coordinates:`, error)
      return []
    }
  })

  // Compute hull and enrich entries with e_above_hull (before filtering)
  const { all_enriched_entries, hull_points } = $derived.by(() => {
    if (coords_entries.length === 0) {
      return { all_enriched_entries: [], hull_points: [] }
    }

    // Build lower hull: group by x, use lowest energy per x
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local var in derived
    const by_x = new Map<number, ConvexHullEntry[]>()
    for (const entry of coords_entries) {
      const group = by_x.get(entry.x)
      if (group) group.push(entry)
      else by_x.set(entry.x, [entry])
    }

    const hull_input: HullVertex[] = [...by_x].map(([x_coord, entries]) => ({
      x: x_coord,
      y: Math.min(...entries.map((e) => e.y)),
    }))
    const hull_points = compute_lower_hull(hull_input)

    const all_enriched_entries = coords_entries.map((entry) => {
      const y_hull = interpolate_on_hull(hull_points, entry.x)
      const e_above_hull = y_hull == null ? 0 : Math.max(0, entry.y - y_hull)
      return {
        ...entry,
        e_above_hull,
        is_stable: e_above_hull <= 1e-9,
        visible: true,
      }
    })
    return { all_enriched_entries, hull_points }
  })

  // Auto threshold: show all for few entries, use default for many, interpolate between
  const max_hull_dist_in_data = $derived(
    helpers.calc_max_hull_dist_in_data(all_enriched_entries),
  )
  const auto_default_threshold = $derived(helpers.compute_auto_hull_dist_threshold(
    all_enriched_entries.length,
    max_hull_dist_in_data,
    DEFAULTS.convex_hull.binary.max_hull_dist_show_phases,
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
    all_enriched_entries
      .filter((e) =>
        e.is_stable || (e.e_above_hull ?? 0) <= max_hull_dist_show_phases
      )
      .map((e) => ({
        ...e,
        visible: (e.is_stable && show_stable) || (!e.is_stable && show_unstable),
      })),
  )

  // Update bindable entries arrays when plot_entries change (single pass)
  $effect(() => {
    const stable: ConvexHullEntry[] = []
    const unstable: ConvexHullEntry[] = []
    for (const entry of plot_entries) {
      if (entry.is_stable) stable.push(entry)
      else unstable.push(entry)
    }
    stable_entries = stable
    unstable_entries = unstable
  })

  let reset_counter = $state(0)

  // Drag and drop state (to match 3D/4D components)
  let drag_over = $state(false)

  // Copy feedback state
  let copy_feedback = $state({ visible: false, position: { x: 0, y: 0 } })

  // Structure popup state
  let structure_popup = $state<{
    open: boolean
    structure: AnyStructure | null
    entry: ConvexHullEntry | null
    place_right: boolean
  }>({
    open: false,
    structure: null,
    entry: null,
    place_right: true,
  })

  // Axis mapping helpers ------------------------------------------------------
  const x_domain = $derived<[number, number]>([0, 1])
  const y_domain = $derived.by((): [number, number] => {
    const ys = plot_entries.map((entry) => entry.y)
    if (ys.length === 0) return [-1, 0]
    const min_y_data = Math.min(...ys)
    const max_y_data = Math.max(...ys)
    const span = Math.max(1e-9, max_y_data - min_y_data)
    const pad = 0.05 * span
    return [min_y_data - pad, max_y_data + pad]
  })

  // Build ScatterPlot series --------------------------------------------------

  // Map MarkerSymbol to D3SymbolName (type-safe via symbol_map lookup)
  const marker_to_d3_symbol = (marker?: string): D3SymbolName | undefined => {
    if (!marker) return undefined
    const name = marker.charAt(0).toUpperCase() + marker.slice(1)
    return name in symbol_map ? (name as D3SymbolName) : undefined
  }

  // Pre-compute visible entries to avoid redundant filtering
  const visible_entries = $derived(plot_entries.filter((e) => e.visible))

  const scatter_points_series = $derived.by(() => {
    const is_energy_mode = color_mode === `energy`
    const count = visible_entries.length

    // Single pass: extract x, y, color_values, and point_style simultaneously
    const x_vals: number[] = new Array(count)
    const y_vals: number[] = new Array(count)
    const color_values: number[] = is_energy_mode ? new Array(count) : []
    const point_style = new Array(count)

    for (let idx = 0; idx < count; idx++) {
      const entry = visible_entries[idx]
      x_vals[idx] = entry.x
      y_vals[idx] = entry.y
      if (is_energy_mode) color_values[idx] = entry.e_above_hull ?? 0

      const is_stable = entry.is_stable || entry.e_above_hull === 0
      const base_radius = entry.size || (is_stable ? 6 : 4)
      const hl = is_highlighted(entry) ? merged_highlight_style : null

      point_style[idx] = {
        fill: hl && (hl.effect === `color` || hl.effect === `both`)
          ? hl.color
          : is_energy_mode
          ? undefined
          : merged_config.colors?.[is_stable ? `stable` : `unstable`],
        stroke: is_stable ? `#ffffff` : `#000000`,
        radius: hl && (hl.effect === `size` || hl.effect === `both`)
          ? base_radius * hl.size_multiplier
          : base_radius,
        symbol_type: marker_to_d3_symbol(entry.marker),
        is_highlighted: !!hl,
        highlight_effect: hl?.effect,
        highlight_color: hl?.color,
      }
    }

    return {
      x: x_vals,
      y: y_vals,
      metadata: visible_entries,
      markers: `points` as const,
      point_style,
      ...(is_energy_mode ? { color_values } : {}),
    }
  })

  const hull_segments_series = $derived.by(() => {
    if (!merged_config.show_hull || hull_points.length < 2) return []
    const segments = []
    for (let idx = 0; idx < hull_points.length - 1; idx++) {
      const p1 = hull_points[idx]
      const p2 = hull_points[idx + 1]
      segments.push({
        x: [p1.x, p2.x] as const,
        y: [p1.y, p2.y] as const,
        markers: `line` as const,
        line_style: {
          stroke: CONVEX_HULL_STYLE.structure_line.color,
          stroke_width: CONVEX_HULL_STYLE.structure_line.line_width,
          line_dash: `${CONVEX_HULL_STYLE.structure_line.dash[0]},${
            CONVEX_HULL_STYLE.structure_line.dash[1]
          }`,
        },
      })
    }
    return segments
  })

  const scatter_series = $derived([scatter_points_series, ...hull_segments_series])

  // Map selected_entry to ScatterPlot point index (series_idx: 0 = points series)
  // Use object identity comparison (e === entry) instead of entry_id comparison
  // because synthetic elemental entries lack entry_id, and undefined === undefined
  // would incorrectly match the first entry with undefined entry_id
  const selected_scatter_point = $derived.by(() => {
    const entry = selected_entry
    if (!entry) return null
    const idx = visible_entries.findIndex((vis_entry) => vis_entry === entry)
    return idx >= 0 ? { series_idx: 0, point_idx: idx } : null
  })

  // Convex hull statistics - compute internally and expose via bindable prop
  $effect(() => {
    phase_stats = thermo.get_convex_hull_stats(plot_entries, elements, 3)
  })

  function extract_structure_from_entry(
    entry: ConvexHullEntry,
  ): AnyStructure | null {
    if (!entry.entry_id) return null
    const orig_entry = entries.find((ent) => ent.entry_id === entry.entry_id)
    return orig_entry?.structure as AnyStructure || null
  }

  function reset_all() {
    fullscreen = DEFAULTS.convex_hull.binary.fullscreen
    info_pane_open = DEFAULTS.convex_hull.binary.info_pane_open
    legend_pane_open = DEFAULTS.convex_hull.binary.legend_pane_open
    color_mode = DEFAULTS.convex_hull.binary.color_mode
    color_scale = DEFAULTS.convex_hull.binary.color_scale as D3InterpolateName
    show_stable = DEFAULTS.convex_hull.binary.show_stable
    show_unstable = DEFAULTS.convex_hull.binary.show_unstable
    show_stable_labels = DEFAULTS.convex_hull.binary.show_stable_labels
    show_unstable_labels = DEFAULTS.convex_hull.binary.show_unstable_labels
    // Use auto-computed threshold based on entry count instead of static default
    max_hull_dist_show_phases = auto_default_threshold
    max_hull_dist_show_labels = DEFAULTS.convex_hull.binary.max_hull_dist_show_labels
    reset_counter += 1
  }

  // Track whether any settings differ from defaults (to show/hide reset button)
  // Must match all properties that reset_all() resets
  // Use auto_default_threshold for comparison since that's the effective default
  const has_changes_to_reset = $derived(
    fullscreen !== DEFAULTS.convex_hull.binary.fullscreen ||
      info_pane_open !== DEFAULTS.convex_hull.binary.info_pane_open ||
      legend_pane_open !== DEFAULTS.convex_hull.binary.legend_pane_open ||
      color_mode !== DEFAULTS.convex_hull.binary.color_mode ||
      color_scale !== DEFAULTS.convex_hull.binary.color_scale ||
      show_stable !== DEFAULTS.convex_hull.binary.show_stable ||
      show_unstable !== DEFAULTS.convex_hull.binary.show_unstable ||
      show_stable_labels !== DEFAULTS.convex_hull.binary.show_stable_labels ||
      show_unstable_labels !== DEFAULTS.convex_hull.binary.show_unstable_labels ||
      // Compare with auto-computed threshold, with small tolerance for floating point
      Math.abs(max_hull_dist_show_phases - auto_default_threshold) > 0.001 ||
      max_hull_dist_show_labels !==
        DEFAULTS.convex_hull.binary.max_hull_dist_show_labels,
  )

  // Custom hover tooltip state used with ScatterPlot events
  let hover_data = $state<HoverData3D<ConvexHullEntry> | null>(null)

  const handle_keydown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName.match(/INPUT|TEXTAREA/)) return
    const actions: Record<string, () => void> = {
      b: () => color_mode = color_mode === `stability` ? `energy` : `stability`,
      s: () => show_stable = !show_stable,
      u: () => show_unstable = !show_unstable,
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

  function close_structure_popup() {
    structure_popup = { open: false, structure: null, entry: null, place_right: true }
    selected_entry = null
  }

  // Track last clicked entry for double-click detection
  let last_clicked_entry: ConvexHullEntry | null = null
  let last_click_time = 0

  function handle_point_click_internal(data: ScatterHandlerEvent) {
    const entry = data.metadata as unknown as ConvexHullEntry
    if (!entry) return

    const now = Date.now()
    const is_double_click = last_clicked_entry === entry &&
      now - last_click_time < 300

    if (is_double_click) {
      // Double-click: copy to clipboard
      copy_entry_data(entry, {
        x: data.event.clientX,
        y: data.event.clientY,
      })
      last_clicked_entry = null
      last_click_time = 0
    } else {
      // Single click: show structure preview
      last_clicked_entry = entry
      last_click_time = now

      on_point_click?.(entry)
      selected_entry = entry
      if (enable_structure_preview) {
        const structure = extract_structure_from_entry(entry)
        if (structure) {
          const viewport_width = globalThis.innerWidth
          const click_x = data.event.clientX
          const space_on_right = viewport_width - click_x
          const space_on_left = click_x
          const place_right = space_on_right >= space_on_left

          structure_popup = { open: true, structure, entry, place_right }
          data.event.stopPropagation()
        }
      }
    }
  }

  // Fullscreen handling
  $effect(() => {
    setup_fullscreen_effect(fullscreen, wrapper)
    set_fullscreen_bg(wrapper, fullscreen, `--hull-2d-bg-fullscreen`)
  })

  let style = $derived(
    `--hull-stable-color:${merged_config.colors?.stable || `#0072B2`};
    --hull-unstable-color:${merged_config.colors?.unstable || `#E69F00`};
    --hull-edge-color:${merged_config.colors?.edge || `var(--text-color, #212121)`};
     --hull-text-color:${
      merged_config.colors?.annotation || `var(--text-color, #212121)`
    };`,
  )
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
  }}
/>

<!-- Hover tooltip matching 3D/4D style (content only; container handled by ScatterPlot) -->
{#snippet tooltip(point: ScatterHandlerProps)}
  {@const entry = point.metadata as unknown as ConvexHullEntry}
  {@const entry_highlight = entry && is_highlighted(entry)
    ? merged_highlight_style
    : undefined}
  {#if entry}
    <PhaseEntryTooltip {entry} {polymorph_stats_map} highlight_style={entry_highlight} />
  {/if}
{/snippet}

{#snippet pd_header_controls()}
  {#if merged_controls.show && !structure_popup.open}
    {#if has_changes_to_reset}
      <button
        type="button"
        onclick={reset_all}
        title="Reset view and settings"
        class="control-btn reset-camera-btn"
      >
        <Icon icon="Reset" />
      </button>
    {/if}

    {#if enable_info_pane && phase_stats}
      <ConvexHullInfoPane
        bind:pane_open={info_pane_open}
        {phase_stats}
        {stable_entries}
        {unstable_entries}
        {max_hull_dist_show_phases}
        {max_hull_dist_show_labels}
        {label_threshold}
        toggle_props={{ class: `control-btn info-btn` }}
      />
    {/if}

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
      {merged_controls}
      toggle_props={{ class: `control-btn legend-controls-btn` }}
      bind:energy_source_mode
      {has_precomputed_e_form}
      {can_compute_e_form}
      {has_precomputed_hull}
      {can_compute_hull}
    />
  {/if}
{/snippet}

{#snippet user_content(
  { x_scale_fn, pad, height, y_scale_fn, y_range, width }: UserContentProps,
)}
  {@const [x0, x1, y0] = [x_scale_fn(0), x_scale_fn(1), y_scale_fn(y_range[0])]}
  {@const stroke = {
    stroke: `var(--scatter-grid-stroke, gray)`,
    'stroke-width': `var(--scatter-grid-width, 0.4)`,
    'stroke-dasharray': `var(--scatter-grid-dash, 4)`,
  }}
  <line y1={pad.t} y2={height - pad.b} x1={x0} x2={x0} {...stroke} />
  <line y1={pad.t} y2={height - pad.b} {x1} x2={x1} {...stroke} />
  <line x1={pad.l} x2={width - pad.r} y1={y0} y2={y0} {...stroke} />
{/snippet}
{#key reset_counter}
  <ScatterPlot
    {...rest}
    class="convex-hull-2d {rest.class ?? ``} {drag_over ? `dragover` : ``}"
    style={`${style}; ${rest.style ?? ``}`}
    bind:wrapper
    bind:fullscreen
    role="application"
    tabindex={-1}
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
    aria-label="Binary convex hull visualization"
    series={scatter_series}
    bind:display
    controls={{ show: false }}
    x_axis={{
      label: elements.length === 2 ? `x in ${elements[0]}₁₋ₓ ${elements[1]}ₓ` : `x`,
      range: x_domain,
      ticks: 4,
      ...x_axis,
    }}
    y_axis={{
      label: `E<sub>form</sub> (eV/atom)`,
      range: y_domain,
      ticks: 4,
      label_shift: { y: 15 },
      ...y_axis,
    }}
    legend={null}
    color_bar={{
      title: `E<sub>above hull</sub> (eV/atom)`,
      bar_style: `width: 220px; height: 16px;`,
    }}
    {tooltip}
    {user_content}
    header_controls={pd_header_controls}
    selected_point={selected_scatter_point}
    on_point_click={handle_point_click_internal}
    on_point_hover={(data: ScatterHandlerEvent | null) => {
      if (!data) {
        hover_data = null
        on_point_hover?.(null)
        return
      }
      const entry = data.metadata as unknown as ConvexHullEntry
      hover_data = entry
        ? {
          entry,
          position: { x: data.event.clientX, y: data.event.clientY },
        }
        : null
      on_point_hover?.(hover_data)
    }}
    padding={{ t: 30, b: 60, l: 60, r: 30 }}
  >
    {@render children?.({
      stable_entries,
      unstable_entries,
      highlighted_entries,
      selected_entry,
    })}
    <h3 style="position: absolute; left: 1em; top: 1ex; margin: 0">
      {phase_stats?.chemical_system}
    </h3>

    <ClickFeedback
      bind:visible={copy_feedback.visible}
      position={copy_feedback.position}
    />
    <DragOverlay visible={drag_over} />

    {#if structure_popup.open && structure_popup.structure}
      <StructurePopup
        structure={structure_popup.structure}
        place_right={structure_popup.place_right}
        stats={{
          id: structure_popup.entry?.entry_id,
          e_above_hull: structure_popup.entry?.e_above_hull,
          e_form: structure_popup.entry?.e_form_per_atom,
        }}
        onclose={close_structure_popup}
      />
    {/if}
  </ScatterPlot>
{/key}

<style>
  :global(.convex-hull-2d:fullscreen) {
    background: var(--hull-2d-bg-fullscreen, var(--hull-2d-bg, var(--hull-bg)))
      !important;
    overflow: hidden;
  }
  :global(.convex-hull-2d.dragover) {
    border: 2px dashed var(--accent-color, #1976d2) !important;
  }
  /* Styles for control buttons rendered via header_controls snippet */
  :global(.convex-hull-2d .control-btn) {
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    border-radius: 3px;
    color: var(--text-color, currentColor);
    transition: background-color 0.2s, opacity 0.2s;
    display: flex;
    font-size: clamp(0.85em, 2cqmin, 2.5em);
  }
  :global(.convex-hull-2d .control-btn:hover) {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
</style>
