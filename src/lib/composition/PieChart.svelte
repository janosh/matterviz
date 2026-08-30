<script lang="ts">
  import type { ColorSchemeName } from '$lib/colors'
  import type { CompositionType } from '$lib/composition'
  import PatternDefs from '$lib/plot/core/components/PatternDefs.svelte'
  import type { SVGAttributes } from 'svelte/elements'
  import type { ElementPatterns } from './chart'
  import { composition_segments, fit_font_scale, segment_suffix, segment_title } from './chart'
  import SegmentLabel from './SegmentLabel.svelte'

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
  }: SVGAttributes<SVGSVGElement> & {
    composition: CompositionType
    size?: number
    stroke_width?: number
    inner_radius?: number
    show_labels?: boolean
    show_percentages?: boolean
    show_amounts?: boolean
    color_scheme?: ColorSchemeName
    patterns?: ElementPatterns // hatch/texture fill per element symbol
    svg_node?: SVGSVGElement | null
  } = $props()

  const uid = $props.id()
  const pattern_uid = `pie-${uid}`

  let label_opts = $derived({ show_amounts, show_percentages })
  let center = $derived(size / 2)
  let outer_radius = $derived(size / 2 - stroke_width)
  let ring_inner = $derived(Math.min(inner_radius, outer_radius - 10))

  const polar = (radius: number, angle_deg: number): [number, number] => {
    const rad = (angle_deg * Math.PI) / 180
    return [center + radius * Math.cos(rad), center + radius * Math.sin(rad)]
  }

  let segments = $derived.by(() => {
    let angle = -90 // start at 12 o'clock, sweep clockwise
    return composition_segments(composition, color_scheme, patterns, pattern_uid).map(
      (segment) => {
        const label = segment.element + segment_suffix(segment, label_opts)
        if (segment.fraction === 1) {
          // single element: two semicircles per ring (an SVG arc can't sweep a full 360°)
          const circle = (radius: number, sweep: 0 | 1) =>
            `M ${center} ${center - radius} A ${radius} ${radius} 0 1 ${sweep} ${center} ${center + radius} A ${radius} ${radius} 0 1 ${sweep} ${center} ${center - radius} Z`
          return {
            ...segment,
            path: circle(outer_radius, 1) + (ring_inner > 0 ? circle(ring_inner, 0) : ``),
            label_x: center,
            label_y: center,
            outside: false,
            font_scale: fit_font_scale(2.6, label.length, outer_radius * 2),
          }
        }
        const span = segment.fraction * 360
        const [start, end] = [angle, angle + span]
        angle = end
        const large_arc = span > 180 ? 1 : 0
        const [x1, y1] = polar(outer_radius, start)
        const [x2, y2] = polar(outer_radius, end)
        const outer_arc = `A ${outer_radius} ${outer_radius} 0 ${large_arc} 1 ${x2} ${y2}`
        let path: string
        if (ring_inner > 0) {
          const [x3, y3] = polar(ring_inner, end)
          const [x4, y4] = polar(ring_inner, start)
          path = `M ${x1} ${y1} ${outer_arc} L ${x3} ${y3} A ${ring_inner} ${ring_inner} 0 ${large_arc} 0 ${x4} ${y4} Z`
        } else path = `M ${center} ${center} L ${x1} ${y1} ${outer_arc} Z`

        const outside = span < THIN_SLICE
        const label_radius = outside
          ? outer_radius * 1.2
          : span < MEDIUM_SLICE
            ? outer_radius * 0.7
            : (outer_radius + ring_inner) / 2
        const [label_x, label_y] = polar(label_radius, (start + end) / 2)
        // font grows with slice angle, then shrinks to fit radial/arc space at the label radius
        const base_scale = 1.4 + Math.min(span / FULL_SCALE_ANGLE, 1) * 0.6
        const available = outside
          ? outer_radius * 0.8
          : Math.min(outer_radius - ring_inner, ((span * Math.PI) / 180) * label_radius * 0.8)
        return {
          ...segment,
          path,
          label_x,
          label_y,
          outside,
          font_scale: fit_font_scale(base_scale, label.length, available),
          text_color: outside ? `var(--text-color, #333)` : segment.text_color,
        }
      },
    )
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
    <path
      d={segment.path}
      fill={segment.pattern?.url ?? segment.color}
      stroke="white"
      role="img"
      aria-label={segment_title(segment)}
      stroke-width={segments.length === 1 ? 0 : stroke_width}
      class="pie-segment"
    >
      <title>{segment_title(segment)}</title>
    </path>
  {/each}

  {#if show_labels}
    {#each segments as segment (segment.element)}
      <SegmentLabel
        x={segment.label_x}
        y={segment.label_y}
        {segment}
        font_scale={segment.font_scale}
        text_color={segment.text_color}
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
  .pie-segment:hover {
    filter: brightness(1.1);
  }
</style>
