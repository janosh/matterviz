<script lang="ts">
  import { type CompositionType, type ElementSymbol, format_num } from '$lib'
  import type { ColorSchemeName } from '$lib/colors'
  import { element_color_schemes, pick_contrast_color } from '$lib/colors'
  import type { Snippet } from 'svelte'
  import type { SVGAttributes } from 'svelte/elements'
  import { type ChartSegmentData, get_chart_font_scale } from './index'
  import { fractional_composition } from './parse'

  type BarSegmentData = ChartSegmentData & {
    x: number
    width: number
    can_show_label: boolean
    needs_external_label: boolean
    external_label_position: `above` | `below` | null
    label_x: number
    label_y: number
  }

  interface Props extends SVGAttributes<SVGSVGElement> {
    composition: CompositionType
    size?: number
    bar_height?: number
    label_height?: number
    gap?: number
    min_segment_size_for_label?: number
    thin_segment_threshold?: number
    external_label_size_threshold?: number
    outer_corners_only?: boolean
    show_labels?: boolean
    show_percentages?: boolean
    show_amounts?: boolean
    color_scheme?: ColorSchemeName
    segment_content?: Snippet<[BarSegmentData]>
    interactive?: boolean
    svg_node?: SVGSVGElement | null
  }
  let {
    composition,
    size = 200,
    bar_height = 30,
    label_height = 20,
    gap = 2,
    min_segment_size_for_label = 15,
    thin_segment_threshold = 0.2,
    external_label_size_threshold = 5,
    outer_corners_only = true,
    show_labels = true,
    show_percentages = false,
    show_amounts = true,
    color_scheme = `Vesta`,
    segment_content,
    interactive = true,
    svg_node = $bindable(null),
    ...rest
  }: Props = $props()

  let element_colors = $derived(
    element_color_schemes[color_scheme] || element_color_schemes.Vesta,
  )
  let fractions = $derived(fractional_composition(composition))

  let svg_height = $derived(label_height + gap + bar_height + gap + label_height)
  let bar_y = $derived(label_height + gap)
  let above_labels_y = $derived(label_height / 2)
  let below_labels_y = $derived(
    label_height + gap + bar_height + gap + label_height / 2,
  )

  let segments = $derived.by(() => {
    const element_entries = Object.entries(composition).filter(([_, amount]) =>
      amount && amount > 0
    ) as [ElementSymbol, number][]
    if (element_entries.length === 0) return []

    let [above_labels, below_labels] = [0, 0]
    let current_x = 0

    return element_entries.map(([element, amount]) => {
      const fraction = fractions[element] || 0
      const color = element_colors[element] || `#cccccc`
      const width = fraction * size
      const x = current_x
      current_x += width

      const segment_size = Math.min(width, size)
      const base_scale = Math.min(2, Math.max(1, segment_size / 40))
      const label_text = element + (show_amounts ? amount!.toString() : ``) +
        (show_percentages ? `${format_num(fraction, `.1~%`)}` : ``)
      const font_scale = get_chart_font_scale(
        base_scale,
        label_text,
        segment_size * 0.9,
        0.6,
        12,
      )

      // Label positioning
      const can_show_label = segment_size >= min_segment_size_for_label
      const is_thin = fraction < thin_segment_threshold
      const can_show_external_label = segment_size >= external_label_size_threshold
      const needs_external_label = is_thin && can_show_external_label

      let external_label_position: `above` | `below` | null = null
      if (needs_external_label) {
        external_label_position = above_labels <= below_labels ? `above` : `below`
        if (external_label_position === `above`) above_labels++
        else below_labels++
      }

      return {
        element,
        amount,
        fraction,
        color,
        x,
        width,
        font_scale,
        text_color: pick_contrast_color({ bg_color: color }),
        can_show_label,
        needs_external_label,
        external_label_position,
        label_x: x + width / 2,
        label_y: bar_y + bar_height / 2,
      }
    })
  })

  let hovered_element: ElementSymbol | null = $state(null)
  // Generate unique ID for clipPath to avoid collisions across BarCharts
  let clip_path_id = $derived(`bar-clip-${crypto.randomUUID()}`)
</script>

