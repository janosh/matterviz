<script lang="ts">
  import { create_flash } from '$lib/effects.svelte'
  import { DEFAULT_PNG_DPI } from '$lib/constants'
  import EmptyState from '$lib/EmptyState.svelte'
  import { ClickFeedback } from 'svelte-widgets'
  import { create_file_drop_handler } from '$lib/io/file-drop'
  import { format_num } from '$lib/labels'
  import { normalize_show_controls, type ShowControlsProp } from '$lib/controls'
  import { ViewerChrome } from '$lib/layout'
  import { sanitize_svg } from '$lib/sanitize'
  import { array_extent, compute_bounding_box_2d, polygon_centroid } from '$lib/math'
  import { type AxisConfig, PlotTooltip } from '$lib/plot'
  import { unique_id } from '$lib/plot/core/utils'
  import { handle_and_prevent, to_error } from '$lib/utils'
  import { forward_window_keydown } from 'svelte-widgets/attachments'
  import { is_editable_event_target, is_modifier_chord } from 'svelte-widgets/utils'
  import { scaleLinear } from 'd3-scale'
  import { type Snippet, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { build_diagram } from './build-diagram'
  import type { DiagramInput } from './diagram-input'
  import PhaseDiagramControls from './PhaseDiagramControls.svelte'
  import PhaseDiagramEditorPane from './PhaseDiagramEditorPane.svelte'
  import PhaseDiagramExportPane from './PhaseDiagramExportPane.svelte'
  import PhaseDiagramTooltip from './PhaseDiagramTooltip.svelte'
  import { parse_phase_diagram_svg } from './svg-to-diagram'
  import type {
    PhaseDiagramConfig,
    PhaseDiagramData,
    PhaseDiagramTooltipConfig,
    PhaseHoverInfo,
    PhaseRegion,
    TempUnit,
  } from './types'
  import { format_formula_svg, format_label_svg } from '$lib/composition/format'
  import {
    calculate_lever_rule,
    compute_label_properties,
    compute_x_domain,
    convert_temp,
    find_phase_at_point,
    format_composition,
    format_hover_info_text,
    generate_boundary_path,
    generate_region_path,
    get_multi_phase_gradient,
    get_phase_color,
    merge_phase_diagram_config,
    PHASE_DIAGRAM_DEFAULTS,
    TIE_LINE_COLOR,
    transform_vertices,
  } from './utils'

  let {
    data: data_prop,
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
    show_controls,
    display_temp_unit = $bindable(),
    controls_open = $bindable(false),
    export_pane_open = $bindable(false),
    png_dpi = $bindable(DEFAULT_PNG_DPI),
    export_filename = `phase-diagram`,
    diagram_input = $bindable<DiagramInput | null>(null),
    editor_open = $bindable(false),
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    tooltip,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    data?: PhaseDiagramData
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
    show_controls?: ShowControlsProp<`controls` | `export` | `editor` | `fullscreen`>
    // Temperature display unit (can differ from data.temperature_unit)
    display_temp_unit?: `K` | `°C` | `°F`
    controls_open?: boolean
    // Export options
    export_pane_open?: boolean
    png_dpi?: number
    export_filename?: string
    // Diagram input editor (for SVG drop editing)
    diagram_input?: DiagramInput | null
    editor_open?: boolean
    // Axis configuration
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    // Custom tooltip - can be a snippet (replaces default), config object (adds prefix/suffix),
    // or false to disable tooltip entirely
    tooltip?: Snippet<[PhaseHoverInfo]> | PhaseDiagramTooltipConfig | false
    children?: Snippet<[{ width: number; height: number; fullscreen: boolean }]>
  } = $props()

  // Keep calculations safe while the template renders the missing-data state.
  const missing_data_placeholder: PhaseDiagramData = {
    components: [``, ``],
    temperature_range: [0, 1],
    regions: [],
    boundaries: [],
  }

  // `always` by default: the editor and export toggles are how users discover those features
  const controls_config = $derived(normalize_show_controls(show_controls, `always`))
  // Shared icon/toggle styling for the controls, export and editor panes
  const pane_props = {
    icon_style: `width: 14px; height: 14px`,
    toggle_props: { style: `padding: 0` },
  }

  // Instance-unique prefix for gradient ids: region ids come from user data (e.g.
  // 'liquid'), so two diagrams on one page would otherwise cross-reference each
  // other's gradients (first-in-document wins, with that instance's pixel coords)
  const gradient_uid = unique_id(`pd-gradient`)

  // A diagram_input that fails to build is surfaced as an error banner rather than silently
  // falling back to the data prop.
  const rebuilt = $derived.by((): { data: PhaseDiagramData | null; error: string | null } => {
    if (!diagram_input) return { data: null, error: null }
    try {
      return { data: build_diagram(diagram_input), error: null }
    } catch (error) {
      return { data: null, error: `Invalid phase diagram input: ${to_error(error).message}` }
    }
  })
  let drop_error = $state<string | null>(null)
  const input_error = $derived(drop_error ?? rebuilt.error)

  // Direct editor edits can override this value until either source changes.
  let source_data = $derived(rebuilt.data ?? data_prop)
  const effective_data = $derived(source_data ?? missing_data_placeholder)

  // Handle SVG file drop directly on the component. The shared handler reads the file,
  // expands dropped folders and serializes overlapping drops; only the SVG filter and the
  // parse are specific to this diagram.
  const handle_svg_drop = create_file_drop_handler({
    allow: () => true,
    on_drop: (content, filename, { file }) => {
      if (!filename.endsWith(`.svg`) && file?.type !== `image/svg+xml`) return
      if (typeof content !== `string`) return
      drop_error = null
      diagram_input = parse_phase_diagram_svg(content)
    },
    // covers reading, decompressing and the parse above, since on_drop is awaited inside
    // the handler's per-file try — hence the generic wording
    on_error: (msg) => (drop_error = `Phase diagram file drop failed: ${msg}`),
  })

  const merged_config = $derived(merge_phase_diagram_config(config))

  // Dimensions - use container size directly, no fallback to avoid layout shift
  let width = $state(0)
  let height = $state(0)

  const margin = $derived(merged_config.margin)

  const left = $derived(margin.l)
  const right = $derived(width - margin.r)
  const top = $derived(margin.t)
  const bottom = $derived(height - margin.b)
  const plot_width = $derived(right - left)
  const plot_height = $derived(bottom - top)

  // Compute x domain from data extent, x_axis.range override, or default [0, 1]
  // Auto-extends to 0/1 when edge regions contain a pure component
  const x_domain = $derived(compute_x_domain(x_axis.range, effective_data))

  const x_scale = $derived(scaleLinear().domain(x_domain).range([left, right]))

  const data_temp_unit = $derived<TempUnit>(effective_data.temperature_unit ?? `K`)
  const temp_unit = $derived<TempUnit>(display_temp_unit ?? data_temp_unit)
  const temp_range = $derived(effective_data.temperature_range)

  // y_scale maps data temperatures to SVG coordinates
  // We keep this in data units so region vertices render correctly
  const y_scale = $derived(scaleLinear().domain(temp_range).range([bottom, top]))

  // y_scale_display maps display temperatures (after unit conversion) to SVG
  // Used for axis labels and ticks
  const y_scale_display = $derived(
    scaleLinear()
      .domain(temp_range.map((temp) => convert_temp(temp, data_temp_unit, temp_unit)))
      .range([bottom, top]),
  )

  const tick_count = (axis: AxisConfig, fallback: number): number =>
    typeof axis.ticks === `number` ? axis.ticks : fallback
  const x_ticks = $derived(x_scale.ticks(tick_count(x_axis, PHASE_DIAGRAM_DEFAULTS.x_ticks)))
  const y_ticks = $derived(
    y_scale_display.ticks(tick_count(y_axis, PHASE_DIAGRAM_DEFAULTS.y_ticks)),
  )

  const transformed_regions = $derived(
    effective_data.regions.map((region) => {
      const svg_vertices = transform_vertices(region.vertices, x_scale, y_scale)
      const { width: box_width, height: box_height } = compute_bounding_box_2d(svg_vertices)
      const label_props = compute_label_properties(
        region.name,
        { width: box_width, height: box_height },
        merged_config.font_size,
      )
      const gradient = get_multi_phase_gradient(region.name)
      const [x_min, x_max] = array_extent(svg_vertices.map(([vx]) => vx))
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
        x_min,
        x_max,
      }
    }),
  )

  const transformed_boundaries = $derived(
    effective_data.boundaries.map((boundary) => ({
      ...boundary,
      svg_path: generate_boundary_path(transform_vertices(boundary.points, x_scale, y_scale)),
    })),
  )

  const transformed_special_points = $derived(
    (effective_data.special_points ?? []).map((point) => ({
      ...point,
      svg_x: x_scale(point.position[0]),
      svg_y: y_scale(point.position[1]),
    })),
  )

  let hover_info = $state<PhaseHoverInfo | null>(null)
  // Locked tooltip state (click to lock, click again to unlock)
  let locked_hover_info = $state<PhaseHoverInfo | null>(null)

  function clear_hover() {
    hover_info = null
    hovered_region = null
    on_phase_hover?.(null)
  }

  // Hover and lock state describe the previous data, so drop them when the data changes
  $effect(() => {
    void source_data
    untrack(() => {
      if (!hover_info && !locked_hover_info && !hovered_region) return
      locked_hover_info = null
      clear_hover()
    })
  })

  // Click toggles the tooltip lock
  function handle_click() {
    if (locked_hover_info) locked_hover_info = null
    else if (hover_info) locked_hover_info = { ...hover_info }
  }

  const effective_hover_info = $derived(locked_hover_info ?? hover_info)

  // Isothermal tie-line geometry (SVG px); null outside two-phase regions.
  // The line runs between the two endpoint markers, the cursor marker sits at the hover point.
  const tie_line = $derived.by(() => {
    const info = effective_hover_info
    if (!info) return null
    const cursor = { cx: x_scale(info.composition), cy: y_scale(info.temperature) }
    const endpoint = (phase: string, cx: number, cy: number) =>
      ({ cx, cy, color: get_phase_color(phase, `hex`) }) as const
    const { lever_rule: lr } = info
    if (!lr) return null
    const endpoints = [
      endpoint(lr.left_phase, x_scale(lr.left_composition), cursor.cy),
      endpoint(lr.right_phase, x_scale(lr.right_composition), cursor.cy),
    ] as const
    return { cursor, endpoints }
  })

  // Copy feedback position; ClickFeedback's CSS animation fades it out and the template keys
  // on the position object so back-to-back copies each remount and restart the animation
  const copy_feedback_pos = create_flash<{ x: number; y: number } | null>(null, 1500)

  async function handle_double_click(event: MouseEvent) {
    const info = effective_hover_info
    if (!info) return
    try {
      await navigator.clipboard.writeText(
        format_hover_info_text(info, {
          temp_unit,
          comp_unit,
          component_a,
          component_b,
          data_temp_unit,
        }),
      )
      copy_feedback_pos.show({ x: event.clientX, y: event.clientY })
    } catch (error) {
      console.error(`Failed to copy phase data:`, error)
    }
  }

  function find_nearby_special_point(svg_x: number, svg_y: number, threshold: number = 20) {
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

  function handle_pointer_move(event: PointerEvent & { currentTarget: SVGElement }) {
    const rect = event.currentTarget.getBoundingClientRect()
    const svg_x = event.clientX - rect.left
    const svg_y = event.clientY - rect.top
    const in_plot = svg_x >= left && svg_x <= right && svg_y >= top && svg_y <= bottom
    const composition = x_scale.invert(svg_x)
    const temperature = y_scale.invert(svg_y)
    const region = in_plot
      ? find_phase_at_point(composition, temperature, effective_data)
      : null
    if (!region) return clear_hover()

    const nearby_special = show_special_points ? find_nearby_special_point(svg_x, svg_y) : null
    hovered_region = region
    hover_info = {
      region,
      composition,
      temperature,
      position: { x: event.clientX, y: event.clientY },
      lever_rule:
        calculate_lever_rule(region, composition, temperature, effective_data.regions) ||
        undefined,
      special_point: nearby_special || undefined,
    }
    on_phase_hover?.(hover_info)
  }

  function handle_pointer_leave(event: PointerEvent) {
    // Don't clear on touch lift (allows reading tooltip) or when locked
    if (event.pointerType === `touch` || locked_hover_info) return
    clear_hover()
  }

  // Plain letters like every other viewer, scoped to this one rather than the whole
  // document, which is what forced a chord here before. Bound twice: on the root for keys
  // from a focused descendant (clicking a region focuses the SVG, and the window forwarder
  // ignores those), and on the window for the hover-without-focus case. The root fires
  // first and prevents the default, so the forwarder's pass is a no-op.
  function handle_keydown(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) return false
    if (is_editable_event_target(event.target) || is_modifier_chord(event)) return false
    if (event.key === `e` && !event.repeat) {
      export_pane_open = !export_pane_open
      return true
    }
    if (event.key === `Escape` && locked_hover_info) {
      locked_hover_info = null
      return true
    }
    return false
  }

  function handle_svg_keydown(event: KeyboardEvent) {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      handle_click()
    }
  }

  const component_a = $derived(effective_data.components[0])
  const component_b = $derived(effective_data.components[1])
  const comp_unit = $derived(effective_data.composition_unit ?? `at%`)

  // Pseudo-binary support: format compound names with subscripts when enabled
  const use_subscripts = $derived(effective_data.pseudo_binary?.use_subscripts ?? true)

  // Formatted component labels for SVG axis labels (with tspan subscripts if compound)
  const component_a_svg = $derived(format_formula_svg(component_a, use_subscripts))
  const component_b_svg = $derived(format_formula_svg(component_b, use_subscripts))

  // Default x-axis label as a single string (avoids mixing plain text with {@html})
  const default_x_axis_label = $derived(
    comp_unit === `fraction`
      ? `x ${component_b_svg} (mole fraction)`
      : `${component_b_svg} (${comp_unit})`,
  )
