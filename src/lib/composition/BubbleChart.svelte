<script lang="ts">
  import type { CompositionType, ElementSymbol } from '$lib'
  import type { ColorSchemeName } from '$lib/colors'
  import { element_color_schemes, pick_color_for_contrast } from '$lib/colors'
  import { hierarchy, type HierarchyCircularNode, pack } from 'd3-hierarchy'
  import type { Snippet } from 'svelte'

  // Constants for bubble positioning and sizing
  const MIN_FONT_SCALE = 0.6
  const MAX_FONT_SCALE = 2

  // Type for our bubble data structure
  type BubbleDataLeaf = {
    element: ElementSymbol
    amount: number
    color: string
    radius?: number
    x?: number
    y?: number
    font_scale?: number
    text_color?: string
  }

  interface Props {
    composition: CompositionType
    size?: number
    padding?: number
    show_labels?: boolean
    show_amounts?: boolean
    color_scheme?: ColorSchemeName
    bubble_content?: Snippet<[BubbleDataLeaf]>
    interactive?: boolean
    [key: string]: unknown
  }
  let {
    composition,
    size = 200,
    padding = 0,
    show_labels = true,
    show_amounts = true,
    color_scheme = `Vesta`,
    bubble_content,
    interactive = true,
    ...rest
  }: Props = $props()

  let element_colors = $derived(
    element_color_schemes[color_scheme] || element_color_schemes.Vesta,
  )

  // Calculate bubble data with proper circle packing
  let bubbles = $derived.by(() => {
    const element_entries = Object.entries(composition).filter(
      ([_, amount]) => amount && amount > 0,
    )
    if (element_entries.length === 0) return []

    // Create hierarchy data structure for D3 pack
    const hierarchy_data = {
      children: element_entries.map(([element, amount]) => ({
        element: element as ElementSymbol,
        amount: amount!,
        color: element_colors[element as ElementSymbol] || `#cccccc`,
      })),
    }

    // Use D3's pack layout for proper circle packing
    const pack_layout = pack()
      .size([size - 2 * padding, size - 2 * padding])
      .padding(padding * 0.1) // Small padding between circles

    const root = pack_layout(
      hierarchy(hierarchy_data).sum((d) => d && `amount` in d ? d.amount : 0),
    ) as HierarchyCircularNode<BubbleDataLeaf | BubbleDataLeaf[]>

    // Get max radius for font scaling
    const max_radius = Math.max(...root.leaves().map((d) => d.r || 0))

    return root.leaves().map((node) => {
      const radius = node.r || 0
      const data = node.data as BubbleDataLeaf

      // Calculate font scale based on bubble size
      // Scale from MIN_FONT_SCALE (for very small bubbles) to MAX_FONT_SCALE (for large bubbles)
      const font_scale = Math.min(
        MAX_FONT_SCALE,
        MIN_FONT_SCALE + (radius / max_radius) * (MAX_FONT_SCALE - MIN_FONT_SCALE),
      )

      return {
        element: data.element,
        amount: data.amount,
        radius,
        x: (node.x || 0) + padding, // Offset by padding
        y: (node.y || 0) + padding,
        color: data.color,
        font_scale,
        text_color: pick_color_for_contrast(null, data.color),
      }
    })
  })

  let hovered_element: ElementSymbol | null = $state(null)
</script>

<svg viewBox="0 0 {size} {size}" {...rest} class="bubble-chart {rest.class ?? ``}">
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
</svg>

<style>
  .bubble {
    transition: all 0.2s ease;
  }
  .bubble.interactive {
    cursor: pointer;
  }
  .bubble.interactive:hover,
  .bubble.hovered {
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
