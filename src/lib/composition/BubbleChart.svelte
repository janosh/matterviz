<script lang="ts">
  import type { ColorSchemeName } from '$lib/colors'
  import type { CompositionType } from '$lib/composition'
  import { hierarchy, pack } from 'd3-hierarchy'
  import PatternDefs from '$lib/plot/core/components/PatternDefs.svelte'
  import type { SVGAttributes } from 'svelte/elements'
  import type { ChartSegment, ElementPatterns } from './chart'
  import { composition_segments, fit_font_scale, segment_suffix, segment_title } from './chart'
  import SegmentLabel from './SegmentLabel.svelte'

  let {
    composition,
    size = 200,
    padding = 0,
    show_labels = true,
    show_amounts = true,
    show_percentages = false,
    color_scheme = `Vesta`,
    patterns = {},
    svg_node = $bindable(null),
    ...rest
  }: SVGAttributes<SVGSVGElement> & {
    composition: CompositionType
    size?: number
    padding?: number
    show_labels?: boolean
    show_amounts?: boolean
    show_percentages?: boolean
    color_scheme?: ColorSchemeName
    patterns?: ElementPatterns // hatch/texture fill per element symbol
    svg_node?: SVGSVGElement | null
  } = $props()

  const uid = $props.id()

  let label_opts = $derived({ show_amounts, show_percentages })

  // d3 circle packing: bubble area ∝ amount
  let bubbles = $derived.by(() => {
    const segments = composition_segments(composition, color_scheme, patterns, `bubble-${uid}`)
    if (segments.length === 0) return []
    const root = hierarchy<{ children: ChartSegment[] } | ChartSegment>({
      children: segments,
    }).sum((node) => (`amount` in node ? node.amount : 0))
    const inner_size = size - 2 * padding
    const leaves = pack<typeof root.data>()
      .size([inner_size, inner_size])
      .padding(padding * 0.1)(root)
      .leaves()
    // `|| 1` floors the divisor: size 0 or padding >= size / 2 packs every bubble at r = 0,
    // and 0 / 0 put a NaN font_scale into `font-size: NaNpx`
    const max_radius = Math.max(...leaves.map((leaf) => leaf.r)) || 1
    return leaves.map((leaf) => {
      const segment = leaf.data as ChartSegment
      const label = segment.element + segment_suffix(segment, label_opts)
      const base_scale = 0.6 + (leaf.r / max_radius) * 1.4
      return {
        ...segment,
        radius: leaf.r,
        x: leaf.x + padding,
        y: leaf.y + padding,
        font_scale: fit_font_scale(base_scale, label.length, leaf.r * 1.6),
      }
    })
  })
</script>

<svg
  viewBox="0 0 {size} {size}"
  style:max-width="{size}px"
  {...rest}
  class={[`bubble-chart`, rest.class]}
  bind:this={svg_node}
>
  <defs><PatternDefs patterns={bubbles.map((bubble) => bubble.pattern)} /></defs>
  {#each bubbles as bubble (bubble.element)}
    <circle
      cx={bubble.x}
      cy={bubble.y}
      r={bubble.radius}
      fill={bubble.pattern?.url ?? bubble.color}
      stroke="white"
      role="img"
      aria-label={segment_title(bubble)}
      stroke-width="1"
      class="bubble"
    >
      <title>{segment_title(bubble)}</title>
    </circle>
  {/each}

  {#if show_labels}
    {#each bubbles as bubble (bubble.element)}
      <SegmentLabel
        x={bubble.x}
        y={bubble.y}
        segment={bubble}
        font_scale={bubble.font_scale}
        text_color={bubble.text_color}
        {label_opts}
      />
    {/each}
  {/if}
</svg>

<style>
  .bubble {
    transition: all 0.2s ease;
  }
  .bubble:hover {
    filter: brightness(1.1);
  }
</style>