</script>

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

<div
  {...rest}
  class={[`binary-phase-diagram`, rest.class, { fullscreen }]}
  bind:this={wrapper}
  onkeydown={handle_and_prevent(handle_keydown)}
  {@attach forward_window_keydown({ handle: handle_keydown })}
  bind:clientWidth={width}
  bind:clientHeight={height}
  role="img"
  aria-label={source_data === undefined
    ? `Missing phase diagram data. Provide diagram data through the data prop.`
    : `${component_a}-${component_b} binary phase diagram`}
  ondrop={handle_svg_drop}
  ondragover={(ev) => ev.preventDefault()}
>
  {#if input_error}
    <div class="error" role="alert">{input_error}</div>
  {/if}
  {#if source_data === undefined}
    <EmptyState role="status">
      <h3>Missing phase diagram data</h3>
      <p>Provide diagram data through the <code>data</code> prop.</p>
    </EmptyState>
  {:else if width > 0 && height > 0}
    <ViewerChrome
      {controls_config}
      bind:fullscreen
      {fullscreen_toggle}
      {wrapper}
      fullscreen_bg_css_var="--phase-diagram-bg-fullscreen"
      style="--viewer-buttons-top: var(--ctrl-btn-top, 30px); --viewer-buttons-right: var(--ctrl-btn-right, 20px)"
    >
      {#if controls_config.visible(`controls`)}
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
          data={effective_data}
          {enable_export}
          {...pane_props}
        />
      {/if}
      {#if enable_export && controls_config.visible(`export`)}
        <PhaseDiagramExportPane
          bind:export_pane_open
          bind:png_dpi
          data={effective_data}
          {wrapper}
          filename={export_filename}
          {...pane_props}
        />
      {/if}
      {#if controls_config.visible(`editor`)}
        <PhaseDiagramEditorPane
          bind:editor_open
          bind:diagram_input
          data={effective_data}
          on_data={(edited) => (source_data = edited)}
          {...pane_props}
        />
      {/if}
    </ViewerChrome>

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
      style="display: block; cursor: {effective_hover_info
        ? `crosshair`
        : `default`}; touch-action: none"
      role="application"
      aria-label="Binary phase diagram. Use mouse to explore phases. Click to lock tooltip, double-click to copy data. Press E to export."
    >
      <!-- Gradient definitions for multi-phase regions (2+ phases) -->
      <defs>
        {#each transformed_regions as region (region.id)}
          {#if region.gradient}
            <linearGradient
              id="{gradient_uid}-{region.id}"
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

      <rect
        x={left}
        y={top}
        width={plot_width}
        height={plot_height}
        fill={merged_config.colors.background}
      />

      {#if show_grid}
        <g class="grid" style="pointer-events: none">
          {@render grid_lines(x_ticks, true)}
          {@render grid_lines(y_ticks, false)}
        </g>
      {/if}

      <g class="phase-regions">
        {#each transformed_regions as region (region.id)}
          <path
            d={region.svg_path}
            fill={region.gradient
              ? `url(#${gradient_uid}-${region.id})`
              : region.color || get_phase_color(region.name)}
            stroke="none"
            class:hovered={hovered_region?.id === region.id}
          />
        {/each}
      </g>

      {#if show_boundaries}
        <g class="boundaries">
          {#each transformed_boundaries as boundary (boundary.id)}
            <path
              d={boundary.svg_path}
              fill="none"
              stroke={boundary.style?.color ?? merged_config.colors.boundary}
              stroke-width={boundary.style?.width ?? 2}
              stroke-dasharray={boundary.style?.dash || ``}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          {/each}
        </g>
      {/if}

      {#if show_labels}
        <g class="region-labels" style="pointer-events: none">
          {#each transformed_regions as region (region.id)}
            {@const line_height = merged_config.font_size * 1.2}
            <g
              transform="translate({region.label_pos[0]}, {region
                .label_pos[1]}) rotate({region.label_rotation}) scale({region.label_scale})"
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
                  {@html sanitize_svg(format_label_svg(line, use_subscripts))}
                </text>
              {/each}
            </g>
          {/each}
        </g>
      {/if}

      <!-- Tie-line for two-phase regions: white-outlined line, phase endpoints, cursor marker -->
      {#if tie_line}
        {@const {
          cursor,
          endpoints: [start, end],
        } = tie_line}
        {@const tl = merged_config.tie_line}
        <g class="tie-line" class:locked={locked_hover_info}>
          {#each [`white`, TIE_LINE_COLOR] as stroke (stroke)}
            <line
              x1={start.cx}
              y1={start.cy}
              x2={end.cx}
              y2={end.cy}
              {stroke}
              stroke-width={tl.stroke_width + (stroke === `white` ? 1 : 0)}
              stroke-linecap="round"
            />
          {/each}
          {#each tie_line.endpoints as ep, idx (idx)}
            <circle
              cx={ep.cx}
              cy={ep.cy}
              r={tl.endpoint_radius}
              fill={ep.color}
              stroke="white"
              stroke-width={1.5}
            />
          {/each}
          <circle
            cx={cursor.cx}
            cy={cursor.cy}
            r={tl.cursor_radius}
            fill={TIE_LINE_COLOR}
            stroke="white"
            stroke-width={2}
          />
        </g>
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
          {@html sanitize_svg(
            x_axis.label || effective_data.x_axis_label || default_x_axis_label,
          )}
        </text>
      </g>

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
          {@html sanitize_svg(
            y_axis.label || effective_data.y_axis_label || `Temperature (${temp_unit})`,
          )}
        </text>
      </g>

      <!-- Component labels at corners (supports compound formulas with subscripts) -->
      {#if show_component_labels}
        {#each [component_a_svg, component_b_svg] as svg, idx (idx)}
          <text
            x={idx === 0 ? left : right}
            y={bottom + 45}
            text-anchor="middle"
            fill={merged_config.colors.text}
            font-size={merged_config.font_size + 2}
            font-weight="bold"
          >
            {@html sanitize_svg(svg)}
          </text>
        {/each}
      {/if}
    </svg>

    {#if effective_hover_info && tooltip !== false}
      <PlotTooltip
        x={effective_hover_info.position.x}
        y={effective_hover_info.position.y}
        fixed
        offset={{ x: 15, y: 15 }}
        fallback_size={{ width: 200, height: 150 }}
        class={[`tooltip-container`, { locked: locked_hover_info }]}
        style="--plot-tooltip-padding: 0; white-space: normal{locked_hover_info
          ? `; pointer-events: auto`
          : ``}"
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
            boundaries={effective_data.boundaries}
            {use_subscripts}
            {tooltip}
          />
        {/if}
      </PlotTooltip>
    {/if}

    {#key copy_feedback_pos.value}
      {#if copy_feedback_pos.value}
        <ClickFeedback visible position={copy_feedback_pos.value} />
      {/if}
    {/key}

    {@render children?.({ width, height, fullscreen })}
  {/if}
</div>

<style>
  .error {
    position: absolute;
    top: 0.5em;
    left: 0.5em;
    right: 0.5em;
    z-index: 5;
    padding: 0.4em 0.8em;
    border-radius: 4px;
    background: rgba(198, 40, 40, 0.15);
    color: #c62828;
  }
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
  .phase-regions path {
    transition: opacity 0.15s ease;

    &.hovered {
      opacity: 0.85;
      filter: brightness(1.1);
    }
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
  .region-label {
    user-select: none;
  }
  .tie-line {
    pointer-events: none;
    animation: tie-line-fade-in 150ms ease-out;
  }
  .tie-line.locked {
    filter: drop-shadow(0 0 3px rgba(255, 107, 107, 0.5));
  }
  @keyframes tie-line-fade-in {
    from {
      opacity: 0;
    }
  }
  .binary-phase-diagram :global(.tooltip-container.locked) {
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
</style>
