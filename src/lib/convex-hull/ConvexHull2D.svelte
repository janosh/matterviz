<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { normalize_show_controls } from '$lib/controls'
  import { array_extent, type Vec2 } from '$lib/math'
  import type {
    AxisConfig,
    PointStyle,
    ScatterHandlerEvent,
    ScatterHandlerProps,
    UserContentProps,
  } from '$lib/plot'
  import { ScatterPlot } from '$lib/plot'
  import { DEFAULTS } from '$lib/settings'
  import { marker_d3_name, point_radius } from './canvas-draw'
  import { create_hull_selection } from './canvas-interactions.svelte'
  import ConvexHullChrome from './ConvexHullChrome.svelte'
  import ConvexHullTooltip from './ConvexHullTooltip.svelte'
  import {
    entry_is_stable,
    get_point_color_for_entry,
    hull_style_css,
    is_entry_highlighted,
    merge_highlight_style,
    same_entry,
  } from './helpers'
  import { create_hull_data_pipeline } from './hull-state.svelte'
  import type { BaseConvexHullProps } from './index'
  import { CONVEX_HULL_STYLE, default_controls, merge_hull_config } from './index'
  import MissingConvexHullData from './MissingConvexHullData.svelte'
  import type { ConvexHullEntry } from './types'
  import { MAGNETIC_ORDERING_CATEGORY } from './types'

  // Binary convex hull rendered as energy vs composition (x in [0, 1])
  const defaults = DEFAULTS.convex_hull.binary
  let {
    entries: entries_prop,
    components,
    controls = {},
    config = {},
    show_controls,
    on_point_click,
    on_point_hover,
    fullscreen = $bindable(defaults.fullscreen),
    fullscreen_toggle = true,
    enable_info_pane = true,
    wrapper = $bindable(),
    label_threshold = 50,
    show_stable = $bindable(defaults.show_stable),
    show_unstable = $bindable(defaults.show_unstable),
    entry_category = MAGNETIC_ORDERING_CATEGORY,
    hidden_categories = $bindable([]),
    color_mode = $bindable(defaults.color_mode),
    color_scale = $bindable(defaults.color_scale as D3InterpolateName),
    info_pane_open = $bindable(defaults.info_pane_open),
    controls_open = $bindable(defaults.legend_pane_open),
    max_hull_dist_show_phases = $bindable(defaults.max_hull_dist_show_phases),
    max_hull_dist_show_labels = $bindable(defaults.max_hull_dist_show_labels),
    show_stable_labels = $bindable(defaults.show_stable_labels),
    show_unstable_labels = $bindable(defaults.show_unstable_labels),
    allow_file_drop = true,
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
    title,
    ...rest
  }: BaseConvexHullProps<ConvexHullEntry> & {
    x_axis?: AxisConfig
    y_axis?: AxisConfig
  } = $props()
  const entries = $derived(entries_prop ?? [])

  const merged_controls = $derived({ ...default_controls, ...controls })
  const controls_config = $derived(normalize_show_controls(show_controls))
  const merged_config = $derived(merge_hull_config(config))
  // Narrow deriveds to primitive fields so heavy downstream deriveds (scatter series,
  // hull segments) don't recompute whenever the broad merged_config object is recreated.
  const stable_color = $derived(merged_config.colors?.stable)
  const unstable_color = $derived(merged_config.colors?.unstable)
  const show_hull_line = $derived(merged_config.show_hull)

  const merged_highlight_style = $derived(merge_highlight_style(highlight_style))
  const is_highlighted = (entry: ConvexHullEntry): boolean =>
    is_entry_highlighted(entry, highlighted_entries)

  // Shared reactive data pipeline (temperature → gas → energies → coordinates → hull)
  const hull_data = create_hull_data_pipeline({
    dim: 2,
    entries: () => entries,
    components: () => components,
    temperature: () => temperature,
    interpolate_temperature: () => interpolate_temperature,
    max_interpolation_gap: () => max_interpolation_gap,
    gas_config: () => gas_config,
    gas_pressures: () => gas_pressures,
    energy_source_mode: () => energy_source_mode,
    max_hull_dist_show_phases: () => max_hull_dist_show_phases,
    show_stable: () => show_stable,
    show_unstable: () => show_unstable,
    entry_category: () => entry_category,
    hidden_categories: () => hidden_categories,
    label_threshold: () => label_threshold,
    set_temperature: (next_temp) => (temperature = next_temp),
    set_max_hull_dist_show_phases: (value) => (max_hull_dist_show_phases = value),
    set_stable_entries: (value) => (stable_entries = value),
    set_unstable_entries: (value) => (unstable_entries = value),
    set_phase_stats: (value) => (phase_stats = value),
    hide_labels: () => {
      show_stable_labels = false
      show_unstable_labels = false
    },
  })
  const elements = $derived(hull_data.elements)
  const plot_entries = $derived(hull_data.plot_entries)
  const visible_entries = $derived(hull_data.visible_entries)

  // Lower hull polyline: the vertices of the lower facets (edges), left to right. Without
  // facets every hull point is at E_form = 0 and the hull is the segment between the elements.
  const hull_points = $derived.by(() => {
    const { entries: hull_entries, facet_entries } = hull_data.hull
    const vertices =
      facet_entries.length === 0
        ? hull_entries.filter((entry) => entry.is_element)
        : [...new Set(facet_entries.flat())]
    return vertices.toSorted((left, right) => left.x - right.x)
  })

  let chrome = $state<ReturnType<typeof ConvexHullChrome>>()
  let title_height = $state(0)
  const selection = create_hull_selection({
    entries: () => entries,
    plot_entries: () => plot_entries,
    selected_entry: () => selected_entry,
    set_selected_entry: (entry) => (selected_entry = entry),
    enable_click_selection: () => enable_click_selection,
    enable_structure_preview: () => enable_structure_preview,
    allow_file_drop: () => allow_file_drop,
    on_point_click: () => on_point_click,
    on_point_hover: () => on_point_hover,
    on_file_drop: () => on_file_drop,
    entry_category: () => entry_category,
    wrapper: () => wrapper,
    actions: () => ({
      b: () => (color_mode = color_mode === `stability` ? `energy` : `stability`),
      s: () => (show_stable = !show_stable),
      u: () => (show_unstable = !show_unstable),
      l: () => (show_stable_labels = !show_stable_labels),
      r: () => chrome?.reset_all(),
    }),
  })

  const y_domain = $derived.by((): Vec2 => {
    if (plot_entries.length === 0) return [-1, 0]
    const [min_y, max_y] = array_extent(plot_entries.map((entry) => entry.y))
    const pad = 0.05 * Math.max(1e-9, max_y - min_y)
    return [min_y - pad, max_y + pad]
  })

  const scatter_points_series = $derived.by(() => {
    const is_energy_mode = color_mode === `energy`
    const point_style = visible_entries.map((entry): PointStyle => {
      const is_stable = entry_is_stable(entry)
      const base_radius = point_radius(entry)
      const hl = is_highlighted(entry) ? merged_highlight_style : null
      const colored = hl?.effect === `color` || hl?.effect === `both`
      const sized = hl?.effect === `size` || hl?.effect === `both`
      return {
        fill: colored
          ? hl?.color
          : is_energy_mode
            ? undefined
            : is_stable
              ? stable_color
              : unstable_color,
        stroke: is_stable ? `#ffffff` : `#000000`,
        radius: sized ? base_radius * (hl?.size_multiplier ?? 1) : base_radius,
        symbol_type: entry.marker && marker_d3_name(entry.marker),
        is_highlighted: Boolean(hl),
        // size/colour effects are already applied above via radius/fill
        highlight_effect:
          hl?.effect === `pulse` || hl?.effect === `glow` ? hl.effect : undefined,
        highlight_color: hl?.color,
      }
    })
    return {
      x: visible_entries.map((entry) => entry.x),
      y: visible_entries.map((entry) => entry.y),
      // ConvexHullEntry is an interface (no implicit index signature), so cast for
      // ScatterPlot's Metadata extends Record<string, unknown> constraint
      metadata: visible_entries as (ConvexHullEntry & Record<string, unknown>)[],
      markers: `points` as const,
      point_style,
      ...(is_energy_mode
        ? { color_values: visible_entries.map((entry) => entry.e_above_hull ?? 0) }
        : {}),
    }
  })

  const hull_line_series = $derived.by(() => {
    if (!show_hull_line || hull_points.length < 2) return []
    const { color, line_width, dash } = CONVEX_HULL_STYLE.structure_line
    return [
      {
        x: hull_points.map((point) => point.x),
        y: hull_points.map((point) => point.y),
        markers: `line` as const,
        // Hull facets are straight segments between stable entries: never spline them
        line_style: {
          stroke: color,
          stroke_width: line_width,
          line_dash: dash.join(`,`),
          curve: `linear` as const,
        },
      },
    ]
  })

  const scatter_series = $derived([scatter_points_series, ...hull_line_series])

  // Map selected_entry to ScatterPlot point index (series_idx: 0 = points series), matching
  // by same_entry since selected_entry may be a proxied copy of the visible entry
  const selected_scatter_point = $derived.by(() => {
    if (!selected_entry) return null
    const idx = visible_entries.findIndex((entry) => same_entry(entry, selected_entry))
    return idx === -1 ? null : { series_idx: 0, point_idx: idx }
  })

  // ScatterPlot only reports clicks, so a second click on the same entry within 300 ms is
  // the double-click that copies the entry
  let last_clicked: { entry: ConvexHullEntry; time: number } | null = null
  function handle_point_click({
    metadata: entry,
    event,
  }: ScatterHandlerEvent<ConvexHullEntry>) {
    if (!entry) return
    const now = Date.now()
    if (
      last_clicked &&
      same_entry(last_clicked.entry, entry) &&
      now - last_clicked.time < 300
    ) {
      last_clicked = null
      void selection.copy_entry_data(entry, { x: event.clientX, y: event.clientY })
      return
    }
    last_clicked = { entry, time: now }
    selection.select_entry(entry)
    if (selection.modal_open) event.stopPropagation()
  }

  const style = $derived(`${hull_style_css(merged_config.colors)}; ${rest.style ?? ``}`)
