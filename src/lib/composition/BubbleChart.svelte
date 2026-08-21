<script lang="ts">
  import type { ColorSchemeName } from '$lib/colors'
  import type { CompositionType } from '$lib/composition'
  import { hierarchy, pack } from 'd3-hierarchy'
  import type { SVGAttributes } from 'svelte/elements'
  import {
    type ChartSegment,
    composition_segments,
    fit_font_scale,
    segment_suffix,
    segment_title,
  } from './chart'

  let {
    composition,
    size = 200,
    padding = 0,
    show_labels = true,
    show_amounts = true,
    show_percentages = false,
    color_scheme = `Vesta`,
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
    svg_node?: SVGSVGElement | null
  } = $props()

  let label_opts = $derived({ show_amounts, show_percentages })

  // d3 circle packing: bubble area ∝ amount
  let bubbles = $derived.by(() => {
    const segments = composition_segments(composition, color_scheme)
    if (segments.length === 0) return []
    const root = hierarchy<{ children: ChartSegment[] } | ChartSegment>({
      children: segments,
    }).sum((node) => (`amount` in node ? node.amount : 0))
    const inner_size = size - 2 * padding
    const leaves = pack<typeof root.data>()
      .size([inner_size, inner_size])
      .padding(padding * 0.1)(root)
      .leaves()
    const max_radius = Math.max(...leaves.map((leaf) => leaf.r))
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
  {#each bubbles as bubble (bubble.element)}
    <circle
      cx={bubble.x}
      cy={bubble.y}
      r={bubble.radius}
      fill={bubble.color}
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
      {@const [width, height] = [size * 0.15, size * 0.075].map(
        (len) => len * bubble.font_scale,
      )}
      <foreignObject x={bubble.x - width / 2} y={bubble.y - height / 2} {width} {height}>
        <div class="bubble-label" style:color={bubble.text_color}>
          <span style:font-size="{14 * bubble.font_scale}px">{bubble.element}</span>
          {#if show_amounts || show_percentages}
            <sub style:font-size="{8 * bubble.font_scale}px"
              >{segment_suffix(bubble, label_opts)}</sub
            >
          {/if}
        </div>
      </foreignObject>
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
  foreignobject {
    pointer-events: none;
    overflow: visible;
  }
  .bubble-label {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    white-space: nowrap;
    span {
      font-weight: 700;
    }
    sub {
      font-weight: 500;
      margin-left: 1px;
      transform: translateY(5px);
    }
  }
</style>
