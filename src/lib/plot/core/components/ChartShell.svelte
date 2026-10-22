<script module lang="ts">
  // Public CSS knobs shared by Cartesian and non-Cartesian chart shells.
  export const chart_css_defaults = (prefix: string): Record<string, string> => ({
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
  })
</script>

<script lang="ts">
  import type { ShowControlsProp } from '#lib/controls.js'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import LiveMessage from 'svelte-widgets/LiveMessage.svelte'
  // Outer shell of the non-Cartesian charts: the measured wrapper div, fullscreen mode and the
  // hover-revealed header row. Exposes the same public CSS knobs as CartesianFrame
  // (`--<prefix>-width`, `--<prefix>-bg`, …) so every chart is themed the same way.
  import ChartHeaderControls from '#lib/plot/core/components/ChartHeaderControls.svelte'
  import type { Dims } from '#lib/plot/core/components/ChartHeaderControls.svelte'
  import type { PaneToggleProps } from '#lib/overlays/index.js'
  import type { ExportProps, ExportSources } from '#lib/io/export.js'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    chart_class,
    css_prefix,
    css_var_fallbacks = {},
    wrapper = $bindable(),
    width = $bindable(0),
    height = $bindable(0),
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    show_controls,
    chrome_color,
    controls_toggle_props,
    header_controls,
    export_sources = {},
    export_formats,
    export_filename = css_prefix,
    on_export,
    controls,
    empty = false,
    live_message = ``,
    body,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> &
    ExportProps & {
      // Wrapper class the chart is selected by (`sankey`, `treemap`)
      chart_class: string
      // Prefix of this chart's public CSS variables (`sankey`, `scatter3d`)
      css_prefix: string
      // Per-chart fallbacks for chart_css_defaults entries whose default differs
      css_var_fallbacks?: Record<string, string>
      wrapper?: HTMLDivElement
      // Measured container size, 0 until the first layout pass
      width?: number
      height?: number
      fullscreen?: boolean
      fullscreen_toggle?: boolean
      show_controls?: ShowControlsProp<`controls` | `fullscreen`>
      // Color for the chrome icons, from what the chart paints under the top-right corner. A
      // prop, not a CSS var in `style`: a caller's rest `style` would clobber that.
      chrome_color?: string
      controls_toggle_props?: PaneToggleProps
      header_controls?: Snippet<[Dims]>
      // What the chart can export (its figure and data), offered in the header's export pane
      export_sources?: ExportSources
      // The controls pane receives layout props and visibility; this row owns mode and style.
      controls?: Snippet<[PaneToggleProps, boolean]>
      // No data to plot: the body stays, overlaid with the shared empty-state message
      empty?: boolean
      // Announced to screen readers via a polite live region, e.g. where a keyboard cursor
      // over marks with no focusable element of their own landed
      live_message?: string
      // Chart content, rendered once the container is measured
      body: Snippet
      children?: Snippet<[Dims]>
    } = $props()

  const css_vars = $derived(
    Object.entries(chart_css_defaults(css_prefix))
      .map(
        ([key, fallback]) =>
          `--chart-shell-${key}: var(--${css_prefix}-${key}, ${css_var_fallbacks[key] ?? fallback});`,
      )
      .join(` `),
  )
  const dims = $derived({ width, height, fullscreen })
</script>

<div
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class={[chart_class, `chart-shell`, rest.class, { fullscreen }]}
  style={`${css_vars} ${rest.style ?? ``}`}
>
  {#if width && height}
    <ChartHeaderControls
      {dims}
      bind:fullscreen
      {wrapper}
      {css_prefix}
      {fullscreen_toggle}
      {show_controls}
      corner
      {chrome_color}
      {controls_toggle_props}
      {header_controls}
      export_pane={{
        sources: export_sources,
        export_formats,
        on_export,
        filename: export_filename,
      }}
      {controls}
    />
    {@render body()}
    {@render children?.(dims)}
    {#if empty}<EmptyState overlay />{/if}
  {/if}
  <LiveMessage message={live_message} />
</div>

<style>
  .chart-shell {
    position: relative;
    width: var(--chart-shell-width);
    height: var(--chart-shell-height);
    min-height: var(--chart-shell-min-height);
    container-type: size;
    z-index: var(--chart-shell-z-index);
    flex: var(--chart-shell-flex);
    display: var(--chart-shell-display);
    flex-direction: column;
    background: var(--chart-shell-bg);
    border-radius: var(--chart-shell-border-radius);
  }
  .chart-shell.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    z-index: var(--chart-shell-fullscreen-z-index);
    margin: 0;
    border-radius: 0;
    background: var(--chart-shell-fullscreen-bg);
    max-height: none !important;
    overflow: hidden;
    /* border-top (not padding-top): bind:clientHeight includes padding but excludes
    borders - padding made the chart overflow + clip its bottom 2em */
    border-top: var(--plot-fullscreen-padding-top, 2em) solid var(--chart-shell-fullscreen-bg);
    box-sizing: border-box;
  }
</style>
