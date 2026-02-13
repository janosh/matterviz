<script lang="ts">
  import { format_num } from '$lib/labels'
  import {
    FullscreenToggle,
    set_fullscreen_bg,
    setup_fullscreen_effect,
  } from '$lib/layout'
  import { compute_bounding_box_2d, polygon_centroid, type Vec2 } from '$lib/math'
  import type { AxisConfig } from '$lib/plot'
  import { constrain_tooltip_position } from '$lib/plot/layout'
  import { scaleLinear } from 'd3-scale'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { build_diagram } from './build-diagram'
  import type { DiagramInput } from './diagram-input'
  import PhaseDiagramControls from './PhaseDiagramControls.svelte'
  import PhaseDiagramEditorPane from './PhaseDiagramEditorPane.svelte'
  import PhaseDiagramExportPane from './PhaseDiagramExportPane.svelte'
  import PhaseDiagramTooltip from './PhaseDiagramTooltip.svelte'
  import { parse_phase_diagram_svg } from './svg-to-diagram'
  import type {
    LeverRuleMode,
    PhaseDiagramConfig,
    PhaseDiagramData,
    PhaseDiagramTooltipConfig,
    PhaseHoverInfo,
    PhaseRegion,
    TempUnit,
  } from './types'
  import {
    calculate_lever_rule,
    calculate_vertical_lever_rule,
    compute_label_properties,
    convert_temp,
    find_phase_at_point,
    format_composition,
    format_formula_svg,
    format_hover_info_text,
    format_label_svg,
    generate_boundary_path,
    generate_region_path,
    get_multi_phase_gradient,
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
    // Lever rule mode (horizontal = composition tie-line, vertical = temperature tie-line)
    lever_rule_mode?: LeverRuleMode
    // Diagram input editor (for SVG drop editing)
    diagram_input?: DiagramInput | null
    editor_open?: boolean
    // Axis configuration
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    // Custom tooltip - can be a snippet (replaces default), config object (adds prefix/suffix),
    // or false to disable tooltip entirely
    tooltip?: Snippet<[PhaseHoverInfo]> | PhaseDiagramTooltipConfig | false
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
    lever_rule_mode = $bindable(`horizontal`),
    diagram_input = $bindable<DiagramInput | null>(null),
    editor_open = $bindable(false),
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    tooltip,
    children,
    ...rest
  }: Props = $props()

  // Shared icon/toggle styling for controls and export panes
  const pane_icon_style = `width: 14px; height: 14px`
  const pane_toggle_props = { style: `padding: 0; font-size: 18px` }

  // Rebuild diagram data when diagram_input changes ($derived auto-recomputes)
  const rebuilt_data = $derived.by(() => {
    if (!diagram_input) return null
    try {
      return build_diagram(diagram_input)
    } catch (err) {
      console.warn(`Failed to rebuild diagram from input:`, err)
      return null
    }
  })

  // Use rebuilt data if available, otherwise fall back to the data prop
  const effective_data = $derived(rebuilt_data ?? data)

  // Handle SVG file drop directly on the component
  function handle_svg_drop(event: DragEvent) {
    event.preventDefault()
    const file = event.dataTransfer?.files[0]
    if (!file || (!file.name.endsWith(`.svg`) && file.type !== `image/svg+xml`)) {
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        diagram_input = parse_phase_diagram_svg(reader.result as string)
      } catch (err) {
        console.error(`Failed to parse dropped SVG:`, err)
      }
    }
    reader.readAsText(file)
  }

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

  // Compute x domain from data extent, x_axis.range override, or default [0, 1]
  // Auto-extends to 0/1 when edge regions contain a pure component
  const x_domain = $derived.by((): Vec2 => {
    const lo = x_axis.range?.[0]
    const hi = x_axis.range?.[1]
    if (lo != null && hi != null) return [lo, hi]

    if (effective_data) {
      // Loop-based min/max to avoid stack overflow with large datasets
      let data_min = Infinity
      let data_max = -Infinity
      const update = (val: number) => {
        if (val < data_min) data_min = val
        if (val > data_max) data_max = val
      }
      for (const region of effective_data.regions) {
        for (const vertex of region.vertices) update(vertex[0])
      }
      for (const boundary of effective_data.boundaries) {
        for (const point of boundary.points) update(point[0])
      }
      for (const special_point of effective_data.special_points ?? []) {
        update(special_point.position[0])
      }

      if (data_min <= data_max) {
        let x_min = lo ?? data_min
        let x_max = hi ?? data_max

        // Auto-extend to 0/1 when edge regions contain a pure component AND the
        // data already nearly reaches the boundary. This prevents extending a
        // section diagram (e.g. 0.3–0.7) to the full [0, 1] range.
        // Word boundary regex avoids matching substrings (e.g. "Fe" won't match "Fe3C")
        const comp_at_edge = (comp: string, x_val: number) => {
          const re = new RegExp(
            `\\b${comp.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)}\\b`,
          )
          return effective_data.regions.some((region) =>
            re.test(region.name) &&
            region.vertices.some((vertex) => Math.abs(vertex[0] - x_val) < 1e-6)
          )
        }
        if (
          lo == null && x_min < 0.05 &&
          effective_data.components[0] &&
          comp_at_edge(effective_data.components[0], x_min)
        ) {
          x_min = 0
        }
        if (
          hi == null && x_max > 0.95 &&
          effective_data.components[1] &&
          comp_at_edge(effective_data.components[1], x_max)
        ) {
          x_max = 1
        }

        return [x_min, x_max]
      }
    }
    return [lo ?? 0, hi ?? 1]
  })

  // Scales
  const x_scale = $derived(scaleLinear().domain(x_domain).range([left, right]))

  // Temperature units (guard for initial render when data may be undefined)
  const data_temp_unit = $derived<TempUnit>(
    (effective_data?.temperature_unit ?? `K`) as TempUnit,
  )
  const temp_unit = $derived<TempUnit>(display_temp_unit ?? data_temp_unit)
  const temp_range = $derived(effective_data?.temperature_range ?? [0, 1000])

  // Convert temperature range for display
  const display_temp_range = $derived<Vec2>([
    convert_temp(temp_range[0], data_temp_unit, temp_unit),
    convert_temp(temp_range[1], data_temp_unit, temp_unit),
  ])

  // y_scale maps data temperatures to SVG coordinates
  // We keep this in data units so region vertices render correctly
  const y_scale = $derived(
    scaleLinear().domain(temp_range).range([bottom, top]),
  )

  // y_scale_display maps display temperatures (after unit conversion) to SVG
  // Used for axis labels and ticks
  const y_scale_display = $derived(
    scaleLinear().domain(display_temp_range).range([bottom, top]),
  )

  // Generate tick values using d3 scale's built-in ticks method
  const x_ticks = $derived(
    x_scale.ticks(typeof x_axis.ticks === `number` ? x_axis.ticks : 5),
  )
  // Use display scale for y ticks so they show converted temperatures
  const y_ticks = $derived(
    y_scale_display.ticks(typeof y_axis.ticks === `number` ? y_axis.ticks : 6),
  )

  // Transform regions to SVG coordinates
  const transformed_regions = $derived(
    (effective_data?.regions ?? []).map((region) => {
      const svg_vertices = transform_vertices(region.vertices, x_scale, y_scale)
      const { width, height } = compute_bounding_box_2d(svg_vertices)
      const label_props = compute_label_properties(
        region.name,
        { width, height },
        merged_config.font_size,
      )
      // Get gradient stops for multi-phase regions (2+, supports 3+ phases)
      const gradient = get_multi_phase_gradient(region.name)
      const x_coords = svg_vertices.map(([vx]) => vx)
      return {
        ...region,
        svg_path: generate_region_path(svg_vertices),
        label_pos: region.label_position
          ? [x_scale(region.label_position[0]), y_scale(region.label_position[1])]
          : polygon_centroid(svg_vertices),
        label_rotation: label_props.rotation,
        label_lines: label_props.lines,
        label_scale: label_props.scale,
        gradient,
        x_min: Math.min(...x_coords),
        x_max: Math.max(...x_coords),
      }
    }),
  )

  // Transform boundaries to SVG coordinates
  const transformed_boundaries = $derived(
    (effective_data?.boundaries ?? []).map((boundary) => ({
      ...boundary,
      svg_path: generate_boundary_path(
        transform_vertices(boundary.points, x_scale, y_scale),
      ),
    })),
  )

  // Transform special points to SVG coordinates
  const transformed_special_points = $derived(
    (effective_data?.special_points ?? []).map((point) => ({
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
  let copy_feedback_visible = $state(false)
  let copy_feedback_pos = $state({ x: 0, y: 0 })
  let copy_feedback_timeout: ReturnType<typeof setTimeout> | undefined

  // Handle double-click to copy tooltip data
  async function handle_double_click(event: MouseEvent) {
    if (!hover_info) return
    try {
      await navigator.clipboard.writeText(
        format_hover_info_text(
          hover_info,
          temp_unit,
          comp_unit,
          component_a,
          component_b,
          data_temp_unit,
          lever_rule_mode,
        ),
      )
      if (copy_feedback_timeout) clearTimeout(copy_feedback_timeout)
      copy_feedback_pos = { x: event.clientX, y: event.clientY }
      copy_feedback_visible = true
      copy_feedback_timeout = setTimeout(() => {
        copy_feedback_visible = false
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

  // Find nearest special point within threshold (in SVG pixels)
  function find_nearby_special_point(
    svg_x: number,
    svg_y: number,
    threshold: number = 20,
  ) {
    let nearest: (typeof transformed_special_points)[0] | null = null
    let min_dist = threshold
    for (const point of transformed_special_points) {
      const dist = Math.hypot(point.svg_x - svg_x, point.svg_y - svg_y)
      if (dist < min_dist) {
        min_dist = dist
        nearest = point
      }
    }
    return nearest
  }

  // Pointer move handler (unified mouse/touch via Pointer Events API)
  function handle_pointer_move(event: PointerEvent) {
    const svg = event.currentTarget as SVGElement
    const rect = svg.getBoundingClientRect()
    const svg_x = event.clientX - rect.left
    const svg_y = event.clientY - rect.top

    // Check if within plot area
    if (
      svg_x < left || svg_x > right || svg_y < top || svg_y > bottom ||
      !effective_data
    ) {
      clear_hover()
      return
    }

    // Convert to data coordinates and find phase
    const composition = x_scale.invert(svg_x)
    const temperature = y_scale.invert(svg_y)
    const region = find_phase_at_point(composition, temperature, effective_data)

    // Check for nearby special point
    const nearby_special = show_special_points
      ? find_nearby_special_point(svg_x, svg_y)
      : null

    if (region) {
      hovered_region = region
      hover_info = {
        region,
        composition,
        temperature,
        position: { x: event.clientX, y: event.clientY },
        lever_rule: calculate_lever_rule(region, composition, temperature) ||
          undefined,
        vertical_lever_rule:
          calculate_vertical_lever_rule(region, composition, temperature) ||
          undefined,
        special_point: nearby_special || undefined,
      }
      on_phase_hover?.(hover_info)
    } else {
      clear_hover()
    }
  }

  function handle_pointer_leave(event: PointerEvent) {
    // Don't clear on touch lift (allows reading tooltip) or when locked
    if (event.pointerType === `touch` || locked_hover_info) return
    clear_hover()
  }

  // Document-level keyboard shortcuts
  function handle_doc_keydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === `E`) {
      event.preventDefault()
      export_pane_open = !export_pane_open
    } else if (event.key === `Escape` && locked_hover_info) {
      locked_hover_info = null
    }
  }

  // SVG keyboard handler (Enter/Space to toggle lock)
  function handle_svg_keydown(event: KeyboardEvent) {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      handle_click()
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

  // Component labels (guard for initial render when data may be undefined)
  const component_a = $derived(effective_data?.components?.[0] ?? ``)
  const component_b = $derived(effective_data?.components?.[1] ?? ``)
  const comp_unit = $derived(effective_data?.composition_unit ?? `at%`)

  // Pseudo-binary support: format compound names with subscripts when enabled
  const use_subscripts = $derived(
    effective_data?.pseudo_binary?.use_subscripts ?? true,
  )

  // Formatted component labels for SVG axis labels (with tspan subscripts if compound)
  const component_a_svg = $derived(format_formula_svg(component_a, use_subscripts))
  const component_b_svg = $derived(format_formula_svg(component_b, use_subscripts))

  // Default x-axis label as a single string (avoids mixing plain text with {@html})
  const default_x_axis_label = $derived.by(() => {
    const prefix = comp_unit === `fraction` ? `x ` : ``
    const unit = comp_unit === `fraction` ? `mole fraction` : comp_unit
    return `${prefix}${component_b_svg} (${unit})`
  })
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

<!-- Tie-line snippet: renders line with white outline, phase endpoints, and cursor marker -->
{#snippet tie_line_viz(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  endpoints: Array<{ cx: number; cy: number; color: string }>,
  cursor_cx: number,
  cursor_cy: number,
)}
  {@const tl = merged_config.tie_line}
  <g class="tie-line" class:locked={locked_hover_info}>
    {#each [`white`, `rgb(${PHASE_COLOR_RGB.tie_line})`] as stroke (stroke)}
      <line
        {x1}
        {y1}
        {x2}
        {y2}
        {stroke}
        stroke-width={tl.stroke_width + (stroke === `white` ? 1 : 0)}
        stroke-linecap="round"
      />
    {/each}
    {#each endpoints as ep, idx (idx)}
      <circle
        cx={ep.cx}
        cy={ep.cy}
        r={tl.endpoint_radius}
        fill="rgb({ep.color})"
        stroke="white"
        stroke-width={1.5}
      />
    {/each}
    <circle
      cx={cursor_cx}
      cy={cursor_cy}
      r={tl.cursor_radius}
      fill="rgb({PHASE_COLOR_RGB.tie_line})"
      stroke="white"
      stroke-width={2}
    />
  </g>
{/snippet}

<svelte:document
  onfullscreenchange={() => {
    fullscreen = Boolean(document.fullscreenElement)
  }}
  onkeydown={handle_doc_keydown}
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
  ondrop={handle_svg_drop}
  ondragover={(ev) => ev.preventDefault()}
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
          bind:lever_rule_mode
          bind:x_axis
          bind:y_axis
          bind:png_dpi
          data={effective_data}
          {enable_export}
          {...controls_props}
          icon_style={pane_icon_style}
          toggle_props={pane_toggle_props}
        />
      {/if}
      {#if enable_export}
        <PhaseDiagramExportPane
          bind:export_pane_open
          bind:png_dpi
          data={effective_data}
          {wrapper}
          filename={export_filename}
          icon_style={pane_icon_style}
          toggle_props={pane_toggle_props}
        />
      {/if}
      {#if diagram_input}
        <PhaseDiagramEditorPane
          bind:editor_open
          bind:diagram_input
          icon_style={pane_icon_style}
          toggle_props={pane_toggle_props}
        />
      {/if}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <svg
      class="binary-phase-diagram"
      {width}
      {height}
      onpointermove={handle_pointer_move}
      onpointerleave={handle_pointer_leave}
      onclick={handle_click}
      onkeydown={handle_svg_keydown}
      ondblclick={handle_double_click}
      tabindex="0"
      style:display="block"
      style:cursor={effective_hover_info ? `crosshair` : `default`}
      style:touch-action="none"
      role="application"
      aria-label="Binary phase diagram. Use mouse to explore phases. Click to lock tooltip, double-click to copy data. Press Ctrl/Cmd+Shift+E to export."
    >
      <!-- Gradient definitions for multi-phase regions (2+ phases) -->
      <defs>
        {#each transformed_regions as region (region.id)}
          {#if region.gradient}
            <linearGradient
              id="gradient-{region.id}"
              x1={region.x_min}
              x2={region.x_max}
              y1="0"
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              {#each region.gradient as stop, idx (idx)}
                <stop
                  offset="{stop.offset * 100}%"
                  stop-color={stop.color}
                  stop-opacity="0.6"
                />
              {/each}
            </linearGradient>
          {/if}
        {/each}
      </defs>

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
            fill={region.gradient
            ? `url(#gradient-${region.id})`
            : (region.color || get_phase_color(region.name))}
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
              stroke={boundary.style?.color ?? merged_config.colors.boundary}
              stroke-width={boundary.style?.width || 2}
              stroke-dasharray={boundary.style?.dash || ``}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
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
                  {@html format_label_svg(line, use_subscripts)}
                </text>
              {/each}
            </g>
          {/each}
        </g>
      {/if}

      <!-- Tie-line visualization for two-phase regions -->
      {#if lever_rule_mode === `vertical` && effective_hover_info?.vertical_lever_rule}
        {@const vlr = effective_hover_info.vertical_lever_rule}
        {@const cx = x_scale(effective_hover_info.composition)}
        {@const y_bot = y_scale(vlr.bottom_temperature)}
        {@const y_top = y_scale(vlr.top_temperature)}
        {@render tie_line_viz(
        cx,
        y_bot,
        cx,
        y_top,
        [
          { cx, cy: y_bot, color: get_phase_color(vlr.bottom_phase, `rgb`) },
          { cx, cy: y_top, color: get_phase_color(vlr.top_phase, `rgb`) },
        ],
        cx,
        y_scale(effective_hover_info.temperature),
      )}
      {:else if lever_rule_mode === `horizontal` && effective_hover_info?.lever_rule}
        {@const lr = effective_hover_info.lever_rule}
        {@const cy = y_scale(effective_hover_info.temperature)}
        {@const x_l = x_scale(lr.left_composition)}
        {@const x_r = x_scale(lr.right_composition)}
        {@render tie_line_viz(
        x_l,
        cy,
        x_r,
        cy,
        [
          { cx: x_l, cy, color: get_phase_color(lr.left_phase, `rgb`) },
          { cx: x_r, cy, color: get_phase_color(lr.right_phase, `rgb`) },
        ],
        x_scale(effective_hover_info.composition),
        cy,
      )}
      {/if}

      <!-- Special points (rendered last for highest z-index) -->
      {#if show_special_points}
        <g class="special-points">
          {#each transformed_special_points as point (point.id)}
            <!-- Larger hit area for easier hovering (2x radius) -->
            <circle
              cx={point.svg_x}
              cy={point.svg_y}
              r={merged_config.special_point_radius * 2}
              fill="transparent"
              class="special-point-hit-area"
            />
            <circle
              cx={point.svg_x}
              cy={point.svg_y}
              r={merged_config.special_point_radius}
              fill={merged_config.colors.special_point}
              stroke="white"
              stroke-width={1.5}
              class="special-point-marker"
            />
            {#if point.label}
              {@const is_near_left = point.position[0] <= 0.05}
              {@const is_near_right = point.position[0] >= 0.95}
              {@const anchor = is_near_left ? `start` : is_near_right ? `end` : `middle`}
              {@const x_offset = is_near_left ? 4 : is_near_right ? -4 : 0}
              <text
                x={point.svg_x + x_offset}
                y={point.svg_y - merged_config.special_point_radius * 2}
                text-anchor={anchor}
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
              {format_composition(tick, comp_unit, false)}
            </text>
          </g>
        {/each}
        <!-- X-axis label (supports custom labels from props, data, or auto-generated with subscripts) -->
        <text
          x={left + plot_width / 2}
          y={height - 10}
          text-anchor="middle"
          fill={merged_config.colors.text}
          font-size={merged_config.font_size + 2}
        >
          {#if x_axis.label}
            {@html x_axis.label}
          {:else if effective_data?.x_axis_label}
            {@html effective_data.x_axis_label}
          {:else}
            {@html default_x_axis_label}
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
        <!-- Y-axis label (supports custom labels from props or data) -->
        <text
          transform="rotate(-90)"
          x={-(top + plot_height / 2)}
          y={16}
          text-anchor="middle"
          fill={merged_config.colors.text}
          font-size={merged_config.font_size + 2}
        >
          {#if y_axis.label}
            {@html y_axis.label}
          {:else if effective_data?.y_axis_label}
            {@html effective_data.y_axis_label}
          {:else}
            Temperature ({temp_unit})
          {/if}
        </text>
      </g>

      <!-- Component labels at corners (supports compound formulas with subscripts) -->
      {#if show_component_labels}
        <text
          x={left}
          y={bottom + 45}
          text-anchor="middle"
          fill={merged_config.colors.text}
          font-size={merged_config.font_size + 2}
          font-weight="bold"
        >
          {@html component_a_svg}
        </text>
        <text
          x={right}
          y={bottom + 45}
          text-anchor="middle"
          fill={merged_config.colors.text}
          font-size={merged_config.font_size + 2}
          font-weight="bold"
        >
          {@html component_b_svg}
        </text>
      {/if}
    </svg>

    <!-- Tooltip (uses effective_hover_info which respects locked state) -->
    <!-- tooltip={false} disables tooltip entirely -->
    {#if effective_hover_info && tooltip !== false}
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
        {#if typeof tooltip === `function`}
          {@render tooltip(effective_hover_info)}
        {:else}
          <PhaseDiagramTooltip
            hover_info={effective_hover_info}
            temperature_unit={temp_unit}
            data_temperature_unit={data_temp_unit}
            composition_unit={comp_unit}
            {component_a}
            {component_b}
            boundaries={effective_data?.boundaries ?? []}
            {lever_rule_mode}
            {use_subscripts}
            {tooltip}
          />
        {/if}
      </div>
    {/if}

    <!-- Copy feedback indicator -->
    {#if copy_feedback_visible}
      <div
        class="copy-feedback"
        style:left="{copy_feedback_pos.x}px"
        style:top="{copy_feedback_pos.y}px"
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

    &.fullscreen {
      background: var(--phase-diagram-bg-fullscreen, var(--page-bg, #1a1a2e)) !important;
    }
    @container (max-width: 500px) {
      min-height: 300px;
    }
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
  /* Override absolute positioning since container handles it */
  .header-controls :global(:is(.fullscreen-toggle, .phase-diagram-controls-toggle)) {
    position: static;
  }
  .header-controls :global(.fullscreen-toggle) {
    opacity: 1; /* Always visible when inside header-controls */
  }
  /* Hide controls and fullscreen toggles by default, show on hover/focus */
  .binary-phase-diagram :global(:is(.pane-toggle, .header-controls)) {
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .binary-phase-diagram:is(:hover, :focus-within)
    :is(:global(.pane-toggle), .header-controls),
  .binary-phase-diagram :global(.pane-toggle:is(:focus-visible, [aria-expanded='true'])) {
    opacity: 1;
  }
  .phase-regions path {
    transition: opacity 0.15s ease;

    &.hovered {
      opacity: 0.85;
      filter: brightness(1.1);
    }
  }
  .special-points {
    pointer-events: auto;
  }
  .special-point-hit-area {
    cursor: pointer;
    pointer-events: auto;
  }
  .special-point-hit-area:hover + .special-point-marker {
    filter: brightness(1.3) drop-shadow(0 0 4px currentColor);
  }
  .special-point-marker {
    pointer-events: none; /* Let hit-area handle events */
  }
  /* Grouped pointer-events: none */
  .region-label, .tie-line, .tooltip-container, .copy-feedback, .grid, .region-labels {
    pointer-events: none;
  }
  .region-label {
    user-select: none;
  }
  .tie-line {
    animation: tie-line-fade-in 150ms ease-out;

    &.locked {
      filter: drop-shadow(0 0 3px rgba(255, 107, 107, 0.5));
    }
  }
  @keyframes tie-line-fade-in {
    from {
      opacity: 0;
    }
  }
  :is(.tooltip-container, .copy-feedback) {
    position: fixed;
  }
  .tooltip-container {
    z-index: 1000;

    &.locked {
      pointer-events: auto; /* Allow interaction when locked */
      filter: drop-shadow(0 0 4px rgba(99, 102, 241, 0.4));
    }
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
  .copy-feedback {
    z-index: 1001;
    background: rgba(76, 175, 80, 0.95);
    color: white;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    transform: translate(-50%, calc(-100% - 10px));
    animation: copy-fade-up 1.5s ease-out forwards;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  @keyframes copy-fade-up {
    0%, 70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(-50%, calc(-100% - 30px));
    }
  }
</style>