{#snippet label_content(segment: BarSegmentData)}
  <tspan class="element-symbol" style:font-size="{10 * segment.font_scale}px">
    {segment.element}
  </tspan>
  {#if show_amounts}
    <tspan class="amount" style:font-size="{8 * segment.font_scale}px" dx="1" dy="5">
      {segment.amount}
    </tspan>
  {/if}
  {#if show_percentages}
    <tspan class="percentage" style:font-size="{8 * segment.font_scale}px" dx="1" dy="5">
      {format_num(segment.fraction, `.1~%`)}
    </tspan>
  {/if}
{/snippet}

<svg
  viewBox="0 0 {size} {svg_height}"
  {...rest}
  class="bar-chart {rest.class ?? ``}"
  style={`--bar-height: ${bar_height}px; --label-height: ${label_height}px; --gap: ${gap}px; --border-radius: ${
    outer_corners_only ? 4 : 0
  }px; ${rest.style ?? ``}`}
  bind:this={svg_node}
>
  <!-- Background and border -->
  <rect
    x="0"
    y={bar_y}
    width={size}
    height={bar_height}
    rx={outer_corners_only ? 4 : 0}
    ry={outer_corners_only ? 4 : 0}
    fill="var(--bar-bg, #fff)"
    stroke="var(--bar-border, #ccc)"
    stroke-width="1"
  />

  <!-- External labels above -->
  {#each segments as segment (segment.element)}
    {#if show_labels && segment.needs_external_label &&
      segment.external_label_position === `above`}
      <text
        x={segment.label_x}
        y={above_labels_y}
        text-anchor="middle"
        class="external-label"
        class:hovered={hovered_element === segment.element}
        style:fill={segment.color}
      >
        {@render label_content(segment)}
      </text>
    {/if}
  {/each}

  <!-- Bar segments -->
  <defs>
    <clipPath id={clip_path_id}>
      <rect
        x="0"
        y={bar_y}
        width={size}
        height={bar_height}
        rx={outer_corners_only ? 4 : 0}
        ry={outer_corners_only ? 4 : 0}
      />
    </clipPath>
  </defs>

  <g clip-path="url(#{clip_path_id})">
    {#each segments as segment (segment.element)}
      <rect
        x={segment.x}
        y={bar_y}
        width={segment.width}
        height={bar_height}
        fill={segment.color}
        stroke="white"
        stroke-width={hovered_element === segment.element ? 1.5 : 1}
        class="bar-segment"
        class:interactive
        class:hovered={hovered_element === segment.element}
        onmouseenter={() => interactive && (hovered_element = segment.element)}
        onmouseleave={() => interactive && (hovered_element = null)}
        {...(interactive
        ? {
          role: `button`,
          tabindex: 0,
          'aria-label': `${segment.element}: ${segment.amount} ${
            segment.amount === 1 ? `atom` : `atoms`
          } (${format_num(segment.fraction, `.1~%`)})`,
        }
        : {})}
      >
        <title>
          {segment.element}: {segment.amount} {segment.amount === 1 ? `atom` : `atoms`} ({
            format_num(segment.fraction, `.1~%`)
          })
        </title>
      </rect>
      {#if segment_content}
        {@render segment_content(segment)}
      {/if}
    {/each}
  </g>

  <!-- Internal labels -->
  {#each segments as segment (segment.element)}
    {#if show_labels && segment.can_show_label && !segment.needs_external_label}
      <text
        x={segment.label_x}
        y={segment.label_y}
        text-anchor="middle"
        dominant-baseline="middle"
        class="bar-label"
        style:fill={segment.text_color}
      >
        {@render label_content(segment)}
      </text>
    {/if}
  {/each}

  <!-- External labels below -->
  {#each segments as segment (segment.element)}
    {#if show_labels && segment.needs_external_label &&
      segment.external_label_position === `below`}
      <text
        x={segment.label_x}
        y={below_labels_y}
        text-anchor="middle"
        class="external-label"
        class:hovered={hovered_element === segment.element}
        style:fill={segment.color}
      >
        {@render label_content(segment)}
      </text>
    {/if}
  {/each}
</svg>

<style>
  .bar-chart {
    display: inline-block;
    width: 100%;
    max-width: var(--bar-max-width, 100%);
  }
  .bar-segment {
    transition: all 0.2s ease;
  }
  .bar-segment.interactive {
    cursor: pointer;
  }
  .bar-segment.interactive:hover, .bar-segment.hovered {
    filter: brightness(1.1);
  }
  .bar-segment.interactive:focus {
    outline: 2px solid var(--focus-color, #0066cc);
    outline-offset: 2px;
  }
  .external-label, .bar-label {
    transition: all 0.2s ease;
    pointer-events: none;
  }
  .external-label.hovered, .bar-label.hovered {
    font-weight: 700;
  }
  .element-symbol {
    font-weight: 700;
  }
  .amount, .percentage {
    font-weight: 500;
  }
</style>
