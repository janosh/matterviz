<!-- Element symbol with optional superscript charge and an amount/percentage subscript, centered on (x, y) inside a chart
SVG. Plain SVG text (no foreignObject) so the label survives SVG and PNG export. -->
<script lang="ts">
  import type { ChartLabelOptions, ChartSegment } from './chart'
  import { CHARGE_RISE_EM, segment_suffix, subscript_dy } from './chart'

  let {
    x: coord_x,
    y: coord_y,
    segment,
    font_scale,
    label_opts,
  }: {
    x: number
    y: number
    segment: ChartSegment
    font_scale: number
    label_opts: ChartLabelOptions
  } = $props()

  const suffix = $derived(segment_suffix(segment, label_opts))
</script>

<text
  x={coord_x}
  y={coord_y}
  text-anchor="middle"
  dominant-baseline="central"
  style:fill={segment.text_color}
>
  <!-- tspans abut: whitespace between them renders as a space before the subscript. Offsets
  are em of the small font, so they scale with it. dy accumulates: the subscript drops back
  past the charge's rise. -->
  <tspan style:font-size="{14 * font_scale}px" font-weight="500">{segment.element}</tspan
  >{#if segment.charge}<tspan
      style:font-size="{8 * font_scale}px"
      font-weight="500"
      dy="-{CHARGE_RISE_EM}em">{segment.charge}</tspan
    >{/if}{#if suffix}<tspan
      style:font-size="{8 * font_scale}px"
      font-weight="400"
      dx="0.1em"
      dy="{subscript_dy(segment)}em">{suffix}</tspan
    >{/if}
</text>

<style>
  text {
    pointer-events: none;
  }
  /* WebKit doesn't inherit dominant-baseline from <text> to <tspan> */
  tspan {
    dominant-baseline: inherit;
  }
</style>
