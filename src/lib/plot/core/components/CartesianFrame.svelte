<script lang="ts">
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import type { CartesianFrame, FrameAxis } from '$lib/plot/core/cartesian-frame.svelte'
  import {
    marginal_axis,
    marginal_axis_presence,
    type MarginalAxis,
    type MarginalAxisBinding,
    type MarginalSeriesInput,
    type ResolvedMarginals,
  } from '$lib/plot/core/marginals'
  import PlotMarginals from '$lib/plot/core/components/PlotMarginals.svelte'
  import PlotTitle from '$lib/plot/core/components/PlotTitle.svelte'
  import ZoomRect from '$lib/plot/core/components/ZoomRect.svelte'
  import type { Snippet } from 'svelte'
  import { onDestroy } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // Public CSS knobs every Cartesian chart exposes, mapped onto the frame's own
  // variables so the shell can be styled per chart (`--histogram-bg`, `--barplot-bg`, …)
  // without duplicating this stylesheet three times. Values are the historical defaults.
  const css_var_defaults = (prefix: string): Record<string, string> => ({
    width: `100%`,
    height: `auto`,
    'min-height': `300px`,
    'z-index': `auto`,
    flex: `1`,
    display: `flex`,
    bg: `var(--plot-bg)`,
    'border-radius': `0`,
    'fullscreen-z-index': `var(--z-index-overlay-nav, 100000001)`,
    'fullscreen-bg': `var(--${prefix}-bg, var(--plot-bg, transparent))`,
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

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, `title` | `children`> {
    frame: CartesianFrame
    // Wrapper class the chart is selected by (`histogram`, `bar-plot`, `box-plot`)
    plot_class: string
    // Prefix of this chart's public CSS variables (`histogram`, `barplot`, `boxplot`)
    css_prefix: string
    // Per-chart fallbacks for CSS_VAR_DEFAULTS entries whose default differs
    css_var_fallbacks?: Record<string, string>
    aria_label: string
    fullscreen?: boolean
    fullscreen_toggle?: boolean
    // Charts that render their SVG before the container is measured (Histogram)
    require_size?: boolean
    marginals: ResolvedMarginals
    marginal_series: MarginalSeriesInput[]
    marginal_tick_label?: Partial<Record<MarginalAxisBinding, (pos: number) => string>>
    on_mouse_enter?: () => void
    on_mouse_leave?: () => void
    header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
    // Marks, axes, zero lines and reference lines, in the chart's own paint order
    layers?: Snippet
    // Legend, tooltip and controls pane, rendered after the SVG
    overlays?: Snippet
    children?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
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
    require_size = true,
    marginals,
    marginal_series,
    marginal_tick_label = {},
    on_mouse_enter,
    on_mouse_leave,
    header_controls,
    layers,
    overlays,
    children,
    ...rest
  }: Props = $props()

  let wrapper: HTMLDivElement | undefined = $state()
  const pan_zoom = $derived(frame.pan_zoom)

  const css_vars = $derived(
    Object.entries(css_var_defaults(css_prefix))
      .map(([key, fallback]) => {
        const value = css_var_fallbacks[key] ?? fallback
        return `--plot-frame-${key}: var(--${css_prefix}-${key}${value ? `, ${value}` : ``});`
      })
      .join(` `),
  )

  const dims = $derived({ width: frame.width, height: frame.height, fullscreen })
  const title_pad = $derived(frame.effective_base_pad)
  const get_marginal_axis = (axis: FrameAxis, binding: MarginalAxisBinding): MarginalAxis =>
    marginal_axis(
      frame.scales[axis],
      frame.ranges.current[axis],
      frame.axes[axis],
      marginal_tick_label[binding],
    )
  const marginal_axes = $derived({
    x1: get_marginal_axis(`x`, `x1`),
    x2: get_marginal_axis(`x2`, `x2`),
    y1: get_marginal_axis(`y`, `y1`),
    y2: get_marginal_axis(`y2`, `y2`),
  })

  // Theme-aware background when entering fullscreen
  $effect(() => set_fullscreen_bg(wrapper, fullscreen, `--${css_prefix}-fullscreen-bg`))
  onDestroy(() => pan_zoom.destroy())
</script>

<svelte:window
  onkeydown={(evt) => {
    if (evt.key === `Escape` && fullscreen) {
      evt.preventDefault()
      fullscreen = false
    }
    pan_zoom.on_window_key_down(evt)
  }}
  onkeyup={pan_zoom.on_window_key_up}
  onblur={pan_zoom.on_window_blur}
/>

<div
  bind:this={wrapper}
  bind:clientWidth={frame.width}
  bind:clientHeight={frame.height}
  {...rest}
  class={[plot_class, `plot-frame`, rest.class]}
  class:fullscreen
  style={`${css_vars} ${rest.style ?? ``}`}
>
  {#if frame.width && frame.height}
    <div class="header-controls">
      {@render header_controls?.(dims)}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
  {/if}
  {#if !require_size || (frame.width && frame.height)}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <svg
      bind:this={frame.svg_element}
      role="application"
      aria-label={aria_label_override ?? aria_label}
      tabindex="0"
      onfocusin={() => pan_zoom.set_focused(true)}
      onfocusout={() => pan_zoom.set_focused(false)}
      onmousedown={pan_zoom.on_mouse_down}
      ondblclick={pan_zoom.reset_view}
      onkeydown={pan_zoom.on_key_down}
      onmouseenter={on_mouse_enter}
      onmouseleave={on_mouse_leave}
      onwheel={pan_zoom.on_wheel}
      ontouchstart={pan_zoom.on_touch_start}
      ontouchmove={pan_zoom.on_touch_move}
      ontouchend={pan_zoom.on_touch_end}
      ontouchcancel={pan_zoom.on_touch_end}
      style:cursor={pan_zoom.cursor}
    >
      <PlotTitle
        config={frame.title_config}
        x={title_pad.l}
        y={frame.decoration_solution.pad.t - title_pad.t}
        width={Math.max(0, frame.width - title_pad.l - title_pad.r)}
      />
      <ZoomRect start={pan_zoom.drag_start} current={pan_zoom.drag_current} />

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

      {@render layers?.()}

      <!-- Marginal distribution strips -->
      <PlotMarginals
        {marginals}
        series={marginal_series}
        width={frame.width}
        height={frame.height}
        pad={frame.pad}
        has_axis={marginal_axis_presence(frame.has_x2, frame.has_y2)}
        axes={marginal_axes}
        id={frame.clip_path_id}
      />
    </svg>

    {@render overlays?.()}
  {/if}

  <!-- User-provided children (e.g. for custom absolutely-positioned overlays) -->
  {@render children?.(dims)}
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
  .header-controls {
    position: absolute;
    top: var(--ctrl-btn-top, 5pt);
    right: var(--fullscreen-btn-right, 4px);
    z-index: var(--fullscreen-btn-z-index, 10);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .header-controls :global(.fullscreen-toggle) {
    position: static; /* Override absolute positioning since container handles it */
    opacity: 1; /* Always visible when inside header-controls, container controls visibility */
  }
  /* Hide controls and fullscreen toggles by default, show on hover */
  .plot-frame :global(.pane-toggle),
  .plot-frame .header-controls {
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  .plot-frame:hover :global(.pane-toggle),
  .plot-frame:hover .header-controls,
  .plot-frame :global(.pane-toggle:focus-visible),
  .plot-frame :global(.pane-toggle[aria-expanded='true']),
  .plot-frame .header-controls:focus-within {
    opacity: 1;
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
