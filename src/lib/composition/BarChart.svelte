<script lang="ts">
  import type { ColorSchemeName } from '$lib/colors'
  import type { CompositionType } from '$lib/composition'
  import { clamp } from '$lib/math'
  import PatternDefs from '$lib/plot/core/components/PatternDefs.svelte'
  import type { SVGAttributes } from 'svelte/elements'
  import type { ChartSegment, ElementPatterns } from './chart'
  import { composition_segments, fit_font_scale, segment_suffix, segment_title } from './chart'

  const LABEL_HEIGHT = 20 // px rows above and below the bar for external labels
  const GAP = 2 // px between bar and label rows
  const MIN_LABEL_WIDTH = 15 // px: narrower segments get no label at all
  const THIN_FRACTION = 0.2 // segments below this fraction get an external label
  const MIN_EXTERNAL_WIDTH = 5 // px: even external labels need a segment this wide to point at

  type BarSegment = ChartSegment & {
    x: number
    width: number
    font_scale: number
    label_pos: `inside` | `above` | `below` | null
  }

  let {
    composition,
    size = 200,
    bar_height = 30,
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
    bar_height?: number
    show_labels?: boolean
    show_percentages?: boolean
    show_amounts?: boolean
    color_scheme?: ColorSchemeName
    patterns?: ElementPatterns // hatch/texture fill per element symbol
    svg_node?: SVGSVGElement | null
  } = $props()

  const uid = $props.id()
  const clip_path_id = `bar-clip-${uid}`
  const pattern_uid = `bar-${uid}`

  let label_opts = $derived({ show_amounts, show_percentages })
  const bar_y = LABEL_HEIGHT + GAP
  let svg_height = $derived(bar_y + bar_height + GAP + LABEL_HEIGHT)
  let label_y = $derived({
    inside: bar_y + bar_height / 2,
    above: LABEL_HEIGHT / 2,
    below: bar_y + bar_height + GAP + LABEL_HEIGHT / 2,
  })

  let segments = $derived.by((): BarSegment[] => {
    let [cursor, n_above, n_below] = [0, 0, 0]
    const raw_segments = composition_segments(composition, color_scheme, patterns, pattern_uid)
    return raw_segments.map((segment) => {
      const width = segment.fraction * size
      const x = cursor
      cursor += width
      const label = segment.element + segment_suffix(segment, label_opts)
      const base_scale = clamp(width / 40, 1, 2)
      const font_scale = fit_font_scale(base_scale, label.length, width * 0.9, 0.6, 12)
      // thin segments get external labels, alternating above/below to avoid overlap
      let label_pos: BarSegment[`label_pos`] = null
      if (segment.fraction < THIN_FRACTION) {
        if (width >= MIN_EXTERNAL_WIDTH) {
          label_pos = n_above <= n_below ? `above` : `below`
          if (label_pos === `above`) n_above++
          else n_below++
        }
      } else if (width >= MIN_LABEL_WIDTH) label_pos = `inside`
      return { ...segment, x, width, font_scale, label_pos }
    })
  })
</script>

<svg
  viewBox="0 0 {size} {svg_height}"
  {...rest}
  class={[`bar-chart`, rest.class]}
  style:max-width="{size}px"
  bind:this={svg_node}
>
  <defs>
    <clipPath id={clip_path_id}>
      <rect x="0" y={bar_y} width={size} height={bar_height} rx="2" ry="2" />
    </clipPath>
    <PatternDefs patterns={segments.map((seg) => seg.pattern)} />
  </defs>
  <rect
    x="0"
    y={bar_y}
    width={size}
    height={bar_height}
    fill="var(--bar-bg)"
    stroke="var(--bar-border, none)"
  />
  <g clip-path="url(#{clip_path_id})">
    {#each segments as segment (segment.element)}
      <rect
        x={segment.x}
        y={bar_y}
        width={segment.width}
        height={bar_height}
        fill={segment.pattern?.url ?? segment.color}
        stroke="white"
        role="img"
        aria-label={segment_title(segment)}
        stroke-width="1"
        class="bar-segment"
      >
        <title>{segment_title(segment)}</title>
      </rect>
    {/each}
  </g>

  {#if show_labels}
    {#each segments as segment (segment.element)}
      {#if segment.label_pos}
        {@const inside = segment.label_pos === `inside`}
        <text
          x={segment.x + segment.width / 2}
          y={label_y[segment.label_pos]}
          text-anchor="middle"
          dominant-baseline={!inside
            ? undefined
            : show_amounts || show_percentages
              ? `middle`
              : `central`}
          class={inside ? `bar-label` : `external-label`}
          style:fill={inside ? segment.text_color : segment.color}
        >
          <tspan class="element-symbol" style:font-size="{10 * segment.font_scale}px">
            {segment.element}
          </tspan>
          {#if show_amounts || show_percentages}
            <tspan class="amount" style:font-size="{6.5 * segment.font_scale}px" dx="1" dy="5">
              {segment_suffix(segment, label_opts)}
            </tspan>
          {/if}
        </text>
      {/if}
    {/each}
  {/if}
</svg>

<style>
  .bar-chart {
    display: inline-block;
    --bar-bg: light-dark(#fff, #333);
  }
  .bar-segment {
    transition: all 0.2s ease;
  }
  .bar-segment:hover {
    filter: brightness(1.1);
  }
  text {
    pointer-events: none;
  }
  /* WebKit doesn't inherit dominant-baseline from <text> to <tspan> */
  tspan {
    dominant-baseline: inherit;
  }
  .element-symbol {
    font-weight: 700;
  }
  .amount {
    font-weight: 500;
  }
</style>
