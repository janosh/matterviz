<script lang="ts" module>
  // Live size and fullscreen state passed to header_controls/children snippets
  export type Dims = { height: number; width: number; fullscreen: boolean }
</script>

<script lang="ts">
  import {
    normalize_show_controls,
    shows_fullscreen_toggle,
    type ShowControlsProp,
  } from '#lib/controls.js'
  import { FullscreenButton } from '#lib/layout/index.js'
  import type { PaneToggleProps } from '#lib/overlays/index.js'
  import type { Snippet } from 'svelte'

  // Hover-revealed header row of ChartShell and CartesianFrame (caller buttons, controls-pane
  // toggle, fullscreen button). Must be a direct child of the wrapper whose hover reveals it.
  let {
    dims,
    fullscreen = $bindable(false),
    wrapper,
    css_prefix,
    fullscreen_toggle,
    show_controls,
    corner = false,
    chrome_color,
    controls_toggle_props,
    header_controls,
    controls,
  }: {
    dims: Dims
    fullscreen?: boolean
    wrapper?: HTMLDivElement
    css_prefix: string
    fullscreen_toggle: boolean
    show_controls: ShowControlsProp<`controls` | `fullscreen`>
    // Tucked into the corner with tighter spacing (ChartShell), buttons taking chrome_color
    corner?: boolean
    chrome_color?: string
    controls_toggle_props?: PaneToggleProps
    header_controls?: Snippet<[Dims]>
    // The controls pane receives layout props and visibility; this row owns mode and style.
    controls?: Snippet<[PaneToggleProps, boolean]>
  } = $props()

  const controls_config = $derived(normalize_show_controls(show_controls))
  const show_toggle = $derived(shows_fullscreen_toggle(fullscreen_toggle, controls_config))
  // ControlPane positions its toggle absolutely by default; static joins the header flex row
  const toggle_props = $derived({
    ...controls_toggle_props,
    style: `position: static; ${controls_toggle_props?.style ?? ``}`,
  })
</script>

<div
  class={[`header-controls`, controls_config.class, { corner }]}
  style={controls_config.style}
  style:--chart-chrome-color={chrome_color}
>
  {#if controls_config.mode !== `never`}
    {@render header_controls?.(dims)}
  {/if}
  {@render controls?.(toggle_props, controls_config.visible(`controls`))}
  {#if fullscreen || show_toggle}
    <FullscreenButton
      bind:fullscreen
      hidden={!show_toggle}
      {wrapper}
      bg_css_var="--{css_prefix}-fullscreen-bg"
    />
  {/if}
</div>

<style>
  .header-controls {
    --icon-size: var(--ctrl-btn-icon-size, 1rem);
    position: absolute;
    top: var(--viewer-buttons-top, var(--ctrl-btn-top, 1ex));
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
  /* in the corner the chrome floats over the chart, not across cell boundaries and labels */
  .header-controls.corner {
    top: var(--ctrl-btn-top, 2px);
    right: var(--fullscreen-btn-right, 2px);
    gap: var(--chart-chrome-gap, 3px);
  }
  /* on the buttons, not the row: <button> doesn't inherit `color`, and the controls pane
     (also a child of this row) must keep its own colors */
  .header-controls.corner > :global(button) {
    color: var(--chart-chrome-color, inherit);
  }
  /* lifted while its pane is open, else a chart further down paints over a dragged pane */
  .header-controls:has(:global(.draggable-pane.pane-open)) {
    z-index: var(--z-index-viewer-pane-open, 12);
  }
  .header-controls.always-visible,
  :global(:hover) > .header-controls,
  .header-controls:focus-within,
  .header-controls:has(:global(.pane-open)),
  .header-controls:has(:global([aria-expanded='true'])) {
    opacity: 1;
  }
  /* touch screens have no hover to reveal it */
  @media (hover: none) {
    .header-controls.hover-visible {
      opacity: 1;
    }
  }
</style>
