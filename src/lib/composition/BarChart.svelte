<script lang="ts">
  import { format_num, type CompositionType, type ElementSymbol } from '$lib'
  import { element_color_schemes } from '$lib/colors'
  import { choose_bw_for_contrast } from '$lib/labels'
  import type { Snippet } from 'svelte'
  import { composition_to_percentages } from './parse'

  // Constants for bar chart calculations
  const MIN_FONT_SCALE = 0.6
  const MAX_FONT_SCALE = 1.2
  const MIN_SEGMENT_SIZE_FOR_LABEL = 15 // pixels

  // Type for bar chart segment data
  type SegmentData = {
    element: ElementSymbol
    amount: number
    percentage: number
    color: string
    width_percent: number
    font_scale: number
    text_color: string
    can_show_label: boolean
    is_thin: boolean
    needs_external_label: boolean
    external_label_position: `above` | `below` | null
  }

  interface Props {
    composition: CompositionType
    width?: number
    height?: number
    segment_gap?: number
    border_radius?: number
    outer_corners_only?: boolean
    show_labels?: boolean
    show_percentages?: boolean
    show_amounts?: boolean
    color_scheme?: keyof typeof element_color_schemes
    segment_content?: Snippet<
      [
        {
          element: ElementSymbol
          amount: number
          percentage: number
          color: string
          width_percent: number
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
    width = 200,
    height = 60,
    segment_gap = 0,
    border_radius = 8,
    outer_corners_only = true,
    show_labels = true,
    show_percentages = false,
    show_amounts = true,
    color_scheme = `Vesta`,
    segment_content,
    style = ``,
    class: class_name = ``,
    interactive = true,
    ...rest
  }: Props = $props()

  let element_colors = $derived(
    element_color_schemes[color_scheme] || element_color_schemes.Vesta,
  )
  let percentages = $derived(composition_to_percentages(composition))

  // Function to determine text color based on background
  function get_text_color(background_color: string): string {
    return choose_bw_for_contrast(null, background_color)
  }

  // Calculate bar segments for horizontal layout
  let segments = $derived.by(() => {
    const element_entries = Object.entries(composition).filter(
      ([_, amount]) => amount && amount > 0,
    )
    if (element_entries.length === 0) return []

    const THIN_SEGMENT_THRESHOLD = 20 // Percentage below which segment is considered thin
    const EXTERNAL_LABEL_SIZE_THRESHOLD = 5 // Lower threshold for external labels

    let above_labels = 0
    let below_labels = 0

    return element_entries.map(([element, amount]) => {
      const percentage = percentages[element as ElementSymbol] || 0
      const color = element_colors[element as ElementSymbol] || `#cccccc`

      // Calculate font scale based on percentage (approximate segment width)
      const approx_segment_width = (percentage / 100) * width
      const segment_size = Math.min(approx_segment_width, height)
      const font_scale = Math.min(
        MAX_FONT_SCALE,
        Math.max(MIN_FONT_SCALE, segment_size / 40),
      )

      // Determine label display requirements
      const can_show_label = segment_size >= MIN_SEGMENT_SIZE_FOR_LABEL
      const is_thin = percentage < THIN_SEGMENT_THRESHOLD
      const can_show_external_label = segment_size >= EXTERNAL_LABEL_SIZE_THRESHOLD
      const needs_external_label = is_thin && can_show_external_label

      // Balance labels above and below for better visual distribution
      let external_label_position: `above` | `below` | null = null
      if (needs_external_label) {
        external_label_position =
          above_labels <= below_labels ? (`above` as const) : (`below` as const)
        if (external_label_position === `above`) above_labels++
        else below_labels++
      }

      return {
        element: element as ElementSymbol,
        amount: amount!,
        percentage,
        color,
        width_percent: percentage,
        font_scale,
        text_color: get_text_color(color),
        can_show_label,
        is_thin,
        needs_external_label,
        external_label_position,
      }
    })
  })

  let hovered_element: ElementSymbol | null = $state(null)
</script>

{#snippet label_content(segment: SegmentData)}
  <span class="element-symbol" style="font-size: {10 * segment.font_scale}px"
    >{segment.element}</span
  >{#if show_amounts}<sub class="amount" style="font-size: {8 * segment.font_scale}px"
      >{segment.amount}</sub
    >{/if}
  {#if show_percentages}
    <sub class="percentage" style="font-size: {8 * segment.font_scale}px">
      {format_num(segment.percentage, 1)}%
    </sub>
  {/if}
{/snippet}

<div
  class="stacked-bar-chart-container {class_name}"
  style="
    --bar-max-width: {width}px;
    --bar-height: {height}px;
    --segment-gap: {segment_gap}px;
    --border-radius: {border_radius}px;
    {style}
  "
  {...rest}
>
  <!-- External labels above the bar -->
  <div class="external-labels-above">
    {#each segments as segment (segment.element)}
      {#if show_labels && segment.needs_external_label && segment.external_label_position === `above`}
        <div
          class="external-label"
          class:hovered={hovered_element === segment.element}
          style="
            color: {segment.color};
            font-size: {7 * segment.font_scale}px;
            flex: {segment.width_percent};
          "
        >
          {@render label_content(segment)}
        </div>
      {:else}
        <div style="flex: {segment.width_percent};"></div>
      {/if}
    {/each}
  </div>

  <div class="bar-segments" class:outer-corners-only={outer_corners_only}>
    {#each segments as segment (segment.element)}
      <div
        class="bar-segment"
        class:interactive
        class:hovered={hovered_element === segment.element}
        style="
          background-color: {segment.color};
          flex: {segment.width_percent};
        "
        onmouseenter={() => interactive && (hovered_element = segment.element)}
        onmouseleave={() => interactive && (hovered_element = null)}
        {...interactive && {
          role: `button`,
          tabindex: 0,
          'aria-label': `${segment.element}: ${segment.amount} ${segment.amount === 1 ? `atom` : `atoms`} (${segment.percentage.toFixed(1)}%)`,
        }}
        title="{segment.element}: {segment.amount} {segment.amount === 1
          ? `atom`
          : `atoms`} ({segment.percentage.toFixed(1)}%)"
      >
        {#if show_labels && segment.can_show_label && !segment.needs_external_label}
          <div
            class="bar-label"
            style="color: {segment.text_color}; font-size: {7 * segment.font_scale}px;"
          >
            {@render label_content(segment)}
          </div>
        {/if}

        {#if segment_content}
          {@render segment_content(segment)}
        {/if}
      </div>
    {/each}
  </div>

  <!-- External labels below the bar -->
  <div class="external-labels-below">
    {#each segments as segment (segment.element)}
      {#if show_labels && segment.needs_external_label && segment.external_label_position === `below`}
        <div
          class="external-label"
          class:hovered={hovered_element === segment.element}
          style="
            color: {segment.color};
            font-size: {7 * segment.font_scale}px;
            flex: {segment.width_percent};
          "
        >
          {@render label_content(segment)}
        </div>
      {:else}
        <div style="flex: {segment.width_percent};"></div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .stacked-bar-chart-container {
    display: inline-flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--bar-max-width);
    min-width: var(--bar-min-width, 100px);
    gap: 2px;
  }

  .external-labels-above,
  .external-labels-below {
    display: flex;
    width: 100%;
    gap: var(--segment-gap);
    min-height: 20px;
  }

  .external-label {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
    transition: all 0.2s ease;
  }

  .external-label.hovered {
    font-weight: 700;
  }

  .bar-segments {
    display: flex;
    width: 100%;
    height: var(--bar-height, 50px);
    max-height: var(--bar-max-height, 25px);
    gap: var(--segment-gap);
    border-radius: var(--border-radius);
    overflow: hidden;
  }

  .bar-segments:not(.outer-corners-only) .bar-segment {
    border-radius: var(--border-radius);
  }

  .bar-segments.outer-corners-only .bar-segment:first-child {
    border-top-left-radius: var(--border-radius);
    border-bottom-left-radius: var(--border-radius);
  }

  .bar-segments.outer-corners-only .bar-segment:last-child {
    border-top-right-radius: var(--border-radius);
    border-bottom-right-radius: var(--border-radius);
  }

  .bar-segment {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    min-width: 0; /* Allow flex items to shrink */
  }

  .bar-segment.interactive {
    cursor: pointer;
  }

  .bar-segment.interactive:hover,
  .bar-segment.hovered {
    filter: brightness(1.1);
    transform: scaleY(1.05);
  }

  .bar-segment.interactive:focus {
    outline: 2px solid var(--focus-color, #0066cc);
    outline-offset: 2px;
  }

  .bar-label {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
    transition: all 0.2s ease;
  }

  .bar-segment.hovered .bar-label {
    font-weight: 700;
  }

  .element-symbol {
    font-weight: 700;
  }

  .amount,
  .percentage {
    margin-left: 1px;
    transform: translateY(5px);
  }

  .amount {
    font-weight: 500;
  }

  .percentage {
    font-weight: 400;
  }
</style>
