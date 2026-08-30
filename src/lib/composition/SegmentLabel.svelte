<!-- Element symbol with an amount/percentage subscript, centered on (x, y) inside a chart
SVG. Plain SVG text (no foreignObject) so the label survives SVG and PNG export. -->
<script lang="ts">
  import { type ChartLabelOptions, type ChartSegment, segment_suffix } from './chart'

  let {
    x,
    y,
    segment,
    font_scale,
    text_color,
    label_opts,
  }: {
    x: number
    y: number
    segment: ChartSegment
    font_scale: number
    text_color: string
    label_opts: ChartLabelOptions
  } = $props()

  const suffix = $derived(segment_suffix(segment, label_opts))
</script>

<text {x} {y} text-anchor="middle" dominant-baseline="central" style:fill={text_color}>
  <tspan style:font-size="{14 * font_scale}px" font-weight="700">{segment.element}</tspan>
  {#if suffix}
    <tspan style:font-size="{8 * font_scale}px" font-weight="500" dx="1" dy="5">{suffix}</tspan
    >
  {/if}
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
