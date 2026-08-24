<script lang="ts">
  // Outer shell shared by the non-Cartesian charts (Sankey, ScatterPlot3D, Sunburst,
  // Treemap): the measured wrapper div, fullscreen mode and the hover-revealed header row
  // (caller buttons, controls-pane toggle, fullscreen button). Exposes the same public CSS
  // knobs as CartesianFrame (`--<prefix>-width`, `--<prefix>-bg`, `--<prefix>-fullscreen-bg`,
  // …) so every chart is themed the same way.
  import { FullscreenButton } from '$lib/layout'
  import type { PaneToggleProps } from '$lib/overlays'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // Public CSS knobs mapped onto the shell's own variables, with the defaults every chart shares
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
  })

  type Dims = { height: number; width: number; fullscreen: boolean }

  let {
    chart_class,
    css_prefix,
    css_var_fallbacks = {},
    wrapper = $bindable(),
    width = $bindable(0),
    height = $bindable(0),
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    controls_toggle_props,
    header_controls,
    controls,
    body,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    // Wrapper class the chart is selected by (`sankey`, `treemap`)
    chart_class: string
    // Prefix of this chart's public CSS variables (`sankey`, `scatter3d`)
    css_prefix: string
    // Per-chart fallbacks for css_var_defaults entries whose default differs
    css_var_fallbacks?: Record<string, string>
    wrapper?: HTMLDivElement
    // Measured container size, 0 until the first layout pass
    width?: number
    height?: number
    fullscreen?: boolean
    fullscreen_toggle?: boolean
    controls_toggle_props?: PaneToggleProps
    header_controls?: Snippet<[Dims]>
    // The controls pane; receives the toggle props that seat its toggle in the header row
    controls?: Snippet<[PaneToggleProps]>
    // Chart content, rendered once the container is measured
    body: Snippet
    children?: Snippet<[Dims]>
  } = $props()

  const css_vars = $derived(
    Object.entries(css_var_defaults(css_prefix))
      .map(
        ([key, fallback]) =>
          `--chart-shell-${key}: var(--${css_prefix}-${key}, ${css_var_fallbacks[key] ?? fallback});`,
      )
      .join(` `),
  )
  const dims = $derived({ width, height, fullscreen })
  // ControlPane positions its toggle absolutely by default; static joins the header flex row
  const toggle_props = $derived({
    ...controls_toggle_props,
    style: `position: static; ${controls_toggle_props?.style ?? ``}`,
  })
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
    <div class="header-controls">
      {@render header_controls?.(dims)}
      {@render controls?.(toggle_props)}
      {#if fullscreen_toggle}
        <FullscreenButton
          bind:fullscreen
          {wrapper}
          bg_css_var="--{css_prefix}-fullscreen-bg"
        />
      {/if}
    </div>
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
  .header-controls {
    position: absolute;
    top: var(--ctrl-btn-top, 5pt);
    right: var(--fullscreen-btn-right, 4px);
    z-index: var(--fullscreen-btn-z-index, 10);
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  /* revealed on hover, while focused, and while the controls pane is open */
  .chart-shell:hover .header-controls,
  .header-controls:focus-within,
  .header-controls:has(:global([aria-expanded='true'])) {
    opacity: 1;
  }
</style>
