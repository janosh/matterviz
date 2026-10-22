<script lang="ts">
  import type { ShowControlsProp } from '#lib/controls.js'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import LiveMessage from 'svelte-widgets/LiveMessage.svelte'
  import type { PaneToggleProps } from '#lib/overlays/index.js'
  import type { CartesianFrame } from '#lib/plot/core/cartesian-frame.svelte.js'
  import type {
    MarginalAxis,
    MarginalAxisBinding,
    MarginalSeriesInput,
    ResolvedMarginals,
  } from '#lib/plot/core/marginals.js'
  import {
    marginal_axis,
    marginal_axis_presence,
    outer_strip_reservation,
  } from '#lib/plot/core/marginals.js'
  import PlotMarginals from '#lib/plot/core/components/PlotMarginals.svelte'
  import ChartHeaderControls from '#lib/plot/core/components/ChartHeaderControls.svelte'
  import type { Dims } from '#lib/plot/core/components/ChartHeaderControls.svelte'
  import { chart_css_defaults } from '#lib/plot/core/components/ChartShell.svelte'
  import PlotTitle from '#lib/plot/core/components/PlotTitle.svelte'
  import ZoomRect from '#lib/plot/core/components/ZoomRect.svelte'
  import type { UserContentProps } from '#lib/plot/core/types.js'
  import { svg_sources, type ExportProps, type ExportSources } from '#lib/io/export.js'
  import { chart_export_filename } from '#lib/plot/core/utils/chart-export.js'
  import type { Snippet } from 'svelte'
  import { onDestroy } from 'svelte'
  import type { ClassValue, HTMLAttributes } from 'svelte/elements'
  import { on } from 'svelte/events'
  import { viewer_keys } from '#lib/shortcuts.js'

  // Public CSS knobs every Cartesian chart exposes (`--histogram-bg`, `--barplot-bg`, …),
  // mapped onto the frame's own variables so this stylesheet isn't duplicated per chart
  const css_var_defaults = (prefix: string): Record<string, string> => ({
    ...chart_css_defaults(prefix),
    'svg-width': `100%`,
    'svg-height': `100%`,
    'svg-max-height': `none`,
    'svg-flex': `1`,
    'svg-overflow': `visible`,
    'font-weight': ``,
    'font-size': ``,
    'dragover-border': `var(--dragover-border)`,
    'dragover-bg': `var(--dragover-bg)`,
  })

  interface Props
    extends Omit<HTMLAttributes<HTMLDivElement>, `title` | `children`>, ExportProps {
    frame: CartesianFrame
    // Wrapper class the chart is selected by (`histogram`, `bar-plot`, `box-plot`)
    plot_class: ClassValue
    // Prefix of this chart's public CSS variables (`histogram`, `barplot`, `boxplot`)
    css_prefix: string
    // Per-chart fallbacks for css_var_defaults entries whose default differs
    css_var_fallbacks?: Record<string, string>
    // Accessible name when neither the title nor the x/y axis labels give one (`Bar chart`)
    aria_label: string
    fullscreen?: boolean
    fullscreen_toggle?: boolean
    show_controls?: ShowControlsProp<`controls` | `fullscreen`>
    // The outer container, exposed so charts can re-export it to their own callers
    wrapper?: HTMLDivElement
    // Charts that render their SVG before the container is measured (Histogram)
    require_size?: boolean
    marginals: ResolvedMarginals
    marginal_series: MarginalSeriesInput[]
    marginal_tick_label?: Partial<Record<MarginalAxisBinding, (pos: number) => string>>
    on_mouse_enter?: () => void
    on_mouse_leave?: () => void
    on_mouse_move?: (event: MouseEvent) => void
    // Single clicks, not the click ending a pan or a rect-zoom drag
    on_mouse_click?: (event: MouseEvent) => void
    // Cursor while no pan gesture claims it. Charts switch it to `pointer` when a click on
    // the plot surface would land on a mark, so the hand shows before the user commits.
    idle_cursor?: string
    // Chart-supplied key handling on the plot SVG, run before pan/zoom's own. Return
    // true to consume the key. Canvas-rendered marks have no focusable DOM of their
    // own, so this is the only keyboard route into them.
    on_key_down?: (event: KeyboardEvent) => boolean
    // Unpins the chart's pinned tooltip (see TooltipPin), false when none was. Escape calls it
    // first, from focus inside the chart or the page while the pointer is over it.
    unpin?: () => boolean
    // Announced to screen readers via a polite live region. Charts whose marks aren't
    // individually focusable use it to report where a keyboard cursor landed.
    live_message?: string
    // No data to plot: the axes stay, overlaid with the shared empty-state message
    empty?: boolean
    header_controls?: Snippet<[Dims]>
    // Data formats this chart can export, on top of the SVG/PNG of its frame
    export_sources?: ExportSources
    controls_toggle_props?: PaneToggleProps
    controls?: Snippet<[PaneToggleProps, boolean]>
    // Caller-drawn SVG rendered first inside the plot SVG, with the scales and ranges
    user_content?: Snippet<[UserContentProps]>
    // Marks, axes, zero lines and reference lines, in the chart's own paint order
    layers?: Snippet
    // Legend and tooltip, rendered after the SVG
    overlays?: Snippet
    // HTML overlays after the SVG, given the same scales/padding as user_content so they can
    // anchor to data coordinates (the .plot-frame is position: relative)
    children?: Snippet<[UserContentProps]>
  }

  let {
    frame,
    plot_class,
    css_prefix,
    css_var_fallbacks = {},
    aria_label,
    'aria-label': aria_label_override,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    show_controls,
    wrapper = $bindable(),
    require_size = true,
    marginals,
    marginal_series,
    marginal_tick_label = {},
    on_mouse_enter,
    on_mouse_leave,
    on_mouse_move,
    on_mouse_click,
    idle_cursor = `crosshair`,
    on_key_down,
    unpin,
    live_message = ``,
    empty = false,
    header_controls,
    export_sources = {},
    export_formats,
    export_filename,
    on_export,
    controls_toggle_props,
    controls,
    user_content,
    layers,
    overlays,
    children,
    ...rest
  }: Props = $props()

  const pan_zoom = $derived(frame.pan_zoom)
  // An explicit aria-label wins; otherwise the title, then `X label vs Y label`, then the fallback
  const svg_aria_label = $derived(
    aria_label_override ??
      (frame.title_config?.text ||
        [frame.axes.x.label, frame.axes.y.label].filter(Boolean).join(` vs `) ||
        aria_label),
  )

  const css_vars = $derived(
    Object.entries(css_var_defaults(css_prefix))
      .map(([key, fallback]) => {
        const value = css_var_fallbacks[key] ?? fallback
        return `--plot-frame-${key}: var(--${css_prefix}-${key}${value ? `, ${value}` : ``});`
      })
      .join(` `),
  )

  // Container measured by bind:clientWidth/Height; 0 until the first layout pass
  const measured = $derived(Boolean(frame.width && frame.height))
  const dims = $derived({ width: frame.width, height: frame.height, fullscreen })
  const content_ctx = $derived<UserContentProps>({
    ...dims,
    x_scale_fn: frame.scales.x,
    x2_scale_fn: frame.scales.x2,
    y_scale_fn: frame.scales.y,
    y2_scale_fn: frame.scales.y2,
    pad: frame.pad,
    x_range: frame.ranges.current.x,
    x2_range: frame.ranges.current.x2,
    y_range: frame.ranges.current.y,
    y2_range: frame.ranges.current.y2,
  })
  const title_pad = $derived(frame.effective_base_pad)
  const get_marginal_axis = (axis: MarginalAxisBinding): MarginalAxis =>
    marginal_axis(
      frame.scales[axis],
      frame.ranges.current[axis],
      frame.axes[axis],
      marginal_tick_label[axis],
    )
  const marginal_axes = $derived({
    x: get_marginal_axis(`x`),
    x2: get_marginal_axis(`x2`),
    y: get_marginal_axis(`y`),
    y2: get_marginal_axis(`y2`),
  })

  onDestroy(() => pan_zoom.destroy())
