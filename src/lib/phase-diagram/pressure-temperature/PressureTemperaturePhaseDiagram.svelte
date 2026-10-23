<script lang="ts" module>
  import { DEFAULTS } from '#lib/settings.js'

  // Zero lines off: 0 °C or 0 GPa is no reference on a phase diagram, and on a °C axis the
  // line would move with the unit
  const DISPLAY_DEFAULTS = { ...DEFAULTS.plot.display, x_zero_line: false, y_zero_line: false }
</script>

<script lang="ts">
  import { format_label_html, format_label_svg } from '#lib/composition/format.js'
  import { track_settings } from '#lib/controls.js'
  import { format_num, symbol_map } from '#lib/labels.js'
  import { SettingsSection } from '#lib/layout/index.js'
  import { PlotControls } from '#lib/plot/index.js'
  import { sanitize_html, sanitize_svg } from '#lib/sanitize.js'
  import { TooltipContent, TooltipValue } from '#lib/tooltip/index.js'
  import { tooltip as hint } from 'svelte-widgets/attachments'
  import { json_source } from '#lib/io/export.js'
  import ViewerNotices from '#lib/layout/ViewerNotices.svelte'
  import { point_in_polygon, polygon_label_point, type Vec2 } from '#lib/math.js'
  import {
    create_cartesian_frame,
    has_controls_row,
  } from '#lib/plot/core/cartesian-frame.svelte.js'
  import CartesianFrame from '#lib/plot/core/components/CartesianFrame.svelte'
  import PlotAxes from '#lib/plot/core/components/PlotAxes.svelte'
  import PlotLegendLayer from '#lib/plot/core/components/PlotLegendLayer.svelte'
  import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
  import ZeroLines from '#lib/plot/core/components/ZeroLines.svelte'
  import type { ObstacleSeries } from '#lib/plot/core/decorations/index.js'
  import { with_obstacle_frame } from '#lib/plot/core/decorations/index.js'
  import { error_bar_path } from '#lib/plot/core/error-bars.js'
  import { resolve_plot_display } from '#lib/plot/core/display.svelte.js'
  import { pointer_pos } from '#lib/plot/core/interactions.js'
  import { normalize_marginals } from '#lib/plot/core/marginals.js'
  import { create_axis_scales } from '#lib/plot/core/scales.js'
  import type {
    AxisConfig,
    BasePlotProps,
    DisplayConfig,
    LegendConfig,
    LegendItem,
    PanConfig,
  } from '#lib/plot/core/types.js'
  import { get_scale_type_name } from '#lib/plot/core/types.js'
  import { DEFAULT_FONT_SPEC, measure_text_line } from '#lib/plot/core/text-metrics.js'
  import { TooltipPin } from '#lib/tooltip/pin.svelte.js'
  import { toggle_item } from '#lib/utils.js'
  import { symbol } from 'd3-shape'
  import { type Snippet, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import type { TempUnit } from '../types'
  import { convert_temp, generate_boundary_path, generate_region_path } from '../utils'
  import {
    convert_pressure,
    parse_pt_data,
    PRESSURE_UNITS,
    TEMP_UNITS,
    phase_label,
    pressure_log_floor,
    pt_data_extent,
    pt_phase_colors,
  } from './data'
  import type { PixelSigma } from './geometry'
  import {
    clip_polygon_to_rect,
    derive_regions,
    interpolate_at,
    nearest_on_polylines,
    uncertainty_band,
  } from './geometry'
  import type {
    PressureUnit,
    PtHoverInfo,
    PtPhase,
    PtPhaseDiagramData,
    PtPhaseDiagramTooltipProp,
    PtSpecialPointType,
    PtUncertaintyMode,
  } from './types'

  let {
    data,
    pressure_axis = $bindable({}),
    temperature_axis = $bindable({}),
    swap_axes = $bindable(false),
    display_pressure_unit = $bindable(),
    display_temp_unit = $bindable(),
    uncertainty = $bindable(`band`),
    n_sigma = $bindable(1),
    show_regions = $bindable(true),
    show_boundaries = $bindable(true),
    show_labels = $bindable(true),
    show_special_points = $bindable(true),
    show_legend = $bindable(true),
    display = $bindable({ ...DISPLAY_DEFAULTS }),
    hidden_phases = $bindable([]),
    hidden_special_types = $bindable([]),
    legend = {},
    title, // defaults to data.title
    padding = {},
    pan = {},
    tooltip,
    on_phase_hover,
    on_pin,
    show_controls,
    controls_open = $bindable(false),
    controls_toggle_props,
    controls_pane_props,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    wrapper = $bindable(),
    export_filename,
    export_formats,
    on_export,
    header_controls,
    controls_extra,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `title` | `children`> &
    Omit<BasePlotProps, `range_padding` | `hovered`> & {
      data?: PtPhaseDiagramData
      // Axis configs by quantity, whichever side swap_axes puts them on (label, ticks, format,
      // scale_type, range in display units). `scale_type: 'log'` gives a log pressure axis.
      // A pinned range follows unit changes.
      pressure_axis?: AxisConfig
      temperature_axis?: AxisConfig
      // false: pressure on x and temperature on y; true: the other way round
      swap_axes?: boolean
      // Units shown on axes and in the tooltip, default to the data's own
      display_pressure_unit?: PressureUnit
      display_temp_unit?: TempUnit
      uncertainty?: PtUncertaintyMode
      // Error bars and bands span ±n_sigma standard errors (1: 68%, 2: 95%, 3: 99.7%)
      n_sigma?: number
      show_regions?: boolean
      show_boundaries?: boolean
      show_labels?: boolean
      show_special_points?: boolean
      show_legend?: boolean
      display?: DisplayConfig
      // Phase ids and special-point types hidden from the plot (toggled from the legend)
      hidden_phases?: string[]
      hidden_special_types?: PtSpecialPointType[]
      legend?: LegendConfig | null
      pan?: PanConfig
      // false hides the tooltip, a snippet replaces it, a config object adds prefix/suffix
      tooltip?: PtPhaseDiagramTooltipProp
      on_phase_hover?: (info: PtHoverInfo | null) => void
      // A click pins the hovered point's tooltip (null when unpinned)
      on_pin?: (info: PtHoverInfo | null) => void
      wrapper?: HTMLDivElement
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      // Extra controls-pane content above the built-in sections
      controls_extra?: Snippet
    } = $props()

  const BOUNDARY_HIT_PX = 6
  const SPECIAL_HIT_PX = 12
  const ERROR_BAR_SPACING_PX = 18
  // Region-label font at the default --pt-label-font-size, for the fits-in-region check
  const LABEL_FONT = {
    ...DEFAULT_FONT_SPEC,
    font_size: 13,
    font_weight: `600`,
    line_height: 15.6,
  }
  const BOUNDARY_COLOR = `var(--pt-boundary-color, var(--text-color, #333))`
  // Marker shape, d3 symbol area (px²) and name per special point type
  const SPECIAL_STYLES: Record<
    PtSpecialPointType,
    { symbol: keyof typeof symbol_map; size: number; label: string }
  > = {
    triple: { symbol: `Triangle`, size: 90, label: `Triple point` },
    critical: { symbol: `Star`, size: 140, label: `Critical point` },
    custom: { symbol: `Circle`, size: 90, label: `Special point` },
  }

  // Malformed input renders as an empty frame with the problems listed, never half-drawn
  const parsed = $derived(data ? parse_pt_data(data) : { data: null, errors: [] })
  const errors = $derived(parsed.errors)
  const pt_data = $derived(parsed.data)
  const phases = $derived(pt_data?.phases ?? [])
  const boundaries = $derived(pt_data?.boundaries ?? [])
  const special_points = $derived(pt_data?.special_points ?? [])
  const phase_by_id = $derived(new Map(phases.map((phase) => [phase.id, phase])))
  const phase_colors = $derived(pt_phase_colors(phases))
  const hidden = $derived(new Set(hidden_phases))
  const hidden_special = $derived(new Set(hidden_special_types))

  // === Units and axes ===
  const data_p_unit = $derived<PressureUnit>(pt_data?.pressure_unit ?? `GPa`)
  const data_t_unit = $derived<TempUnit>(pt_data?.temperature_unit ?? `K`)
  const p_unit = $derived(display_pressure_unit ?? data_p_unit)
  const t_unit = $derived(display_temp_unit ?? data_t_unit)
  // A pinned range is in display units, so it converts along when its unit changes, unless
  // the axis config changed in the same update (then it already speaks the new unit)
  const follow_unit = <Unit>(
    get: () => [Unit, AxisConfig],
    set: (axis: AxisConfig) => void,
    convert: (value: number, from: Unit, to: Unit) => number,
  ) => {
    let [prev_unit, prev_axis] = untrack(get)
    $effect(() => {
      const [unit, axis] = get()
      untrack(() => {
        let next = axis
        if (unit !== prev_unit && axis === prev_axis && axis.range) {
          const [from, [lo, hi]] = [prev_unit, axis.range]
          const to_unit = (bound: number | null) =>
            bound === null ? null : convert(bound, from, unit)
          next = { ...axis, range: [to_unit(lo), to_unit(hi)] }
          set(next)
        }
        ;[prev_unit, prev_axis] = [unit, next]
      })
    })
  }
  follow_unit(
    () => [p_unit, pressure_axis],
    (axis) => (pressure_axis = axis),
    convert_pressure,
  )
  follow_unit(
    () => [t_unit, temperature_axis],
    (axis) => (temperature_axis = axis),
    convert_temp,
  )

  const wants_log = $derived(get_scale_type_name(pressure_axis.scale_type) === `log`)
  // Lowest pressure a log axis shows (data units); null when the data has no positive one
  const log_floor = $derived(wants_log && pt_data ? pressure_log_floor(pt_data) : null)
  const log_pressure = $derived(log_floor !== null)
  // On a log axis P <= 0 has no position: such points go far below the axis floor and the plot
  // clip cuts them (a line from 0 GPa enters at the left edge). Positive values aren't clamped.
  const p_to_display = (pressure: number): number =>
    log_floor !== null && pressure <= 0
      ? convert_pressure(log_floor, data_p_unit, p_unit) / 1e6
      : convert_pressure(pressure, data_p_unit, p_unit)
  const t_to_display = (temp: number): number => convert_temp(temp, data_t_unit, t_unit)
  // [pressure, temperature] pair → [x, y] and back: swap_axes flips the sides
  const orient = <T>([pressure_side, temp_side]: [T, T]): [T, T] =>
    swap_axes ? [temp_side, pressure_side] : [pressure_side, temp_side]
  // [pressure, temperature] in data units → [x, y] in display units, and back
  const to_xy = ([pressure, temp]: Vec2): Vec2 =>
    orient([p_to_display(pressure), t_to_display(temp)])
  const from_xy = (xy: Vec2): Vec2 => {
    const [disp_p, disp_t] = orient(xy)
    return [
      convert_pressure(disp_p, p_unit, data_p_unit),
      convert_temp(disp_t, t_unit, data_t_unit),
    ]
  }
  const [x_axis, y_axis] = $derived(
    orient<AxisConfig>([
      { label: `Pressure (${p_unit})`, ...pressure_axis },
      { label: `Temperature (${t_unit})`, ...temperature_axis },
    ]),
  )

  const auto_ranges = $derived.by(() => {
    const unit_range: Vec2 = [0, 1]
    if (!pt_data) return { x: unit_range, x2: unit_range, y: unit_range, y2: unit_range }
    const [[p_lo, p_hi], t_range] = pt_data_extent(pt_data)
    // a log axis starts at its floor, which is positive so p_to_display leaves it be
    const disp_p: Vec2 = [
      p_to_display(Math.max(p_lo, log_floor ?? -Infinity)),
      p_to_display(p_hi),
    ]
    const [x_range, y_range] = orient<Vec2>([disp_p, t_range.map(t_to_display) as Vec2])
    return { x: x_range, x2: unit_range, y: y_range, y2: unit_range }
  })

  const frame = create_cartesian_frame({
    controls_row: () => has_controls_row(show_controls, fullscreen_toggle),
    axes: () => ({ x: x_axis, x2: {}, y: y_axis, y2: {} }),
    auto_ranges: () => auto_ranges,
    has_x2: () => false,
    has_y2: () => false,
    padding: () => padding,
    title: () => title ?? pt_data?.title,
    obstacles: () => obstacles_norm,
    legend: () => legend,
    legend_visible: () => show_legend && legend_items.length > 0,
    legend_items: () => legend_items,
    marginals: () => no_marginals,
    ref_lines: () => [],
    pan: () => pan,
    facet_layout: () => undefined,
    clip_id_prefix: `pt-clip`,
  })
  const no_marginals = normalize_marginals(false)
  const data_to_px = (point: Vec2): Vec2 => {
    const [coord_x, coord_y] = to_xy(point)
    return [frame.scales.x(coord_x), frame.scales.y(coord_y)]
  }
  const px_to_data = ([px_x, px_y]: Vec2): Vec2 =>
    from_xy([Number(frame.scales.x.invert(px_x)), Number(frame.scales.y.invert(px_y))])

  // === Regions ===
  // Traced in the space the pressure axis draws (log10 P on a log axis), so snapping matches
  // what the eye sees; explicit regions are used as given
  const traced = $derived(
    pt_data && !pt_data.regions ? derive_regions(pt_data, { log_pressure }) : null,
  )
  const regions = $derived(pt_data?.regions ?? traced?.regions ?? [])
  const notices = $derived(
    [
      errors.length && {
        type: `error` as const,
        message: `Invalid pressure-temperature phase diagram: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ``}`,
      },
      traced?.unlabeled && {
        type: `warning` as const,
        message: `${traced.unlabeled} region(s) couldn't be assigned a phase from the boundaries; pass explicit regions to fill them`,
      },
      wants_log &&
        pt_data &&
        log_floor === null && {
          type: `warning` as const,
          message: `A log pressure axis needs positive pressures spanning a range in the data or pressure_range`,
        },
    ].flatMap((notice) => (notice ? [notice] : [])),
  )

  const chart_rect = $derived<[number, number, number, number]>([
    frame.pad.l,
    frame.pad.t,
    frame.pad.l + frame.chart_width,
    frame.pad.t + frame.chart_height,
  ])
  const region_shapes = $derived(
    regions.flatMap((region, idx) => {
      const phase = phase_by_id.get(region.phase)
      if (!phase || hidden.has(phase.id)) return []
      const pixels = region.vertices.map(data_to_px)
      // Labels sit inside the visible part and are dropped where they'd overflow it
      const anchor = polygon_label_point(clip_polygon_to_rect(pixels, chart_rect))
      const label_width = measure_text_line(phase_label(phase), LABEL_FONT).width
      const label_at = region.label_position
        ? data_to_px(region.label_position)
        : anchor && anchor.width >= label_width + 4 && anchor.height >= LABEL_FONT.line_height
          ? anchor.at
          : null
      return [
        {
          key: `${phase.id}-${idx}`,
          phase,
          pixels,
          color: phase_colors.get(phase.id),
          path: generate_region_path(pixels),
          label_at,
        },
      ]
    }),
  )

  // === Uncertainty ===
  // Signed pixel moves of a point under ±n_sigma standard errors. Pressure and temperature
  // each move along their own axis, so their x and y parts simply add (one of each is 0).
  const sigma_px = ([pressure, temp]: Vec2, sigma_p = 0, sigma_t = 0): PixelSigma => {
    const [base_x, base_y] = data_to_px([pressure, temp])
    const moved = (sign: number): Vec2 => {
      // on a log axis an error reaching P <= 0 runs to the axis floor, not 6 decades below it
      const shifted_p = pressure + sign * n_sigma * sigma_p
      const [p_x, p_y] = data_to_px([
        log_floor !== null && shifted_p <= 0 ? log_floor : shifted_p,
        temp,
      ])
      const [t_x, t_y] = data_to_px([pressure, temp + sign * n_sigma * sigma_t])
      return [p_x + t_x - 2 * base_x, p_y + t_y - 2 * base_y]
    }
    return { plus: moved(1), minus: moved(-1) }
  }
  // Capped bars along whichever axes (0: x, 1: y) the point has an error on
  const ERROR_BAR_CAP = 3
  const error_bars = (at: Vec2, { plus, minus }: PixelSigma): string =>
    ([0, 1] as const)
      .filter((axis) => plus[axis] || minus[axis])
      .map((axis) =>
        error_bar_path(
          [at[axis] + minus[axis], at[axis] + plus[axis]],
          at[1 - axis],
          axis === 1,
          ERROR_BAR_CAP,
        ),
      )
      .join(``)

  // === Boundaries ===
  const boundary_shapes = $derived(
    boundaries.map((boundary) => {
      const pixels = boundary.points.map(data_to_px)
      const has_sigma = Boolean(boundary.sigma_p || boundary.sigma_t)
      const deltas = has_sigma
        ? boundary.points.map((point, idx) =>
            sigma_px(point, boundary.sigma_p?.[idx], boundary.sigma_t?.[idx]),
          )
        : []
      // Error bars thinned to one per ERROR_BAR_SPACING_PX along the line
      let last: Vec2 | null = null
      let bars = ``
      for (const [idx, point] of has_sigma ? pixels.entries() : []) {
        if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < ERROR_BAR_SPACING_PX)
          continue
        bars += error_bars(point, deltas[idx])
        last = point
      }
      return {
        boundary,
        pixels,
        color: boundary.style?.color ?? BOUNDARY_COLOR,
        width: boundary.style?.width ?? 2,
        path: generate_boundary_path(pixels),
        band: has_sigma ? generate_region_path(uncertainty_band(pixels, deltas)) : null,
        bars,
      }
    }),
  )
  const resolved_display = $derived(resolve_plot_display(display, DISPLAY_DEFAULTS))
  const show_band = $derived(uncertainty === `band` || uncertainty === `both`)
  const show_bars = $derived(uncertainty === `bars` || uncertainty === `both`)
  const has_uncertainty = $derived(
    boundaries.some((boundary) => boundary.sigma_p || boundary.sigma_t) ||
      special_points.some((point) => point.sigma_p || point.sigma_t),
  )

  // === Special points ===
  const special_shapes = $derived(
    show_special_points
      ? special_points.flatMap((point) => {
          if (hidden_special.has(point.type)) return []
          const at = data_to_px(point.position)
          const { symbol: shape, size } = SPECIAL_STYLES[point.type]
          return [
            {
              point,
              at,
              marker: symbol(symbol_map[shape], size)() ?? ``,
              bars: error_bars(at, sigma_px(point.position, point.sigma_p, point.sigma_t)),
            },
          ]
        })
      : [],
  )

  // === Legend ===
  const special_types = $derived([...new Set(special_points.map((point) => point.type))])
  const legend_items = $derived<LegendItem[]>([
    ...phases.map((phase, idx) => ({
      series_idx: idx,
      label: phase_label(phase),
      visible: !hidden.has(phase.id),
      display_style: {
        symbol_type: `Square` as const,
        symbol_color: phase_colors.get(phase.id),
      },
    })),
    ...(show_special_points
      ? special_types.map((type, idx) => ({
          series_idx: phases.length + idx,
          label: SPECIAL_STYLES[type].label,
          visible: !hidden_special.has(type),
          display_style: {
            symbol_type: SPECIAL_STYLES[type].symbol,
            symbol_color: `var(--pt-special-point-color, #d32f2f)`,
          },
        }))
      : []),
  ])
  const toggle_legend_item = (series_idx: number) => {
    const phase = phases[series_idx]
    const type = special_types[series_idx - phases.length]
    if (phase) hidden_phases = toggle_item(hidden_phases, phase.id)
    else if (type) hidden_special_types = toggle_item(hidden_special_types, type)
  }

  // Legend placement avoids the lines (walked segment by segment) and the markers
  const obstacles_norm = $derived(
    with_obstacle_frame(frame, Boolean(pt_data), () => {
      const norm = create_axis_scales(
        frame.axes,
        frame.ranges.current,
        { l: 0, r: 0, t: 0, b: 0 },
        1,
        1,
      )
      const to_norm = (point: Vec2) => {
        const [coord_x, coord_y] = to_xy(point)
        return { x: norm.x(coord_x), y: norm.y(coord_y) }
      }
      return [
        ...boundaries.map((boundary): ObstacleSeries => ({
          points: boundary.points.map(to_norm),
          draws_line: true,
        })),
        { points: special_points.map((point) => to_norm(point.position)) },
      ]
    }),
  )

  // === Hover and pin ===
  let hover_info = $state<PtHoverInfo | null>(null)
  // A click pins the hovered snapshot; the mark it names (special point, boundary or region)
  // makes a second click on the same mark unpin
  const mark_key = (info: PtHoverInfo): string =>
    info.special_point
      ? `special:${info.special_point.id}`
      : info.boundary_hit
        ? `boundary:${info.boundary_hit.boundary.id}`
        : `phase:${info.phase?.id}`
  const pin = new TooltipPin<PtHoverInfo>({
    key: mark_key,
    enabled: () => tooltip !== false,
    on_unpin: () => on_pin?.(null),
  })
  const shown_info = $derived(pin.shown(hover_info))

  const hover_at = (px: Vec2): PtHoverInfo | null => {
    const [left, top, right, bottom] = chart_rect
    if (!pt_data || px[0] < left || px[0] > right || px[1] < top || px[1] > bottom) return null
    // a marker is a zero-length polyline, so one nearest-point search serves both
    const special = nearest_on_polylines(
      px,
      special_shapes.map(({ at }) => [at, at]),
    )
    const nearest = show_boundaries
      ? nearest_on_polylines(
          px,
          boundary_shapes.map(({ pixels }) => pixels),
        )
      : null
    let boundary_hit: PtHoverInfo[`boundary_hit`] = null
    if (nearest && nearest.dist <= BOUNDARY_HIT_PX) {
      const { line_idx, seg_idx, param, foot } = nearest
      const { boundary } = boundary_shapes[line_idx]
      boundary_hit = {
        boundary,
        point: px_to_data(foot),
        sigma_t: interpolate_at(boundary.sigma_t, seg_idx, param),
        sigma_p: interpolate_at(boundary.sigma_p, seg_idx, param),
      }
    }
    // Hit-test the drawn (pixel) polygons: on a log axis their edges are straight in pixels,
    // not in data units. The topmost painted region wins.
    const region = region_shapes.findLast(({ pixels }) =>
      point_in_polygon(px[0], px[1], pixels),
    )
    return {
      phase: region?.phase ?? null,
      point: px_to_data(px),
      boundary_hit,
      special_point:
        special && special.dist <= SPECIAL_HIT_PX
          ? special_shapes[special.line_idx].point
          : null,
    }
  }

  const set_hover = (info: PtHoverInfo | null) => {
    hover_info = info
    on_phase_hover?.(info)
  }
  const handle_mouse_move = (event: MouseEvent) => {
    const pos = pointer_pos(event, frame.svg_element)
    set_hover(pos ? hover_at([pos.x, pos.y]) : null)
  }
  // A click on empty space (no phase, line or marker) unpins rather than pinning nothing
  const handle_click = () => {
    const info = hover_info
    pin.toggle(info && (info.phase || info.boundary_hit || info.special_point) ? info : null)
    if (pin.value) on_pin?.(pin.value)
  }

  // Hover and pin describe the previous data or view, so drop them when either changes
  $effect(() => {
    void [pt_data, swap_axes, p_unit, t_unit, log_pressure]
    untrack(() => {
      pin.unpin()
      if (hover_info) set_hover(null)
    })
  })

  const tooltip_color = $derived(
    shown_info?.phase && !shown_info.boundary_hit && !shown_info.special_point
      ? phase_colors.get(shown_info.phase.id)
      : undefined,
  )
  // Placed from data, so a pinned marker and tooltip follow pan and zoom
  const pinned_px = $derived(pin.value ? data_to_px(pin.value.point) : null)
  const tooltip_px = $derived(shown_info ? data_to_px(shown_info.point) : null)
  // Hovered and pinned marks are both lit
  const lit = $derived(
    new Set(
      [hover_info, pin.value].flatMap((info) => [
        ...(info?.boundary_hit ? [`boundary:${info.boundary_hit.boundary.id}`] : []),
        ...(info?.phase ? [`phase:${info.phase.id}`] : []),
      ]),
    ),
  )

  // === Controls ===
  const UNCERTAINTY_MODES: [PtUncertaintyMode, string][] = [
    [`band`, `Band`],
    [`bars`, `Error bars`],
    [`both`, `Band + bars`],
    [`none`, `Hidden`],
  ]
  const SIGMA_LEVELS: [number, string][] = [
    [1, `1σ (68%)`],
    [2, `2σ (95%)`],
    [3, `3σ (99.7%)`],
  ]
  // A width set from code (e.g. 1.96) stays listed and selected
  const sigma_options = $derived(
    SIGMA_LEVELS.some(([level]) => level === n_sigma)
      ? SIGMA_LEVELS
      : [...SIGMA_LEVELS, [n_sigma, `${n_sigma}σ`] as [number, string]],
  )
  // Shared X/Y axis sections edit whichever quantity sits on that side
  const set_side = (on_x: boolean) => (axis: AxisConfig) => {
    if (on_x !== swap_axes) pressure_axis = axis
    else temperature_axis = axis
  }
  const settings = track_settings(
    () => ({
      show_regions,
      show_boundaries,
      show_labels,
      show_special_points,
      show_legend,
      uncertainty,
      n_sigma,
    }),
    `initial`,
  )
  // Pinned ranges convert along with a unit change, so a units reset is plain
  const axes_settings = track_settings(
    () => ({ swap_axes, display_pressure_unit, display_temp_unit }),
    `initial`,
  )

  // === Tooltip ===
  const fmt = (value: number) => format_num(value, `.4~g`)
  const name_html = (phase: PtPhase) => sanitize_html(format_label_html(phase_label(phase)))
  // Phase ids are validated against the phase list, so every lookup succeeds
  const phases_of = (ids: readonly string[] = []) =>
    ids.flatMap((id) => phase_by_id.get(id) ?? [])
  // ±n_sigma display extent of a [pressure, temperature] standard error in data units
  // (temperature errors scale without the zero offset)
  const sigma_scale = $derived([
    convert_pressure(n_sigma, data_p_unit, p_unit),
    convert_temp(n_sigma, data_t_unit, t_unit) - convert_temp(0, data_t_unit, t_unit),
  ])

  const export_sources = $derived(pt_data ? { json: json_source(() => pt_data) } : {})
</script>

{#snippet options(entries: readonly (readonly [string | number, string])[])}
  {#each entries as [value, label] (value)}<option {value}>{label}</option>{/each}
{/snippet}

<!-- P and T rows, with ±n_sigma errors to 2 significant digits where given -->
{#snippet coords(point: Vec2, sigmas: (number | null | undefined)[] = [])}
  {@const display_point = [
    convert_pressure(point[0], data_p_unit, p_unit),
    t_to_display(point[1]),
  ]}
  {#each [`P`, `T`] as name, axis (name)}
    {@const sigma = sigmas[axis]}
    <dt>{name}</dt>
    <dd>
      <TooltipValue value={fmt(display_point[axis])} unit={[p_unit, t_unit][axis]} />
      <!-- .2~r: 2 significant digits in plain decimals (.2~g would print 140 as 1.4e2) -->
      {#if sigma}<small>± {format_num(sigma * sigma_scale[axis], `.2~r`)}</small>{/if}
    </dd>
  {/each}
{/snippet}

<CartesianFrame
  {frame}
  plot_class="pt-phase-diagram"
  css_prefix="pt-phase-diagram"
  aria_label="Pressure-temperature phase diagram"
  aria-label="{pt_data?.system ? `${pt_data.system} ` : ``}pressure-temperature phase diagram"
  bind:fullscreen
  bind:wrapper
  {fullscreen_toggle}
  {show_controls}
  marginals={no_marginals}
  marginal_series={[]}
  empty={!data}
  {export_sources}
  export_filename={export_filename ?? `${pt_data?.system ?? `pt`}-phase-diagram`}
  {export_formats}
  {on_export}
  on_mouse_move={handle_mouse_move}
  on_mouse_leave={() => set_hover(null)}
  on_mouse_click={handle_click}
  unpin={pin.unpin}
  {header_controls}
  {controls_toggle_props}
  {children}
  {...rest}
>
  {#snippet layers()}
    {#if show_regions}
      <g class="regions" clip-path="url(#{frame.clip_path_id})">
        {#each region_shapes as region (region.key)}
          <path
            d={region.path}
            fill={region.color}
            class:lit={lit.has(`phase:${region.phase.id}`)}
            data-phase={region.phase.id}
          />
        {/each}
      </g>
    {/if}

    <PlotAxes {frame} display={resolved_display} />

    <!-- everything drawn over the axes stays inside the plot area; hover is hit-tested in
         code, so none of it takes pointer events -->
    <g class="marks" clip-path="url(#{frame.clip_path_id})">
      <ZeroLines {frame} display={resolved_display} />

      {#if show_boundaries}
        <g class="boundaries">
          {#if show_band}
            {#each boundary_shapes as { boundary, band, color } (boundary.id)}
              {#if band}<path class="uncertainty-band" d={band} fill={color} />{/if}
            {/each}
          {/if}
          {#each boundary_shapes as { boundary, path, color, width } (boundary.id)}
            {@const is_lit = lit.has(`boundary:${boundary.id}`)}
            <path
              class="boundary"
              class:lit={is_lit}
              d={path}
              data-boundary={boundary.id}
              stroke={color}
              stroke-width={is_lit ? width + 1.5 : width}
              stroke-dasharray={boundary.style?.dash ??
                (boundary.metastable ? `6 4` : undefined)}
            />
          {/each}
          {#if show_bars}
            {#each boundary_shapes as { boundary, bars, color } (boundary.id)}
              {#if bars}<path class="error-bars" d={bars} stroke={color} />{/if}
            {/each}
          {/if}
        </g>
      {/if}

      {#if show_labels && show_regions}
        <g class="region-labels">
          {#each region_shapes as { key, phase, label_at } (key)}
            {#if label_at}
              <text x={label_at[0]} y={label_at[1]}>
                {@html sanitize_svg(format_label_svg(phase_label(phase), true))}
              </text>
            {/if}
          {/each}
        </g>
      {/if}

      <g class="special-points">
        {#each special_shapes as { point, at, marker, bars } (point.id)}
          {#if uncertainty !== `none` && bars}
            <path class="special-error-bars" d={bars} />
          {/if}
          <path
            class="special-point"
            data-type={point.type}
            d={marker}
            transform="translate({at[0]} {at[1]})"
          />
          {#if point.label}
            <text class="special-label" x={at[0] + 9} y={at[1] - 9}>{point.label}</text>
          {/if}
        {/each}
      </g>

      {#if pinned_px}
        <g class="pin-marker" transform="translate({pinned_px[0]} {pinned_px[1]})">
          <circle r="6" />
          <path d="M-10,0h6M4,0h6M0,-10v6M0,4v6" />
        </g>
      {/if}
    </g>
  {/snippet}

  {#snippet controls(toggle_props, visible)}
    <PlotControls
      {toggle_props}
      pane_props={controls_pane_props}
      show_controls={visible}
      bind:controls_open
      bind:x_axis={() => orient([pressure_axis, temperature_axis])[0], set_side(true)}
      bind:y_axis={() => orient([pressure_axis, temperature_axis])[1], set_side(false)}
      bind:display
      auto_ranges={frame.controls_auto_ranges}
      controls_name="pt-phase-diagram"
      controls_title="phase diagram"
    >
      {@render controls_extra?.()}
      <SettingsSection
        title="Phase diagram"
        changed_keys={settings.changed_keys}
        on_reset={() =>
          ({
            show_regions,
            show_boundaries,
            show_labels,
            show_special_points,
            show_legend,
            uncertainty,
            n_sigma,
          } = settings.snapshot())}
        layout="flow"
      >
        <div class="ctrl-line">
          <label {@attach hint({ content: `Fill each phase's stability field` })}>
            <input type="checkbox" bind:checked={show_regions} /> Regions
          </label>
          <label {@attach hint({ content: `Coexistence lines between phases` })}>
            <input type="checkbox" bind:checked={show_boundaries} /> Boundaries
          </label>
          <label><input type="checkbox" bind:checked={show_labels} /> Labels</label>
          {#if special_points.length}
            <label {@attach hint({ content: `Triple and critical points` })}>
              <input type="checkbox" bind:checked={show_special_points} /> Special points
            </label>
          {/if}
          <label><input type="checkbox" bind:checked={show_legend} /> Legend</label>
        </div>
        {#if has_uncertainty}
          <div class="ctrl-line">
            <label {@attach hint({ content: `How standard errors are drawn` })}>
              <span>Uncertainty</span>
              <select bind:value={uncertainty}>{@render options(UNCERTAINTY_MODES)}</select>
            </label>
            <label
              {@attach hint({ content: `Width of bands and error bars in standard errors` })}
            >
              <span>Width</span>
              <select bind:value={n_sigma} disabled={uncertainty === `none`}>
                {@render options(sigma_options)}
              </select>
            </label>
          </div>
        {/if}
      </SettingsSection>
      <SettingsSection
        title="Pressure and temperature"
        changed_keys={axes_settings.changed_keys}
        on_reset={() =>
          ({ swap_axes, display_pressure_unit, display_temp_unit } = axes_settings.snapshot())}
        layout="flow"
      >
        <div class="ctrl-line">
          <label>
            <span>Pressure</span>
            <select bind:value={() => p_unit, (unit) => (display_pressure_unit = unit)}>
              {@render options(
                Object.keys(PRESSURE_UNITS).map((unit) => [unit, unit] as const),
              )}
            </select>
          </label>
          <label>
            <span>Temperature</span>
            <select bind:value={() => t_unit, (unit) => (display_temp_unit = unit)}>
              {@render options(TEMP_UNITS.map((unit) => [unit, unit] as const))}
            </select>
          </label>
          <label {@attach hint({ content: `Temperature on x, pressure on y` })}>
            <input type="checkbox" bind:checked={swap_axes} /> Swap axes
          </label>
        </div>
      </SettingsSection>
    </PlotControls>
  {/snippet}

  {#snippet overlays()}
    {#if notices.length}
      <ViewerNotices>
        {#each notices as { type, message } (message)}
          <StatusMessage {type} {message} />
        {/each}
      </ViewerNotices>
    {/if}
    {#if shown_info && tooltip_px && tooltip !== false}
      <PlotTooltip
        x={tooltip_px[0]}
        y={tooltip_px[1]}
        offset={{ x: 12, y: 12 }}
        bg_color={tooltip_color}
        constrain_to={{ width: frame.width, height: frame.height }}
        exclusion_rects={frame.exclusion_rects}
        fallback_size={{ width: 200, height: 110 }}
        pinned={pin.value !== null}
      >
        {@const info = shown_info}
        {@const special = info.special_point}
        <TooltipContent data={info} snippet_arg={info} {tooltip}>
          <div class="pt-tooltip">
            <strong>
              {#if special}{special.label ?? SPECIAL_STYLES[special.type].label}
                {#if special.label}<small>{SPECIAL_STYLES[special.type].label}</small>{/if}
              {:else if info.phase}{@html name_html(info.phase)}
              {:else}No mapped phase{/if}
            </strong>
            {#if special?.phases?.length}
              <p>{@html phases_of(special.phases).map(name_html).join(` + `)}</p>
            {:else if info.phase?.description && !special}
              <p>{info.phase.description}</p>
            {/if}
            <dl>
              {#if special}{@render coords(special.position, [
                  special.sigma_p,
                  special.sigma_t,
                ])}
              {:else}{@render coords(info.point)}{/if}
            </dl>
            {#if info.boundary_hit && !special}
              {@const { boundary, point, sigma_p, sigma_t } = info.boundary_hit}
              <section>
                <strong>
                  {#if boundary.label}{boundary.label}{:else}
                    {@html phases_of(boundary.phases).map(name_html).join(` ⇌ `)}
                  {/if}
                  {#if boundary.metastable}<small>(metastable)</small>{/if}
                </strong>
                <dl>{@render coords(point, [sigma_p, sigma_t])}</dl>
                {#if sigma_p || sigma_t}<small>± {n_sigma}σ standard error</small>{/if}
              </section>
            {/if}
          </div>
        </TooltipContent>
      </PlotTooltip>
    {/if}
    <PlotLegendLayer
      {frame}
      {legend}
      series_data={legend_items}
      on_toggle={toggle_legend_item}
    />
  {/snippet}
</CartesianFrame>

<style>
  .marks {
    pointer-events: none;
  }
  .regions path {
    fill-opacity: var(--pt-region-opacity, 0.45);
    transition: fill-opacity 0.15s;
    &.lit {
      fill-opacity: var(--pt-region-lit-opacity, 0.65);
    }
  }
  .boundary {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .uncertainty-band {
    fill-opacity: var(--pt-band-opacity, 0.2);
    stroke: none;
  }
  .error-bars {
    fill: none;
    stroke-width: 1;
    stroke-opacity: 0.7;
  }
  .region-labels text,
  .special-label {
    font-size: var(--pt-label-font-size, 13px);
    fill: var(--text-color, #333);
    paint-order: stroke;
    stroke: var(--pt-label-halo, light-dark(rgba(255, 255, 255, 0.75), rgba(0, 0, 0, 0.6)));
    stroke-width: 3px;
    stroke-linejoin: round;
    user-select: none;
  }
  .region-labels text {
    font-weight: 600;
    text-anchor: middle;
    dominant-baseline: middle;
  }
  .special-point {
    fill: var(--pt-special-point-color, #d32f2f);
    stroke: white;
    stroke-width: 1.5;
  }
  .special-error-bars {
    fill: none;
    stroke: var(--pt-special-point-color, #d32f2f);
    stroke-width: 1.5;
  }
  .pt-tooltip {
    min-width: 140px;
    p {
      margin: 0 0 4px;
      font-size: 11px;
      font-style: italic;
    }
    small {
      opacity: 0.75;
      font-weight: normal;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 1px 8px;
      margin: 2px 0 0;
    }
    dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
    section {
      margin-top: 5px;
      padding-top: 4px;
      border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    }
  }
  .pin-marker {
    fill: none;
    stroke: var(--pt-pin-color, var(--text-color, #333));
    stroke-width: 2;
  }
</style>
