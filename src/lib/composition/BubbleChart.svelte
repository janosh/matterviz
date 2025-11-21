<script lang="ts">
  import type { CompositionType, ElementSymbol } from '$lib'
  import type { ColorSchemeName } from '$lib/colors'
  import { ELEMENT_COLOR_SCHEMES, pick_contrast_color } from '$lib/colors'
  import { hierarchy, pack } from 'd3-hierarchy'
  import type { Snippet } from 'svelte'
  import type { SVGAttributes } from 'svelte/elements'
  import { type ChartSegmentData, get_chart_font_scale } from './index'
  import { count_atoms_in_composition } from './parse'

  type BubbleSegmentData = ChartSegmentData & { radius: number; x: number; y: number }

  let {
    composition,
    size = 200,
    padding = 0,
    show_labels = true,
    show_amounts = true,
    color_scheme = `Vesta`,
    bubble_content,
    interactive = true,
    svg_node = $bindable(null),
    children,
    ...rest
  }: SVGAttributes<SVGSVGElement> & {
    composition: CompositionType
    size?: number
    padding?: number
    show_labels?: boolean
    show_amounts?: boolean
    color_scheme?: ColorSchemeName
    bubble_content?: Snippet<[BubbleSegmentData]>
    interactive?: boolean
    svg_node?: SVGSVGElement | null
    children?: Snippet<[{ hovered_element: ElementSymbol | null }]>
  } = $props()

  let element_colors = $derived(
    ELEMENT_COLOR_SCHEMES[color_scheme] || ELEMENT_COLOR_SCHEMES.Vesta,
  )

  // Calculate bubble data with proper circle packing
  let bubbles = $derived.by<BubbleSegmentData[]>(() => {
    const element_entries = Object.entries(composition).filter(
      ([_, amount]) => amount && amount > 0,
    )
    if (element_entries.length === 0) return []

    // Create hierarchy data structure for D3 pack
    type Child = { element: string; amount: number; color: string }
    type HierarchyData = { children: Child[] }

    const hierarchy_data: HierarchyData = {
      children: element_entries.map(([element, amount]) => ({
        element,
        amount: amount ?? 0,
        color: element_colors[element] || `#cccccc`,
      })),
    }

    // Use D3's pack layout for proper circle packing
    const pack_layout = pack<HierarchyData | Child>().size([
      size - 2 * padding,
      size - 2 * padding,
    ]).padding(padding * 0.1) // Small padding between circles

    const root = pack_layout(
      hierarchy<HierarchyData | Child>(hierarchy_data).sum(
        (data) => (`amount` in data ? data.amount : 0),
      ),
    )

    // Get max radius for font scaling
    const max_radius = Math.max(...root.leaves().map((data) => data.r || 0))
    const total_atoms = count_atoms_in_composition(composition)

    return root.leaves().map((node) => {
      const radius = node.r || 0
      const data = node.data as Child

      // Calculate font scale based on bubble size and smart text fitting
      const [min_font_scale, max_font_scale] = [0.6, 2] as const
      const scale_factor = radius / max_radius
      const base_scale = min_font_scale +
        scale_factor * (max_font_scale - min_font_scale)
      const label_text = data.element + (show_amounts ? data.amount.toString() : ``)
      const available_space = radius * 2 * 0.8 // 80% of bubble diameter for text
      const font_scale = get_chart_font_scale(base_scale, label_text, available_space)

      return {
        element: data.element as ElementSymbol,
        amount: data.amount,
        fraction: total_atoms > 0 ? data.amount / total_atoms : 0,
        radius,
        x: (node.x || 0) + padding, // Offset by padding
        y: (node.y || 0) + padding,
        color: data.color,
        font_scale,
        text_color: pick_contrast_color({ bg_color: data.color }),
      }
    })
  })

  let hovered_element: ElementSymbol | null = $state(null)
</script>

<svg
  viewBox="0 0 {size} {size}"
  {...rest}
  class="bubble-chart {rest.class ?? ``}"
  bind:this={svg_node}
>
  {#each bubbles as bubble (bubble.element)}
    <circle
      cx={bubble.x}
      cy={bubble.y}
      r={bubble.radius}
      fill={bubble.color}
      stroke="white"
      stroke-width={hovered_element === bubble.element ? 1.5 : 1}
      class="bubble"
      class:interactive
      class:hovered={hovered_element === bubble.element}
      onmouseenter={() => interactive && (hovered_element = bubble.element)}
      onmouseleave={() => interactive && (hovered_element = null)}
      {...interactive && {
        role: `button`,
        tabindex: 0,
        'aria-label': `${bubble.element}: ${bubble.amount} ${
          bubble.amount === 1 ? `atom` : `atoms`
        }`,
      }}
    >
      <title>
        {bubble.element}: {bubble.amount} {bubble.amount === 1 ? `atom` : `atoms`}
      </title>
    </circle>

    {#if bubble_content}
      {@render bubble_content(bubble)}
    {/if}
  {/each}

  {#if show_labels}
    {#each bubbles as bubble (bubble.element)}
      <foreignObject
        x={bubble.x - (size * 0.15 * bubble.font_scale) / 2}
        y={bubble.y - (size * 0.075 * bubble.font_scale) / 2}
        width={size * 0.15 * bubble.font_scale}
        height={size * 0.075 * bubble.font_scale}
        class="bubble-label-container"
        class:hovered={hovered_element === bubble.element}
      >
        <div class="bubble-label" style:color={bubble.text_color}>
          <span class="element-symbol" style:font-size="{14 * bubble.font_scale}px">{
            bubble.element
          }</span>
          {#if show_amounts}
            <sub class="amount" style:font-size="{10 * bubble.font_scale}px">
              {bubble.amount}
            </sub>{/if}
        </div>
      </foreignObject>
    {/each}
  {/if}

  {@render children?.({ hovered_element })}
</svg>

<style>
  .bubble {
    transition: all 0.2s ease;
  }
  .bubble.interactive {
    cursor: pointer;
  }
  .bubble.interactive:hover, .bubble.hovered {
    filter: brightness(1.1);
  }
  .bubble.interactive:focus {
    outline: none;
  }
  .bubble-label-container {
    pointer-events: none;
    transition: all 0.2s ease;
  }
  .bubble-label-container.hovered {
    font-weight: 700;
  }
  .bubble-label {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    width: 100%;
    height: 100%;
    font-weight: 600;
    transition: all 0.2s ease;
    white-space: nowrap;
  }
  foreignobject {
    overflow: visible;
  }
  .bubble-label.hovered {
    font-weight: 700;
  }
  .element-symbol {
    font-weight: 700;
  }
  .amount {
    font-weight: 500;
    margin-left: 1px;
    transform: translateY(5px);
  }
</style>
