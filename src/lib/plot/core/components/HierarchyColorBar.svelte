<script lang="ts">
  // Shared hierarchy color bar. Positioning and measurement attach to ColorBar's root;
  // `css_prefix` selects the chart's CSS variable namespace.
  import type { D3InterpolateName } from '$lib/colors'
  import type { Vec2 } from '$lib/math'
  import ColorBar from '$lib/plot/core/components/ColorBar.svelte'
  import {
    COLOR_BAR_GAP,
    type ColorBarLayout,
    observe_size,
  } from '$lib/plot/core/utils/hierarchy-chart'
  import type { ComponentProps } from 'svelte'

  let {
    color_bar,
    color_scale,
    range,
    layout,
    css_prefix,
    on_measure,
  }: {
    color_bar: ComponentProps<typeof ColorBar>
    color_scale: D3InterpolateName
    range: Vec2
    layout: ColorBarLayout
    css_prefix: string
    on_measure: (size: { width: number; height: number }) => void
  } = $props()

  const position_style = $derived(
    layout.is_vertical
      ? `position: absolute; top: var(--${css_prefix}-colorbar-top, 50%); ${layout.side}: var(--${css_prefix}-colorbar-${layout.side}, ${layout.offset_px}px); transform: var(--${css_prefix}-colorbar-transform, translateY(-50%)); width: var(--${css_prefix}-colorbar-width, auto); min-width: var(--${css_prefix}-colorbar-min-width, 0); pointer-events: auto;`
      : `position: absolute; bottom: var(--${css_prefix}-colorbar-bottom, ${COLOR_BAR_GAP}px); left: var(--${css_prefix}-colorbar-left, 50%); transform: var(--${css_prefix}-colorbar-transform, translateX(-50%)); width: var(--${css_prefix}-colorbar-width, 40%); min-width: 120px; pointer-events: auto;`,
  )
</script>

<ColorBar
  scale={color_scale}
  {range}
  {...color_bar}
  tick_side={layout.tick_side}
  wrapper_style="{layout.is_vertical
    ? `--cbar-height: var(--${css_prefix}-colorbar-height, 150px); --cbar-padding: ${layout.tick_padding};`
    : ``} {color_bar.wrapper_style ?? ``}"
  style="{position_style} {color_bar.style ?? ``}"
  {@attach observe_size(on_measure)}
/>