</script>

<svelte:window
  onkeydown={pan_zoom.on_window_key_down}
  onkeyup={pan_zoom.on_window_key_up}
  onblur={pan_zoom.on_window_blur}
/>

<div
  bind:this={wrapper}
  bind:clientWidth={frame.width}
  bind:clientHeight={frame.height}
  {...rest}
  class={[plot_class, `plot-frame`, rest.class, { fullscreen }]}
  style={`${css_vars} ${rest.style ?? ``}`}
  {@attach viewer_keys(() => ({ Escape: () => unpin?.() ?? false }))}
>
  {#if measured}
    <ChartHeaderControls
      {dims}
      bind:fullscreen
      {wrapper}
      {css_prefix}
      {fullscreen_toggle}
      {show_controls}
      {controls_toggle_props}
      {header_controls}
      export_pane={{
        sources: { ...svg_sources(() => frame.svg_element), ...export_sources },
        export_formats,
        on_export,
        filename: export_filename ?? chart_export_filename(frame),
      }}
      {controls}
    />
  {/if}
  {#if !require_size || measured}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <svg
      bind:this={frame.svg_element}
      role="application"
      aria-label={svg_aria_label}
      tabindex="0"
      onfocusin={() => pan_zoom.set_focused(true)}
      onfocusout={() => pan_zoom.set_focused(false)}
      onmousedown={pan_zoom.on_mouse_down}
      ondblclick={pan_zoom.reset_view}
      onkeydown={(event) =>
        (event.key === `Escape` && unpin?.()) ||
        on_key_down?.(event) ||
        pan_zoom.on_key_down(event)}
      onmouseenter={on_mouse_enter}
      onmouseleave={on_mouse_leave}
      onmousemove={on_mouse_move}
      onclick={(event) => {
        const { suppress_click, drag_start, is_panning } = pan_zoom
        if (event.detail <= 1 && !suppress_click && !drag_start && !is_panning)
          on_mouse_click?.(event)
      }}
      onwheel={pan_zoom.on_wheel}
      {@attach (svg: SVGSVGElement) =>
        on(svg, `touchstart`, pan_zoom.on_touch_start as EventListener, { passive: false })}
      {@attach (svg: SVGSVGElement) =>
        on(svg, `touchmove`, pan_zoom.on_touch_move as EventListener, { passive: false })}
      ontouchend={pan_zoom.on_touch_end}
      ontouchcancel={pan_zoom.on_touch_end}
      style:cursor={pan_zoom.cursor ?? idle_cursor}
    >
      <!-- An outer top marginal strip sits at the container edge, so the title moves below it -->
      <PlotTitle
        config={frame.title_config}
        x={title_pad.l}
        y={frame.decoration_solution.pad.t -
          title_pad.t +
          outer_strip_reservation(marginals.top, frame.has_x2)}
        width={Math.max(0, frame.width - title_pad.l - title_pad.r)}
      />
      <!-- Clip path for the chart area, shared by marks and reference lines -->
      <defs>
        <clipPath id={frame.clip_path_id}>
          <rect
            x={frame.pad.l}
            y={frame.pad.t}
            width={frame.chart_width}
            height={frame.chart_height}
          />
        </clipPath>
      </defs>

      {@render user_content?.(content_ctx)}
      {@render layers?.()}

      <!-- After the marks so the drag rect stays visible over dense points and canvases -->
      <ZoomRect
        start={pan_zoom.drag_start}
        current={pan_zoom.drag_current}
        mode={pan_zoom.drag_mode}
      />

      <PlotMarginals
        {marginals}
        series={marginal_series}
        width={frame.width}
        height={frame.height}
        pad={frame.pad}
        outer_pad={frame.outside_pad}
        has_axis={marginal_axis_presence(frame.has_x2, frame.has_y2)}
        axes={marginal_axes}
        id={frame.clip_path_id}
      />
    </svg>

    {@render overlays?.()}
    {#if empty}<EmptyState overlay />{/if}
  {/if}

  <!-- Where a keyboard cursor landed, for marks with no focusable element of their own -->
  <LiveMessage message={live_message} />

  {@render children?.(content_ctx)}
</div>

<style>
  .plot-frame {
    position: relative;
    width: var(--plot-frame-width);
    height: var(--plot-frame-height);
    min-height: var(--plot-frame-min-height);
    container-type: size; /* enable cqh for panes if explicit height is set */
    z-index: var(--plot-frame-z-index);
    flex: var(--plot-frame-flex);
    display: var(--plot-frame-display);
    flex-direction: column;
    background: var(--plot-frame-bg);
    border-radius: var(--plot-frame-border-radius);
  }
  .plot-frame.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    /* Must be higher than Structure.svelte's --struct-buttons-z-index. */
    z-index: var(--plot-frame-fullscreen-z-index);
    margin: 0;
    border-radius: 0;
    background: var(--plot-frame-fullscreen-bg);
    max-height: none !important;
    overflow: hidden;
    /* border-top (not padding-top): bind:clientHeight includes padding but excludes
    borders - padding made the chart overflow + clip its bottom 2em (x-axis title) */
    border-top: var(--plot-fullscreen-padding-top, 2em) solid var(--plot-frame-fullscreen-bg);
    box-sizing: border-box;
  }
  .plot-frame.dragover {
    border: var(--plot-frame-dragover-border);
    background-color: var(--plot-frame-dragover-bg);
  }
  svg {
    width: var(--plot-frame-svg-width);
    height: var(--plot-frame-svg-height);
    max-height: var(--plot-frame-svg-max-height);
    flex: var(--plot-frame-svg-flex);
    overflow: var(--plot-frame-svg-overflow);
    fill: var(--text-color);
    font-weight: var(--plot-frame-font-weight);
    font-size: var(--plot-frame-font-size);
  }
</style>
