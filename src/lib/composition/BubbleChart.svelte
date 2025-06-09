<script lang="ts">
  import type { CompositionType, ElementSymbol } from '$lib'
  import { element_color_schemes } from '$lib/colors'
  import { choose_bw_for_contrast } from '$lib/labels'
  import type { HierarchyCircularNode } from 'd3-hierarchy'
  import { hierarchy, pack } from 'd3-hierarchy'
  import type { Snippet } from 'svelte'

  // Constants for bubble positioning and sizing
  const MIN_FONT_SCALE = 0.4
  const MAX_FONT_SCALE = 1.0

  // Type for our bubble data structure
  type BubbleDataLeaf = {
    element: ElementSymbol
    amount: number
    color: string
  }

  type BubbleDataRoot = {
    children: BubbleDataLeaf[]
  }

  interface Props {
    composition: CompositionType
    size?: number
    padding?: number
    show_labels?: boolean
    show_amounts?: boolean
    color_scheme?: keyof typeof element_color_schemes
    bubble_content?: Snippet<
      [
        {
          element: ElementSymbol
          amount: number
          radius: number
          x: number
          y: number
          color: string
          font_scale: number
          text_color: string
        },
      ]
    >
    style?: string
    class?: string
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
    style = ``,
    class: class_name = ``,
    interactive = true,
    ...rest
  }: Props = $props()

  let element_colors = $derived(
    element_color_schemes[color_scheme] || element_color_schemes.Vesta,
  )

  // Function to determine text color based on background
  function get_text_color(background_color: string): string {
    return choose_bw_for_contrast(null, background_color)
  }

  // Calculate bubble data with proper circle packing
  let bubbles = $derived.by(() => {
    const element_entries = Object.entries(composition).filter(
      ([_, amount]) => amount && amount > 0,
    )
    if (element_entries.length === 0) return []

    // Create hierarchy data structure for D3 pack
    const hierarchy_data: BubbleDataRoot = {
      children: element_entries.map(([element, amount]) => ({
        element: element as ElementSymbol,
        amount: amount!,
        color: element_colors[element as ElementSymbol] || `#cccccc`,
      })),
    }

    // Use D3's pack layout for proper circle packing
    const pack_layout = pack<BubbleDataLeaf | BubbleDataRoot>()
      .size([size - 2 * padding, size - 2 * padding])
      .padding(padding * 0.1) // Small padding between circles

    const root = pack_layout(
      hierarchy<BubbleDataLeaf | BubbleDataRoot>(hierarchy_data).sum((d) =>
        d && `amount` in d ? d.amount : 0,
      ),
    ) as HierarchyCircularNode<BubbleDataLeaf | BubbleDataRoot>

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
        text_color: get_text_color(data.color),
      }
    })
  })

  let hovered_element: ElementSymbol | null = $state(null)
</script>

<div class="bubble-chart-container {class_name}" {style} {...rest}>
  <svg viewBox="0 0 {size} {size}" class="bubble-chart">
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
        role={interactive ? `button` : undefined}
        tabindex={interactive ? 0 : undefined}
      >
        <title>
          {bubble.element}: {bubble.amount}
          {bubble.amount === 1 ? `atom` : `atoms`}
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
          <div
            class="bubble-label"
            style="color: {bubble.text_color}; font-size: {12 * bubble.font_scale}px;"
          >
            <span class="element-symbol" style="font-size: {14 * bubble.font_scale}px"
              >{bubble.element}</span
            >{#if show_amounts}<sub
                class="amount"
                style="font-size: {10 * bubble.font_scale}px">{bubble.amount}</sub
              >{/if}
          </div>
        </foreignObject>
      {/each}
    {/if}
  </svg>
</div>

<style>
  .bubble-chart-container {
    display: inline-block;
  }
  .bubble-chart {
    overflow: visible;
    width: 100%;
    height: auto;
  }
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
  foreignObject {
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
