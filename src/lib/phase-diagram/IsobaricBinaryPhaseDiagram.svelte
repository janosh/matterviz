<script lang="ts">
  import { format_num } from '$lib'
  import {
    FullscreenToggle,
    set_fullscreen_bg,
    setup_fullscreen_effect,
  } from '$lib/layout'
  import type { AxisConfig } from '$lib/plot'
  import { scaleLinear } from 'd3-scale'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import PhaseDiagramControls from './PhaseDiagramControls.svelte'
  import PhaseDiagramExportPane from './PhaseDiagramExportPane.svelte'
  import PhaseDiagramTooltip from './PhaseDiagramTooltip.svelte'
  import type {
    PhaseDiagramConfig,
    PhaseDiagramData,
    PhaseHoverInfo,
    PhaseRegion,
  } from './types'
  import {
    calculate_lever_rule,
    calculate_polygon_bounds,
    calculate_polygon_centroid,
    calculate_tooltip_position,
    compute_label_properties,
    find_phase_at_point,
    format_hover_info_text,
    generate_boundary_path,
    generate_region_path,
    get_default_phase_color,
    merge_phase_diagram_config,
    PHASE_COLOR_RGB,
    transform_vertices,
  } from './utils'

  type Props = HTMLAttributes<HTMLDivElement> & {
    data: PhaseDiagramData
    config?: Partial<PhaseDiagramConfig>
    // Hover callback
    on_phase_hover?: (info: PhaseHoverInfo | null) => void
    // Bindable state
    fullscreen?: boolean
    wrapper?: HTMLDivElement
    hovered_region?: PhaseRegion | null
    // Display options
    show_boundaries?: boolean
    show_labels?: boolean
    show_special_points?: boolean
    show_grid?: boolean
    show_component_labels?: boolean
    fullscreen_toggle?: boolean
    enable_export?: boolean
    show_controls?: boolean
    // Controls pane
    controls_open?: boolean
    controls_props?: Partial<ComponentProps<typeof PhaseDiagramControls>>
    // Export options
    export_pane_open?: boolean
    png_dpi?: number
    export_filename?: string
    // Axis configuration
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    // Custom content snippets
    tooltip?: Snippet<[PhaseHoverInfo]>
    children?: Snippet<
      [{ width: number; height: number; fullscreen: boolean }]
    >
  }

  let {
    data,
    config = $bindable({}),
    on_phase_hover,
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    hovered_region = $bindable(null),
    show_boundaries = $bindable(true),
    show_labels = $bindable(true),
    show_special_points = $bindable(true),
    show_grid = $bindable(true),
    show_component_labels = $bindable(true),
    fullscreen_toggle = true,
    enable_export = true,
    show_controls = true,
    controls_open = $bindable(false),
    controls_props = {},
    export_pane_open = $bindable(false),
    png_dpi = $bindable(150),
    export_filename = `phase-diagram`,
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    tooltip,
    children,
    ...rest
  }: Props = $props()

  // Merge config with centralized defaults using shared helper
  const merged_config = $derived(merge_phase_diagram_config(config))

  // Dimensions - use container size directly, no fallback to avoid layout shift
  let width = $state(0)
  let height = $state(0)

  // Margin from config
  const margin = $derived(merged_config.margin)

  // Pre-computed plot edges to avoid repeated calculations
  const left = $derived(margin.l)
  const right = $derived(width - margin.r)
  const top = $derived(margin.t)
  const bottom = $derived(height - margin.b)
  const plot_width = $derived(right - left)
  const plot_height = $derived(bottom - top)

  // Scales
  const x_scale = $derived(scaleLinear().domain([0, 1]).range([left, right]))

  const y_scale = $derived(
    scaleLinear().domain(data.temperature_range).range([bottom, top]),
  )

  // Generate tick values using d3 scale's built-in ticks method
  const x_tick_count = $derived(
    typeof x_axis.ticks === `number` ? x_axis.ticks : 5,
  )
  const y_tick_count = $derived(
    typeof y_axis.ticks === `number` ? y_axis.ticks : 6,
  )
  const x_ticks = $derived(x_scale.ticks(x_tick_count))
  const y_ticks = $derived(y_scale.ticks(y_tick_count))

  // Transform regions to SVG coordinates
  const transformed_regions = $derived(
    (data?.regions ?? []).map((region) => {
      const svg_vertices = transform_vertices(region.vertices, x_scale, y_scale)
      const bounds = calculate_polygon_bounds(svg_vertices)
      const label_props = compute_label_properties(
        region.name,
        bounds,
        merged_config.font_size,
      )
      return {
        ...region,
        svg_path: generate_region_path(svg_vertices),
        label_pos: region.label_position
          ? [x_scale(region.label_position[0]), y_scale(region.label_position[1])]
          : calculate_polygon_centroid(svg_vertices),
        label_rotation: label_props.rotation,
        label_lines: label_props.lines,
        label_scale: label_props.scale,
      }
    }),
  )

  // Transform boundaries to SVG coordinates
  const transformed_boundaries = $derived(
    data.boundaries.map((boundary) => ({
      ...boundary,
      svg_path: generate_boundary_path(
        transform_vertices(boundary.points, x_scale, y_scale),
      ),
    })),
  )

  // Transform special points to SVG coordinates
  const transformed_special_points = $derived(
    (data.special_points ?? []).map((point) => ({
      ...point,
      svg_x: x_scale(point.position[0]),
      svg_y: y_scale(point.position[1]),
    })),
  )

  // Hover state
  let hover_info = $state<PhaseHoverInfo | null>(null)

  // Copy feedback state
  let copy_feedback = $state<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0,
  })
  let copy_feedback_timeout: ReturnType<typeof setTimeout> | undefined

  // Handle double-click to copy tooltip data
  async function handle_double_click(event: MouseEvent) {
    if (!hover_info) return

    const text = format_hover_info_text(
      hover_info,
      temp_unit,
      comp_unit,
      component_a,
      component_b,
    )

    try {
      await navigator.clipboard.writeText(text)

      // Clear any pending timeout from previous double-click
      if (copy_feedback_timeout) clearTimeout(copy_feedback_timeout)

      // Show copy feedback at click position
      copy_feedback = {
        visible: true,
        x: event.clientX,
        y: event.clientY,
      }

      // Hide feedback after animation completes (matches CSS animation duration)
      copy_feedback_timeout = setTimeout(() => {
        copy_feedback = { ...copy_feedback, visible: false }
        copy_feedback_timeout = undefined
      }, 1500)
    } catch (err) {
      console.error(`Failed to copy phase data:`, err)
    }
  }

  // Tooltip element reference for measuring actual size
  let tooltip_el = $state<HTMLDivElement | null>(null)

  // Tooltip positioning using shared utility
  const tooltip_pos = $derived.by(() => {
    if (!hover_info) return { x: 0, y: 0 }
    return calculate_tooltip_position(
      hover_info.position,
      {
        width: tooltip_el?.offsetWidth ?? 200,
        height: tooltip_el?.offsetHeight ?? 150,
      },
      { width: globalThis.innerWidth ?? 1000, height: globalThis.innerHeight ?? 800 },
    )
  })

  function handle_mouse_move(event: MouseEvent) {
    const svg = event.currentTarget as SVGElement
    const rect = svg.getBoundingClientRect()
    const svg_x = event.clientX - rect.left
    const svg_y = event.clientY - rect.top

    // Check if within plot area
    if (
      svg_x < left ||
      svg_x > right ||
      svg_y < top ||
      svg_y > bottom
    ) {
      hover_info = null
      hovered_region = null
      on_phase_hover?.(null)
      return
    }

    // Convert to data coordinates
    const composition = x_scale.invert(svg_x)
    const temperature = y_scale.invert(svg_y)

    // Find the phase at this point
    const region = find_phase_at_point(composition, temperature, data)

    if (region) {
      hovered_region = region
      // Calculate lever rule (returns null for single-phase regions)
      const lever_rule = calculate_lever_rule(region, composition, temperature)
      hover_info = {
        region,
        composition,
        temperature,
        position: { x: event.clientX, y: event.clientY },
        lever_rule: lever_rule ?? undefined,
      }
      on_phase_hover?.(hover_info)
    } else {
      hover_info = null
      hovered_region = null
      on_phase_hover?.(null)
    }
  }

  function handle_mouse_leave() {
    hover_info = null
    hovered_region = null
    on_phase_hover?.(null)
  }

  // Fullscreen handling
  $effect(() => {
    setup_fullscreen_effect(fullscreen, wrapper)
    set_fullscreen_bg(wrapper, fullscreen, `--phase-diagram-bg-fullscreen`)
  })

  // Component labels
  const component_a = $derived(data.components[0])
  const component_b = $derived(data.components[1])
  const temp_unit = $derived(data.temperature_unit ?? `K`)
  const comp_unit = $derived(data.composition_unit ?? `at%`)

  // Format x-axis tick label with same precision as format_composition in utils.ts
  const format_x_tick = (value: number): string => {
    if (comp_unit === `fraction`) {
      return format_num(value, `.3f`)
    }
    return `${format_num(value * 100, `.1f`)}`
  }
