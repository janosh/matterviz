<script lang="ts">
  import { type CompositionType, type ElementSymbol, format_num } from '$lib'
  import type { ColorSchemeName } from '$lib/colors'
  import { element_color_schemes, pick_contrast_color } from '$lib/colors'
  import type { Snippet } from 'svelte'
  import type { SVGAttributes } from 'svelte/elements'
  import { type ChartSegmentData, get_chart_font_scale } from './index'
  import { fractional_composition, get_total_atoms } from './parse'

  // Constants for pie chart calculations
  const VERY_THIN_SLICE_THRESHOLD = 20 // degrees
  const MEDIUM_SLICE_THRESHOLD = 90 // degrees - increased to move more slices toward outer edge
  const MAX_ANGLE_FOR_FULL_SCALE = 120 // degrees

  type PieSegmentData = ChartSegmentData & {
    start_angle: number
    end_angle: number
    path: string
    label_x: number
    label_y: number
    is_outside_slice: boolean
  }
  let {
    composition,
    size = 200,
    stroke_width = 0.5,
    inner_radius = 0,
    show_labels = true,
    show_percentages = false,
    show_amounts = true,
    color_scheme = `Vesta`,
    center_content,
    segment_content,
    interactive = true,
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
    center_content?: Snippet<[{ composition: CompositionType; total_atoms: number }]>
    segment_content?: Snippet<[PieSegmentData]>
    interactive?: boolean
    svg_node?: SVGSVGElement | null
  } = $props()

  let element_colors = $derived(
    element_color_schemes[color_scheme] || element_color_schemes.Vesta,
  )
  let fractions = $derived(fractional_composition(composition))
  let total_atoms = $derived(get_total_atoms(composition))
  let outer_radius = $derived(size / 2 - stroke_width)
  let inner_radius_adjusted = $derived(Math.min(inner_radius, outer_radius - 10))
  let center = $derived(size / 2)

  // Calculate pie segments
  let segments = $derived.by(() => {
    let current_angle = -90 // Start from top

    return Object.entries(composition)
      .filter(([_, amount]) => amount && amount > 0)
      .map(([element_key, amount]) => {
        const element = element_key as ElementSymbol
        const fraction = fractions[element] || 0
        // use 359.99° to avoid 360° for single-element compositions which cause SVG arc issues
        const angle_span = fraction === 1 ? 359.99 : fraction * 360
        const start_angle = current_angle
        const end_angle = current_angle + angle_span

        current_angle = end_angle

        // Convert to radians for calculations
        const start_rad = (start_angle * Math.PI) / 180
        const end_rad = (end_angle * Math.PI) / 180
        const mid_rad = (((start_angle + end_angle) / 2) * Math.PI) / 180

        // Arc coordinates for outer radius
        const x1_outer = center + outer_radius * Math.cos(start_rad)
        const y1_outer = center + outer_radius * Math.sin(start_rad)
        const x2_outer = center + outer_radius * Math.cos(end_rad)
        const y2_outer = center + outer_radius * Math.sin(end_rad)

        // Arc coordinates for inner radius
        const x1_inner = center + inner_radius_adjusted * Math.cos(start_rad)
        const y1_inner = center + inner_radius_adjusted * Math.sin(start_rad)
        const x2_inner = center + inner_radius_adjusted * Math.cos(end_rad)
        const y2_inner = center + inner_radius_adjusted * Math.sin(end_rad)

        const large_arc = angle_span > 180 ? 1 : 0

        // Create donut path if inner radius > 0, otherwise regular pie slice
        const path = inner_radius_adjusted > 0
          ? `M ${x1_outer} ${y1_outer} A ${outer_radius} ${outer_radius} 0 ${large_arc} 1 ${x2_outer} ${y2_outer} L ${x2_inner} ${y2_inner} A ${inner_radius_adjusted} ${inner_radius_adjusted} 0 ${large_arc} 0 ${x1_inner} ${y1_inner} Z`
          : `M ${center} ${center} L ${x1_outer} ${y1_outer} A ${outer_radius} ${outer_radius} 0 ${large_arc} 1 ${x2_outer} ${y2_outer} Z`

        // Position labels with three-tier strategy
        const is_very_thin_slice = angle_span < VERY_THIN_SLICE_THRESHOLD // Place outside
        const is_medium_slice = angle_span >= VERY_THIN_SLICE_THRESHOLD &&
          angle_span < MEDIUM_SLICE_THRESHOLD // Near outer edge

        let label_radius: number
        let is_outside_slice = false

        if (is_very_thin_slice) {
          // Very thin slices: place outside with distance proportional to chart size
          label_radius = outer_radius + outer_radius * 0.2
          is_outside_slice = true
        } else if (is_medium_slice) {
          // Medium slices: place closer to outer edge, proportional to chart size
          label_radius = outer_radius - outer_radius * 0.3
          is_outside_slice = false
        } else {
          // Large slices: place in middle of ring
          label_radius = (outer_radius + inner_radius_adjusted) / 2
          is_outside_slice = false
        }

        // Calculate font scale based on slice size and smart text fitting
        const [min_font_scale, max_font_scale] = [1.4, 2] as const
        const scale_factor = angle_span / MAX_ANGLE_FOR_FULL_SCALE
        const base_scale = min_font_scale +
          scale_factor * (max_font_scale - min_font_scale)
        const label_text = element + (show_amounts ? amount!.toString() : ``) +
          (show_percentages ? `${format_num(fraction, `.1~%`)}` : ``)
        const available_space = is_very_thin_slice
          ? outer_radius * 0.8 // More space outside the slice
          : Math.min(
            outer_radius - inner_radius_adjusted, // Radial space
            (angle_span * Math.PI / 180) * label_radius * 0.8, // Arc space at label radius
          )

        const font_scale = get_chart_font_scale(
          base_scale,
          label_text,
          available_space,
        )
        const color = element_colors[element] || `#cccccc`

        return {
          element,
          amount: amount!,
          fraction,
          color,
          start_angle,
          end_angle,
          path,
          label_x: center + label_radius * Math.cos(mid_rad),
          label_y: center + label_radius * Math.sin(mid_rad),
          is_outside_slice,
          font_scale,
          text_color: is_outside_slice
            ? `var(--text-color, #333)`
            : pick_contrast_color({ bg_color: color }),
        }
      })
  })

  let hovered_element: ElementSymbol | null = $state(null)
