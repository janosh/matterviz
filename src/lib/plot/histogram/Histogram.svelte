<script lang="ts">
  import { create_chart_exporter } from '$lib/plot/core/utils/chart-export'
  import { format_value_or_num } from '$lib/labels'
  import type {
    AxisLoadError,
    BarStyle,
    DataLoaderFn,
    HistogramHandlerProps,
    LayerZIndex,
    PanConfig,
    RefLine,
    RefLineEvent,
  } from '$lib/plot'
  import { HistogramControls } from '$lib/plot'
  import CartesianFrame from '$lib/plot/core/components/CartesianFrame.svelte'
  import PatternDefs from '$lib/plot/core/components/PatternDefs.svelte'
  import PlotAxes from '$lib/plot/core/components/PlotAxes.svelte'
  import PlotLegendLayer from '$lib/plot/core/components/PlotLegendLayer.svelte'
  import ReferenceLinesLayer from '$lib/plot/core/components/ReferenceLinesLayer.svelte'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import { normalize_marginals } from '$lib/plot/core/marginals'
  import {
    AXIS_DEFAULTS,
    create_axis_loader,
    X2_AXIS_DEFAULTS,
  } from '$lib/plot/core/axis-utils'
  import type { AxisChangeState } from '$lib/plot/core/axis-utils'
  import { create_cartesian_frame } from '$lib/plot/core/cartesian-frame.svelte'
  import { resolve_plot_display } from '$lib/plot/core/display.svelte'
  import { plot_color } from '$lib/colors'
  import { build_legend_items } from '$lib/plot/core/data-transform'
  import type { FacetLayoutContext } from '$lib/plot/core/facets'
  import {
    create_legend_visibility,
    legend_mode_to_prop,
    resolve_legend_visibility,
  } from '$lib/plot/core/utils/series-visibility'
  import type { ObstacleSeries } from '$lib/plot/core/decorations'
  import { clip_bar, with_obstacle_frame } from '$lib/plot/core/decorations'
  import { index_ref_lines } from '$lib/plot/core/reference-line'
  import {
    accumulate_extent,
    empty_extent,
    nice_range_from_extent,
  } from '$lib/plot/core/scales'
  import type {
    AxisConfig,
    BasePlotProps,
    LegendConfig,
    PlotConfig,
    UserContentProps,
  } from '$lib/plot/core/types'
  import type {
    BinnedSeries,
    HistogramBin,
    HistogramNormalize,
    HistogramSeries,
  } from '$lib/plot/histogram/histogram'
  import {
    compute_count_range,
    compute_histogram_bins,
    log_safe_range,
  } from '$lib/plot/histogram/histogram'
  import ZeroLines from '$lib/plot/core/components/ZeroLines.svelte'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { clamp, type Vec2 } from '$lib/math'
  import {
    create_focus_exit,
    is_activation_key,
    vec2_equal,
  } from '$lib/plot/core/interactions'
  import { roving_key } from '$lib/plot/core/utils/roving-focus.svelte'
  import { create_roving_focus, ROVING_ATTR } from 'svelte-widgets/roving-focus'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import { bar_path } from '$lib/plot/core/svg'
  import { resolve_pattern } from '$lib/plot/core/patterns'
  import { unique_id } from '$lib/plot/core/utils'

  let {
    series: series_in = $bindable([]),
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable({ ...DEFAULTS.plot.display }),
    range_padding = 0,
    padding = {},
    title,
    bins = $bindable(DEFAULTS.histogram.bin_count),
    normalize = $bindable(DEFAULTS.histogram.normalize),
    // explicit type arg keeps `undefined` (auto) in the prop type - a bare fallback
    // would collapse it to plain boolean
    show_legend = $bindable<boolean | undefined>(
      legend_mode_to_prop(DEFAULTS.histogram.show_legend),
    ),
    legend = {},
    bar = $bindable({}),
    selected_property = $bindable(``),
    mode = $bindable(DEFAULTS.histogram.mode),
    tooltip,
    user_content,
    hovered = $bindable(false),
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
      series: HistogramSeries[]
      // Component-specific props
      bins?: number
      normalize?: HistogramNormalize
      show_legend?: boolean
      legend?: LegendConfig | null
      bar?: BarStyle
      selected_property?: string
      mode?: `single` | `overlay`
      tooltip?: Snippet<[HistogramHandlerProps]>
      user_content?: Snippet<[UserContentProps]>
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet<[Required<PlotConfig>]>
      on_bar_click?: (
        data: HistogramHandlerProps & { event: MouseEvent | KeyboardEvent },
      ) => void
      // FocusEvent for keyboard focus, which reaches a bar the same way a hover does
      on_bar_hover?: (
        data: (HistogramHandlerProps & { event: MouseEvent | FocusEvent }) | null,
      ) => void
      ref_lines?: RefLine[]
      on_ref_line_click?: (event: RefLineEvent) => void
      on_ref_line_hover?: (event: RefLineEvent | null) => void
      on_series_toggle?: (series_idx: number) => void
      // Interactive axis props
      data_loader?: DataLoaderFn<Record<string, unknown>, HistogramSeries>
      on_axis_change?: (
        axis: `x` | `x2` | `y` | `y2`,
        key: string,
        new_series: HistogramSeries[],
      ) => void
      on_error?: (error: AxisLoadError) => void
      pan?: PanConfig
      marginals?: MarginalsProp
      facet_layout?: FacetLayoutContext
    } = $props()

  const legend_vis = create_legend_visibility<HistogramSeries>(
    () => series,
    (next) => (series_in = next),
  )
  let series: HistogramSeries[] = $derived(legend_vis.resolve(series_in))

  // Merge defaults without writing library-owned values into the caller's bound state.
  // No default tick format: PlotAxis falls back to format_num, which uses SI
  // prefixes above 1 but plain decimals below (0.2 must not render as 200m)
  const { format: _default_format, ...axis_defaults } = AXIS_DEFAULTS
  const { format: _x2_format, ...x2_axis_defaults } = X2_AXIS_DEFAULTS
  const final_x_axis = $derived<AxisConfig>({ ...axis_defaults, label: `Value`, ...x_axis })
  const final_x2_axis = $derived<AxisConfig>({
    ...x2_axis_defaults,
    label: `Value`,
    ...x2_axis,
  })
  // Normalized bars are fractions, so only raw counts default to integer tick labels
  const value_axis_defaults = $derived(
    normalize === `count`
      ? { label: `Count`, format: `d` }
      : { label: normalize === `density` ? `Density` : `Probability` },
  )
  const value_axis = (axis: AxisConfig): AxisConfig => ({
    ...axis_defaults,
    ...value_axis_defaults,
    ...axis,
  })
  const final_y_axis = $derived(value_axis(y_axis))
  const final_y2_axis = $derived(value_axis(y2_axis))
  const resolved_display = $derived(resolve_plot_display(display, DEFAULTS.plot.display))
  const resolved_bar = $derived({ ...DEFAULTS.histogram.bar, ...bar })

  let hover_info = $state<HistogramHandlerProps | null>(null)

  // Interactive axis loading state
  let axis_loading = $state<`x` | `x2` | `y` | `y2` | null>(null)

  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))

  // === Series selection ===
  let visible_series_labels = $derived(
    series
      .filter((series_data) => series_data.visible ?? true)
      .map((series_data) => series_data.label)
      .filter((label): label is string => typeof label === `string` && label.length > 0),
  )
  // In single mode an unset or stale `selected_property` falls back to the first visible label
  // (an invalid binding is corrected on the next write, not by an effect).
  const active_property = $derived(
    visible_series_labels.includes(selected_property)
      ? selected_property
      : (visible_series_labels[0] ?? ``),
  )
  let selected_series_entries = $derived(
    series
      .map((series_data, series_idx) => ({ series_data, series_idx }))
      .filter(
        ({ series_data }) =>
          (series_data.visible ?? true) &&
          (mode !== `single` || !active_property || series_data.label === active_property),
      ),
  )
  let selected_series = $derived(selected_series_entries.map(({ series_data }) => series_data))

  // Value extents per x axis and whether any sample lands on a secondary axis, in one pass.
  let axis_data = $derived.by(() => {
    const x1_extent = empty_extent()
    const x2_extent = empty_extent()
    const y2_extent = empty_extent()
    for (const srs of selected_series) {
      accumulate_extent(srs.x_axis === `x2` ? x2_extent : x1_extent, srs.values)
      if (srs.y_axis === `y2`) accumulate_extent(y2_extent, srs.values)
    }
    return { x1_extent, x2_extent, y2_extent }
  })
  let has_x2_points = $derived(axis_data.x2_extent.n_finite > 0)
  let has_y2_points = $derived(axis_data.y2_extent.n_finite > 0)

  // === Binning ===
  // Pad-independent (no pixel scales) so the legend obstacle field and the count ranges reuse it
  const bin_over = (x_domain: Vec2, x2_domain: Vec2): BinnedSeries[] =>
    compute_histogram_bins(selected_series_entries, {
      x_domain,
      x2_domain,
      x_scale_type: final_x_axis.scale_type,
      x2_scale_type: final_x2_axis.scale_type,
      bins,
      normalize,
      series_color,
    })
  const count_ranges = (binned: readonly BinnedSeries[]) => {
    const on_axis = (axis: `y1` | `y2`) =>
      binned.filter((hist) => (hist.y_axis ?? `y1`) === axis)
    const range_for = (axis: AxisConfig, key: `y1` | `y2`) =>
      compute_count_range(on_axis(key), {
        scale_type: axis.scale_type ?? `linear`,
        y_limit: log_safe_range(axis),
        range_padding,
      })
    return { y: range_for(final_y_axis, `y1`), y2: range_for(final_y2_axis, `y2`) }
  }

  const auto_x_ranges = $derived.by(() => {
    const nice_for = (extent: typeof axis_data.x1_extent, axis: AxisConfig) =>
      nice_range_from_extent(
        extent,
        axis.range ?? [null, null],
        axis.scale_type ?? `linear`,
        range_padding,
      )
    return {
      x: nice_for(axis_data.x1_extent, final_x_axis),
      x2: has_x2_points ? nice_for(axis_data.x2_extent, final_x2_axis) : ([0, 1] as Vec2),
    }
  })
  // Bins over the data-driven x domains; they also fix the count ranges so a pan/zoom along x
  // doesn't rescale y.
  const auto_bins = $derived(bin_over(auto_x_ranges.x, auto_x_ranges.x2))
  let auto_ranges = $derived({ ...auto_x_ranges, ...count_ranges(auto_bins) })
  // Histogram count ranges depend on the bin domain. Once FacetGrid resolves shared x domains,
  // re-bin against those domains before reporting y so the reconciled count range cannot clip bars.
  const intrinsic_ranges = $derived.by(() => {
    if (!facet_layout) return auto_ranges
    const x_domain = facet_layout.ranges.x ?? auto_ranges.x
    const x2_domain = facet_layout.ranges.x2 ?? auto_ranges.x2
    return { ...auto_ranges, ...count_ranges(bin_over(x_domain, x2_domain)) }
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
    legend_items: () => legend_data,
    marginals: () => resolved_marginals,
    ref_lines: () => indexed_ref_lines,
    pan: () => pan,
    facet_layout: () => facet_layout,
    clip_id_prefix: `histogram-clip`,
  })

  // Obstacle field in normalized [0,1] plot coords (y=0 at top). Each filled bar is modeled as a
  // vertical segment (top -> baseline) so the legend can't hide inside a tall bar. Built from
  // histogram_bins (pad-independent) + ranges so the crowding decision can't see its own reservation.
  const obstacles_norm = $derived.by(() =>
    with_obstacle_frame(frame, histogram_bins.length > 0, ({ base_w, base_h }) => {
      const { ranges } = frame
      const bars: ObstacleSeries[] = []
      for (const hist of histogram_bins) {
        const [rx0, rx1] = hist.x_axis === `x2` ? ranges.current.x2 : ranges.current.x
        const [ry0, ry1] = hist.y_axis === `y2` ? ranges.current.y2 : ranges.current.y
        const x_span = rx1 - rx0
        const y_span = ry1 - ry0
        // signed spans: the x_norm/top/baseline math below is direction-correct, and rejecting a
        // reversed range as degenerate emptied the obstacle field, so auto-placed decorations
        // landed on the bars. Matches BoxPlot.svelte's guard.
        if (x_span === 0 || y_span === 0) continue
        for (const { x0, x1, value } of hist.bins) {
          if (value <= 0) continue
          const x_norm = ((x0 + x1) / 2 - rx0) / x_span
          const top = 1 - (value - ry0) / y_span
          const baseline = 1 + ry0 / y_span // normalized y of value=0 (bar foot)
          const seg = clip_bar(true, x_norm, top, baseline)
          if (seg) bars.push(seg)
        }
      }
      return bars
    }),
  )

  // A lone series uses the configured bar color; with several, each gets its own (`color`, then
  // the cycled palette). Keyed on `series`, not the visible subset the legend outlives, which
  // painted every swatch `bar.color` once all but one series were hidden.
  const series_color = (series_data: HistogramSeries, series_idx: number): string =>
    series.length === 1 ? resolved_bar.color : (series_data.color ?? plot_color(series_idx))
  const marginal_series = $derived<MarginalSeriesInput[]>(
    selected_series_entries.map(({ series_data, series_idx }) => ({
      x: series_data.values,
      color: series_color(series_data, series_idx),
      label: series_data.label,
      visible: true,
      x_axis: series_data.x_axis,
      y_axis: series_data.y_axis,
    })),
  )

  // Bins over the current (possibly panned/zoomed) x domains. Until the view moves these are
  // the auto-domain bins, so the common case bins each series exactly once.
  let histogram_bins = $derived.by(() => {
    if (selected_series.length === 0 || !frame.width || !frame.height) return []
    const { x, x2 } = frame.ranges.current
    if (vec2_equal(x, auto_x_ranges.x) && vec2_equal(x2, auto_x_ranges.x2)) return auto_bins
    return bin_over(x, x2)
  })

  // One tab stop for all bins instead of one per bin: a 100-bin histogram would
  // otherwise take 100 presses to tab past. Arrow keys walk the bars.
  const roving = create_roving_focus({
    container: () => frame.svg_element,
    items: () => histogram_bins,
  })

  let legend_data = $derived(
    build_legend_items(series, (series_data, series_idx) => ({
      symbol_type: `Square`,
      symbol_color: series_color(series_data, series_idx),
      pattern: series_data.pattern,
    })),
  )

  // Per-series hatch/texture tiles resolved against the bar color, indexed by series (null:
  // plain fill; ids scoped to this instance). Derived from the series, not the bins, so
  // pan/zoom frames that rebin do not re-resolve tiles and re-diff the <defs>.
  const pattern_uid = unique_id(`histogram`)
  let hist_patterns = $derived(
    series.map((series_data, series_idx) =>
      series_data.pattern
        ? resolve_pattern(
            series_data.pattern,
            series_color(series_data, series_idx),
            pattern_uid,
          )
        : null,
    ),
  )

  // Handler payload for a bar: `value`/`x` are the bin center, `y` the normalized bar height
  const bar_data = (hist: BinnedSeries, { x0, x1, count, value }: HistogramBin) => {
    const active_x_axis = hist.x_axis ?? `x1`
    const active_y_axis = hist.y_axis ?? `y1`
    const center = (x0 + x1) / 2
    return {
      value: center,
      count,
      property: hist.label,
      active_x_axis,
      active_y_axis,
      x: center,
      y: value,
      series_idx: hist.series_idx,
      metadata: null,
      label: hist.label,
      x_axis: active_x_axis === `x2` ? final_x2_axis : final_x_axis,
      x2_axis: final_x2_axis,
      y_axis: active_y_axis === `y2` ? final_y2_axis : final_y_axis,
      y2_axis: final_y2_axis,
    } satisfies HistogramHandlerProps
  }
  // Accepts a FocusEvent too: keyboard focus is the keyboard's hover
  const handle_bar_hover =
    (hist: BinnedSeries, bin: HistogramBin) => (evt: MouseEvent | FocusEvent) => {
      hovered = true
      hover_info = bar_data(hist, bin)
      on_bar_hover?.({ ...hover_info, event: evt })
    }
  const clear_hover = () => {
    hover_info = null
    on_bar_hover?.(null)
  }

  const clear_hover_on_exit = create_focus_exit(() => frame.svg_element, clear_hover)
  const handle_bar_click =
    (hist: BinnedSeries, bin: HistogramBin) => (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (!is_activation_key(event)) return
        event.preventDefault()
      }
      on_bar_click?.({ ...bar_data(hist, bin), event })
    }

  const axis_state: AxisChangeState<HistogramSeries> = {
    axes: {
      x: { get: () => final_x_axis, set: (config) => (x_axis = config) },
      x2: { get: () => final_x2_axis, set: (config) => (x2_axis = config) },
      y: { get: () => final_y_axis, set: (config) => (y_axis = config) },
      y2: { get: () => final_y2_axis, set: (config) => (y2_axis = config) },
    },
    series: { get: () => series, set: (next) => (series_in = next) },
    loading: { get: () => axis_loading, set: (axis) => (axis_loading = axis) },
  }

  const { handle_axis_change, try_auto_load } = create_axis_loader(axis_state, () => ({
    data_loader,
    on_axis_change,
    on_error,
  }))
  $effect(try_auto_load)

  // === Export ===
  // Bins have an extent, so CSV reports edges rather than the (x, y) the shared long
  // format would collapse them to.
  const handle_export = create_chart_exporter(frame, () => ({
    header: [`series`, `bin_start`, `bin_end`, `count`, `value`],
    rows: histogram_bins.flatMap((hist) =>
      hist.bins.map((bin) => [
        hist.label ?? `series ${hist.series_idx + 1}`,
        bin.x0,
        bin.x1,
        bin.count,
        bin.value,
      ]),
    ),
  }))
