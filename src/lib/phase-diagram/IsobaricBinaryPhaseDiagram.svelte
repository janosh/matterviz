<script lang="ts">
  import { add_alpha } from '#lib/colors/index.js'
  import { create_flash } from '#lib/effects.svelte.js'
  import { DEFAULT_PNG_DPI } from '#lib/constants.js'
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import ClickFeedback from 'svelte-widgets/ClickFeedback.svelte'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import ViewerNotices from '#lib/layout/ViewerNotices.svelte'
  import { file_drop_zone } from '#lib/io/file-drop.js'
  import type { FileLoadCallback, FileLoadData } from '#lib/io/types.js'
  import { format_num } from '#lib/labels.js'
  import { normalize_show_controls, type ShowControlsProp } from '#lib/controls.js'
  import { ViewerChrome } from '#lib/layout/index.js'
  import { sanitize_html, sanitize_svg } from '#lib/sanitize.js'
  import {
    array_extent,
    compute_bounding_box_2d,
    polygon_centroid,
    polygon_label_point,
    type Vec2,
  } from '#lib/math.js'
  import { type AxisConfig, PlotTooltip } from '#lib/plot/index.js'
  import InsetLegend from '#lib/plot/core/components/InsetLegend.svelte'
  import type { LegendItem } from '#lib/plot/core/types.js'
  import { error_bar_path } from '#lib/plot/core/error-bars.js'
  import { unique_id } from '#lib/plot/core/utils.js'
  import { viewer_keys } from '#lib/shortcuts.js'
  import { TooltipPin } from '#lib/tooltip/pin.svelte.js'
  import { scaleLinear } from 'd3-scale'
  import { type Snippet, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'
  import type { ExportProps } from '#lib/io/export.js'
  import {
    BOUNDARY_STYLES,
    diagram_errors,
    diagram_name,
    diagram_hit,
    diagram_points,
    format_hover_info_text,
    observation_markers,
    OVERLAY_DASH,
    phase_colors,
    phase_labeler,
    region_label,
    status_color,
    status_label,
    temperature_extent,
  } from './diagram'
  import PhaseDiagramControls from './PhaseDiagramControls.svelte'
  import PhaseDiagramEditorPane from './PhaseDiagramEditorPane.svelte'
  import PhaseDiagramExportPane from './PhaseDiagramExportPane.svelte'
  import PhaseDiagramTooltip from './PhaseDiagramTooltip.svelte'
  import { parse_phase_diagram_svg } from './svg-to-diagram'
  import {
    BINARY_DIAGRAM_FORMAT,
    type BinaryPhaseDiagram,
    type CompUnit,
    type DiagramCursor,
    type DiagramRegion,
    type ObservationMarker,
    type ObservationStatus,
    type PhaseDiagramConfig,
    type PhaseDiagramTooltipProp,
    type PhaseHoverInfo,
    type PhaseObservation,
    type TempUnit,
  } from './types'
  import {
    format_formula_svg,
    format_label_html,
    format_label_svg,
  } from '#lib/composition/format.js'
  import {
    compute_label_properties,
    convert_temp,
    find_region_at,
    format_composition,
    generate_boundary_path,
    generate_region_path,
    merge_phase_diagram_config,
    PHASE_DIAGRAM_DEFAULTS,
    TIE_LINE_COLOR,
    transform_vertices,
  } from './utils'

  let {
    data: data_prop,
    overlay = null,
    phase_color_keys = [],
    observations = [],
    cursor = $bindable(null),
    temp_unit = $bindable(PHASE_DIAGRAM_DEFAULTS.temp_unit),
    comp_unit = $bindable(PHASE_DIAGRAM_DEFAULTS.comp_unit),
    config = $bindable({}),
    on_phase_hover,
    fullscreen = $bindable(false),
    wrapper = $bindable(),
    hovered_region = $bindable(null),
    show_boundaries = $bindable(PHASE_DIAGRAM_DEFAULTS.show_boundaries),
    show_labels = $bindable(PHASE_DIAGRAM_DEFAULTS.show_labels),
    show_special_points = $bindable(PHASE_DIAGRAM_DEFAULTS.show_special_points),
    show_grid = $bindable(PHASE_DIAGRAM_DEFAULTS.show_grid),
    show_component_labels = $bindable(PHASE_DIAGRAM_DEFAULTS.show_component_labels),
    show_overlay = $bindable(PHASE_DIAGRAM_DEFAULTS.show_overlay),
    show_observations = $bindable(PHASE_DIAGRAM_DEFAULTS.show_observations),
    fullscreen_toggle = true,
    show_controls,
    controls_open = $bindable(false),
    export_pane_open = $bindable(false),
    png_dpi = $bindable(DEFAULT_PNG_DPI),
    export_filename = `phase-diagram`,
    export_formats,
    on_export,
    editor_open = $bindable(false),
    allow_file_drop = true,
    on_file_drop,
    on_file_load,
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    tooltip,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> &
    ExportProps & {
      data?: BinaryPhaseDiagram
      // Second diagram of the same components, drawn as dashed boundaries only
      overlay?: BinaryPhaseDiagram | null
      // Model phases that take palette slots besides this diagram's own: give every diagram
      // of a comparison the same keys (model_phase_keys of all of them) so shared phases
      // match in color
      phase_color_keys?: readonly string[]
      // Experimental points with T and x error bars, colored by status
      observations?: readonly PhaseObservation[]
      // Hovered (x, T) in data units; bind one $state to several diagrams to sync their hover
      cursor?: DiagramCursor | null
      // Display units only: data stays in K and mole fraction
      temp_unit?: TempUnit
      comp_unit?: CompUnit
      config?: Partial<PhaseDiagramConfig>
      on_phase_hover?: (info: PhaseHoverInfo | null) => void
      fullscreen?: boolean
      wrapper?: HTMLDivElement
      hovered_region?: DiagramRegion | null
      show_boundaries?: boolean
      show_labels?: boolean
      show_special_points?: boolean
      show_grid?: boolean
      show_component_labels?: boolean
      show_overlay?: boolean
      show_observations?: boolean
      fullscreen_toggle?: boolean
      show_controls?: ShowControlsProp<`controls` | `export` | `editor` | `fullscreen`>
      controls_open?: boolean
      export_pane_open?: boolean
      png_dpi?: number
      editor_open?: boolean
      // Dropped phase-diagram SVGs (parsed) and v2 JSON files replace the diagram
      allow_file_drop?: boolean
      // Takes each dropped file raw instead of the built-in parsing
      on_file_drop?: FileLoadCallback
      // Called with each dropped file's parsed diagram (invalid ones show the error banner)
      on_file_load?: (data: FileLoadData & { diagram: BinaryPhaseDiagram }) => void
      // range in data units: mole fraction (x) and K (y)
      x_axis?: AxisConfig
      y_axis?: AxisConfig
      // false hides the tooltip, a snippet replaces it, a config object adds prefix/suffix
      tooltip?: PhaseDiagramTooltipProp
      children?: Snippet<[{ width: number; height: number; fullscreen: boolean }]>
    } = $props()

  // Keep calculations safe while the template renders the missing-data state
  const placeholder: BinaryPhaseDiagram = {
    format: BINARY_DIAGRAM_FORMAT,
    components: [``, ``],
    pressure_pa: 101325,
    temperature_range: [0, 1],
    phases: [],
    regions: [],
    boundaries: [],
    invariants: [],
    congruent_points: [],
    critical_points: [],
    unary_transitions: [],
    polymorphic_transitions: [],
    provenance: { kind: `sketch` },
  }

  // `always` by default: the editor and export toggles are how users discover those features
  const controls_config = $derived(normalize_show_controls(show_controls))
  // Instance-unique prefix for gradient ids, so two diagrams on one page never
  // cross-reference each other's gradients (first-in-document wins, with that instance's
  // pixel coords)
  const gradient_uid = unique_id(`pd-gradient`)
  const plot_clip = `url(#${gradient_uid}-plot-area)`

  // Editor edits and dropped files override the data prop until it changes, which also
  // clears a failed drop's error
  let source_data = $derived(data_prop)
  let drop_error = $derived<string | null>((void data_prop, null))
  const data_errors = $derived(source_data ? diagram_errors(source_data) : [])
  const valid_data = $derived(data_errors.length ? undefined : source_data)
  const data = $derived(valid_data ?? placeholder)
  const overlay_errors = $derived.by(() => {
    if (!overlay) return []
    const errors = diagram_errors(overlay)
    if (errors.length || !valid_data) return errors
    const [own, other] = [overlay, data].map(({ components }) => components.join(`-`))
    return own === other ? [] : [`components ${own} differ from ${other}`]
  })
  const valid_overlay = $derived(overlay && !overlay_errors.length ? overlay : null)
  const shown_overlay = $derived(show_overlay ? valid_overlay : null)
  const input_error = $derived(
    drop_error ??
      (data_errors.length ? `Invalid phase diagram data: ${data_errors.join(`; `)}` : null) ??
      (overlay_errors.length ? `Invalid overlay diagram: ${overlay_errors.join(`; `)}` : null),
  )

  const drop_zone = file_drop_zone({
    allow: () => allow_file_drop,
    on_drop: (content, filename, metadata) => {
      if (on_file_drop) return on_file_drop(content, filename, metadata)
      if (typeof content !== `string`) return
      const is_svg = filename.endsWith(`.svg`) || metadata.file?.type === `image/svg+xml`
      if (!is_svg && !filename.endsWith(`.json`)) return
      const diagram: BinaryPhaseDiagram = is_svg
        ? parse_phase_diagram_svg(content)
        : JSON.parse(content)
      drop_error = null
      source_data = diagram
      on_file_load?.({ diagram, filename, ...metadata })
    },
    // covers reading, decompressing and the parse above, since on_drop is awaited inside
    // the handler's per-file try — hence the generic wording
    on_error: (msg) => (drop_error = `Phase diagram file drop failed: ${msg}`),
  })

  const merged_config = $derived(merge_phase_diagram_config(config))
  // Opacity of region fills, so boundaries and the grid show through
  const REGION_ALPHA = 0.55
  const overlay_color = $derived(merged_config.colors.overlay)

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

  // Axis windows in data units: each set range end overrides the default, [0, 1] in x and the
  // union of both diagrams' computed temperature windows in T
  const x_domain = $derived<Vec2>([x_axis.range?.[0] ?? 0, x_axis.range?.[1] ?? 1])
  const t_extent = $derived(temperature_extent(valid_overlay ? [data, valid_overlay] : [data]))
  const t_domain = $derived<Vec2>([
    y_axis.range?.[0] ?? t_extent[0],
    y_axis.range?.[1] ?? t_extent[1],
  ])
  const x_scale = $derived(scaleLinear().domain(x_domain).range([left, right]))
  const y_scale = $derived(scaleLinear().domain(t_domain).range([bottom, top]))
  // Display-unit twin of y_scale for the axis ticks
  const y_scale_display = $derived(
    scaleLinear()
      .domain(t_domain.map((kelvin) => convert_temp(kelvin, `K`, temp_unit)))
      .range([bottom, top]),
  )

  const tick_count = (axis: AxisConfig, fallback: number): number =>
    typeof axis.ticks === `number` ? axis.ticks : fallback
  const x_ticks = $derived(x_scale.ticks(tick_count(x_axis, PHASE_DIAGRAM_DEFAULTS.x_ticks)))
  const y_ticks = $derived(
    y_scale_display.ticks(tick_count(y_axis, PHASE_DIAGRAM_DEFAULTS.y_ticks)),
  )

  const regions = $derived(data.regions)
  const label_of = $derived(phase_labeler(data))
  const colors = $derived(phase_colors(data.phases, phase_color_keys))
  // phase ids are validated, so a miss is a caller bug
  const color_of = (id: string): string => {
    const color = colors.get(id)
    if (color === undefined) throw new Error(`No color for phase id "${id}"`)
    return color
  }

  const transformed_regions = $derived(
    regions.map((region) => {
      const svg_vertices = transform_vertices(region.vertices, x_scale, y_scale)
      const label = region_label(region, label_of)
      // Not the area centroid, which lies outside concave (L-shaped) fields; the room at the
      // label point, not the bounding box, then sizes the label
      const anchor = polygon_label_point(svg_vertices)
      const label_props = compute_label_properties(
        label,
        anchor ?? compute_bounding_box_2d(svg_vertices),
        merged_config.font_size,
      )
      const [x_min, x_max] = array_extent(svg_vertices.map(([svg_x]) => svg_x))
      const { phases } = region
      // shoelace area in px², which ranks regions for label placement
      const area = Math.abs(
        svg_vertices.reduce((sum, [x_0, y_0], idx) => {
          const [x_1, y_1] = svg_vertices[(idx + 1) % svg_vertices.length]
          return sum + x_0 * y_1 - x_1 * y_0
        }, 0) / 2,
      )
      return {
        region,
        svg_path: generate_region_path(svg_vertices),
        label_pos: anchor?.at ?? polygon_centroid(svg_vertices),
        label_props,
        area,
        // multi-phase regions blend their phases' colors left to right
        gradient:
          phases.length > 1
            ? phases.map((id, idx) => ({
                offset: idx / (phases.length - 1),
                color: color_of(id),
              }))
            : null,
        fill: phases.length === 1 ? add_alpha(color_of(phases[0]), REGION_ALPHA) : `#c8c8c880`,
        x_min,
        x_max,
      }
    }),
  )

  // Indices of the region labels drawn: largest regions first, each skipped where its box
  // would cover an already placed label or a marked point. Narrow strips in dense diagrams
  // (Fe-Fe3C's δ fields) lose their label this way; the tooltip still names every region.
  const shown_label_idxs = $derived.by(() => {
    const { font_size, special_point_radius } = merged_config
    type Box = [number, number, number, number] // x_min, y_min, x_max, y_max
    const overlaps = (box_a: Box, box_b: Box) =>
      box_a[0] < box_b[2] && box_b[0] < box_a[2] && box_a[1] < box_b[3] && box_b[1] < box_a[3]
    const reach = special_point_radius + 4
    const placed: Box[] = show_special_points
      ? transformed_points.map(({ svg_x, svg_y }) => [
          svg_x - reach,
          svg_y - reach,
          svg_x + reach,
          svg_y + reach,
        ])
      : []
    const shown = new Set<number>()
    const order = transformed_regions
      .map((region, idx) => [idx, region.area] as const)
      .toSorted(([, area_a], [, area_b]) => area_b - area_a)
    for (const [idx] of order) {
      const { label_pos, label_props } = transformed_regions[idx]
      const { lines, scale, rotation } = label_props
      if (!lines.length) continue
      // same character metrics as compute_label_properties
      const along = Math.max(...lines.map((line) => line.length)) * font_size * 0.6 * scale
      const across = lines.length * font_size * 1.2 * scale
      const [half_w, half_h] = rotation ? [across / 2, along / 2] : [along / 2, across / 2]
      const [cx, cy] = label_pos
      const box: Box = [cx - half_w, cy - half_h, cx + half_w, cy + half_h]
      if (placed.some((other) => overlaps(box, other))) continue
      placed.push(box)
      shown.add(idx)
    }
    return shown
  })

  const boundary_path = (points: Vec2[]) =>
    generate_boundary_path(transform_vertices(points, x_scale, y_scale))

  const in_plot = (svg_x: number, svg_y: number) =>
    svg_x >= left - 0.5 && svg_x <= right + 0.5 && svg_y >= top - 0.5 && svg_y <= bottom + 0.5

  // Points outside a zoomed x/y window would sit on the axes or margins
  const transformed_points = $derived(
    diagram_points(data)
      .map((point) => ({
        ...point,
        svg_x: x_scale(point.composition),
        svg_y: y_scale(point.temperature),
      }))
      .filter(({ svg_x, svg_y }) => in_plot(svg_x, svg_y)),
  )

  // Observation statuses the legend toggled off
  const hidden_statuses = new SvelteSet<ObservationStatus>()
  const all_markers = $derived(observation_markers(observations, data.components))
  const marker_statuses = $derived([...new Set(all_markers.map(({ row }) => row.status))])
  const shown_markers = $derived(
    show_observations
      ? all_markers
          .filter(({ row }) => !hidden_statuses.has(row.status))
          .map((marker) => ({
            marker,
            svg_x: x_scale(marker.composition),
            svg_y: y_scale(marker.temperature),
            color: status_color(marker.row.status),
          }))
          // outside a zoomed window a marker is neither drawn nor hoverable
          .filter(({ svg_x, svg_y }) => in_plot(svg_x, svg_y))
      : [],
  )
  // An invariant's phases share one isotherm: join them with a thin line
  const observation_isotherms = $derived(
    [...Map.groupBy(shown_markers, ({ marker }) => marker.row.id)].flatMap(([id, group]) => {
      if (group.length < 2) return []
      const [x_min, x_max] = array_extent(group.map(({ svg_x }) => svg_x))
      const { svg_y, color } = group[0]
      return [{ id, x_min, x_max, svg_y, color }]
    }),
  )
  const error_bar_cap = 3

  const legend_items = $derived.by((): LegendItem[] => {
    if (!valid_overlay && all_markers.length === 0) return []
    const items: LegendItem[] = [
      {
        label: diagram_name(data),
        visible: show_boundaries,
        series_idx: 0,
        display_style: { line_color: BOUNDARY_STYLES.liquidus.color },
      },
    ]
    if (valid_overlay) {
      items.push({
        label: diagram_name(valid_overlay),
        visible: show_overlay,
        series_idx: 1,
        display_style: { line_color: overlay_color, line_dash: OVERLAY_DASH },
      })
    }
    marker_statuses.forEach((status, idx) =>
      items.push({
        label: status_label(status),
        visible: show_observations && !hidden_statuses.has(status),
        series_idx: 2 + idx,
        display_style: {
          symbol_type: `Circle`,
          symbol_color: status_color(status),
        },
      }),
    )
    return items
  })
  // Points every ~16 px along a boundary polyline (its vertices alone leave a 2-point
  // invariant isotherm free for the legend to cover)
  const sample_boundary = (points: Vec2[]): { x: number; y: number }[] =>
    transform_vertices(points, x_scale, y_scale).flatMap(([x_0, y_0], idx, svg_points) => {
      const next = svg_points[idx + 1]
      if (!next) return [{ x: x_0, y: y_0 }]
      const n_steps = Math.max(1, Math.ceil(Math.hypot(next[0] - x_0, next[1] - y_0) / 16))
      return Array.from({ length: n_steps }, (_, step) => ({
        x: x_0 + ((next[0] - x_0) * step) / n_steps,
        y: y_0 + ((next[1] - y_0) * step) / n_steps,
      }))
    })
  // The legend avoids marked points, observations and boundaries
  const legend_obstacles = $derived(
    legend_items.length
      ? [
          ...transformed_points.map(({ svg_x, svg_y }) => ({ x: svg_x, y: svg_y })),
          ...shown_markers.map(({ svg_x, svg_y }) => ({ x: svg_x, y: svg_y })),
          ...[...data.boundaries, ...(shown_overlay?.boundaries ?? [])].flatMap(({ points }) =>
            sample_boundary(points),
          ),
        ]
      : [],
  )
  function toggle_legend_item(series_idx: number) {
    if (series_idx === 0) show_boundaries = !show_boundaries
    else if (series_idx === 1) show_overlay = !show_overlay
    else {
      // with observations off, a click shows the clicked status rather than toggling it
      const status = marker_statuses[series_idx - 2]
      if (!show_observations) {
        show_observations = true
        hidden_statuses.delete(status)
      } else if (hidden_statuses.has(status)) hidden_statuses.delete(status)
      else hidden_statuses.add(status)
    }
  }

  let hover_info = $state.raw<PhaseHoverInfo | null>(null)
  // A click pins the hovered snapshot; its observation or region names the mark
  type HoverMark = Pick<PhaseHoverInfo, `region` | `observation`>
  const pin = new TooltipPin<PhaseHoverInfo, HoverMark>({
    key: ({ region, observation }) => observation ?? region,
  })
  const lit_region = (region: DiagramRegion) =>
    pin.lit({ region, observation: null }, hover_info) || region === remote_region

  const own_cursor = () => cursor?.source === gradient_uid
  // Drops this diagram's hover (reporting it once), and the shared cursor when it set it
  function clear_hover() {
    if (own_cursor()) cursor = null
    if (!hover_info && !hovered_region) return
    hover_info = null
    hovered_region = null
    on_phase_hover?.(null)
  }

  // Hover and pin describe the previous data, so drop them when the data changes
  $effect(() => {
    void source_data
    untrack(() => {
      if (!hover_info && !pin.value && !hovered_region) return
      pin.unpin()
      clear_hover()
    })
  })

  const handle_click = () => pin.toggle(hover_info)

  const effective_hover_info = $derived(pin.shown(hover_info))
  // The tooltip wears the hovered single-phase region's hue; multi-phase regions and
  // observations keep the neutral card
  const tooltip_region_color = $derived.by(() => {
    const info = effective_hover_info
    if (!info || info.observation || info.region?.phases.length !== 1) return undefined
    return color_of(info.region.phases[0])
  })

  // Isothermal tie-line geometry (SVG px); null outside two-phase regions.
  // The line runs between the two endpoint markers, the cursor marker sits at the hover point.
  const tie_line = $derived.by(() => {
    const info = effective_hover_info
    if (!info?.lever_rule) return null
    const { lever_rule } = info
    const cy = y_scale(info.temperature)
    const endpoint = (phase: string, composition: number) => ({
      cx: x_scale(composition),
      cy,
      color: color_of(phase),
    })
    return {
      cursor: { cx: x_scale(info.composition), cy },
      endpoints: [
        endpoint(lever_rule.left_phase, lever_rule.left_composition),
        endpoint(lever_rule.right_phase, lever_rule.right_composition),
      ] as const,
    }
  })

  // A partner taking over the shared cursor (e.g. a tap there, where touch sent this diagram
  // no leave) ends this diagram's own live hover; a pinned tooltip stays
  $effect(() => {
    if (cursor && !own_cursor()) untrack(clear_hover)
  })

  // A synced diagram's cursor: crosshair and this diagram's phase set at the same (x, T)
  const remote_cursor = $derived.by(() => {
    if (!cursor || own_cursor()) return null
    const svg_x = x_scale(cursor.composition)
    const svg_y = y_scale(cursor.temperature)
    if (!in_plot(svg_x, svg_y)) return null
    const region = find_region_at(regions, cursor.composition, cursor.temperature)
    // a boundaries-only diagram has no phase set to name, just the crosshair
    const label = regions.length ? region_label(region, label_of) : null
    return { svg_x, svg_y, region, label }
  })
  const remote_region = $derived(remote_cursor?.region ?? null)

  // Copy feedback position; ClickFeedback's CSS animation fades it out and the template keys
  // on the position object so back-to-back copies each remount and restart the animation
  const copy_feedback_pos = create_flash<{ x: number; y: number } | null>(null, 1500)

  async function handle_double_click(event: MouseEvent) {
    const info = effective_hover_info
    if (!info) return
    try {
      await navigator.clipboard.writeText(
        format_hover_info_text(info, data, { overlay: shown_overlay, temp_unit, comp_unit }),
      )
      copy_feedback_pos.show({ x: event.clientX, y: event.clientY })
    } catch (error) {
      console.error(`Failed to copy phase data:`, error)
    }
  }

  // Item of `items` nearest to (svg_x, svg_y) within `threshold` px, else null
  function nearest<T extends { svg_x: number; svg_y: number }>(
    items: readonly T[],
    svg_x: number,
    svg_y: number,
    threshold: number,
  ): T | null {
    let [best, min_dist] = [null as T | null, threshold]
    for (const item of items) {
      const dist = Math.hypot(item.svg_x - svg_x, item.svg_y - svg_y)
      if (dist < min_dist) [best, min_dist] = [item, dist]
    }
    return best
  }

  function handle_pointer_move(event: PointerEvent & { currentTarget: SVGElement }) {
    const rect = event.currentTarget.getBoundingClientRect()
    const svg_x = event.clientX - rect.left
    const svg_y = event.clientY - rect.top
    if (svg_x < left || svg_x > right || svg_y < top || svg_y > bottom) return clear_hover()
    const composition = x_scale.invert(svg_x)
    const temperature = y_scale.invert(svg_y)
    cursor = { composition, temperature, source: gradient_uid }

    const hit = diagram_hit(data, composition, temperature)
    const overlay_region =
      shown_overlay && diagram_hit(shown_overlay, composition, temperature).region
    const point = show_special_points ? nearest(transformed_points, svg_x, svg_y, 12) : null
    const observation: ObservationMarker | null =
      nearest(shown_markers, svg_x, svg_y, 8)?.marker ?? null
    // a diagram with regions shows no tooltip in a gap; one without (boundaries only) always
    // reports the cursor's (x, T)
    const nothing_hit = !hit.region && !overlay_region && !point && !observation
    if (nothing_hit && regions.length > 0) {
      if (!hover_info && !hovered_region) return
      hover_info = null
      hovered_region = null
      on_phase_hover?.(null)
      return
    }
    hovered_region = hit.region
    hover_info = {
      ...hit,
      composition,
      temperature,
      position: { x: event.clientX, y: event.clientY },
      point,
      observation,
    }
    on_phase_hover?.(hover_info)
  }

  function handle_pointer_leave(event: PointerEvent) {
    // Don't clear on touch lift (allows reading tooltip); a pinned one outlives the hover
    if (event.pointerType === `touch`) return
    clear_hover()
  }
  // A diagram unmounted mid-hover must not leave its synced partners a stuck crosshair
  $effect(() => () => {
    if (own_cursor()) cursor = null
  })

  // `e` toggles the export pane, Escape unpins the tooltip
  const keys = viewer_keys(() => ({
    e: () => {
      export_pane_open = !export_pane_open
    },
    Escape: pin.unpin,
  }))

  function handle_svg_keydown(event: KeyboardEvent) {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      handle_click()
    }
  }

  const [component_a, component_b] = $derived(data.components)
  // Formatted component labels for SVG axis labels (with tspan subscripts if compound)
  const component_a_svg = $derived(format_formula_svg(component_a, true))
  const component_b_svg = $derived(format_formula_svg(component_b, true))
  const default_x_axis_label = $derived(
    comp_unit === `fraction`
      ? `x ${component_b_svg} (mole fraction)`
      : `${component_b_svg} (${comp_unit})`,
  )
  const marker_radius = $derived(merged_config.special_point_radius)
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
  {@attach keys}
  bind:clientWidth={width}
  bind:clientHeight={height}
  role="img"
  aria-label={!source_data
    ? `Missing phase diagram data. Provide diagram data through the data prop.`
    : valid_data
      ? `${component_a}-${component_b} binary phase diagram`
      : `Invalid phase diagram data`}
  {@attach drop_zone}
>
  <ViewerNotices>
    {#if input_error}<StatusMessage message={input_error} type="error" />{/if}
  </ViewerNotices>
  {#if !source_data}
    <EmptyState>
      <h3>Missing phase diagram data</h3>
      <p>Provide diagram data through the <code>data</code> prop.</p>
    </EmptyState>
  {:else if valid_data && plot_width > 0 && plot_height > 0}
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
          bind:show_overlay
          bind:show_observations
          bind:temp_unit
          bind:comp_unit
          bind:config
          bind:x_axis
          bind:y_axis
          {data}
          has_overlay={valid_overlay !== null}
          has_observations={all_markers.length > 0}
          shortcut_scopes={[`viewer`, `binary-phase-diagram`]}
        />
      {/if}
      {#if export_formats?.length !== 0 && controls_config.visible(`export`)}
        <PhaseDiagramExportPane
          bind:export_pane_open
          bind:png_dpi
          {data}
          {wrapper}
          filename={export_filename}
          {export_formats}
          {on_export}
        />
      {/if}
      {#if controls_config.visible(`editor`)}
        <PhaseDiagramEditorPane
          bind:editor_open
          data={valid_data}
          on_data={(edited) => (source_data = edited)}
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
      aria-label="Binary phase diagram. Use mouse to explore phases. Click to pin tooltip, double-click to copy data. Press E to export."
    >
      <defs>
        <!-- zoomed axes (x_axis/y_axis.range) must not paint data over the axes and margins -->
        <clipPath id="{gradient_uid}-plot-area">
          <rect x={left} y={top} width={plot_width} height={plot_height} />
        </clipPath>
        {#each transformed_regions as { gradient, x_min, x_max }, idx (idx)}
          {#if gradient}
            <linearGradient
              id="{gradient_uid}-{idx}"
              x1={x_min}
              x2={x_max}
              y1="0"
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              {#each gradient as stop, stop_idx (stop_idx)}
                <stop
                  offset="{stop.offset * 100}%"
                  stop-color={stop.color}
                  stop-opacity={REGION_ALPHA}
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

      <g class="phase-regions" clip-path={plot_clip}>
        {#each transformed_regions as { region, svg_path, gradient, fill }, idx (idx)}
          <path
            d={svg_path}
            fill={gradient ? `url(#${gradient_uid}-${idx})` : fill}
            stroke="none"
            class:hovered={lit_region(region)}
          />
        {/each}
      </g>

      {#if show_boundaries}
        <g class="boundaries" clip-path={plot_clip}>
          {#each data.boundaries as { kind, points }, idx (idx)}
            {@const style = BOUNDARY_STYLES[kind]}
            <path
              d={boundary_path(points)}
              fill="none"
              stroke={style.color}
              stroke-width={style.width}
              stroke-dasharray={style.dash ?? ``}
              stroke-linecap="round"
              stroke-linejoin="round"
              data-kind={kind}
            />
          {/each}
        </g>
      {/if}

      {#if shown_overlay}
        <g class="overlay-boundaries" clip-path={plot_clip} style="pointer-events: none">
          {#each shown_overlay.boundaries as { kind, points }, idx (idx)}
            <!-- magnetic lines keep their dash-dot so they never read as phase boundaries -->
            <path
              d={boundary_path(points)}
              fill="none"
              stroke={overlay_color}
              stroke-width={kind === `magnetic` ? 1.5 : 2}
              stroke-dasharray={kind === `magnetic`
                ? BOUNDARY_STYLES.magnetic.dash
                : OVERLAY_DASH}
              stroke-linecap="round"
              stroke-linejoin="round"
              data-kind={kind}
            />
          {/each}
        </g>
      {/if}

      {#if show_labels}
        <g class="region-labels" style="pointer-events: none" clip-path={plot_clip}>
          {#each transformed_regions as { label_pos, label_props }, idx (idx)}
            {@const line_height = merged_config.font_size * 1.2}
            {#if shown_label_idxs.has(idx)}<g
                transform="translate({label_pos[0]}, {label_pos[1]}) rotate({label_props.rotation}) scale({label_props.scale})"
              >
                {#each label_props.lines as line, line_idx (line_idx)}
                  <text
                    x={0}
                    y={(line_idx - (label_props.lines.length - 1) / 2) * line_height}
                    text-anchor="middle"
                    dominant-baseline="middle"
                    fill={merged_config.colors.text}
                    font-size={merged_config.font_size}
                    font-weight="500"
                    class="region-label"
                  >
                    {@html sanitize_svg(format_label_svg(line, true))}
                  </text>
                {/each}
              </g>{/if}
          {/each}
        </g>
      {/if}

      <!-- Tie-line for two-phase regions: white-outlined line, phase endpoints, cursor marker -->
      {#if tie_line}
        {@const {
          cursor: tie_cursor,
          endpoints: [start, end],
        } = tie_line}
        {@const tie_style = merged_config.tie_line}
        <g class="tie-line" class:pinned={pin.value} clip-path={plot_clip}>
          {#each [`white`, TIE_LINE_COLOR] as stroke (stroke)}
            <line
              x1={start.cx}
              y1={start.cy}
              x2={end.cx}
              y2={end.cy}
              {stroke}
              stroke-width={tie_style.stroke_width + (stroke === `white` ? 1 : 0)}
              stroke-linecap="round"
            />
          {/each}
          {#each tie_line.endpoints as endpoint, idx (idx)}
            <circle
              cx={endpoint.cx}
              cy={endpoint.cy}
              r={tie_style.endpoint_radius}
              fill={endpoint.color}
              stroke="white"
              stroke-width={1.5}
            />
          {/each}
          <circle
            cx={tie_cursor.cx}
            cy={tie_cursor.cy}
            r={tie_style.cursor_radius}
            fill={TIE_LINE_COLOR}
            stroke="white"
            stroke-width={2}
          />
        </g>
      {/if}

      <!-- Marked points, drawn over regions, boundaries and the tie-line -->
      {#if show_special_points}
        {@const color = merged_config.colors.special_point}
        <g class="special-points">
          {#each transformed_points as point, idx (idx)}
            {@const { svg_x, svg_y, category, marker_label } = point}
            {@const hovered = effective_hover_info?.point === point}
            {#if category === `congruent`}
              {@const size = marker_radius * 1.3}
              <path
                d="M{svg_x},{svg_y - size}L{svg_x + size},{svg_y}L{svg_x},{svg_y +
                  size}L{svg_x - size},{svg_y}Z"
                fill={color}
                stroke="white"
                stroke-width={1.5}
                class="special-point-marker"
                class:hovered
                data-category={category}
              />
            {:else}
              <circle
                cx={svg_x}
                cy={svg_y}
                r={marker_radius}
                fill={category === `critical` ? `white` : color}
                stroke={category === `critical` ? color : `white`}
                stroke-width={category === `critical` ? 2 : 1.5}
                class="special-point-marker"
                class:hovered
                data-category={category}
              />
            {/if}
            {#if marker_label}
              <!-- labels at a composition edge run inwards (-1: left edge, 1: right edge) -->
              {@const edge =
                point.composition <= 0.05 ? -1 : point.composition >= 0.95 ? 1 : 0}
              <text
                x={svg_x - 4 * edge}
                y={svg_y - marker_radius * 2}
                text-anchor={[`start`, `middle`, `end`][edge + 1]}
                fill={merged_config.colors.text}
                font-size={merged_config.font_size}
                font-weight="bold"
              >
                {marker_label}
              </text>
            {/if}
          {/each}
        </g>
      {/if}

      <!-- Observations: isotherm joining one row's phases, error bars, status-colored markers -->
      {#if shown_markers.length}
        <g class="observations" clip-path={plot_clip} style="pointer-events: none">
          {#each observation_isotherms as { id, x_min, x_max, svg_y, color } (id)}
            <line
              x1={x_min}
              x2={x_max}
              y1={svg_y}
              y2={svg_y}
              stroke={color}
              stroke-width={1}
              stroke-dasharray="3,2"
            />
          {/each}
          {#each shown_markers as { marker, svg_x, svg_y, color }, idx (idx)}
            {@const { row, phase, composition, temperature } = marker}
            {@const sigma_t = row.sigma_T_K ?? 0}
            {@const sigma_x = phase?.sigma_x ?? 0}
            {#if sigma_t > 0}
              <path
                class="error-bar"
                d={error_bar_path(
                  [y_scale(temperature - sigma_t), y_scale(temperature + sigma_t)],
                  svg_x,
                  true,
                  error_bar_cap,
                )}
                stroke={color}
                fill="none"
              />
            {/if}
            {#if sigma_x > 0}
              <path
                class="error-bar"
                d={error_bar_path(
                  [x_scale(composition - sigma_x), x_scale(composition + sigma_x)],
                  svg_y,
                  false,
                  error_bar_cap,
                )}
                stroke={color}
                fill="none"
              />
            {/if}
          {/each}
        </g>
        <!-- unclipped, so markers on the x = 0 and x = 1 edges show whole like marked points -->
        <g class="observation-markers" style="pointer-events: none">
          {#each shown_markers as { marker, svg_x, svg_y, color }, idx (idx)}
            <circle
              cx={svg_x}
              cy={svg_y}
              r={4.5}
              fill={color}
              stroke="white"
              stroke-width={1.5}
              class="observation-marker"
              class:hovered={effective_hover_info?.observation === marker}
              data-status={marker.row.status}
            />
          {/each}
        </g>
      {/if}

      {#if remote_cursor}
        <g class="remote-cursor" style="pointer-events: none">
          <line
            x1={remote_cursor.svg_x}
            x2={remote_cursor.svg_x}
            y1={top}
            y2={bottom}
            stroke={TIE_LINE_COLOR}
            stroke-dasharray="4,3"
          />
          <line
            x1={left}
            x2={right}
            y1={remote_cursor.svg_y}
            y2={remote_cursor.svg_y}
            stroke={TIE_LINE_COLOR}
            stroke-dasharray="4,3"
          />
          <circle
            cx={remote_cursor.svg_x}
            cy={remote_cursor.svg_y}
            r={4}
            fill={TIE_LINE_COLOR}
            stroke="white"
            stroke-width={1.5}
          />
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
        <text
          x={left + plot_width / 2}
          y={height - 10}
          text-anchor="middle"
          fill={merged_config.colors.text}
          font-size={merged_config.font_size + 2}
        >
          {@html sanitize_svg(x_axis.label || default_x_axis_label)}
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
        <text
          transform="rotate(-90)"
          x={-(top + plot_height / 2)}
          y={16}
          text-anchor="middle"
          fill={merged_config.colors.text}
          font-size={merged_config.font_size + 2}
        >
          {@html sanitize_svg(y_axis.label || `Temperature (${temp_unit})`)}
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

    {#if legend_items.length}
      <InsetLegend
        legend={null}
        measured
        plot_bounds={{ x: left, y: top, width: plot_width, height: plot_height }}
        points={legend_obstacles}
        series_data={legend_items}
        on_toggle={toggle_legend_item}
        draggable={false}
        filterable={false}
        class="phase-diagram-legend"
      />
    {/if}

    {#if remote_cursor?.label}
      <div
        class="remote-cursor-label"
        style:left="{remote_cursor.svg_x + 8}px"
        style:top="{remote_cursor.svg_y - 26}px"
        style:transform={remote_cursor.svg_x > left + plot_width / 2
          ? `translateX(calc(-100% - 16px))`
          : undefined}
      >
        {@html sanitize_html(format_label_html(remote_cursor.label, true))}
      </div>
    {/if}

    {#if effective_hover_info && tooltip !== false}
      <PlotTooltip
        x={effective_hover_info.position.x}
        y={effective_hover_info.position.y}
        fixed
        offset={{ x: 15, y: 15 }}
        fallback_size={{ width: 200, height: 150 }}
        class="tooltip-container"
        bg_color={tooltip_region_color}
        pinned={pin.value !== null}
      >
        <PhaseDiagramTooltip
          hover_info={effective_hover_info}
          {data}
          overlay={shown_overlay}
          {phase_color_keys}
          {temp_unit}
          {comp_unit}
          {tooltip}
        />
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
  /* hover is decided by distance in handle_pointer_move, not by the marker's own box */
  .special-point-marker {
    pointer-events: none;
    &.hovered {
      filter: brightness(1.3) drop-shadow(0 0 4px currentColor);
    }
  }
  .observation-marker.hovered {
    stroke: var(--text-color, #333);
    stroke-width: 2.5;
  }
  .region-label {
    user-select: none;
  }
  .tie-line {
    pointer-events: none;
    animation: tie-line-fade-in 150ms ease-out;
  }
  .tie-line.pinned {
    filter: drop-shadow(0 0 3px rgba(255, 107, 107, 0.5));
  }
  @keyframes tie-line-fade-in {
    from {
      opacity: 0;
    }
  }
  .remote-cursor-label {
    position: absolute;
    pointer-events: none;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    background: var(--tooltip-bg, rgba(0, 0, 0, 0.75));
    color: var(--tooltip-color, white);
  }
</style>