</script>

<!-- Hover tooltip matching 3D/4D style (content only; container handled by ScatterPlot) -->
{#snippet tooltip(point: ScatterHandlerProps<ConvexHullEntry>)}
  {@const entry = point.metadata}
  {#if entry}
    <ConvexHullTooltip
      {entry}
      polymorph_stats_map={hull_data.polymorph_stats_map}
      highlight_style={is_highlighted(entry) ? merged_highlight_style : undefined}
      {entry_category}
      tooltip={custom_tooltip}
    />
  {/if}
{/snippet}

<!-- Dashed guides at x = 0, x = 1 and the bottom of the y range -->
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

{#if entries_prop === undefined || hull_data.error}
  <MissingConvexHullData
    {...rest}
    error={hull_data.error}
    style="{style}; height: var(--hull-height, 500px)"
  />
{:else}
  <ScatterPlot
    {...rest}
    class={[`convex-hull-2d`, rest.class]}
    {style}
    title={title ?? undefined}
    data-has-selection={selected_entry !== null}
    bind:wrapper
    bind:fullscreen
    role="application"
    tabindex={-1}
    onkeydown={selection.handle_keydown}
    {...selection.drop_zone}
    aria-label="Binary convex hull visualization"
    series={scatter_series}
    bind:display
    show_controls={false}
    fullscreen_toggle={false}
    x_axis={{
      label: elements.length === 2 ? `x in ${elements[0]}₁₋ₓ ${elements[1]}ₓ` : `x`,
      range: [0, 1],
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
    selected_point={selected_scatter_point}
    on_point_click={handle_point_click}
    on_point_hover={(data: ScatterHandlerEvent<ConvexHullEntry> | null) =>
      selection.set_hover(
        data?.metadata
          ? {
              entry: data.metadata,
              position: { x: data.event.clientX, y: data.event.clientY },
            }
          : null,
      )}
    padding={{ t: 30 + title_height, b: 60, l: 60, r: 30 }}
  >
    {@render children?.({
      stable_entries,
      unstable_entries,
      highlighted_entries,
      selected_entry,
    })}
    <ConvexHullChrome
      bind:this={chrome}
      bind:title_height
      kind="binary"
      {selection}
      {hull_data}
      {controls_config}
      show_tooltip={false}
      {enable_info_pane}
      {phase_stats}
      {label_threshold}
      bind:fullscreen
      {fullscreen_toggle}
      {wrapper}
      {merged_controls}
      {stable_entries}
      {unstable_entries}
      get_point_color={(entry) =>
        get_point_color_for_entry(entry, color_mode, merged_config.colors, null)}
      {merged_highlight_style}
      {is_highlighted}
      tooltip={custom_tooltip}
      {selected_entry}
      bind:temperature
      bind:gas_pressures
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
  </ScatterPlot>
{/if}

<style>
  :global(.convex-hull-2d:fullscreen) {
    background: var(--hull-bg-fullscreen, var(--hull-bg, var(--plot-bg))) !important;
    overflow: hidden;
  }
</style>