</script>

{#snippet ref_lines_layer(z: LayerZIndex)}
  <ReferenceLinesLayer {frame} {z} on_click={on_ref_line_click} on_hover={on_ref_line_hover} />
{/snippet}

<CartesianFrame
  {frame}
  plot_class="histogram"
  css_prefix="histogram"
  css_var_fallbacks={{ 'svg-max-height': `100%` }}
  aria_label="Histogram"
  bind:fullscreen
  {fullscreen_toggle}
  require_size={false}
  marginals={resolved_marginals}
  {marginal_series}
  on_mouse_enter={() => (hovered = true)}
  on_mouse_leave={() => {
    hovered = false
    clear_hover()
  }}
  {header_controls}
  {user_content}
  {children}
  {...rest}
>
  {#snippet layers()}
    {@render ref_lines_layer(`below-grid`)}
    <ZeroLines {frame} display={resolved_display} />
    {@render ref_lines_layer(`below-lines`)}
    {@render ref_lines_layer(`below-points`)}

    <PlotAxes
      {frame}
      display={resolved_display}
      {axis_loading}
      on_axis_change={handle_axis_change}
    />

    <!-- Histogram bars (rendered after axes so bars appear above grid lines) -->
    <defs><PatternDefs patterns={hist_patterns} /></defs>
    {#each histogram_bins as hist (hist.id)}
      {@const x_scale = hist.x_axis === `x2` ? frame.scales.x2 : frame.scales.x}
      {@const y_scale = hist.y_axis === `y2` ? frame.scales.y2 : frame.scales.y}
      <!-- Bars grow from zero, or from the range floor when zero is off-axis (log, pinned range) -->
      {@const y_range =
        hist.y_axis === `y2` ? frame.ranges.current.y2 : frame.ranges.current.y}
      {@const baseline = y_scale(clamp(0, Math.min(...y_range), Math.max(...y_range)))}
      <g
        class="histogram-series"
        data-series-idx={hist.series_idx}
        clip-path="url(#{frame.clip_path_id})"
        opacity={frame.hovered_series_idx !== null &&
        frame.hovered_series_idx !== hist.series_idx
          ? 0.25
          : 1}
      >
        {#each hist.bins as bin, bin_idx (bin_idx)}
          <!-- min/abs on both axes (as BarPlot's compute_bar_rect does) rather than assuming
               x0 is left of x1 and the baseline below the value: bin edges and the baseline are
               data values, so a reversed range flips either pair and used to drop every bar -->
          {@const x0_px = x_scale(bin.x0)}
          {@const x1_px = x_scale(bin.x1)}
          {@const value_px = y_scale(bin.value)}
          {@const bar_x = Math.min(x0_px, x1_px)}
          {@const bar_y = Math.min(baseline, value_px)}
          {@const bar_width = Math.max(1, Math.abs(x1_px - x0_px))}
          {@const bar_height = Math.abs(baseline - value_px)}
          {#if bar_height > 0}
            <path
              d={bar_path(
                bar_x,
                bar_y,
                bar_width,
                bar_height,
                resolved_bar.border_radius ?? 0,
              )}
              fill={hist_patterns[hist.series_idx]?.url ?? hist.color}
              opacity={resolved_bar.opacity}
              stroke={resolved_bar.stroke_color}
              stroke-opacity={resolved_bar.stroke_opacity}
              stroke-width={resolved_bar.stroke_width}
              role="button"
              tabindex={roving.tabindex(roving_key(hist.series_idx, bin_idx))}
              {...{ [ROVING_ATTR]: roving_key(hist.series_idx, bin_idx) }}
              aria-label={`${hist.label ?? `series`} bin ${bin_idx + 1}: ${bin.x0} to ${
                bin.x1
              }, count ${bin.count}${normalize === `count` ? `` : `, value ${bin.value}`}`}
              onmousemove={handle_bar_hover(hist, bin)}
              onmouseleave={clear_hover}
              onfocusin={(evt) => {
                roving.focusin(evt)
                // Focus is the keyboard's hover; without it the tooltip never opens
                handle_bar_hover(hist, bin)(evt)
              }}
              onfocusout={clear_hover_on_exit}
              onclick={handle_bar_click(hist, bin)}
              onkeydown={(evt) => {
                if (roving.handle_keydown(evt)) return
                handle_bar_click(hist, bin)(evt)
              }}
              style:cursor={on_bar_click ? `pointer` : undefined}
            />
          {/if}
        {/each}
      </g>
    {/each}

    {@render ref_lines_layer(`above-all`)}
  {/snippet}

  {#snippet overlays()}
    <!-- Tooltip (outside SVG for proper HTML rendering) -->
    {#if hover_info && hovered}
      {@const { value, count, y, property, active_y_axis, active_x_axis } = hover_info}
      {@const tooltip_x = (active_x_axis === `x2` ? frame.scales.x2 : frame.scales.x)(value)}
      {@const tooltip_y = (active_y_axis === `y2` ? frame.scales.y2 : frame.scales.y)(y)}
      <!-- avoid_cursor off: the anchor snaps to the bin, not the pointer -->
      <PlotTooltip
        x={tooltip_x}
        y={tooltip_y}
        avoid_cursor={false}
        offset={{ x: 5, y: -10 }}
        constrain_to={{ width: frame.width, height: frame.height }}
        exclusion_rects={frame.exclusion_rects}
        fallback_size={{ width: 120, height: mode === `overlay` ? 60 : 40 }}
      >
        {#if tooltip}
          {@render tooltip({ ...hover_info, fullscreen })}
        {:else}
          <div>Value: {format_value_or_num(value, hover_info.x_axis.format)}</div>
          <div>Count: {format_value_or_num(count, `d`)}</div>
          {#if normalize !== `count`}
            <div>{value_axis_defaults.label}: {format_value_or_num(y, `.3~g`)}</div>
          {/if}
          {#if mode === `overlay`}<div>{property}</div>{/if}
        {/if}
      </PlotTooltip>
    {/if}

    {#if show_controls}
      <HistogramControls
        on_export={handle_export}
        toggle_props={controls_toggle_props}
        pane_props={controls_pane_props}
        bind:show_controls
        bind:controls_open
        bind:bins
        bind:normalize
        bind:mode
        bind:show_legend
        resolved_show_legend={should_show_legend}
        bind:selected_property={() => active_property, (value) => (selected_property = value)}
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
        legend_vis.on_toggle(series_idx)
        on_series_toggle(series_idx)
      }}
      on_group_toggle={legend_vis.on_group_toggle}
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
