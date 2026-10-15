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
  // Outer shell shared by the non-Cartesian charts (Sankey, ScatterPlot3D, Sunburst,
  // TernaryPlot, Treemap): the measured wrapper div, fullscreen mode and the hover-revealed header row
  // (caller buttons, controls-pane toggle, fullscreen button). Exposes the same public CSS
  // knobs as CartesianFrame (`--<prefix>-width`, `--<prefix>-bg`, `--<prefix>-fullscreen-bg`,
  // …) so every chart is themed the same way.
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
    show_controls = `hover`,
    chrome_color,
    controls_toggle_props,
    header_controls,
    export_sources = {},
    export_formats,
    export_filename = css_prefix,
    on_export,
    controls,
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
      // Color for the chrome icons, from whatever the chart paints under the top-right
      // corner. A prop, not a CSS var passed through `style`: charts spread the caller's
      // rest props after their own, so a `style` they set would be clobbered by any caller
      // that passes one - which every sized mount does.
      chrome_color?: string
      controls_toggle_props?: PaneToggleProps
      header_controls?: Snippet<[Dims]>
      // What the chart can export (its figure and data), offered in the header's export pane
      export_sources?: ExportSources
      // The controls pane receives layout props and visibility; this row owns mode and style.
      controls?: Snippet<[PaneToggleProps, boolean]>
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
  {/if}
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
