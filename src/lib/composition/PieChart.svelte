<script lang="ts">
  import { annular_sector_path } from '#lib/plot/sunburst/render.js'
  import { hover_tooltip } from '#lib/tooltip/hover.svelte.js'
  import PatternDefs from '#lib/plot/core/components/PatternDefs.svelte'
  import type { CompositionChartProps } from './chart'
  import { composition_segments, fit_font_scale, segment_suffix, segment_title } from './chart'
  import SegmentLabel from './SegmentLabel.svelte'
  import SegmentTooltip from './SegmentTooltip.svelte'

  // label placement tiers by slice angle (degrees)
  const THIN_SLICE = 20 // label outside the pie
  const MEDIUM_SLICE = 90 // label near the outer edge
  const FULL_SCALE_ANGLE = 120 // slices at least this wide get the max font scale

  let {
    composition,
    size = 200,
    stroke_width = 0.5,
    inner_radius = 0,
    show_labels = true,
    show_percentages = false,
    show_amounts = true,
    color_scheme = `Vesta`,
    patterns = {},
    svg_node = $bindable(null),
    ...rest
  }: CompositionChartProps & {
    stroke_width?: number
    inner_radius?: number
  } = $props()

  const uid = $props.id()
  const pattern_uid = `pie-${uid}`

  let label_opts = $derived({ show_amounts, show_percentages })
  let center = $derived(size / 2)
  let outer_radius = $derived(size / 2 - stroke_width)
  let ring_inner = $derived(Math.min(inner_radius, outer_radius - 10))

  // Angles are radians clockwise from 12 o'clock, as annular_sector_path draws them
  const polar = (radius: number, angle: number): [number, number] => [
    center + radius * Math.sin(angle),
    center - radius * Math.cos(angle),
  ]

  let segments = $derived.by(() => {
    let angle = 0
    const raw_segments = composition_segments(composition, color_scheme, patterns, pattern_uid)
    return raw_segments.map((segment) => {
      const label = segment.element + segment_suffix(segment, label_opts)
      const [start, end] = [angle, angle + segment.fraction * 2 * Math.PI]
      angle = end
      // centered on the origin, the <path> translates it to the chart center
      const path = annular_sector_path(start, end, Math.max(0, ring_inner), outer_radius)
      if (segment.fraction === 1) {
        const font_scale = fit_font_scale(2.6, label.length, outer_radius * 2)
        return { ...segment, path, label_x: center, label_y: center, font_scale }
      }
      const span = segment.fraction * 360 // degrees
      const outside = span < THIN_SLICE
      const label_radius = outside
        ? outer_radius * 1.2
        : span < MEDIUM_SLICE
          ? ring_inner + (outer_radius - ring_inner) * 0.7
          : (outer_radius + ring_inner) / 2
      const [label_x, label_y] = polar(label_radius, (start + end) / 2)
      // font grows with slice angle, then shrinks to fit radial/arc space at the label radius
      const base_scale = 1.4 + Math.min(span / FULL_SCALE_ANGLE, 1) * 0.6
      const available = outside
        ? outer_radius * 0.8
        : Math.min(outer_radius - ring_inner, (end - start) * label_radius * 0.8)
      return {
        ...segment,
        path,
        label_x,
        label_y,
        font_scale: fit_font_scale(base_scale, label.length, available),
        text_color: outside ? `var(--text-color, #333)` : segment.text_color,
      }
    })
  })
</script>

<svg
  viewBox="0 0 {size} {size}"
  style:max-width="{size}px"
  {...rest}
  class={[`pie-chart`, rest.class]}
  bind:this={svg_node}
>
  <defs><PatternDefs patterns={segments.map((seg) => seg.pattern)} /></defs>
  {#each segments as segment (segment.element)}
    {#snippet segment_tooltip()}
      <SegmentTooltip {segment} />
    {/snippet}
    <path
      d={segment.path}
      transform="translate({center} {center})"
      fill={segment.pattern?.url ?? segment.color}
      stroke="white"
      role="img"
      aria-label={segment_title(segment)}
      {@attach hover_tooltip(segment_tooltip, () => segment.color)}
      stroke-width={segments.length === 1 ? 0 : stroke_width}
      class="pie-segment"
    />
  {/each}

  {#if show_labels}
    {#each segments as segment (segment.element)}
      <SegmentLabel
        x={segment.label_x}
        y={segment.label_y}
        {segment}
        font_scale={segment.font_scale}
        {label_opts}
      />
    {/each}
  {/if}
</svg>

<style>
  svg {
    /* thin slices place their labels outside the pie at 1.2x the outer radius, past the
    square viewBox - the default svg overflow: hidden would clip them */
    overflow: visible;
  }
  .pie-segment {
    transition: all 0.2s ease;
  }
  .pie-segment:is(:hover, [data-pinned]) {
    filter: brightness(1.1);
  }
</style>
