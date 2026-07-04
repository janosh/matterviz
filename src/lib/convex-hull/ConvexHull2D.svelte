<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import type { CompositionType } from '$lib/composition'
  import { normalize_show_controls } from '$lib/controls'
  import { sanitize_html } from '$lib/sanitize'
  import type { ElementSymbol } from '$lib/element'
  import { ClickFeedback, DragOverlay } from '$lib/feedback'
  import Icon from '$lib/Icon.svelte'
  import type { D3SymbolName } from '$lib/labels'
  import { symbol_map } from '$lib/labels'
  import { FullscreenButton, set_fullscreen_bg, setup_fullscreen_effect } from '$lib/layout'
  import type { Point2D, Vec2 } from '$lib/math'
  import type {
    AxisConfig,
    PointStyle,
    ScatterHandlerEvent,
    ScatterHandlerProps,
    UserContentProps,
  } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import { DEFAULTS } from '$lib/settings'
  import type { AnyStructure } from '$lib/structure'
  import { SvelteMap } from 'svelte/reactivity'
  import ConvexHullControls from './ConvexHullControls.svelte'
  import ConvexHullInfoPane from './ConvexHullInfoPane.svelte'
  import ConvexHullTooltip from './ConvexHullTooltip.svelte'
  import GasPressureControls from './GasPressureControls.svelte'
  import * as helpers from './helpers'
  import { create_hull_data_pipeline } from './hull-state.svelte'
  import type { BaseConvexHullProps } from './index'
  import { CONVEX_HULL_STYLE, default_controls, default_hull_config } from './index'
  import StructurePopup from './StructurePopup.svelte'
  import TemperatureSlider from './TemperatureSlider.svelte'
  import * as thermo from './thermodynamics'
  import type { ConvexHullEntry, HighlightStyle, HoverData3D, PhaseData } from './types'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'

  // Binary convex hull rendered as energy vs composition (x in [0, 1])
  let {
    entries = [],
    controls = {},
    config = {},
    show_controls,
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(DEFAULTS.convex_hull.binary.fullscreen),
    fullscreen_toggle = true,
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(DEFAULTS.convex_hull.binary.show_stable),
    show_unstable = $bindable(DEFAULTS.convex_hull.binary.show_unstable),
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = $bindable([]),
    color_mode = $bindable(DEFAULTS.convex_hull.binary.color_mode),
    color_scale = $bindable(DEFAULTS.convex_hull.binary.color_scale as D3InterpolateName),
    info_pane_open = $bindable(DEFAULTS.convex_hull.binary.info_pane_open),
    controls_open = $bindable(DEFAULTS.convex_hull.binary.legend_pane_open),
    max_hull_dist_show_phases = $bindable(
      DEFAULTS.convex_hull.binary.max_hull_dist_show_phases,
    ),
    max_hull_dist_show_labels = $bindable(
      DEFAULTS.convex_hull.binary.max_hull_dist_show_labels,
    ),
    show_stable_labels = $bindable(DEFAULTS.convex_hull.binary.show_stable_labels),
    show_unstable_labels = $bindable(DEFAULTS.convex_hull.binary.show_unstable_labels),
    on_file_drop,
    enable_click_selection = true,
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
    temperature = $bindable(),
    interpolate_temperature = true,
    max_interpolation_gap = 500,
    gas_config,
    gas_pressures = $bindable({}),
    children,
    tooltip: custom_tooltip,
    ...rest
  }: BaseConvexHullProps<ConvexHullEntry> & {
    highlight_style?: HighlightStyle
    x_axis?: AxisConfig
    y_axis?: AxisConfig
  } = $props()

  const merged_controls = $derived({ ...default_controls, ...controls })
  const controls_config = $derived(normalize_show_controls(show_controls))
  const merged_config = $derived({
    ...default_hull_config,
    point_size: 6, // Binary diagrams use slightly smaller points
    ...config,
    colors: { ...default_hull_config.colors, ...config.colors },
    margin: { t: 40, r: 40, b: 60, l: 60, ...config.margin },
  })

  // Narrow deriveds to primitive fields so heavy downstream deriveds (scatter series,
  // hull segments) don't recompute whenever the broad merged_config object is recreated.
  const stable_color = $derived(merged_config.colors?.stable)
  const unstable_color = $derived(merged_config.colors?.unstable)
  const show_hull_line = $derived(merged_config.show_hull)

  // Merge highlight style with defaults (consistent with 3D/4D)
  const merged_highlight_style = $derived(helpers.merge_highlight_style(highlight_style))

  // Helper to check if entry is highlighted
  const is_highlighted = (entry: ConvexHullEntry): boolean =>
    helpers.is_entry_highlighted(entry, highlighted_entries)

  // Shared reactive data pipeline (temperature → gas → energy mode → hull data → threshold)
  // Explicit generic breaks the circular type inference through the all_enriched_entries thunk
  const hull_data = create_hull_data_pipeline<ConvexHullEntry>({
    dim: 2,
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
  const elements = $derived(hull_data.elements)
  const auto_default_threshold = $derived(hull_data.auto_default_threshold)
  const plot_entries = $derived(hull_data.plot_entries)
  const visible_entries = $derived(hull_data.visible_entries)

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
      const total = Object.values(entry.composition).reduce((sum, amount) => sum + amount, 0)
      if (total <= 0) continue
      const frac_b = (entry.composition[el2] || 0) / total
      const is_element = helpers.is_unary_entry(entry)
      coords.push({ ...entry, x: frac_b, y: e_form, z: 0, is_element })
    }
    // Ensure elemental references at x=0 and x=1 with y=0 to close the hull
    for (const [element, x_coord] of [
      [el1, 0],
      [el2, 1],
    ] as const) {
      if (coords.some((entry) => entry.is_element && entry.x === x_coord)) continue
      coords.push({
        composition: { [element]: 1 } as CompositionType,
        energy: 0,
        entry_id: `synthetic-element:${element}`,
        x: x_coord,
        y: 0,
        z: 0,
        is_element: true,
      })
    }
    return coords
  }

  const coords_entries = $derived.by(() => {
    if (elements.length !== 2) return []
    try {
      return compute_binary_coordinates(hull_data.pd_data.entries, elements)
    } catch (error) {
      console.error(`Error computing binary coordinates:`, error)
      return []
    }
  })

  // Compute hull and enrich entries with e_above_hull (before filtering)
  // Explicit return type breaks circular type inference with the hull_data pipeline
  const { all_enriched_entries, hull_points } = $derived.by(
    (): { all_enriched_entries: ConvexHullEntry[]; hull_points: Point2D[] } => {
      if (coords_entries.length === 0) {
        return { all_enriched_entries: [], hull_points: [] }
      }

      // Build lower hull input: one minimum-energy point per composition x.
      // Excluded entries don't participate in hull construction.
      const min_y_by_x = new SvelteMap<number, number>()
      for (const entry of coords_entries) {
        if (entry.exclude_from_hull) continue
        const current_min_y = min_y_by_x.get(entry.x)
        if (current_min_y === undefined || entry.y < current_min_y) {
          min_y_by_x.set(entry.x, entry.y)
        }
      }

      const hull_input = [...min_y_by_x].map(([x_coord, min_y]) => ({
        x: x_coord,
        y: min_y,
      }))
      const computed_hull_points = thermo.compute_lower_hull_2d(hull_input)

      const enriched_entries = coords_entries.map((entry) => {
        const y_hull = thermo.interpolate_hull_2d(computed_hull_points, entry.x)
        // degenerate hull (<2 points): y_hull null -> unknown distance (not 0/stable)
        const raw_dist = y_hull == null ? undefined : entry.y - y_hull
        return {
          ...entry,
          ...helpers.compute_hull_stability(raw_dist, entry.exclude_from_hull),
        }
      })
      return { all_enriched_entries: enriched_entries, hull_points: computed_hull_points }
    },
  )

  let reset_counter = $state(0)
  // Drag and drop state (to match 3D/4D components)
  let drag_over = $state(false)
  // Copy feedback state
  let copy_feedback = $state({ visible: false, position: { x: 0, y: 0 } })

  // Structure popup state
  let structure_popup = $state.raw<{
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
  const x_domain = $derived<Vec2>([0, 1])
  const y_domain = $derived.by((): Vec2 => {
    const ys = plot_entries.map((entry) => entry.y)
    if (ys.length === 0) return [-1, 0]
    const min_y_data = helpers.array_min(ys)
    const max_y_data = helpers.array_max(ys)
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

  const scatter_points_series = $derived.by(() => {
    const is_energy_mode = color_mode === `energy`
    const count = visible_entries.length

    // Single pass: extract x, y, color_values, and point_style simultaneously
    const x_vals: number[] = Array(count)
    const y_vals: number[] = Array(count)
    const color_values: number[] = is_energy_mode ? Array(count) : []
    const point_style: PointStyle[] = Array(count)

    for (let idx = 0; idx < count; idx++) {
      const entry = visible_entries[idx]
      x_vals[idx] = entry.x
      y_vals[idx] = entry.y
      if (is_energy_mode) color_values[idx] = entry.e_above_hull ?? 0

      const is_stable = helpers.entry_is_stable(entry)
      const base_radius = entry.size || (is_stable ? 6 : 4)
      const hl = is_highlighted(entry) ? merged_highlight_style : null

      point_style[idx] = {
        fill:
          hl?.effect === `color` || hl?.effect === `both`
            ? hl?.color
            : is_energy_mode
              ? undefined
              : is_stable
                ? stable_color
                : unstable_color,
        stroke: is_stable ? `#ffffff` : `#000000`,
        radius:
          hl?.effect === `size` || hl?.effect === `both`
            ? base_radius * (hl?.size_multiplier ?? 1)
            : base_radius,
        symbol_type: marker_to_d3_symbol(entry.marker),
        is_highlighted: Boolean(hl),
        highlight_effect: hl?.effect,
        highlight_color: hl?.color,
      }
    }

    return {
      x: x_vals,
      y: y_vals,
      // ConvexHullEntry is an interface (no implicit index signature), so cast for
      // ScatterPlot's Metadata extends Record<string, unknown> constraint
      metadata: visible_entries as (ConvexHullEntry & Record<string, unknown>)[],
      markers: `points` as const,
      point_style,
      ...(is_energy_mode ? { color_values } : {}),
    }
  })

  const hull_segments_series = $derived.by(() => {
    if (!show_hull_line || hull_points.length < 2) return []
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

  // Map selected_entry to ScatterPlot point index (series_idx: 0 = points series).
  // current_entry() keeps selections pointing at the current plot entry object.
  const selected_scatter_point = $derived.by(() => {
    const entry = selected_entry
    if (!entry) return null
    // match by entry_id (same_entry), not reference: selected_entry may be a proxied/
    // different instance than visible_entries elements when bound to a parent $state
    const idx = visible_entries.findIndex((vis_entry) => helpers.same_entry(vis_entry, entry))
    return idx === -1 ? null : { series_idx: 0, point_idx: idx }
  })

  // Convex hull statistics - compute internally and expose via bindable prop
  $effect(() => {
    phase_stats = thermo.get_convex_hull_stats(plot_entries, elements, 3)
  })

  const extract_structure_from_entry = (entry: ConvexHullEntry): AnyStructure | null =>
    helpers.extract_structure_from_entry(entries, entry)

  function reset_all() {
    fullscreen = DEFAULTS.convex_hull.binary.fullscreen
    info_pane_open = DEFAULTS.convex_hull.binary.info_pane_open
    controls_open = DEFAULTS.convex_hull.binary.legend_pane_open
    color_mode = DEFAULTS.convex_hull.binary.color_mode
    color_scale = DEFAULTS.convex_hull.binary.color_scale as D3InterpolateName
    show_stable = DEFAULTS.convex_hull.binary.show_stable
    show_unstable = DEFAULTS.convex_hull.binary.show_unstable
    hidden_categories = []
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
      controls_open !== DEFAULTS.convex_hull.binary.legend_pane_open ||
      color_mode !== DEFAULTS.convex_hull.binary.color_mode ||
      color_scale !== DEFAULTS.convex_hull.binary.color_scale ||
      show_stable !== DEFAULTS.convex_hull.binary.show_stable ||
      show_unstable !== DEFAULTS.convex_hull.binary.show_unstable ||
      hidden_categories.length > 0 ||
      show_stable_labels !== DEFAULTS.convex_hull.binary.show_stable_labels ||
      show_unstable_labels !== DEFAULTS.convex_hull.binary.show_unstable_labels ||
      // Compare with auto-computed threshold, with small tolerance for floating point
      Math.abs(max_hull_dist_show_phases - auto_default_threshold) > 0.001 ||
      max_hull_dist_show_labels !== DEFAULTS.convex_hull.binary.max_hull_dist_show_labels,
  )

  // Custom hover tooltip state used with ScatterPlot events
  let hover_data = $state.raw<HoverData3D<ConvexHullEntry> | null>(null)
  $effect(() => {
    const current_selection = helpers.current_entry(selected_entry, plot_entries)
    if (selected_entry && !current_selection) selected_entry = null
    else if (current_selection && !helpers.same_entry(current_selection, selected_entry)) {
      selected_entry = current_selection
    }
    const current_hover = helpers.current_entry(hover_data?.entry, plot_entries)
    if (hover_data?.entry && !current_hover) {
      hover_data = null
      on_point_hover?.(null)
    } else if (hover_data && current_hover && current_hover !== hover_data.entry) {
      hover_data = { ...hover_data, entry: current_hover }
    }
    const current_popup = helpers.current_entry(structure_popup.entry, plot_entries)
    if (structure_popup.open) {
      const structure = current_popup && extract_structure_from_entry(current_popup)
      if (!structure)
        structure_popup = { open: false, structure: null, entry: null, place_right: true }
      else if (
        current_popup !== structure_popup.entry ||
        structure !== structure_popup.structure
      )
        structure_popup = { ...structure_popup, entry: current_popup, structure }
    }
  })

  const handle_keydown = (event: KeyboardEvent) => {
    const target = event.target
    if (target instanceof HTMLElement && target.tagName.match(/INPUT|TEXTAREA/)) return
    const actions: Record<string, () => void> = {
      b: () => (color_mode = color_mode === `stability` ? `energy` : `stability`),
      s: () => (show_stable = !show_stable),
      u: () => (show_unstable = !show_unstable),
      l: () => (show_stable_labels = !show_stable_labels),
    }
    actions[event.key.toLowerCase()]?.()
  }

  async function handle_file_drop(event: DragEvent): Promise<void> {
    drag_over = false
    const data = await helpers.parse_hull_entries_from_drop(event)
    if (data) on_file_drop?.(data)
  }

  async function copy_entry_data(entry: ConvexHullEntry, position: { x: number; y: number }) {
    await helpers.copy_entry_to_clipboard(
      entry,
      position,
      (visible, pos) => {
        copy_feedback.visible = visible
        copy_feedback.position = pos
      },
      entry_category,
    )
  }

  function close_structure_popup() {
    structure_popup = { open: false, structure: null, entry: null, place_right: true }
    selected_entry = null
  }

  // Track last clicked entry for double-click detection
  let last_clicked_entry: ConvexHullEntry | null = null
  let last_click_time = 0

  function handle_point_click_internal(data: ScatterHandlerEvent<ConvexHullEntry>) {
    const { metadata: entry, event } = data
    if (!entry) return

    const now = Date.now()
    const is_double_click = last_clicked_entry === entry && now - last_click_time < 300

    if (is_double_click) {
      // Double-click: copy to clipboard
      copy_entry_data(entry, { x: event.clientX, y: event.clientY })
      last_clicked_entry = null
      last_click_time = 0
    } else {
      // Single click: select entry and optionally show structure preview
      last_clicked_entry = entry
      last_click_time = now

      on_point_click?.(entry)
      if (enable_click_selection) {
        selected_entry = entry
        if (enable_structure_preview) {
          const structure = extract_structure_from_entry(entry)
          if (structure) {
            const viewport_width = globalThis.innerWidth
            const click_x = event.clientX
            const space_on_right = viewport_width - click_x
            const space_on_left = click_x
            const place_right = space_on_right >= space_on_left

            structure_popup = { open: true, structure, entry, place_right }
            event.stopPropagation()
          }
        }
      }
    }
  }

  // Fullscreen handling
  $effect(() => {
    setup_fullscreen_effect(fullscreen, wrapper)
    set_fullscreen_bg(wrapper, fullscreen, `--hull-2d-bg-fullscreen`)
  })

  let style = $derived(helpers.hull_style_css(merged_config.colors))
</script>

<svelte:document
  onfullscreenchange={() => {
    // tie fullscreen state to this component's own wrapper, not any fullscreen element
    fullscreen = document.fullscreenElement === wrapper
  }}
/>

<!-- Hover tooltip matching 3D/4D style (content only; container handled by ScatterPlot) -->
{#snippet tooltip(point: ScatterHandlerProps<ConvexHullEntry>)}
  {@const entry = point.metadata}
  {@const entry_highlight =
    entry && is_highlighted(entry) ? merged_highlight_style : undefined}
  {#if entry}
    <ConvexHullTooltip
      {entry}
      polymorph_stats_map={hull_data.polymorph_stats_map}
      highlight_style={entry_highlight}
      {entry_category}
      tooltip={custom_tooltip}
    />
  {/if}
{/snippet}

{#snippet pd_header_controls()}
  {#if controls_config.mode !== `never` && !structure_popup.open}
    {#if has_changes_to_reset && controls_config.visible(`reset`)}
      <button
        type="button"
        onclick={reset_all}
        title="Reset view and settings"
        class="control-btn reset-camera-btn"
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
        {show_stable}
        {show_unstable}
        {entry_category}
        {hidden_categories}
        {max_hull_dist_show_phases}
        {max_hull_dist_show_labels}
        {label_threshold}
        toggle_props={{ class: `control-btn info-btn` }}
      />
    {/if}

    {#if fullscreen_toggle && controls_config.visible(`fullscreen`)}
      <FullscreenButton {fullscreen} toggle={fullscreen_toggle} {wrapper} />
    {/if}

    {#if controls_config.visible(`controls`)}
      <ConvexHullControls
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
        max_hull_dist_in_data={hull_data.max_hull_dist_in_data}
        {stable_entries}
        {unstable_entries}
        {merged_controls}
        toggle_props={{ class: `control-btn legend-controls-btn` }}
        bind:energy_source_mode
        has_precomputed_e_form={hull_data.has_precomputed_e_form}
        can_compute_e_form={hull_data.can_compute_e_form}
        has_precomputed_hull={hull_data.has_precomputed_hull}
        can_compute_hull={hull_data.can_compute_hull}
      />
    {/if}
  {/if}
{/snippet}

{#snippet user_content({
  x_scale_fn,
  pad,
  height,
  y_scale_fn,
  y_range,
  width,
}: UserContentProps)}
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
    class={[`convex-hull-2d`, rest.class, drag_over && `dragover`]}
    style={`${style}; ${rest.style ?? ``}`}
    data-has-selection={selected_entry !== null}
    bind:wrapper
    bind:fullscreen
    role="application"
    tabindex={-1}
    onkeydown={handle_keydown}
    ondrop={handle_file_drop}
    ondragover={(event: DragEvent) => {
      event.preventDefault()
      drag_over = true
    }}
    ondragleave={(event: DragEvent) => {
      event.preventDefault()
      drag_over = false
    }}
    aria-label="Binary convex hull visualization"
    series={scatter_series}
    bind:display
    controls={{ show: false }}
    fullscreen_toggle={false}
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
    on_point_hover={(data: ScatterHandlerEvent<ConvexHullEntry> | null) => {
      if (!data) {
        hover_data = null
        on_point_hover?.(null)
        return
      }
      const { metadata: entry, event } = data
      hover_data = entry ? { entry, position: { x: event.clientX, y: event.clientY } } : null
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
      {@html sanitize_html(merged_controls.title || phase_stats?.chemical_system || ``)}
    </h3>

    <ClickFeedback bind:visible={copy_feedback.visible} position={copy_feedback.position} />
    <DragOverlay visible={drag_over} message="Drop JSON file to load phase diagram data" />

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
    background: var(--hull-2d-bg-fullscreen, var(--hull-2d-bg, var(--hull-bg))) !important;
    overflow: hidden;
  }
  :global(.convex-hull-2d.dragover) {
    border: 2px dashed var(--accent-color, #1976d2) !important;
  }
  /* Styles for control buttons rendered via header_controls snippet
     (.fullscreen-btn is FullscreenButton's built-in class) */
  :global(.convex-hull-2d :is(.control-btn, .fullscreen-btn)) {
    background: transparent;
    border: none;
    padding: 4px;
    cursor: pointer;
    border-radius: 3px;
    color: var(--text-color, currentColor);
    transition:
      background-color 0.2s,
      opacity 0.2s;
    display: flex;
    font-size: var(--ctrl-btn-icon-size, clamp(0.7rem, 2cqmin, 0.85rem));
  }
  :global(.convex-hull-2d :is(.control-btn, .fullscreen-btn):hover) {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
</style>
