<script lang="ts">
  import { format_num } from '$lib'
  import {
    FullscreenToggle,
    set_fullscreen_bg,
    setup_fullscreen_effect,
  } from '$lib/layout'
  import { compute_bounding_box_2d, polygon_centroid } from '$lib/math'
  import type { AxisConfig } from '$lib/plot'
  import { constrain_tooltip_position } from '$lib/plot/layout'
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
    compute_label_properties,
    find_phase_at_point,
    format_composition,
    format_hover_info_text,
    generate_boundary_path,
    generate_region_path,
    get_phase_color,
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
    // Temperature display unit (can differ from data.temperature_unit)
    display_temp_unit?: `K` | `°C` | `°F`
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
    display_temp_unit = $bindable(),
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

  // Temperature conversion utilities (defined early for use in scales)
  type TempUnit = `K` | `°C` | `°F`
  const data_temp_unit = $derived<TempUnit>(
    (data.temperature_unit ?? `K`) as TempUnit,
  )
  const temp_unit = $derived<TempUnit>(display_temp_unit ?? data_temp_unit)

  // Convert temperature from one unit to another
  function convert_temp(value: number, from: TempUnit, to: TempUnit): number {
    if (from === to) return value
    // First convert to Kelvin
    let kelvin = value
    if (from === `°C`) kelvin = value + 273.15
    else if (from === `°F`) kelvin = (value - 32) * (5 / 9) + 273.15
    // Then convert from Kelvin to target
    if (to === `K`) return kelvin
    if (to === `°C`) return kelvin - 273.15
    return (kelvin - 273.15) * (9 / 5) + 32 // °F
  }

  // Convert temperature range for display
  const display_temp_range = $derived<[number, number]>([
    convert_temp(data.temperature_range[0], data_temp_unit, temp_unit),
    convert_temp(data.temperature_range[1], data_temp_unit, temp_unit),
  ])

  // y_scale maps data temperatures to SVG coordinates
  // We keep this in data units so region vertices render correctly
  const y_scale = $derived(
    scaleLinear().domain(data.temperature_range).range([bottom, top]),
  )

  // y_scale_display maps display temperatures (after unit conversion) to SVG
  // Used for axis labels and ticks
  const y_scale_display = $derived(
    scaleLinear().domain(display_temp_range).range([bottom, top]),
  )

  // Generate tick values using d3 scale's built-in ticks method
  const x_tick_count = $derived(
    typeof x_axis.ticks === `number` ? x_axis.ticks : 5,
  )
  const y_tick_count = $derived(
    typeof y_axis.ticks === `number` ? y_axis.ticks : 6,
  )
  const x_ticks = $derived(x_scale.ticks(x_tick_count))
  // Use display scale for y ticks so they show converted temperatures
  const y_ticks = $derived(y_scale_display.ticks(y_tick_count))

  // Transform regions to SVG coordinates
  const transformed_regions = $derived(
    (data.regions ?? []).map((region) => {
      const svg_vertices = transform_vertices(region.vertices, x_scale, y_scale)
      const { width, height } = compute_bounding_box_2d(svg_vertices)
      const label_props = compute_label_properties(
        region.name,
        { width, height },
        merged_config.font_size,
      )
      return {
        ...region,
        svg_path: generate_region_path(svg_vertices),
        label_pos: region.label_position
          ? [x_scale(region.label_position[0]), y_scale(region.label_position[1])]
          : polygon_centroid(svg_vertices),
        label_rotation: label_props.rotation,
        label_lines: label_props.lines,
        label_scale: label_props.scale,
      }
    }),
  )

  // Transform boundaries to SVG coordinates
  const transformed_boundaries = $derived(
    (data.boundaries ?? []).map((boundary) => ({
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
  // Locked tooltip state (click to lock, click again to unlock)
  let locked_hover_info = $state<PhaseHoverInfo | null>(null)

  // Clear hover state helper (used in multiple places)
  function clear_hover() {
    hover_info = null
    hovered_region = null
    on_phase_hover?.(null)
  }

  // Handle click to lock/unlock tooltip
  function handle_click() {
    if (locked_hover_info) {
      // Unlock if already locked
      locked_hover_info = null
    } else if (hover_info) {
      // Lock current hover info
      locked_hover_info = { ...hover_info }
    }
  }

  // Effective hover info - locked takes precedence
  const effective_hover_info = $derived(locked_hover_info ?? hover_info)

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

  // Tooltip positioning using shared utility (uses effective_hover_info for locked state)
  const tooltip_pos = $derived.by(() => {
    const info = effective_hover_info
    if (!info) return { x: 0, y: 0 }
    return constrain_tooltip_position(
      info.position.x,
      info.position.y,
      tooltip_el?.offsetWidth ?? 200,
      tooltip_el?.offsetHeight ?? 150,
      globalThis.innerWidth ?? 1000,
      globalThis.innerHeight ?? 800,
      { offset: 15 },
    )
  })

  // Aria-live announcement text for screen readers
  const aria_announcement = $derived.by(() => {
    const info = effective_hover_info
    if (!info) return ``
    const phase_text = `${info.region.name} phase`
    // Convert temperature from data unit to display unit for announcement
    const display_temp = convert_temp(info.temperature, data_temp_unit, temp_unit)
    const temp_text = `${Math.round(display_temp)} ${temp_unit}`
    const comp_text = `${Math.round(info.composition * 100)}% ${component_b}`
    return `${phase_text} at ${temp_text}, ${comp_text}`
  })

  // Unified pointer handler for both mouse and touch events
  function handle_pointer_at(
    client_x: number,
    client_y: number,
    svg: SVGElement,
  ) {
    const rect = svg.getBoundingClientRect()
    const svg_x = client_x - rect.left
    const svg_y = client_y - rect.top

    // Check if within plot area
    if (svg_x < left || svg_x > right || svg_y < top || svg_y > bottom) {
      clear_hover()
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
        position: { x: client_x, y: client_y },
        lever_rule: lever_rule ?? undefined,
      }
      on_phase_hover?.(hover_info)
    } else {
      clear_hover()
    }
  }

  function handle_mouse_move(event: MouseEvent) {
    handle_pointer_at(event.clientX, event.clientY, event.currentTarget as SVGElement)
  }

  // Touch support for mobile devices
  function handle_touch_move(event: TouchEvent) {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    handle_pointer_at(touch.clientX, touch.clientY, event.currentTarget as SVGElement)
    // Prevent scrolling while interacting with the diagram
    event.preventDefault()
  }

  function handle_touch_end() {
    // Don't clear hover on touch end to allow reading the tooltip
    // User can tap elsewhere or tap the locked region to dismiss
  }

  function handle_mouse_leave() {
    // Don't clear if tooltip is locked
    if (!locked_hover_info) clear_hover()
  }

  // Keyboard shortcut handler (Ctrl+Shift+E for export)
  function handle_keyboard_shortcut(event: KeyboardEvent) {
    if (event.ctrlKey && event.shiftKey && event.key === `E`) {
      event.preventDefault()
      export_pane_open = !export_pane_open
    }
    // Escape to unlock tooltip
    if (event.key === `Escape` && locked_hover_info) {
      locked_hover_info = null
    }
  }

  // Fullscreen handling
  $effect(() => {
    setup_fullscreen_effect(fullscreen, wrapper)
    set_fullscreen_bg(wrapper, fullscreen, `--phase-diagram-bg-fullscreen`)
  })

  // Cleanup timeout on unmount to prevent memory leaks
  $effect(() => {
    return () => {
      if (copy_feedback_timeout) clearTimeout(copy_feedback_timeout)
    }
  })

  // Component labels
  const component_a = $derived(data.components[0])
  const component_b = $derived(data.components[1])
  const comp_unit = $derived(data.composition_unit ?? `at%`)

  // Format x-axis tick label (uses shared format_composition without unit suffix)
  const format_x_tick = (value: number): string =>
    format_composition(value, comp_unit, false)
</script>

<!-- Grid lines snippet for DRY rendering -->
{#snippet grid_lines(ticks: number[], vertical: boolean)}
  {#each ticks as tick (tick)}
    <line
      x1={vertical ? x_scale(tick) : left}
      y1={vertical ? top : y_scale_display(tick)}
      x2={vertical ? x_scale(tick) : right}
      y2={vertical ? bottom : y_scale_display(tick)}
      stroke={merged_config.colors.grid}
      stroke-dasharray="4"
    />
  {/each}
{/snippet}

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
  }}
  onkeydown={handle_keyboard_shortcut}
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

    <!-- Aria-live region for screen reader announcements -->
    <div class="sr-only" aria-live="polite" aria-atomic="true">
      {aria_announcement}
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <svg
      class="binary-phase-diagram"
      {width}
      {height}
      onmousemove={handle_mouse_move}
      onmouseleave={handle_mouse_leave}
      onclick={handle_click}
      onkeydown={(event) => {
        // Enter/Space to toggle lock when focused
        if (event.key === `Enter` || event.key === ` `) {
          event.preventDefault()
          handle_click()
        }
      }}
      ondblclick={handle_double_click}
      ontouchmove={handle_touch_move}
      ontouchend={handle_touch_end}
      tabindex="0"
      style={`display: block; cursor: ${
        effective_hover_info ? `crosshair` : `default`
      }; touch-action: none;`}
      role="application"
      aria-label="Binary phase diagram. Use mouse to explore phases. Click to lock tooltip, double-click to copy data. Press Ctrl+Shift+E to export."
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
          {@render grid_lines(x_ticks, true)}
          {@render grid_lines(y_ticks, false)}
        </g>
      {/if}

      <!-- Phase regions -->
      <g class="phase-regions">
        {#each transformed_regions as region (region.id)}
          <path
            d={region.svg_path}
            fill={region.color || get_phase_color(region.name)}
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
      {#if effective_hover_info?.lever_rule}
        {@const info = effective_hover_info}
        {@const lr = effective_hover_info.lever_rule}
        {@const y_pos = y_scale(info.temperature)}
        {@const x_left = x_scale(lr.left_composition)}
        {@const x_right = x_scale(lr.right_composition)}
        {@const tie_line = merged_config.tie_line}
        {@const endpoints = [
        { cx: x_left, color: get_phase_color(lr.left_phase, `rgb`) },
        { cx: x_right, color: get_phase_color(lr.right_phase, `rgb`) },
      ]}
        <g class="tie-line" class:locked={locked_hover_info}>
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
            cx={x_scale(info.composition)}
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
          <g transform="translate({left}, {y_scale_display(tick)})">
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
          y={12}
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

    <!-- Tooltip (uses effective_hover_info which respects locked state) -->
    {#if effective_hover_info}
      <div
        bind:this={tooltip_el}
        class="tooltip-container"
        class:locked={locked_hover_info}
        style:left="{tooltip_pos.x}px"
        style:top="{tooltip_pos.y}px"
      >
        {#if locked_hover_info}
          <div class="tooltip-lock-indicator" title="Click diagram to unlock">🔒</div>
        {/if}
        {#if tooltip}
          {@render tooltip(effective_hover_info)}
        {:else}
          <PhaseDiagramTooltip
            hover_info={effective_hover_info}
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
    animation: tie-line-fade-in 150ms ease-out;
  }
  .tie-line.locked {
    /* Slightly different appearance when locked */
    filter: drop-shadow(0 0 3px rgba(255, 107, 107, 0.5));
  }
  @keyframes tie-line-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .tooltip-container {
    position: fixed;
    z-index: 1000;
    pointer-events: none;
  }
  .tooltip-container.locked {
    /* Allow pointer events when locked so user can interact with tooltip */
    pointer-events: auto;
    /* Add subtle visual distinction for locked state */
    filter: drop-shadow(0 0 4px rgba(99, 102, 241, 0.4));
  }
  .tooltip-lock-indicator {
    position: absolute;
    top: -8px;
    right: -8px;
    font-size: 12px;
    background: rgba(99, 102, 241, 0.9);
    border-radius: 50%;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  /* Screen reader only - visually hidden but accessible */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
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
