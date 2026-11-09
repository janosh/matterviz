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
  import { type D3SymbolName, format_num, humanize, symbol_map } from '#lib/labels.js'
  import { symbol } from 'd3-shape'
  import { normalize_show_controls, type ShowControlsProp } from '#lib/controls.js'
  import { ViewerChrome } from '#lib/layout/index.js'
  import { sanitize_html, sanitize_svg } from '#lib/sanitize.js'
  import {
    array_extent,
    compute_bounding_box_2d,
    polygon_centroid,
    polygon_label_point,
    polygon_signed_area,
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
  import { compute_isopleth, phase_disagreement } from './analysis'
  import {
    BOUNDARY_STYLES,
    diagram_errors,
    diagram_name,
    diagram_hit,
    diagram_points,
    format_hover_info_text,
    match_point,
    observation_markers,
    overlay_style,
    point_ref,
    parse_diagram,
    phase_colors,
    phase_labeler,
    region_label,
    status_color,
    status_label,
    temperature_extent,
    VERDICT_STYLES,
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
    type DiagramHighlight,
    type DiagramPoint,
    type DiagramRegion,
    type ObservationMarker,
    type ObservationPrediction,
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
    CHAR_WIDTH_EM,
    compute_label_properties,
    convert_temp,
    find_region_at,
    format_composition,
    format_temperature,
    generate_boundary_path,
    generate_region_path,
    LINE_HEIGHT_EM,
    merge_phase_diagram_config,
    PHASE_DIAGRAM_DEFAULTS,
    TIE_LINE_COLOR,
    transform_vertices,
  } from './utils'

  let {
    data: data_prop,
    overlays = [],
    phase_color_keys = [],
    observations = [],
    predictions = [],
    highlight = $bindable(null),
    phase_matches = {},
    isopleth = $bindable(null),
    lens = $bindable(PHASE_DIAGRAM_DEFAULTS.lens),
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
    show_uncertainty = $bindable(PHASE_DIAGRAM_DEFAULTS.show_uncertainty),
    show_disagreement = $bindable(PHASE_DIAGRAM_DEFAULTS.show_disagreement),
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
      // Diagrams of the same components drawn as dashed boundaries only, each in its own
      // color and dash. Where the first valid one disagrees on the phase set is hatched.
      overlays?: readonly BinaryPhaseDiagram[]
      // Model phases that take palette slots besides this diagram's own: give every diagram
      // of a comparison the same keys (model_phase_keys of all of them) so shared phases
      // match in color
      phase_color_keys?: readonly string[]
      // Experimental points with T and x error bars, colored by status
      observations?: readonly PhaseObservation[]
      // This diagram's predictions of the observations: an arrow from each observed point to
      // the predicted one, markers colored by the verdict
      predictions?: readonly ObservationPrediction[]
      // Marks lit from outside (e.g. a hovered score-table row); set while the pointer is on
      // an observation or marked point
      highlight?: DiagramHighlight | null
      // This diagram's phase id or model phase -> the reference phase it stands in for, e.g.
      // { DIAMOND_A4: `(Sn)` }, named in the tooltip and matched by highlight.phases
      phase_matches?: Readonly<Record<string, string>>
      // Composition of a vertical section: its phase-fraction strip sits right of the plot
      // and its phase changes are marked on the line. Shift+click sets or clears it.
      isopleth?: number | null
      // Magnifier following the pointer (key `m`), for narrow fields at the edges
      lens?: boolean
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
      // Bands of boundary and marked-point sigma_T
      show_uncertainty?: boolean
      // Hatching where the first valid overlay (even while hidden) has a different phase set
      show_disagreement?: boolean
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
  const overlay_errors = $derived(
    overlays.map((overlay) => {
      const errors = diagram_errors(overlay)
      if (errors.length || !valid_data) return errors
      const [own, other] = [overlay, data].map(({ components }) => components.join(`-`))
      return own === other ? [] : [`components ${own} differ from ${other}`]
    }),
  )
  const valid_overlays = $derived(overlays.filter((_, idx) => !overlay_errors[idx].length))
  // Overlays the legend toggled off (show_overlay hides them all)
  const hidden_overlays = new SvelteSet<BinaryPhaseDiagram>()
  // valid_overlays order, null for a hidden one, so hover hits and styles keep their index
  const overlay_slots = $derived(
    valid_overlays.map((overlay) =>
      show_overlay && !hidden_overlays.has(overlay) ? overlay : null,
    ),
  )
  const input_error = $derived.by(() => {
    if (drop_error) return drop_error
    if (data_errors.length) return `Invalid phase diagram data: ${data_errors.join(`; `)}`
    const bad_idx = overlay_errors.findIndex((errors) => errors.length)
    if (bad_idx === -1) return null
    const which = overlays.length > 1 ? ` ${bad_idx + 1}` : ``
    return `Invalid overlay diagram${which}: ${overlay_errors[bad_idx].join(`; `)}`
  })

  const drop_zone = file_drop_zone({
    allow: () => allow_file_drop,
    on_drop: (content, filename, metadata) => {
      if (on_file_drop) return on_file_drop(content, filename, metadata)
      if (typeof content !== `string`) return
      const is_svg = filename.endsWith(`.svg`) || metadata.file?.type === `image/svg+xml`
      if (!is_svg && !filename.endsWith(`.json`)) return
      // an invalid diagram throws to on_error, keeping the current one on screen
      const diagram = parse_diagram(
        is_svg ? parse_phase_diagram_svg(content) : JSON.parse(content),
      )
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
  const DISAGREEMENT_COLOR = `#424242`
  const overlay_styles = $derived(
    valid_overlays.map((_, idx) => overlay_style(idx, merged_config.colors.overlay)),
  )

  // Dimensions - use container size directly, no fallback to avoid layout shift
  let width = $state(0)
  let height = $state(0)
  const margin = $derived(merged_config.margin)
  // an isopleth's phase-fraction strip takes room right of the plot (a boundaries-only diagram
  // has no fractions to show)
  const ISOPLETH_STRIP = { width: 64, gap: 14 }
  const has_isopleth = $derived(isopleth !== null && data.regions.length > 0)
  const left = $derived(margin.l)
  const right = $derived(
    width - margin.r - (has_isopleth ? ISOPLETH_STRIP.width + ISOPLETH_STRIP.gap : 0),
  )
  const top = $derived(margin.t)
  const bottom = $derived(height - margin.b)
  const plot_width = $derived(right - left)
  const plot_height = $derived(bottom - top)

  // Axis windows in data units: each set range end overrides the default, [0, 1] in x and the
  // union of both diagrams' computed temperature windows in T
  const x_domain = $derived<Vec2>([x_axis.range?.[0] ?? 0, x_axis.range?.[1] ?? 1])
  const t_extent = $derived(temperature_extent([data, ...valid_overlays]))
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
  const model_phase_of = $derived(
    new Map(data.phases.map(({ id, model_phase }) => [id, model_phase])),
  )
  // Reference phase this diagram's phase stands in for, by id first, then model phase
  const match_of = (id: string): string | undefined =>
    phase_matches[id] ?? phase_matches[model_phase_of.get(id) ?? ``]
  // Phase ids highlight.phases names, by id, model phase or match target
  const lit_phases = $derived.by(() => {
    const wanted = new Set(highlight?.phases)
    if (!wanted.size) return null
    return new Set(
      data.phases
        .filter(({ id, model_phase }) =>
          [id, model_phase, match_of(id)].some((name) => name && wanted.has(name)),
        )
        .map(({ id }) => id),
    )
  })

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
      return {
        region,
        svg_path: generate_region_path(svg_vertices),
        label_pos: anchor?.at ?? polygon_centroid(svg_vertices),
        label_props,
        // area in px² ranks regions for label placement
        area: Math.abs(polygon_signed_area(svg_vertices)),
        // two-phase regions blend their phases' colors left to right
        gradient:
          phases.length === 2
            ? phases.map((id, stop_idx) => ({ offset: stop_idx, color: color_of(id) }))
            : null,
        x_min,
        x_max,
      }
    }),
  )

  // Indices of the region labels drawn: largest regions first, each skipped where its box
  // would cover an already placed label or a marked point. Narrow strips in dense diagrams
  // (Fe-Fe3C's δ fields) lose their label this way; the tooltip still names every region.
  const shown_label_idxs = $derived.by(() => {
    const { font_size } = merged_config
    const placed: Box[] = show_special_points
      ? [...marker_boxes, ...point_labels.map(({ box }) => box)]
      : []
    const shown = new Set<number>()
    const order = transformed_regions
      .map((region, idx) => [idx, region.area] as const)
      .toSorted(([, area_a], [, area_b]) => area_b - area_a)
    for (const [idx] of order) {
      const { label_pos, label_props } = transformed_regions[idx]
      const { lines, scale, rotation } = label_props
      // a label clipped by a zoomed window must not block visible ones
      if (!lines.length || !in_plot(...label_pos)) continue
      const along =
        Math.max(...lines.map((line) => line.length)) * font_size * CHAR_WIDTH_EM * scale
      const across = lines.length * font_size * LINE_HEIGHT_EM * scale
      const [half_w, half_h] = rotation ? [across / 2, along / 2] : [along / 2, across / 2]
      const [cx, cy] = label_pos
      const box: Box = [cx - half_w, cy - half_h, cx + half_w, cy + half_h]
      if (placed.some((other) => overlaps(box, other))) continue
      placed.push(box)
      shown.add(idx)
    }
    return shown
  })

  type Box = [number, number, number, number] // x_min, y_min, x_max, y_max
  const overlaps = (box_a: Box, box_b: Box) =>
    box_a[0] < box_b[2] && box_b[0] < box_a[2] && box_a[1] < box_b[3] && box_b[1] < box_a[3]

  const boundary_path = (points: Vec2[]) =>
    generate_boundary_path(transform_vertices(points, x_scale, y_scale))

  const in_plot = (svg_x: number, svg_y: number) =>
    svg_x >= left - 0.5 && svg_x <= right + 0.5 && svg_y >= top - 0.5 && svg_y <= bottom + 0.5

  const special_points = $derived(diagram_points(data))
  // Point categories the legend toggled off
  const hidden_categories = new SvelteSet<DiagramPoint[`category`]>()
  // Points outside a zoomed x/y window would sit on the axes or margins
  const transformed_points = $derived(
    special_points
      .filter(({ category }) => !hidden_categories.has(category))
      .map((point) => ({
        ...point,
        src: point, // the diagram_points entry, for identity checks (lit_point)
        svg_x: x_scale(point.composition),
        svg_y: y_scale(point.temperature),
      }))
      .filter(({ svg_x, svg_y }) => in_plot(svg_x, svg_y)),
  )
  // Each drawn marker's box, which labels avoid
  const marker_boxes = $derived.by(() => {
    const reach = merged_config.special_point_radius + 2
    return transformed_points.map(({ svg_x, svg_y }): Box => [
      svg_x - reach,
      svg_y - reach,
      svg_x + reach,
      svg_y + reach,
    ])
  })
  // The point highlight.point names: matched among all of this diagram's points (not just
  // the drawn ones), so zooming never re-pairs it
  const lit_point = $derived.by(() => {
    const ref = highlight?.point
    if (!ref) return null
    const names = new Map(
      data.phases.map(({ id, model_phase, label }) => [
        id,
        [model_phase, label, match_of(id)].filter((name) => name !== undefined),
      ]),
    )
    const t_span = t_extent[1] - t_extent[0] || 1
    return match_point(special_points, ref, t_span, (id) => names.get(id) ?? [id])
  })

  // Marker labels (E, Tₘ(Pb)) take the first spot of above, below, beside that stays in the
  // plot, clear of every marker and of labels placed before, else above. Labels of points
  // within a label width of the plot's side run inwards.
  const point_labels = $derived.by(() => {
    const { font_size, special_point_radius: radius } = merged_config
    const reach = radius + 2
    const placed: Box[] = []
    return transformed_points.flatMap((point) => {
      const { svg_x, svg_y, marker_label } = point
      if (!marker_label) return []
      const text_w = marker_label.length * font_size * CHAR_WIDTH_EM
      const edge = svg_x - left < text_w / 2 ? -1 : right - svg_x < text_w / 2 ? 1 : 0
      const half_h = (font_size * LINE_HEIGHT_EM) / 2
      // [anchor x, baseline-centre y, text-anchor]
      const centred = edge === 0
      const above_x = centred ? svg_x : svg_x - 4 * edge
      const anchor = ([`start`, `middle`, `end`] as const)[edge + 1]
      // beside spots only on the inward side of an edge point, where the plot has room
      type Spot = [number, number, `start` | `middle` | `end`]
      const beside_right: Spot[] = edge === 1 ? [] : [[svg_x + reach + 2, svg_y, `start`]]
      const beside_left: Spot[] = edge === -1 ? [] : [[svg_x - reach - 2, svg_y, `end`]]
      const spots: Spot[] = [
        [above_x, svg_y - radius * 2 - 2, anchor],
        [above_x, svg_y + radius * 2 + 4, anchor],
        ...beside_right,
        ...beside_left,
      ]
      const box_of = ([x_val, y_val, text_anchor]: (typeof spots)[number]): Box => {
        const x_min =
          text_anchor === `start`
            ? x_val
            : text_anchor === `end`
              ? x_val - text_w
              : x_val - text_w / 2
        return [x_min, y_val - half_h, x_min + text_w, y_val + half_h]
      }
      const fits = (box: Box) =>
        box[0] >= left && box[2] <= right && box[1] >= top && box[3] <= bottom
      const obstacles = [...marker_boxes, ...placed]
      const spot =
        spots.find((candidate) => {
          const box = box_of(candidate)
          return fits(box) && !obstacles.some((other) => overlaps(box, other))
        }) ?? spots[0]
      const box = box_of(spot)
      placed.push(box)
      return [{ point, x: spot[0], y: spot[1], text_anchor: spot[2], box }]
    })
  })

  // Legend group of an observation marker: its verdict when scored, else its status
  // (prefixed, so a row status named like a verdict doesn't merge into its group)
  const STATUS_PREFIX = `status:`
  const marker_group = ({ pass, row }: ObservationMarker): string =>
    pass === true ? `pass` : pass === false ? `fail` : `${STATUS_PREFIX}${row.status}`
  const group_style = (group: string) => {
    if (group === `pass` || group === `fail`) return VERDICT_STYLES[group]
    const status = group.slice(STATUS_PREFIX.length)
    return { color: status_color(status), label: status_label(status) }
  }
  // Observation groups the legend toggled off
  const hidden_groups = new SvelteSet<string>()
  const all_markers = $derived(observation_markers(observations, data.components, predictions))
  // fixed legend order: verdicts, then statuses as they first appear
  const marker_groups = $derived.by(() => {
    const present = new Set(all_markers.map(marker_group))
    return [...new Set([`pass`, `fail`, ...present])].filter((group) => present.has(group))
  })
  const shown_markers = $derived(
    show_observations
      ? all_markers.flatMap((marker) => {
          const group = marker_group(marker)
          if (hidden_groups.has(group)) return []
          const svg_x = x_scale(marker.composition)
          const svg_y = y_scale(marker.temperature)
          // outside a zoomed window a marker is neither drawn nor hoverable
          if (!in_plot(svg_x, svg_y)) return []
          // the arrow keeps the observed coordinate the prediction leaves out
          const { predicted_x, predicted_t } = marker
          const arrow =
            predicted_x === null && predicted_t === null
              ? null
              : {
                  x_end: x_scale(predicted_x ?? marker.composition),
                  y_end: y_scale(predicted_t ?? marker.temperature),
                }
          return [{ marker, svg_x, svg_y, color: group_style(group).color, arrow }]
        })
      : [],
  )
  const arrow_colors = $derived([
    ...new Set(shown_markers.flatMap(({ arrow, color }) => (arrow ? [color] : []))),
  ])
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

  const has_uncertainty = $derived(
    data.boundaries.some(({ sigma_T }) => sigma_T?.some((sigma) => sigma > 0)) ||
      special_points.some(({ sigma_T }) => sigma_T > 0),
  )
  // Uncertainty bands: each boundary with sigma_T as a T ± σ polygon
  const boundary_bands = $derived(
    show_uncertainty
      ? data.boundaries.flatMap(({ kind, points, sigma_T }) => {
          if (!sigma_T?.some((sigma) => sigma > 0)) return []
          const upper = points.map(([comp, temp], idx): Vec2 => [comp, temp + sigma_T[idx]])
          const lower = points.map(([comp, temp], idx): Vec2 => [comp, temp - sigma_T[idx]])
          const outline = transform_vertices(
            [...upper, ...lower.toReversed()],
            x_scale,
            y_scale,
          )
          return [{ path: generate_region_path(outline), color: BOUNDARY_STYLES[kind].color }]
        })
      : [],
  )

  // Hatched isotherm strips where the first valid overlay (even while its lines are hidden)
  // names other model phases, one row per 3 px of plot height, recomputed on zoom or resize,
  // not on hover. The legend's share uses a fixed T grid, so zoom and plot size don't move it.
  const DISAGREEMENT_ROW_PX = 3
  const disagreement_target = $derived(
    valid_overlays[0]?.regions.length && data.regions.length ? valid_overlays[0] : null,
  )
  // A phase standing in for a reference phase (phase_matches) counts as that phase's model phase
  const disagreement_name_of = $derived.by(() => {
    const model_phase_by_name = new Map(
      (disagreement_target?.phases ?? []).flatMap(({ id, label, model_phase }) =>
        [id, label, model_phase].map((name) => [name, model_phase] as const),
      ),
    )
    return (id: string): string | undefined => {
      const target = match_of(id)
      return target === undefined ? undefined : (model_phase_by_name.get(target) ?? target)
    }
  })
  const disagreement_share = $derived.by(() => {
    if (!disagreement_target) return 0
    const [t_min, t_max] = t_extent
    const temps = Array.from(
      { length: 400 },
      (_, idx) => t_min + ((idx + 0.5) * (t_max - t_min)) / 400,
    )
    return phase_disagreement(data, disagreement_target, temps, disagreement_name_of).fraction
  })
  const disagreement_path = $derived.by(() => {
    const other = disagreement_target
    if (!show_disagreement || !other) return ``
    const n_rows = Math.max(1, Math.floor(plot_height / DISAGREEMENT_ROW_PX))
    const temps = Array.from({ length: n_rows }, (_, idx) =>
      y_scale.invert(bottom - (idx + 0.5) * DISAGREEMENT_ROW_PX),
    )
    const { segments } = phase_disagreement(data, other, temps, disagreement_name_of)
    const half = DISAGREEMENT_ROW_PX / 2
    return segments
      .map(([temp, x_start, x_end]) => {
        const [x_0, x_1] = [x_scale(x_start), x_scale(x_end)]
        return `M${x_0},${y_scale(temp) - half}h${x_1 - x_0}v${DISAGREEMENT_ROW_PX}h${x_0 - x_1}z`
      })
      .join(``)
  })

  // Legend series: 0 the diagram, 1.. its overlays, then point categories, observation
  // groups and the disagreement hatch
  const UNLABELLED_CATEGORIES = [`congruent`, `critical`, `polymorphic`] as const
  // d3 symbol paths (centred on 0, 0) of the non-circle point markers
  const symbol_paths = $derived(
    Object.fromEntries(
      [`Diamond`, `Triangle`].map((name) => [
        name,
        symbol(symbol_map[name as D3SymbolName], 1.4 * Math.PI * marker_radius ** 2)(),
      ]),
    ),
  )
  // Marker shape per point category, in the plot, the lens and the legend
  const POINT_SYMBOLS = {
    invariant: `Circle`,
    unary: `Circle`,
    polymorphic: `Circle`,
    congruent: `Diamond`,
    critical: `Triangle`,
  } as const satisfies Record<DiagramPoint[`category`], D3SymbolName>
  const legend_categories = $derived(
    UNLABELLED_CATEGORIES.filter((category) =>
      special_points.some((point) => point.category === category),
    ),
  )
  const has_legend = $derived(
    valid_overlays.length > 0 || all_markers.length > 0 || legend_categories.length > 0,
  )
  type LegendTarget =
    | { kind: `main` }
    | { kind: `overlay`; overlay: BinaryPhaseDiagram }
    | { kind: `category`; category: DiagramPoint[`category`] }
    | { kind: `group`; group: string }
    | { kind: `disagreement` }
  type LegendEntry = [Omit<LegendItem, `series_idx`>, LegendTarget]
  const legend_entries = $derived.by((): [LegendItem, LegendTarget][] => {
    if (!has_legend) return []
    const point_color = merged_config.colors.special_point
    const entries: LegendEntry[] = [
      [
        {
          label: diagram_name(data),
          visible: show_boundaries,
          display_style: { line_color: BOUNDARY_STYLES.liquidus.color },
        },
        { kind: `main` },
      ],
      ...valid_overlays.map((overlay, idx): LegendEntry => [
        {
          label: diagram_name(overlay),
          visible: overlay_slots[idx] !== null,
          display_style: {
            line_color: overlay_styles[idx].color,
            line_dash: overlay_styles[idx].dash,
          },
        },
        { kind: `overlay`, overlay },
      ]),
      ...legend_categories.map((category): LegendEntry => [
        {
          label: `${humanize(category)} point`,
          visible: show_special_points && !hidden_categories.has(category),
          display_style: { symbol_type: POINT_SYMBOLS[category], symbol_color: point_color },
        },
        { kind: `category`, category },
      ]),
      ...marker_groups.map((group): LegendEntry => [
        {
          label: group_style(group).label,
          visible: show_observations && !hidden_groups.has(group),
          display_style: { symbol_type: `Circle`, symbol_color: group_style(group).color },
        },
        { kind: `group`, group },
      ]),
    ]
    if (disagreement_target) {
      entries.push([
        {
          label: `Phases differ from ${diagram_name(disagreement_target)} (${format_num(disagreement_share, `.0%`)} of area)`,
          visible: show_disagreement,
          item_type: `fill`,
          display_style: { fill_color: DISAGREEMENT_COLOR, fill_opacity: 0.5 },
        },
        { kind: `disagreement` },
      ])
    }
    return entries.map(([item, target], series_idx) => [{ ...item, series_idx }, target])
  })
  const legend_items = $derived(legend_entries.map(([item]) => item))
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
  // The legend avoids marked points, observations and boundaries (keyed on has_legend, not
  // legend_items, so a legend toggle doesn't re-sample every boundary)
  const boundary_samples = $derived(
    has_legend
      ? [data, ...overlay_slots].flatMap((diagram) =>
          (diagram?.boundaries ?? []).flatMap(({ points }) => sample_boundary(points)),
        )
      : [],
  )
  const legend_obstacles = $derived(
    has_legend
      ? [
          ...transformed_points.map(({ svg_x, svg_y }) => ({ x: svg_x, y: svg_y })),
          ...shown_markers.map(({ svg_x, svg_y }) => ({ x: svg_x, y: svg_y })),
          ...boundary_samples,
        ]
      : [],
  )
  // Toggles one sub-layer (an overlay, point category or observation group); while its
  // whole layer is off, a click unhides the item and turns the layer back on
  function toggle_in<T>(set: SvelteSet<T>, item: T, layer_on: boolean): void {
    if (layer_on && !set.has(item)) set.add(item)
    else set.delete(item)
  }
  function toggle_legend_item(series_idx: number) {
    const target = legend_entries[series_idx]?.[1]
    if (!target) return
    if (target.kind === `main`) show_boundaries = !show_boundaries
    else if (target.kind === `disagreement`) show_disagreement = !show_disagreement
    else if (target.kind === `overlay`) {
      toggle_in(hidden_overlays, target.overlay, show_overlay)
      // all hidden is the layer off, so a bound show_overlay checkbox stays truthful
      const all_hidden = valid_overlays.every((overlay) => hidden_overlays.has(overlay))
      if (all_hidden) hidden_overlays.clear()
      show_overlay = !all_hidden
    } else if (target.kind === `category`) {
      toggle_in(hidden_categories, target.category, show_special_points)
      show_special_points = true
    } else {
      toggle_in(hidden_groups, target.group, show_observations)
      show_observations = true
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
  // a highlighted phase lights its single-phase fields and the boundary edges tracing it
  const highlighted_region = ({ phases }: DiagramRegion) =>
    phases.length === 1 && lit_phases?.has(phases[0]) === true

  const own_cursor = () => cursor?.source === gradient_uid
  // Highlights compare by value (a host's $state hands back a proxy, not the object written):
  // `obs:<id>` or `pt:<category>:<kind>:<x>,<T>`, null for any other highlight
  const highlight_key = (value: DiagramHighlight | null): string | null => {
    if (value?.observation) return `obs:${value.observation}`
    const ref = value?.point
    if (!ref || value.phases?.length) return null
    return `pt:${ref.category}:${ref.kind}:${ref.at.join(`,`)}:${ref.phases?.join(`+`) ?? ``}`
  }
  // Key of the highlight this diagram last wrote for its hovered mark
  let written_key: string | null = null
  // Writes the hovered observation's or point's highlight; leaving the mark clears it, unless
  // a partner or the host has replaced it meanwhile
  function set_mark_highlight(
    observation: ObservationMarker | null,
    point: DiagramPoint | null,
  ) {
    const next: DiagramHighlight | null = observation
      ? { observation: observation.row.id }
      : point && { point: point_ref(point, data) }
    const key = highlight_key(next)
    const current = highlight_key(highlight)
    if (key === null) {
      if (written_key !== null && current === written_key) highlight = null
    } else if (key !== current) highlight = next
    written_key = key
  }
  // Drops this diagram's hover, reporting it once
  function drop_hover() {
    if (written_key !== null) set_mark_highlight(null, null)
    if (!hover_info && !hovered_region) return
    hover_info = null
    hovered_region = null
    on_phase_hover?.(null)
  }
  // Drops the hover and the shared cursor when this diagram set it
  function clear_hover() {
    if (own_cursor()) cursor = null
    drop_hover()
  }

  // Hover and pin describe the previous data, overlays and observation markers, so drop them
  // when those change.
  // Hiding the overlay keeps a pin: its tooltip just leaves out the overlay phase.
  $effect(() => {
    void [source_data, valid_overlays, all_markers]
    untrack(() => {
      for (const overlay of hidden_overlays) {
        if (!valid_overlays.includes(overlay)) hidden_overlays.delete(overlay)
      }
      if (!hover_info && !pin.value && !hovered_region) return
      pin.unpin()
      clear_hover()
    })
  })

  // The strip's room rescales x, so the hover (tooltip, tie line) is dropped until the next move
  function set_isopleth(composition: number | null) {
    if (!regions.length) return
    isopleth = composition
    clear_hover()
  }
  // Shift+click sets the isopleth at the pointer's composition, or clears it on the line
  function handle_click(event: { shiftKey: boolean }) {
    if (!event.shiftKey) return pin.toggle(hover_info)
    if (!hover_info) return
    const near_line =
      isopleth !== null && Math.abs(x_scale(isopleth) - x_scale(hover_info.composition)) < 4
    set_isopleth(near_line ? null : hover_info.composition)
  }

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

  // === Lens ===
  // A circle magnifying the regions, boundaries and overlays around the pointer; markers in
  // it keep their size, at magnified positions
  const LENS = { zoom: 4, radius: 70 }
  let lens_center = $state.raw<Vec2 | null>(null)
  const lens_view = $derived.by(() => {
    if (!lens || !lens_center) return null
    const [cx, cy] = lens_center
    const { zoom, radius } = LENS
    // marks drawn in the lens keep their size at magnified positions; the clip hides the rest
    const project = (svg_x: number, svg_y: number): Vec2 => [
      cx + (svg_x - cx) * zoom,
      cy + (svg_y - cy) * zoom,
    ]
    const transform = `translate(${cx * (1 - zoom)}, ${cy * (1 - zoom)}) scale(${zoom})`
    return { cx, cy, radius, transform, project }
  })
  const identity = (svg_x: number, svg_y: number): Vec2 => [svg_x, svg_y]

  // === Isopleth ===
  // Phase fractions at the isopleth's composition stacked left to right in a strip right of
  // the plot (one path per phase), and its phase changes marked on the line
  const isopleth_view = $derived.by(() => {
    if (isopleth === null || !has_isopleth) return null
    // one bin per 2 px of plot height keeps the strip smooth at any size
    const n_steps = Math.max(10, Math.round(plot_height / 2))
    const { steps, transitions, bin } = compute_isopleth(data, isopleth, t_domain, n_steps)
    const x_start = right + ISOPLETH_STRIP.gap
    const strip_width = ISOPLETH_STRIP.width
    const paths = new Map<string, string>()
    for (const { temperature, fractions } of steps) {
      const [y_top, y_bottom] = [
        y_scale(temperature + bin / 2),
        y_scale(temperature - bin / 2),
      ]
      let offset = 0
      for (const [id, fraction] of fractions) {
        const [x_0, bar] = [x_start + offset * strip_width, fraction * strip_width]
        paths.set(id, `${paths.get(id) ?? ``}M${x_0},${y_top}h${bar}V${y_bottom}h${-bar}z`)
        offset += fraction
      }
    }
    // labels closer than a text line to the previous one are left to the tooltip
    let last_y = -Infinity
    const marks = transitions.map(({ temperature }) => {
      const svg_y = y_scale(temperature)
      const labelled = svg_y - last_y > merged_config.font_size * LINE_HEIGHT_EM
      if (labelled) last_y = svg_y
      return { svg_y, labelled, text: format_temperature(temperature, temp_unit) }
    })
    // outside a zoomed x window only the strip remains; near the right edge labels run left
    const svg_x = x_scale(isopleth)
    const on_plot = svg_x >= left && svg_x <= right
    const label_left = svg_x > right - 50
    return {
      composition: isopleth,
      svg_x,
      label_x: label_left ? svg_x - 6 : svg_x + 6,
      label_anchor: label_left ? `end` : `start`,
      x_start,
      strip_width,
      paths: [...paths],
      marks: on_plot ? marks : [],
      on_plot,
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
        format_hover_info_text(info, data, { overlays: overlay_slots, temp_unit, comp_unit }),
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
    if (svg_x < left || svg_x > right || svg_y < top || svg_y > bottom) {
      lens_center = null
      return clear_hover()
    }
    lens_center = [svg_x, svg_y] // free while the lens is off: lens_view reads `lens` first
    const composition = x_scale.invert(svg_x)
    const temperature = y_scale.invert(svg_y)
    cursor = { composition, temperature, source: gradient_uid }

    const hit = diagram_hit(data, composition, temperature)
    const overlay_hits = overlay_slots.map(
      (overlay) => overlay && diagram_hit(overlay, composition, temperature),
    )
    const point = show_special_points ? nearest(transformed_points, svg_x, svg_y, 12) : null
    const observation: ObservationMarker | null =
      nearest(shown_markers, svg_x, svg_y, 8)?.marker ?? null
    set_mark_highlight(observation, point)
    // a diagram with regions shows no tooltip in a gap; one without (boundaries only) always
    // reports the cursor's (x, T)
    const nothing_hit =
      !hit.region && !overlay_hits.some((other) => other?.region) && !point && !observation
    if (nothing_hit && regions.length > 0) return drop_hover()
    hovered_region = hit.region
    hover_info = {
      ...hit,
      overlay_hits,
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
    lens_center = null
    clear_hover()
  }
  // A diagram unmounted mid-hover must not leave its synced partners a stuck crosshair, nor
  // its host a stuck highlight
  $effect(() => () => {
    if (own_cursor()) cursor = null
    if (written_key !== null && highlight_key(highlight) === written_key) highlight = null
  })

  // `e` toggles the export pane, `m` the lens, `i` the isopleth at the pointer, Escape
  // unpins the tooltip
  const keys = viewer_keys(() => ({
    e: () => {
      export_pane_open = !export_pane_open
    },
    m: () => {
      lens = !lens
    },
    i: () => {
      set_isopleth(isopleth === null && cursor ? cursor.composition : null)
    },
    Escape: pin.unpin,
  }))

  function handle_svg_keydown(event: KeyboardEvent) {
    if (event.key === `Enter` || event.key === ` `) {
      event.preventDefault()
      handle_click(event)
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

{#snippet error_bar(low: number, high: number, at: number, vertical: boolean, color: string)}
  {@const scale = vertical ? y_scale : x_scale}
  <path
    class="error-bar"
    d={error_bar_path([scale(low), scale(high)], at, vertical, error_bar_cap)}
    stroke={color}
    fill="none"
  />
{/snippet}

<!-- Marks redrawn in the lens at magnified positions: marked points, observations, tie line -->
{#snippet point_marker(
  category: DiagramPoint[`category`],
  [x_val, y_val]: Vec2,
  hovered = false,
  lit = false,
)}
  {@const fill = merged_config.colors.special_point}
  {@const shape = POINT_SYMBOLS[category]}
  {#if shape === `Circle`}
    <circle
      cx={x_val}
      cy={y_val}
      r={marker_radius}
      {fill}
      stroke="white"
      stroke-width={1.5}
      class="special-point-marker"
      class:hovered
      class:lit={lit && !hovered}
      data-category={category}
    />
  {:else}
    <path
      d={symbol_paths[shape]}
      transform="translate({x_val}, {y_val})"
      {fill}
      stroke="white"
      stroke-width={1.5}
      class="special-point-marker"
      class:hovered
      class:lit={lit && !hovered}
      data-category={category}
    />
  {/if}
{/snippet}

{#snippet observation_marker(
  marker: ObservationMarker,
  [x_val, y_val]: Vec2,
  color: string,
  hovered = false,
)}
  <circle
    cx={x_val}
    cy={y_val}
    r={4.5}
    fill={color}
    stroke="white"
    stroke-width={1.5}
    class="observation-marker"
    class:hovered
    class:lit={!hovered && highlight?.observation === marker.row.id}
    data-status={marker.row.status}
    data-verdict={marker.pass === null ? undefined : marker.pass ? `pass` : `fail`}
  />
{/snippet}

<!-- Tie line: white-outlined line, phase endpoints, cursor marker -->
{#snippet tie_marks(project: (svg_x: number, svg_y: number) => Vec2)}
  {#if tie_line}
    {@const style = merged_config.tie_line}
    {@const ends = tie_line.endpoints.map(({ cx, cy, color }) => ({
      at: project(cx, cy),
      color,
    }))}
    {@const [cursor_x, cursor_y] = project(tie_line.cursor.cx, tie_line.cursor.cy)}
    {#each [`white`, TIE_LINE_COLOR] as stroke (stroke)}
      <line
        x1={ends[0].at[0]}
        y1={ends[0].at[1]}
        x2={ends[1].at[0]}
        y2={ends[1].at[1]}
        {stroke}
        stroke-width={style.stroke_width + (stroke === `white` ? 1 : 0)}
        stroke-linecap="round"
      />
    {/each}
    {#each ends as { at, color }, idx (idx)}
      <circle
        cx={at[0]}
        cy={at[1]}
        r={style.endpoint_radius}
        fill={color}
        stroke="white"
        stroke-width={1.5}
      />
    {/each}
    <circle
      cx={cursor_x}
      cy={cursor_y}
      r={style.cursor_radius}
      fill={TIE_LINE_COLOR}
      stroke="white"
      stroke-width={2}
    />
  {/if}
{/snippet}

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
          bind:show_uncertainty
          bind:show_disagreement
          bind:lens
          bind:temp_unit
          bind:comp_unit
          bind:config
          bind:x_axis
          bind:y_axis
          {data}
          has_overlay={valid_overlays.length > 0}
          has_special_points={special_points.length > 0}
          has_observations={all_markers.length > 0}
          {has_uncertainty}
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
      aria-label="Binary phase diagram. Use mouse to explore phases. Click to pin tooltip, double-click to copy data, shift+click to set an isopleth. Press E to export, M for a magnifier, I for an isopleth."
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
        <pattern
          id="{gradient_uid}-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line y2="6" stroke={DISAGREEMENT_COLOR} stroke-width="2" stroke-opacity="0.55" />
        </pattern>
        <!-- one arrowhead per marker color (context-stroke is not supported everywhere) -->
        {#each arrow_colors as color, idx (color)}
          <marker
            id="{gradient_uid}-arrow-{idx}"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0L10,5L0,10z" fill={color} />
          </marker>
        {/each}
        {#if lens_view}
          <clipPath id="{gradient_uid}-lens">
            <circle cx={lens_view.cx} cy={lens_view.cy} r={lens_view.radius} />
          </clipPath>
        {/if}
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

      <!-- regions, uncertainty bands, disagreement hatch, boundaries and overlays: the lens
      shows this group magnified (strokes keep their width there) -->
      <g id="{gradient_uid}-layers">
        <g class="phase-regions" clip-path={plot_clip}>
          {#each transformed_regions as { region, svg_path, gradient }, idx (idx)}
            <path
              d={svg_path}
              fill={gradient
                ? `url(#${gradient_uid}-${idx})`
                : add_alpha(color_of(region.phases[0]), REGION_ALPHA)}
              stroke="none"
              class:hovered={lit_region(region)}
              class:lit={highlighted_region(region)}
            />
          {/each}
        </g>

        {#if boundary_bands.length}
          <g class="uncertainty-bands" clip-path={plot_clip}>
            {#each boundary_bands as { path, color }, idx (idx)}
              <path d={path} fill={color} fill-opacity="0.2" />
            {/each}
          </g>
        {/if}

        {#if disagreement_path}
          <path
            class="disagreement"
            d={disagreement_path}
            fill="url(#{gradient_uid}-hatch)"
            clip-path={plot_clip}
          />
        {/if}

        {#if show_boundaries}
          <g class="boundaries" clip-path={plot_clip}>
            {#each data.boundaries as { kind, points, side }, idx (idx)}
              {@const style = BOUNDARY_STYLES[kind]}
              <path
                d={boundary_path(points)}
                fill="none"
                stroke={style.color}
                stroke-width={style.width}
                stroke-dasharray={style.dash ?? ``}
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
                class:lit={side != null && lit_phases?.has(side) === true}
                data-kind={kind}
              />
            {/each}
          </g>
        {/if}

        {#each overlay_slots as overlay, overlay_idx (overlay_idx)}
          {#if overlay}
            {@const { color, dash } = overlay_styles[overlay_idx]}
            <g class="overlay-boundaries" clip-path={plot_clip} style="pointer-events: none">
              {#each overlay.boundaries as { kind, points }, idx (idx)}
                <!-- magnetic lines keep their dash-dot so they never read as phase boundaries -->
                <path
                  d={boundary_path(points)}
                  fill="none"
                  stroke={color}
                  stroke-width={kind === `magnetic` ? 1.5 : 2}
                  stroke-dasharray={kind === `magnetic` ? BOUNDARY_STYLES.magnetic.dash : dash}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  vector-effect="non-scaling-stroke"
                  data-kind={kind}
                />
              {/each}
            </g>
          {/if}
        {/each}

        {#if isopleth_view?.on_plot}
          <line
            class="isopleth-line"
            x1={isopleth_view.svg_x}
            x2={isopleth_view.svg_x}
            y1={top}
            y2={bottom}
            stroke={merged_config.colors.axis}
            stroke-width="1.5"
            stroke-dasharray="6,3"
            vector-effect="non-scaling-stroke"
            style="pointer-events: none"
          />
        {/if}
      </g>

      {#if show_labels}
        <g class="region-labels" style="pointer-events: none" clip-path={plot_clip}>
          {#each transformed_regions as { label_pos, label_props }, idx (idx)}
            {@const line_height = merged_config.font_size * LINE_HEIGHT_EM}
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

      {#if tie_line}
        <g class="tie-line" class:pinned={pin.value} clip-path={plot_clip}>
          {@render tie_marks(identity)}
        </g>
      {/if}

      {#if isopleth_view}
        {@const { svg_x, label_x, label_anchor, x_start, strip_width, paths, marks } =
          isopleth_view}
        {@const { axis, text } = merged_config.colors}
        {@const small_font = merged_config.font_size - 2}
        {@const middle = x_start + strip_width / 2}
        <g class="isopleth" style="pointer-events: none">
          {#each marks as { svg_y, labelled, text: label }, idx (idx)}
            <line
              x1={svg_x - 4}
              x2={svg_x + 4}
              y1={svg_y}
              y2={svg_y}
              stroke={axis}
              stroke-width="2"
            />
            {#if labelled}
              <text
                x={label_x}
                y={svg_y - 3}
                text-anchor={label_anchor}
                fill={text}
                font-size={small_font}
                class="halo">{label}</text
              >
            {/if}
          {/each}
          {#each paths as [id, path] (id)}
            <path d={path} fill={color_of(id)} />
          {/each}
          <rect
            x={x_start}
            y={top}
            width={strip_width}
            height={plot_height}
            fill="none"
            stroke={axis}
          />
          <!-- strip captions: its composition above, the 0..1 fraction axis below -->
          {#each [[middle, top - 8, format_composition(isopleth_view.composition, comp_unit)], [x_start, bottom + 14, `0`], [x_start + strip_width, bottom + 14, `1`], [middle, bottom + 28, `fraction`]] as const as [x_val, y_val, caption] (caption)}
            <text x={x_val} y={y_val} text-anchor="middle" fill={text} font-size={small_font}>
              {caption}
            </text>
          {/each}
        </g>
      {/if}

      <!-- Marked points, drawn over regions, boundaries and the tie-line -->
      {#if show_special_points}
        {@const color = merged_config.colors.special_point}
        <g class="special-points">
          {#each transformed_points as point, idx (idx)}
            {@const { svg_x, svg_y, category, sigma_T, temperature } = point}
            {#if show_uncertainty && sigma_T > 0}
              {@render error_bar(
                temperature - sigma_T,
                temperature + sigma_T,
                svg_x,
                true,
                color,
              )}
            {/if}
            {@render point_marker(
              category,
              [svg_x, svg_y],
              effective_hover_info?.point === point,
              point.src === lit_point,
            )}
          {/each}
          {#each point_labels as { point, x, y, text_anchor } (point)}
            <text
              {x}
              {y}
              text-anchor={text_anchor}
              dominant-baseline="middle"
              fill={merged_config.colors.text}
              font-size={merged_config.font_size}
              font-weight="bold"
              class="halo"
            >
              {point.marker_label}
            </text>
          {/each}
        </g>
      {/if}

      <!-- Observations: isotherm joining one row's phases, error bars, residual arrows to the
      predicted point, then markers colored by verdict or status -->
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
          {#each shown_markers as { marker, svg_x, svg_y, color, arrow }, idx (idx)}
            {@const { row, phase, composition, temperature } = marker}
            {@const sigma_t = row.sigma_T_K ?? 0}
            {@const sigma_x = phase?.sigma_x ?? 0}
            {#if sigma_t > 0}
              {@render error_bar(
                temperature - sigma_t,
                temperature + sigma_t,
                svg_x,
                true,
                color,
              )}
            {/if}
            {#if sigma_x > 0}
              {@render error_bar(
                composition - sigma_x,
                composition + sigma_x,
                svg_y,
                false,
                color,
              )}
            {/if}
            <!-- shorter arrows would be all head (9 px) reaching back over the marker -->
            {#if arrow && Math.hypot(arrow.x_end - svg_x, arrow.y_end - svg_y) > 14}
              <line
                class="residual"
                x1={svg_x}
                y1={svg_y}
                x2={arrow.x_end}
                y2={arrow.y_end}
                stroke={color}
                stroke-width="1.5"
                marker-end="url(#{gradient_uid}-arrow-{arrow_colors.indexOf(color)})"
              />
            {/if}
          {/each}
        </g>
        <!-- unclipped, so markers on the x = 0 and x = 1 edges show whole like marked points -->
        <g class="observation-markers" style="pointer-events: none">
          {#each shown_markers as { marker, svg_x, svg_y, color }, idx (idx)}
            {@render observation_marker(
              marker,
              [svg_x, svg_y],
              color,
              effective_hover_info?.observation === marker,
            )}
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

      {#if lens_view}
        {@const { cx, cy, radius, transform, project } = lens_view}
        <g class="lens" style="pointer-events: none">
          <circle {cx} {cy} r={radius} fill="var(--pd-lens-bg, var(--page-bg, white))" />
          <g clip-path="url(#{gradient_uid}-lens)">
            <g {transform}><use href="#{gradient_uid}-layers" /></g>
            {@render tie_marks(project)}
            {#if show_special_points}
              {#each transformed_points as { category, svg_x, svg_y, src }, idx (idx)}
                {@render point_marker(
                  category,
                  project(svg_x, svg_y),
                  false,
                  src === lit_point,
                )}
              {/each}
            {/if}
            {#each shown_markers as { marker, svg_x, svg_y, color }, idx (idx)}
              {@render observation_marker(marker, project(svg_x, svg_y), color)}
            {/each}
          </g>
          <circle
            {cx}
            {cy}
            r={radius}
            fill="none"
            stroke={merged_config.colors.axis}
            stroke-width="1.5"
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
        offset={lens_view ? { x: LENS.radius + 8, y: LENS.radius + 8 } : { x: 15, y: 15 }}
        fallback_size={{ width: 200, height: 150 }}
        class="tooltip-container"
        bg_color={tooltip_region_color}
        pinned={pin.value !== null}
      >
        <PhaseDiagramTooltip
          hover_info={effective_hover_info}
          {data}
          overlays={overlay_slots}
          {color_of}
          {match_of}
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
  /* highlight from a linked host: a static outline (an animated stroke would repaint the
  whole SVG every frame) */
  :is(.observation-marker, .special-point-marker, .boundaries path, .phase-regions path).lit {
    stroke: var(--pd-highlight, #ffb300);
    stroke-width: 3;
  }
  .halo {
    paint-order: stroke;
    stroke: var(--pd-halo, var(--page-bg, white));
    stroke-width: 3px;
    stroke-linejoin: round;
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
