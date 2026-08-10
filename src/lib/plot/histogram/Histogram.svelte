<script lang="ts">
  import { format_value_or_num } from '$lib/labels'
  import type {
    AxisLoadError,
    BarStyle,
    DataLoaderFn,
    HistogramHandlerProps,
    PanConfig,
    RefLine,
    RefLineEvent,
  } from '$lib/plot'
  import { HistogramControls } from '$lib/plot'
  import CartesianFrame from '$lib/plot/core/components/CartesianFrame.svelte'
  import PlotAxes from '$lib/plot/core/components/PlotAxes.svelte'
  import PlotLegendLayer from '$lib/plot/core/components/PlotLegendLayer.svelte'
  import ReferenceLinesLayer from '$lib/plot/core/components/ReferenceLinesLayer.svelte'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import { normalize_marginals } from '$lib/plot/core/marginals'
  import { AXIS_DEFAULTS, create_axis_loader } from '$lib/plot/core/axis-utils'
  import type { AxisChangeState } from '$lib/plot/core/axis-utils'
  import { create_cartesian_frame } from '$lib/plot/core/cartesian-frame.svelte'
  import {
    build_legend_items,
    extract_series_color,
    series_symbol_swatch,
  } from '$lib/plot/core/data-transform'
  import type { FacetLayoutContext } from '$lib/plot/core/facets'
  import {
    create_legend_visibility,
    legend_mode_to_prop,
    resolve_legend_visibility,
  } from '$lib/plot/core/utils/series-visibility'
  import { AXIS_TITLE_OFFSET } from '$lib/plot/core/layout'
  import { build_obstacles_norm, clip_bar } from '$lib/plot/core/decorations'
  import type { IndexedRefLine } from '$lib/plot/core/reference-line'
  import { group_ref_lines_by_z, index_ref_lines } from '$lib/plot/core/reference-line'
  import {
    accumulate_extent,
    empty_extent,
    nice_range_from_extent,
  } from '$lib/plot/core/scales'
  import type {
    AxisConfig,
    BasePlotProps,
    DataSeries,
    LegendConfig,
    PlotConfig,
  } from '$lib/plot/core/types'
  import {
    compute_count_range,
    compute_histogram_bins,
    log_safe_range,
  } from '$lib/plot/histogram/histogram'
  import ZeroLines from '$lib/plot/core/components/ZeroLines.svelte'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Point2D, Vec2 } from '$lib/math'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import { bar_path } from '$lib/plot/core/svg'

  let {
    series = $bindable([]),
    x_axis: x_axis_init = {},
    x2_axis: x2_axis_init = {},
    y_axis: y_axis_init = {},
    y2_axis: y2_axis_init = {},
    display: display_init = DEFAULTS.histogram.display,
    range_padding = 0,
    padding = {},
    title,
    bins = $bindable(DEFAULTS.histogram.bin_count),
    // explicit type arg keeps `undefined` (auto) in the prop type - a bare fallback
    // would collapse it to plain boolean
    show_legend = $bindable<boolean | undefined>(
      legend_mode_to_prop(DEFAULTS.histogram.show_legend),
    ),
    legend = {},
    bar: bar_init = {},
    selected_property = $bindable(``),
    // Defaults come from settings so the component and its controls pane agree; the pane
    // read DEFAULTS.histogram.mode ('overlay') while the component hard-coded 'single'
    mode = $bindable(DEFAULTS.histogram.mode),
    tooltip,
    hovered = $bindable(false),
    change = () => {},
    on_bar_click,
    on_bar_hover,
    ref_lines = $bindable([]),
    on_ref_line_click,
    on_ref_line_hover,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    on_series_toggle = () => {},
    controls_toggle_props,
    controls_pane_props,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    children,
    header_controls,
    controls_extra,
    data_loader,
    on_axis_change,
    on_error,
    pan = {},
    marginals = false,
    facet_layout,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `title`> &
    BasePlotProps &
    PlotConfig & {
      series: DataSeries[]
      // Component-specific props
      bins?: number
      show_legend?: boolean
      legend?: LegendConfig | null
      bar?: BarStyle
      selected_property?: string
      mode?: `single` | `overlay`
      tooltip?: Snippet<[HistogramHandlerProps]>
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet<[Required<PlotConfig>]>
      change?: (data: { value: number; count: number; property: string } | null) => void
      on_bar_click?: (data: {
        value: number
        count: number
        property: string
        event: MouseEvent | KeyboardEvent
      }) => void
      on_bar_hover?: (
        data: { value: number; count: number; property: string; event: MouseEvent } | null,
      ) => void
      ref_lines?: RefLine[]
      on_ref_line_click?: (event: RefLineEvent) => void
      on_ref_line_hover?: (event: RefLineEvent | null) => void
      on_series_toggle?: (series_idx: number) => void
      // Interactive axis props
      data_loader?: DataLoaderFn
      on_axis_change?: (
        axis: `x` | `x2` | `y` | `y2`,
        key: string,
        new_series: DataSeries[],
      ) => void
      on_error?: (error: AxisLoadError) => void
      pan?: PanConfig
      marginals?: MarginalsProp
      facet_layout?: FacetLayoutContext
    } = $props()

  // Local state for controls (initialized from props, owned by this component)
  // Include key AXIS_DEFAULTS props (range, ticks, scale_type) that PlotControls needs
  // Using $state because these have bindings in HistogramControls/PlotControls
  // untrack() explicitly captures initial prop values (intentional - props provide initial config)
  const { format: _, ...axis_state_defaults } = AXIS_DEFAULTS // Exclude format (has component-specific default)
  const init_axis = (get_initial: () => AxisConfig, label_shift?: Point2D): AxisConfig =>
    untrack(() => ({
      ...axis_state_defaults,
      ...(label_shift ? { label_shift } : {}),
      ...get_initial(),
    }))
  let bar = $state(untrack(() => ({ ...DEFAULTS.histogram.bar, ...bar_init })))
  let x_axis = $state(init_axis(() => x_axis_init))
  // x2-axis needs different default label_shift for top-side positioning
  let x2_axis = $state(init_axis(() => x2_axis_init, { x: 0, y: AXIS_TITLE_OFFSET }))
  let y_axis = $state(init_axis(() => y_axis_init))
  // y2 title stays vertically centered; its x position is computed by y2_axis_label_x
  let y2_axis = $state(init_axis(() => y2_axis_init, { x: 0, y: 0 }))
  let display = $state(untrack(() => ({ ...DEFAULTS.histogram.display, ...display_init })))

  // Merge component-specific defaults with local state (format comes from here, not AXIS_DEFAULTS)
  // No default tick format: PlotAxis falls back to format_num, which uses SI
  // prefixes above 1 but plain decimals below (0.2 must not render as 200m)
  const final_x_axis = $derived({ label: `Value`, ...x_axis })
  const final_x2_axis = $derived({ label: `Value`, ...x2_axis })
  const final_y_axis = $derived({ label: `Count`, format: `d`, ...y_axis })
  const final_y2_axis = $derived({ label: `Count`, format: `d`, ...y2_axis })

  let hover_info = $state<HistogramHandlerProps | null>(null)

  // Reference line hover state
  let hovered_ref_line_idx = $state<number | null>(null)

  // Interactive axis loading state
  let axis_loading = $state<`x` | `x2` | `y` | `y2` | null>(null)

  // Compute ref_lines with index and group by z-index (using shared utilities)
  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))
  let ref_lines_by_z = $derived(group_ref_lines_by_z(indexed_ref_lines))

  // Derived data
  type IndexedSeries = { series_data: DataSeries; series_idx: number }
  let visible_series_labels = $derived(
    series
      .filter((series_data) => series_data.visible ?? true)
      .map((series_data) => series_data.label)
      .filter((label): label is string => typeof label === `string` && label.length > 0),
  )
  $effect(() => {
    if (mode !== `single`) return
    if (selected_property && visible_series_labels.includes(selected_property)) return
    selected_property = visible_series_labels[0] ?? ``
  })
  let selected_series_entries = $derived<IndexedSeries[]>(
    series
      .map((series_data: DataSeries, series_idx: number) => ({ series_data, series_idx }))
      .filter(
        ({ series_data }) =>
          (series_data.visible ?? true) &&
          (mode !== `single` || !selected_property || series_data.label === selected_property),
      ),
  )
  let selected_series = $derived(selected_series_entries.map(({ series_data }) => series_data))

  // Partition count axes and accumulate value extents in one pass.
  let axis_data = $derived.by(() => {
    const y1_series: DataSeries[] = []
    const y2_series: DataSeries[] = []
    const x1_extent = empty_extent()
    const x2_extent = empty_extent()
    const y2_extent = empty_extent()
    for (const srs of selected_series) {
      accumulate_extent(srs.x_axis === `x2` ? x2_extent : x1_extent, srs.y)
      if (srs.y_axis === `y2`) {
        y2_series.push(srs)
        accumulate_extent(y2_extent, srs.y)
      } else y1_series.push(srs)
    }
    return { y1_series, y2_series, x1_extent, x2_extent, y2_extent }
  })

  const count_ranges = (x_domain: Vec2, x2_domain: Vec2) => {
    const count_cfg = { x_domain, x2_domain, bin_count: bins, range_padding }
    return {
      y: compute_count_range(axis_data.y1_series, {
        ...count_cfg,
        scale_type: final_y_axis.scale_type ?? `linear`,
        y_limit: log_safe_range(final_y_axis),
      }),
      y2: compute_count_range(axis_data.y2_series, {
        ...count_cfg,
        scale_type: final_y2_axis.scale_type ?? `linear`,
        y_limit: log_safe_range(final_y2_axis),
      }),
    }
  }

  let has_x2_points = $derived(axis_data.x2_extent.n_finite > 0)
  let has_y2_points = $derived(axis_data.y2_extent.n_finite > 0)

  let auto_ranges = $derived.by(() => {
    const auto_x = nice_range_from_extent(
      axis_data.x1_extent,
      final_x_axis.range ?? [null, null],
      final_x_axis.scale_type ?? `linear`,
      range_padding,
    )

    const auto_x2 = has_x2_points
      ? nice_range_from_extent(
          axis_data.x2_extent,
          final_x2_axis.range ?? [null, null],
          final_x2_axis.scale_type ?? `linear`,
          range_padding,
        )
      : ([0, 1] as Vec2)

    return { x: auto_x, x2: auto_x2, ...count_ranges(auto_x, auto_x2) }
  })
  // Histogram count ranges depend on the bin domain. Once FacetGrid resolves shared x domains,
  // re-bin against those domains before reporting y so the reconciled count range cannot clip bars.
  const intrinsic_ranges = $derived.by(() => {
    if (!facet_layout) return auto_ranges
    const x_domain = facet_layout.ranges.x ?? auto_ranges.x
    const x2_domain = facet_layout.ranges.x2 ?? auto_ranges.x2
    return { ...auto_ranges, ...count_ranges(x_domain, x2_domain) }
  })

  // Controls read the resolved auto value and write back an explicit override.
  const should_show_legend = $derived(
    resolve_legend_visibility(show_legend, legend, series.length),
  )

  // Pass the histogram's `bins` as the marginal's histogram bin count (not strip thickness)
  // so a histogram marginal inherits the main binning; CDF marginals ignore it.
  const resolved_marginals = $derived(
    normalize_marginals(marginals, { top: { type: `cdf`, bins } }),
  )

  const frame = create_cartesian_frame({
    axes: () => ({ x: final_x_axis, x2: final_x2_axis, y: final_y_axis, y2: final_y2_axis }),
    auto_ranges: () => auto_ranges,
    facet_ranges: () => intrinsic_ranges,
    // Supports one-sided range pinning (null bounds fall back to auto). y/y2 ranges are
    // log-sanitized so an invalid (<= 0) log lower falls back to the auto count minimum.
    range_sources: () => ({
      x: final_x_axis,
      x2: final_x2_axis,
      y: { range: log_safe_range(final_y_axis) },
      y2: { range: log_safe_range(final_y2_axis) },
    }),
    range_sync: `per-axis`,
    has_x2: () => has_x2_points,
    has_y2: () => has_y2_points,
    padding: () => padding,
    title: () => title,
    obstacles: () => obstacles_norm,
    legend: () => legend,
    legend_visible: () => should_show_legend,
    legend_items: () =>
      series.map((series_data, series_idx) => ({
        label: series_data.label ?? `Series ${series_idx + 1}`,
        legend_group: series_data.legend_group,
      })),
    marginals: () => resolved_marginals,
    ref_lines: () => indexed_ref_lines,
    pan: () => pan,
    facet_layout: () => facet_layout,
    write_range: (axis, range) => {
      if (axis === `x`) x_axis = { ...x_axis, range }
      else if (axis === `x2`) x2_axis = { ...x2_axis, range }
      else if (axis === `y`) y_axis = { ...y_axis, range }
      else y2_axis = { ...y2_axis, range }
    },
    clip_id_prefix: `histogram-clip`,
  })

  // Obstacle field in normalized [0,1] plot coords (y=0 at top). Each filled bar is modeled as a
  // vertical segment (top -> baseline) so the legend can't hide inside a tall bar. Built from
  // histogram_bins (pad-independent) + ranges so the crowding decision can't see its own reservation.
  const obstacles_norm = $derived.by(() => {
    const { width, height, effective_base_pad: base_pad, ranges } = frame
    if (!width || !height || histogram_bins.length === 0) return []
    const base_w = width - base_pad.l - base_pad.r
    const base_h = height - base_pad.t - base_pad.b
    if (base_w <= 0 || base_h <= 0) return []
    const bars: { points: { x: number; y: number }[]; draws_line: boolean }[] = []
    for (const hist of histogram_bins) {
      const [rx0, rx1] = hist.x_axis === `x2` ? ranges.current.x2 : ranges.current.x
      const [ry0, ry1] = hist.y_axis === `y2` ? ranges.current.y2 : ranges.current.y
      const x_span = rx1 - rx0
      const y_span = ry1 - ry0
      if (!(x_span > 0) || !(y_span > 0)) continue
      for (const series_bin of hist.bins) {
        if (series_bin.length <= 0) continue
        const x_norm = (((series_bin.x0 ?? 0) + (series_bin.x1 ?? 0)) / 2 - rx0) / x_span
        const top = 1 - (series_bin.length - ry0) / y_span
        const baseline = 1 + ry0 / y_span // normalized y of count=0 (bar foot)
        const seg = clip_bar(true, x_norm, top, baseline)
        if (seg) bars.push(seg)
      }
    }
    return build_obstacles_norm(bars, base_w, base_h)
  })

  // a lone series uses the configured bar color; with multiple, each gets its own
  const series_color = (series_data: DataSeries) =>
    selected_series.length === 1 ? bar.color : extract_series_color(series_data)
  const marginal_series = $derived<MarginalSeriesInput[]>(
    selected_series_entries.map(({ series_data }) => ({
      x: series_data.y ?? [],
      color: series_color(series_data),
      label: series_data.label,
      visible: true,
      x_axis: series_data.x_axis,
      y_axis: series_data.y_axis,
    })),
  )

  // Pad-independent binning (no pixel scales) so the auto-place obstacle field can reuse it
  let histogram_bins = $derived.by(() => {
    if (selected_series.length === 0 || !frame.width || !frame.height) return []
    return compute_histogram_bins(selected_series_entries, {
      x_domain: frame.ranges.current.x,
      x2_domain: frame.ranges.current.x2,
      has_x2: has_x2_points,
      bin_count: bins,
      series_color,
    })
  })
  // Render-time data adds the pixel scales (pad-dependent)
  let histogram_data = $derived(
    histogram_bins.map((hist) => ({
      ...hist,
      x_scale: hist.x_axis === `x2` ? frame.scales.x2 : frame.scales.x,
      y_scale: hist.y_axis === `y2` ? frame.scales.y2 : frame.scales.y,
    })),
  )

  let legend_data = $derived(build_legend_items(series, series_symbol_swatch))

  function handle_mouse_move(
    evt: MouseEvent,
    value: number,
    count: number,
    property: string,
    active_y_axis: `y1` | `y2` = `y1`,
    series_idx: number = 0,
    active_x_axis: `x1` | `x2` = `x1`,
  ) {
    hovered = true
    hover_info = {
      value,
      count,
      property,
      active_y_axis,
      active_x_axis,
      x: value,
      y: count,
      series_idx,
      metadata: null,
      label: property,
      x_axis: active_x_axis === `x2` ? x2_axis : x_axis,
      x2_axis,
      y_axis: active_y_axis === `y2` ? y2_axis : y_axis,
      y2_axis,
    }
    change({ value, count, property })
    on_bar_hover?.({ value, count, property, event: evt })
  }

  const legend_vis = create_legend_visibility(
    () => series,
    (next) => (series = next),
  )

  // State accessors for shared axis change handler
  // Spread into existing state in each setter to preserve merged type structure
  const axis_state: AxisChangeState<DataSeries> = {
    axes: {
      x: { get: () => x_axis, set: (config) => (x_axis = { ...x_axis, ...config }) },
      x2: { get: () => x2_axis, set: (config) => (x2_axis = { ...x2_axis, ...config }) },
      y: { get: () => y_axis, set: (config) => (y_axis = { ...y_axis, ...config }) },
      y2: { get: () => y2_axis, set: (config) => (y2_axis = { ...y2_axis, ...config }) },
    },
    series: { get: () => series, set: (next) => (series = next) },
    loading: { get: () => axis_loading, set: (axis) => (axis_loading = axis) },
  }

  // Shared handler + one-shot auto-load bound to this component's state
  const { handle_axis_change, try_auto_load } = create_axis_loader(axis_state, () => ({
    data_loader,
    on_axis_change,
    on_error,
  }))
  $effect(try_auto_load)