</script>

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
  }}
/>

<div
  {...rest}
  class="binary-phase-diagram {rest.class ?? ``}"
  class:fullscreen
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  role="img"
  aria-label={`${component_a}-${component_b} binary phase diagram`}
>
  {#if width > 0 && height > 0}
    <!-- Header controls -->
    <div class="header-controls">
      {#if show_controls}
        <PhaseDiagramControls
          bind:controls_open
          bind:show_boundaries
          bind:show_labels
          bind:show_special_points
          bind:show_grid
          bind:show_component_labels
          bind:config
          bind:x_axis
          bind:y_axis
          bind:png_dpi
          {data}
          {enable_export}
          {...controls_props}
        />
      {/if}
      {#if enable_export}
        <PhaseDiagramExportPane
          bind:export_pane_open
          bind:png_dpi
          {data}
          {wrapper}
          filename={export_filename}
        />
      {/if}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>

    <svg
      {width}
      {height}
      onmousemove={handle_mouse_move}
      onmouseleave={handle_mouse_leave}
      ondblclick={handle_double_click}
      style={`display: block; cursor: ${hover_info ? `crosshair` : `default`};`}
      role="img"
      aria-label="Binary phase diagram"
    >
      <!-- Background -->
      <rect
        x={left}
        y={top}
        width={plot_width}
        height={plot_height}
        fill={merged_config.colors.background}
      />

      <!-- Grid lines -->
      {#if show_grid}
        <g class="grid">
          <!-- Vertical grid lines -->
          {#each x_ticks as tick (tick)}
            <line
              x1={x_scale(tick)}
              y1={top}
              x2={x_scale(tick)}
              y2={bottom}
              stroke={merged_config.colors.grid}
              stroke-dasharray="4"
            />
          {/each}
          <!-- Horizontal grid lines -->
          {#each y_ticks as tick (tick)}
            <line
              x1={left}
              y1={y_scale(tick)}
              x2={right}
              y2={y_scale(tick)}
              stroke={merged_config.colors.grid}
              stroke-dasharray="4"
            />
          {/each}
        </g>
      {/if}

      <!-- Phase regions -->
      <g class="phase-regions">
        {#each transformed_regions as region (region.id)}
          <path
            d={region.svg_path}
            fill={region.color || get_default_phase_color(region.name)}
            stroke="none"
            class:hovered={hovered_region?.id === region.id}
          />
        {/each}
      </g>

      <!-- Boundaries -->
      {#if show_boundaries}
        <g class="boundaries">
          {#each transformed_boundaries as boundary (boundary.id)}
            <path
              d={boundary.svg_path}
              fill="none"
              stroke={boundary.style?.color || merged_config.colors.boundary}
              stroke-width={boundary.style?.width || 2}
              stroke-dasharray={boundary.style?.dash || ``}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          {/each}
        </g>
      {/if}

      <!-- Special points -->
      {#if show_special_points}
        <g class="special-points">
          {#each transformed_special_points as point (point.id)}
            <circle
              cx={point.svg_x}
              cy={point.svg_y}
              r={merged_config.special_point_radius}
              fill={merged_config.colors.special_point}
              stroke="white"
              stroke-width={1.5}
            />
            {#if point.label}
              <text
                x={point.svg_x}
                y={point.svg_y - merged_config.special_point_radius * 2}
                text-anchor="middle"
                fill={merged_config.colors.text}
                font-size={merged_config.font_size}
                font-weight="bold"
              >
                {point.label}
              </text>
            {/if}
          {/each}
        </g>
      {/if}

      <!-- Region labels -->
      {#if show_labels}
        <g class="region-labels">
          {#each transformed_regions as region (region.id)}
            {@const line_height = merged_config.font_size * 1.2}
            <g
              transform="translate({region.label_pos[0]}, {region.label_pos[1]}) rotate({region.label_rotation}) scale({region.label_scale})"
            >
              {#each region.label_lines as line, line_idx (line_idx)}
                <text
                  x={0}
                  y={(line_idx - (region.label_lines.length - 1) / 2) * line_height}
                  text-anchor="middle"
                  dominant-baseline="middle"
                  fill={merged_config.colors.text}
                  font-size={merged_config.font_size}
                  font-weight="500"
                  class="region-label"
                >
                  {line}
                </text>
              {/each}
            </g>
          {/each}
        </g>
      {/if}

      <!-- Tie-line visualization for two-phase regions -->
      {#if hover_info?.lever_rule}
        {@const lr = hover_info.lever_rule}
        {@const y_pos = y_scale(hover_info.temperature)}
        {@const x_left = x_scale(lr.left_composition)}
        {@const x_right = x_scale(lr.right_composition)}
        {@const tie_line = merged_config.tie_line}
        {@const endpoints = [
        { cx: x_left, color: PHASE_COLOR_RGB.alpha },
        { cx: x_right, color: PHASE_COLOR_RGB.beta },
      ]}
        <g class="tie-line">
          <!-- Horizontal tie-line with white outline for contrast -->
          {#each [`white`, `rgb(${PHASE_COLOR_RGB.tie_line})`] as stroke, idx (idx)}
            <line
              x1={x_left}
              y1={y_pos}
              x2={x_right}
              y2={y_pos}
              {stroke}
              stroke-width={tie_line.stroke_width + (idx === 0 ? 1 : 0)}
              stroke-linecap="round"
            />
          {/each}
          <!-- Phase endpoints -->
          {#each endpoints as { cx, color } (cx)}
            <circle
              {cx}
              cy={y_pos}
              r={tie_line.endpoint_radius}
              fill="rgb({color})"
              stroke="white"
              stroke-width={1.5}
            />
          {/each}
          <!-- Cursor position marker -->
          <circle
            cx={x_scale(hover_info.composition)}
            cy={y_pos}
            r={tie_line.cursor_radius}
            fill="rgb({PHASE_COLOR_RGB.tie_line})"
            stroke="white"
            stroke-width={2}
          />
        </g>
      {/if}

      <!-- X-axis -->
      <g class="x-axis">
        <line
          x1={left}
          y1={bottom}
          x2={right}
          y2={bottom}
          stroke={merged_config.colors.axis}
          stroke-width={1}
        />
        {#each x_ticks as tick (tick)}
          <g transform="translate({x_scale(tick)}, {bottom})">
            <line y2={6} stroke={merged_config.colors.axis} />
            <text
              y={20}
              text-anchor="middle"
              fill={merged_config.colors.text}
              font-size={merged_config.font_size}
            >
              {format_x_tick(tick)}
            </text>
          </g>
        {/each}
        <!-- X-axis label -->
        <text
          x={left + plot_width / 2}
          y={height - 10}
          text-anchor="middle"
          fill={merged_config.colors.text}
          font-size={merged_config.font_size + 2}
        >
          {#if x_axis.label}
            {@html x_axis.label}
          {:else}
            {comp_unit === `fraction` ? `x ` : ``}{component_b}
            ({comp_unit === `fraction` ? `mole fraction` : comp_unit})
          {/if}
        </text>
      </g>

      <!-- Y-axis -->
      <g class="y-axis">
        <line
          x1={left}
          y1={top}
          x2={left}
          y2={bottom}
          stroke={merged_config.colors.axis}
          stroke-width={1}
        />
        {#each y_ticks as tick (tick)}
          <g transform="translate({left}, {y_scale(tick)})">
            <line x2={-6} stroke={merged_config.colors.axis} />
            <text
              x={-10}
              text-anchor="end"
              dominant-baseline="middle"
              fill={merged_config.colors.text}
              font-size={merged_config.font_size}
            >
              {format_num(tick, `.0f`)}
            </text>
          </g>
        {/each}
        <!-- Y-axis label -->
        <text
          transform="rotate(-90)"
          x={-(top + plot_height / 2)}
          y={20}
          text-anchor="middle"
          fill={merged_config.colors.text}
          font-size={merged_config.font_size + 2}
        >
          {#if y_axis.label}
            {@html y_axis.label}
          {:else}
            Temperature ({temp_unit})
          {/if}
        </text>
      </g>

      <!-- Component labels at corners -->
      {#if show_component_labels}
        {#each [[left, component_a], [right, component_b]] as [x_pos, label] (label)}
          <text
            x={x_pos}
            y={bottom + 45}
            text-anchor="middle"
            fill={merged_config.colors.text}
            font-size={merged_config.font_size + 2}
            font-weight="bold"
          >
            {label}
          </text>
        {/each}
      {/if}
    </svg>

    <!-- Tooltip -->
    {#if hover_info}
      <div
        bind:this={tooltip_el}
        class="tooltip-container"
        style:left="{tooltip_pos.x}px"
        style:top="{tooltip_pos.y}px"
      >
        {#if tooltip}
          {@render tooltip(hover_info)}
        {:else}
          <PhaseDiagramTooltip
            {hover_info}
            temperature_unit={temp_unit}
            composition_unit={comp_unit}
            {component_a}
            {component_b}
          />
        {/if}
      </div>
    {/if}

    <!-- Copy feedback indicator -->
    {#if copy_feedback.visible}
      <div
        class="copy-feedback"
        style:left="{copy_feedback.x}px"
        style:top="{copy_feedback.y}px"
      >
        ✓ Copied
      </div>
    {/if}

    <!-- Custom children -->
    {@render children?.({ width, height, fullscreen })}
  {/if}
</div>

<style>
  .binary-phase-diagram {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 400px;
    aspect-ratio: 6 / 5; /* Default aspect ratio matching 600x500 */
    background: var(--pd-bg, transparent);
    container-type: inline-size;
  }
  .binary-phase-diagram.fullscreen {
    background: var(
      --phase-diagram-bg-fullscreen,
      var(--page-bg, #1a1a2e)
    ) !important;
  }
  .header-controls {
    position: absolute;
    top: var(--ctrl-btn-top, 30px);
    right: var(--ctrl-btn-right, 20px);
    display: flex;
    align-items: center;
    gap: 6px;
    z-index: 10;
  }
  .header-controls :global(.fullscreen-toggle) {
    position: static; /* Override absolute positioning since container handles it */
    opacity: 1; /* Always visible when inside header-controls */
  }
  /* Hide controls and fullscreen toggles by default, show on hover */
  .binary-phase-diagram :global(.pane-toggle),
  .binary-phase-diagram .header-controls {
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .binary-phase-diagram:hover :global(.pane-toggle),
  .binary-phase-diagram:hover .header-controls,
  .binary-phase-diagram :global(.pane-toggle:focus-visible),
  .binary-phase-diagram :global(.pane-toggle[aria-expanded='true']),
  .binary-phase-diagram .header-controls:focus-within {
    opacity: 1;
  }
  /* Remove absolute positioning from controls toggle when inside header-controls */
  .header-controls :global(.phase-diagram-controls-toggle) {
    position: static;
  }
  .phase-regions path {
    transition: opacity 0.15s ease;
  }
  .phase-regions path.hovered {
    opacity: 0.85;
    filter: brightness(1.1);
  }
  .region-label {
    pointer-events: none;
    user-select: none;
  }
  .tie-line {
    pointer-events: none;
  }
  .tooltip-container {
    position: fixed;
    z-index: 1000;
    pointer-events: none;
  }
  .copy-feedback {
    position: fixed;
    z-index: 1001;
    pointer-events: none;
    background: rgba(76, 175, 80, 0.95);
    color: white;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    transform: translate(-50%, -100%) translateY(-10px);
    animation: copy-fade-up 1.5s ease-out forwards;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  @keyframes copy-fade-up {
    0% {
      opacity: 1;
      transform: translate(-50%, -100%) translateY(-10px);
    }
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -100%) translateY(-30px);
    }
  }
  /* Ensure SVG elements don't capture pointer events where not needed */
  .grid,
  .region-labels {
    pointer-events: none;
  }
  /* Responsive adjustments */
  @container (max-width: 500px) {
    .binary-phase-diagram {
      min-height: 300px;
    }
  }
</style>