</script>

<svg
  viewBox="0 0 {size} {size}"
  {...rest}
  class="pie-chart {rest.class ?? ``}"
  bind:this={svg_node}
>
  {#each segments as segment (segment.element)}
    <path
      d={segment.path}
      fill={segment.color}
      stroke="white"
      stroke-width={hovered_element === segment.element ? stroke_width + 1 : stroke_width}
      class="pie-segment"
      class:interactive
      class:hovered={hovered_element === segment.element}
      onmouseenter={() => interactive && (hovered_element = segment.element)}
      onmouseleave={() => interactive && (hovered_element = null)}
      {...interactive && {
        role: `button`,
        tabindex: 0,
        'aria-label': `${segment.element}: ${segment.amount} ${
          segment.amount === 1 ? `atom` : `atoms`
        } (${format_num(segment.fraction, `.1~%`)})`,
      }}
    >
      <title>
        {segment.element}: {segment.amount}
        {segment.amount === 1 ? `atom` : `atoms`} ({format_num(segment.fraction, `.1~%`)})
      </title>
    </path>

    {#if segment_content}
      {@render segment_content(segment)}
    {/if}
  {/each}

  {#if show_labels}
    {#each segments as segment (segment.element)}
      <foreignObject
        x={segment.label_x - (size * 0.15 * segment.font_scale) / 2}
        y={segment.label_y - (size * 0.075 * segment.font_scale) / 2}
        width={size * 0.15 * segment.font_scale}
        height={size * 0.075 * segment.font_scale}
        class:hovered={hovered_element === segment.element}
      >
        <div
          class="pie-label"
          class:inside-slice={!segment.is_outside_slice}
          class:outside-slice={segment.is_outside_slice}
          style:color={segment.text_color}
        >
          <span class="element-symbol" style:font-size="{14 * segment.font_scale}px">{
            segment.element
          }</span>
          {#if show_amounts}
            <sub class="amount" style:font-size="{10 * segment.font_scale}px">
              {segment.amount}
            </sub>{/if}
          {#if show_percentages}
            <sub class="percentage" style:font-size="{11 * segment.font_scale}px">
              {format_num(segment.fraction, `.1~%`)}
            </sub>
          {/if}
        </div>
      </foreignObject>
    {/each}
  {/if}

  {#if center_content}
    <g class="center-content">
      {@render center_content({ composition, total_atoms })}
    </g>
  {/if}
</svg>

<style>
  .pie-segment {
    transition: all 0.2s ease;
  }
  .pie-segment.interactive {
    cursor: pointer;
  }
  .pie-segment.interactive:hover, .pie-segment.hovered {
    filter: brightness(1.1);
  }
  .pie-segment.interactive:focus {
    outline: none;
  }
  foreignobject {
    pointer-events: none;
    transition: all 0.2s ease;
  }
  foreignobject.hovered {
    font-weight: 700;
  }
  .pie-label {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    width: 100%;
    height: 100%;
    transition: all 0.2s ease;
    white-space: nowrap;
  }
  foreignobject {
    overflow: visible;
  }
  .pie-label.hovered {
    font-weight: 700;
  }
  .amount {
    margin-left: 1px;
    transform: translateY(9pt);
  }
  .percentage {
    transform: translateY(4px);
  }
</style>