</script>

{#snippet ref_lines_layer(lines: readonly IndexedRefLine[])}
  <ReferenceLinesLayer
    {lines}
    ranges={frame.ranges.current}
    scales={frame.scales}
    clip_path_id={frame.clip_path_id}
    decoration_solution={frame.decoration_solution}
    bind:hovered_line_idx={hovered_ref_line_idx}
    on_click={on_ref_line_click}
    on_hover={on_ref_line_hover}
  />
{/snippet}

<CartesianFrame
  {frame}
  plot_class="histogram"
  css_prefix="histogram"
  css_var_fallbacks={{ 'svg-max-height': `100%` }}
  aria_label={frame.title_config?.text ||
    [final_x_axis.label, final_y_axis.label].filter(Boolean).join(` vs `) ||
    `Histogram`}
  bind:fullscreen
  {fullscreen_toggle}
  require_size={false}
  marginals={resolved_marginals}
  {marginal_series}
  on_mouse_enter={() => (hovered = true)}
  on_mouse_leave={() => {
    hovered = false
    hover_info = null
    on_bar_hover?.(null)
  }}
  {header_controls}
  {children}
  {...rest}
>
  {#snippet layers()}
    <!-- Reference lines: below grid (must render first to appear behind grid) -->
    {@render ref_lines_layer(ref_lines_by_z.below_grid)}

    <ZeroLines {frame} {display} />

    <!-- Reference lines: below lines -->
    {@render ref_lines_layer(ref_lines_by_z.below_lines)}

    <!-- Reference lines: below points -->
    {@render ref_lines_layer(ref_lines_by_z.below_points)}

    <PlotAxes {frame} {display} {axis_loading} on_axis_change={handle_axis_change} />

    <!-- Histogram bars (rendered after axes so bars appear above grid lines) -->
    {#each histogram_data as { id, bins, color, label, x_scale, y_scale, x_axis: srs_x_axis, y_axis, series_idx }, idx (id ?? idx)}
      <g
        class="histogram-series"
        data-series-idx={series_idx}
        clip-path="url(#{frame.clip_path_id})"
        opacity={frame.hovered_series_idx !== null && frame.hovered_series_idx !== series_idx
          ? 0.25
          : 1}
      >
        {#each bins as bin, bin_idx (bin_idx)}
          {@const bar_x = x_scale(bin.x0!)}
          {@const bar_width = Math.max(1, Math.abs(x_scale(bin.x1!) - bar_x))}
          {@const bar_height = Math.max(0, frame.height - frame.pad.b - y_scale(bin.length))}
          {@const bar_y = y_scale(bin.length)}
          {@const value = (bin.x0! + bin.x1!) / 2}
          {#if bar_height > 0}
            <path
              d={bar_path(
                bar_x,
                bar_y,
                bar_width,
                bar_height,
                Math.min(bar.border_radius ?? 0, bar_width / 2, bar_height / 2),
              )}
              fill={color}
              opacity={bar.opacity}
              stroke={bar.stroke_color}
              stroke-opacity={bar.stroke_opacity}
              stroke-width={bar.stroke_width}
              role="button"
              tabindex="0"
              onmousemove={(evt) =>
                handle_mouse_move(
                  evt,
                  value,
                  bin.length,
                  label,
                  (y_axis ?? `y1`) as `y1` | `y2`,
                  series_idx,
                  (srs_x_axis ?? `x1`) as `x1` | `x2`,
                )}
              onmouseleave={() => {
                hover_info = null
                change(null)
                on_bar_hover?.(null)
              }}
              onclick={(event) =>
                on_bar_click?.({ value, count: bin.length, property: label, event })}
              onkeydown={(event: KeyboardEvent) => {
                if ([`Enter`, ` `].includes(event.key)) {
                  event.preventDefault()
                  on_bar_click?.({ value, count: bin.length, property: label, event })
                }
              }}
              style:cursor={on_bar_click ? `pointer` : undefined}
            />
          {/if}
        {/each}
      </g>
    {/each}

    <!-- Reference lines: above all -->
    {@render ref_lines_layer(ref_lines_by_z.above_all)}
  {/snippet}

  {#snippet overlays()}
    <!-- Tooltip (outside SVG for proper HTML rendering) -->
    {#if hover_info}
      {@const { value, count, property, active_y_axis, active_x_axis } = hover_info}
      {@const tooltip_x = (active_x_axis === `x2` ? frame.scales.x2 : frame.scales.x)(value)}
      {@const tooltip_y = (active_y_axis === `y2` ? frame.scales.y2 : frame.scales.y)(count)}
      <PlotTooltip
        x={tooltip_x}
        y={tooltip_y}
        offset={{ x: 5, y: -10 }}
        constrain_to={{ width: frame.width, height: frame.height }}
        exclusion_rects={frame.exclusion_rects}
        fallback_size={{ width: 120, height: mode === `overlay` ? 60 : 40 }}
      >
        {#if tooltip}
          {@render tooltip({ ...hover_info, fullscreen })}
        {:else}
          <div>Value: {format_value_or_num(value, hover_info.x_axis.format)}</div>
          <div>Count: {format_value_or_num(count, hover_info.y_axis.format)}</div>
          {#if mode === `overlay`}<div>{property}</div>{/if}
        {/if}
      </PlotTooltip>
    {/if}

    {#if show_controls}
      <HistogramControls
        toggle_props={{
          ...controls_toggle_props,
          style: `--ctrl-btn-right: var(--fullscreen-btn-offset, 30px); ${
            controls_toggle_props?.style ?? ``
          }`,
        }}
        pane_props={controls_pane_props}
        bind:show_controls
        bind:controls_open
        bind:bins
        bind:mode
        bind:show_legend
        resolved_show_legend={should_show_legend}
        bind:selected_property
        bind:display
        bind:bar
        bind:x_axis
        bind:x2_axis
        bind:y_axis
        bind:y2_axis
        auto_x_range={auto_ranges.x}
        auto_x2_range={auto_ranges.x2}
        auto_y_range={auto_ranges.y}
        auto_y2_range={auto_ranges.y2}
        {series}
        {has_x2_points}
        {has_y2_points}
        children={controls_extra}
      />
    {/if}

    <PlotLegendLayer
      {frame}
      {legend}
      series_data={legend_data}
      active_series_idx={hover_info?.series_idx ?? frame.hovered_series_idx}
      on_toggle={(series_idx: number) => {
        if (series_idx < 0 || series_idx >= series.length) return
        legend_vis.on_toggle(series_idx)
        on_series_toggle(series_idx)
      }}
      on_double_click={legend_vis.on_double_click}
    />
  {/snippet}
</CartesianFrame>

<style>
  .histogram-series path {
    transition: opacity 0.2s ease;
  }
  .histogram-series path:hover {
    opacity: 1 !important;
  }
</style>
