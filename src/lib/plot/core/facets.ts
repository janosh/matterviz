import type { Vec2 } from '$lib/math'
import type { Rect, Sides } from '$lib/plot/core/layout'
import { is_valid_range, max_side_padding, union_ranges } from '$lib/plot/core/shared-axes'

export const FACET_AXES = [`x`, `x2`, `y`, `y2`] as const
const FACET_AXIS_MODES = [`shared`, `free`, `row`, `col`] as const
const FACET_AXIS_VISIBILITY_MODES = [`auto`, `all`, `outer`, `inner`, `none`] as const

export type FacetAxis = (typeof FACET_AXES)[number]
export type FacetAxisMode = (typeof FACET_AXIS_MODES)[number]
export type FacetAxisVisibilityMode = (typeof FACET_AXIS_VISIBILITY_MODES)[number]
export type FacetKey = string | number
export type FacetAxisRanges = Partial<Record<FacetAxis, Vec2>>
export type FacetAxisModes = Record<FacetAxis, FacetAxisMode>
export type FacetAxisVisibilityModes = Partial<Record<FacetAxis, FacetAxisVisibilityMode>>
export type FacetAxisVisibility = Record<FacetAxis, boolean>
type FacetRangeUpdate = Vec2 | null
type FacetRangeUpdateCallback = (axis: FacetAxis, range: FacetRangeUpdate) => void
type FacetSharedBand = `title` | `legend` | `color_bar`

const DEFAULT_FACET_AXIS_MODES: FacetAxisModes = {
  x: `shared`,
  x2: `shared`,
  y: `shared`,
  y2: `shared`,
}

export interface FacetPanel<Datum = unknown> {
  key: FacetKey
  data: Datum
  row?: number
  column?: number
  row_span?: number
  column_span?: number
}

interface PositionedFacetPanel<Datum = unknown> {
  key: FacetKey
  data: Datum
  index: number
  row: number
  column: number
  row_span: number
  column_span: number
}

interface FacetGridLayout<Datum = unknown> {
  rows: number
  columns: number
  panels: PositionedFacetPanel<Datum>[]
}

export interface FacetPanelLayoutReport {
  padding?: Sides
  // These are the child's intrinsic/auto ranges, not ranges previously supplied by the grid.
  ranges?: FacetAxisRanges
}

interface KeyedFacetPanelLayoutReport extends FacetPanelLayoutReport {
  key: FacetKey
}

interface KeyedFacetAxisRanges {
  key: FacetKey
  ranges: FacetAxisRanges
}

// Shared chrome occupies deterministic outer tracks around the panel grid. Title is
// a top band spanning the full grid; legend and color bar are right-side bands.
export interface FacetSharedBandSizes {
  title_height?: number
  legend_width?: number
  color_bar_width?: number
  gap?: number
}

interface FacetGridGeometry {
  width: number
  height: number
  row_gap?: number
  column_gap?: number
  shared_bands?: FacetSharedBandSizes
}

export interface FacetSharedBandContext {
  band: FacetSharedBand
  rect: Rect
}

export interface ResolvedFacetGridGeometry {
  panel_grid: Rect
  panels: { key: FacetKey; rect: Rect }[]
  title?: FacetSharedBandContext
  legend?: FacetSharedBandContext
  color_bar?: FacetSharedBandContext
}

// Focused child-plot contract. FacetPanelContext extends this shape so a grid snippet can pass
// its context directly as `<ScatterPlot facet_layout={context} ...>`.
export interface FacetLayoutContext {
  padding: Sides
  ranges: FacetAxisRanges
  axis_visibility: FacetAxisVisibility
  report_layout: (report: FacetPanelLayoutReport) => void
  update_range: FacetRangeUpdateCallback
}

export interface FacetPanelContext<Datum = unknown>
  extends PositionedFacetPanel<Datum>, FacetLayoutContext {
  rect: Rect
}

const assert_integer = (
  value: number,
  name: string,
  minimum: number,
  key?: FacetKey,
): void => {
  if (Number.isInteger(value) && value >= minimum) return
  const panel_text = key === undefined ? `` : ` for facet "${key}"`
  throw new RangeError(`${name}${panel_text} must be an integer >= ${minimum}, got ${value}`)
}

const assert_finite_non_negative = (value: number, name: string): void => {
  if (Number.isFinite(value) && value >= 0) return
  throw new RangeError(`${name} must be a finite non-negative number, got ${value}`)
}

// Assign panels in row-major order while honoring explicit row/column placement and spans.
// Partially explicit placement is supported: a fixed row scans columns and a fixed column scans rows.
export function assign_facet_panels<Datum>(
  panels: readonly FacetPanel<Datum>[],
  columns: number,
  rows?: number,
): FacetGridLayout<Datum> {
  assert_integer(columns, `columns`, 1)
  if (rows !== undefined) assert_integer(rows, `rows`, 1)

  const first_idx_by_key = new Map<FacetKey, number>()
  for (const [panel_idx, panel] of panels.entries()) {
    const duplicate_idx = first_idx_by_key.get(panel.key)
    if (duplicate_idx !== undefined) {
      throw new Error(
        `Duplicate facet key "${panel.key}" at indices ${duplicate_idx} and ${panel_idx}`,
      )
    }
    first_idx_by_key.set(panel.key, panel_idx)
  }

  const occupied: boolean[][] = []
  const positioned_panels: PositionedFacetPanel<Datum>[] = []

  const is_occupied = (row_idx: number, column_idx: number): boolean =>
    occupied[row_idx]?.[column_idx] ?? false

  const fits = (
    row_idx: number,
    column_idx: number,
    row_span: number,
    column_span: number,
  ): boolean => {
    if (column_idx < 0 || column_idx + column_span > columns || row_idx < 0) return false
    if (rows !== undefined && row_idx + row_span > rows) return false
    for (let offset_row = 0; offset_row < row_span; offset_row++) {
      for (let offset_column = 0; offset_column < column_span; offset_column++) {
        if (is_occupied(row_idx + offset_row, column_idx + offset_column)) return false
      }
    }
    return true
  }

  const occupy = (
    row_idx: number,
    column_idx: number,
    row_span: number,
    column_span: number,
  ): void => {
    for (let offset_row = 0; offset_row < row_span; offset_row++) {
      occupied[row_idx + offset_row] ??= []
      const occupied_row = occupied[row_idx + offset_row]
      for (let offset_column = 0; offset_column < column_span; offset_column++) {
        occupied_row[column_idx + offset_column] = true
      }
    }
  }

  for (const [panel_idx, panel] of panels.entries()) {
    const row_span = panel.row_span ?? 1
    const column_span = panel.column_span ?? 1
    assert_integer(row_span, `row_span`, 1, panel.key)
    assert_integer(column_span, `column_span`, 1, panel.key)
    if (column_span > columns) {
      throw new RangeError(
        `column_span for facet "${panel.key}" exceeds ${columns} columns: ${column_span}`,
      )
    }
    if (panel.row !== undefined) assert_integer(panel.row, `row`, 0, panel.key)
    if (panel.column !== undefined) assert_integer(panel.column, `column`, 0, panel.key)
    if (panel.column !== undefined && panel.column + column_span > columns) {
      throw new RangeError(
        `Facet "${panel.key}" ends beyond column ${columns}: column ${panel.column}, span ${column_span}`,
      )
    }
    if (rows !== undefined && panel.row !== undefined && panel.row + row_span > rows) {
      throw new RangeError(
        `Facet "${panel.key}" ends beyond row ${rows}: row ${panel.row}, span ${row_span}`,
      )
    }

    let position: { row: number; column: number } | undefined
    const row_start = panel.row ?? 0
    const row_limit =
      panel.row === undefined ? (rows ?? Number.POSITIVE_INFINITY) : panel.row + 1
    const column_start = panel.column ?? 0
    const column_limit = panel.column === undefined ? columns : panel.column + 1
    for (let row_idx = row_start; row_idx < row_limit; row_idx++) {
      for (let column_idx = column_start; column_idx < column_limit; column_idx++) {
        if (!fits(row_idx, column_idx, row_span, column_span)) continue
        position = { row: row_idx, column: column_idx }
        break
      }
      if (position) break
    }

    if (!position) {
      const placement = [
        panel.row === undefined ? `any row` : `row ${panel.row}`,
        panel.column === undefined ? `any column` : `column ${panel.column}`,
      ].join(`, `)
      throw new Error(
        `Cannot place facet "${panel.key}" at ${placement} with span ${row_span}x${column_span}`,
      )
    }

    occupy(position.row, position.column, row_span, column_span)
    positioned_panels.push({
      key: panel.key,
      data: panel.data,
      index: panel_idx,
      row: position.row,
      column: position.column,
      row_span,
      column_span,
    })
  }

  const required_rows = positioned_panels.reduce(
    (row_count, panel) => Math.max(row_count, panel.row + panel.row_span),
    0,
  )
  return { rows: rows ?? required_rows, columns, panels: positioned_panels }
}

// Whether two panels participate in the same range-sharing group for one axis.
const facet_panels_share_axis = (
  left: PositionedFacetPanel,
  right: PositionedFacetPanel,
  mode: FacetAxisMode,
): boolean => {
  if (mode === `shared`) return true
  if (mode === `free`) return left.key === right.key
  if (mode === `row`) return left.row === right.row
  return left.column === right.column
}

const axis_modes_with_defaults = (modes: Partial<FacetAxisModes>): FacetAxisModes => {
  for (const axis of FACET_AXES) {
    const mode = modes[axis]
    if (mode !== undefined && !FACET_AXIS_MODES.includes(mode)) {
      throw new Error(`Invalid ${axis} facet axis mode: ${mode}`)
    }
  }
  return { ...DEFAULT_FACET_AXIS_MODES, ...modes }
}

// Reconcile each axis independently according to its sharing mode. Shared ranges use
// shared-axes.ts's finite union semantics; free ranges retain their original direction.
export function reconcile_facet_ranges<Datum>(
  layout: FacetGridLayout<Datum>,
  reports: readonly KeyedFacetPanelLayoutReport[],
  modes: Partial<FacetAxisModes> = {},
  overrides: readonly KeyedFacetAxisRanges[] = [],
): KeyedFacetAxisRanges[] {
  const resolved_modes = axis_modes_with_defaults(modes)
  const reports_by_key = new Map(reports.map((report) => [report.key, report]))
  const overrides_by_key = new Map(overrides.map((entry) => [entry.key, entry.ranges]))
  return layout.panels.map((panel) => {
    const ranges: FacetAxisRanges = {}
    for (const axis of FACET_AXES) {
      const override = overrides_by_key.get(panel.key)?.[axis]
      if (is_valid_range(override)) {
        ranges[axis] = override
        continue
      }
      const mode = resolved_modes[axis]
      if (mode === `free`) {
        const own_range = reports_by_key.get(panel.key)?.ranges?.[axis]
        if (is_valid_range(own_range)) ranges[axis] = own_range
        continue
      }
      const grouped_panels = layout.panels.filter((candidate) =>
        facet_panels_share_axis(panel, candidate, mode),
      )
      const grouped_ranges = grouped_panels.map(
        (candidate) => reports_by_key.get(candidate.key)?.ranges?.[axis],
      )
      const shared_range = union_ranges(grouped_ranges)
      if (shared_range) ranges[axis] = shared_range
    }
    return { key: panel.key, ranges }
  })
}

// Apply one interactive zoom/reset to every panel in the source panel's sharing group.
// null removes the linked override so intrinsic reports determine the range again.
export function propagate_facet_range<Datum>(
  layout: FacetGridLayout<Datum>,
  current: readonly KeyedFacetAxisRanges[],
  source_key: FacetKey,
  axis: FacetAxis,
  range: FacetRangeUpdate,
  modes: Partial<FacetAxisModes> = {},
): KeyedFacetAxisRanges[] {
  const source_panel = layout.panels.find((panel) => panel.key === source_key)
  if (!source_panel) throw new Error(`Unknown facet key "${source_key}"`)
  if (!FACET_AXES.includes(axis)) throw new Error(`Invalid facet axis: ${axis}`)
  if (range !== null && !is_valid_range(range)) {
    throw new TypeError(`Invalid ${axis} facet range update: ${String(range)}`)
  }
  const mode = axis_modes_with_defaults(modes)[axis]
  return layout.panels.map((panel) => {
    const previous_ranges = current.find((entry) => entry.key === panel.key)?.ranges
    if (!facet_panels_share_axis(source_panel, panel, mode)) {
      return { key: panel.key, ranges: { ...previous_ranges } }
    }
    const ranges = Object.fromEntries(
      Object.entries(previous_ranges ?? {}).filter(([candidate]) => candidate !== axis),
    ) as FacetAxisRanges
    if (range !== null) ranges[axis] = [range[0], range[1]]
    return { key: panel.key, ranges }
  })
}

// Every panel receives the same side-wise maxima so equal CSS grid cells have aligned
// plotting rectangles even when their tick labels and titles reserve different space.
export const reconcile_facet_padding = (
  layout: FacetGridLayout,
  reports: readonly KeyedFacetPanelLayoutReport[],
): Sides => {
  const panel_paddings = layout.panels.map(
    (panel) => reports.find((report) => report.key === panel.key)?.padding,
  )
  return max_side_padding(panel_paddings)
}

const is_outer_axis = (
  axis: FacetAxis,
  panel: PositionedFacetPanel,
  layout: Pick<FacetGridLayout, `panels`>,
): boolean => {
  const horizontal_axis = axis === `x` || axis === `x2`
  return !layout.panels.some((candidate) => {
    if (candidate.key === panel.key) return false
    const overlaps = horizontal_axis
      ? candidate.column < panel.column + panel.column_span &&
        candidate.column + candidate.column_span > panel.column
      : candidate.row < panel.row + panel.row_span &&
        candidate.row + candidate.row_span > panel.row
    if (!overlaps) return false
    if (axis === `x`) return candidate.row >= panel.row + panel.row_span
    if (axis === `x2`) return candidate.row + candidate.row_span <= panel.row
    if (axis === `y`) return candidate.column + candidate.column_span <= panel.column
    return candidate.column >= panel.column + panel.column_span
  })
}

const shares_across_axis_direction = (axis: FacetAxis, mode: FacetAxisMode): boolean =>
  axis === `x` || axis === `x2`
    ? mode === `shared` || mode === `col`
    : mode === `shared` || mode === `row`

// `auto` suppresses duplicates only when a group crosses the axis's perpendicular direction:
// x axes shared down columns and y axes shared across rows. Ragged edges follow occupied panels.
export function resolve_facet_axis_visibility(
  panel: PositionedFacetPanel,
  layout: Pick<FacetGridLayout, `panels`>,
  modes: Partial<FacetAxisModes> = {},
  visibility_modes: FacetAxisVisibilityModes = {},
): FacetAxisVisibility {
  const resolved_modes = axis_modes_with_defaults(modes)
  const visibility = {} as FacetAxisVisibility
  for (const axis of FACET_AXES) {
    let visibility_mode = visibility_modes[axis] ?? `auto`
    if (!FACET_AXIS_VISIBILITY_MODES.includes(visibility_mode)) {
      throw new Error(`Invalid ${axis} facet axis visibility mode: ${visibility_mode}`)
    }
    if (visibility_mode === `auto`) {
      visibility_mode = shares_across_axis_direction(axis, resolved_modes[axis])
        ? `outer`
        : `all`
    }
    const outer = is_outer_axis(axis, panel, layout)
    visibility[axis] =
      visibility_mode === `all` ||
      (visibility_mode === `outer` && outer) ||
      (visibility_mode === `inner` && !outer)
  }
  return visibility
}

export function compute_facet_geometry<Datum>(
  layout: FacetGridLayout<Datum>,
  geometry: FacetGridGeometry,
): ResolvedFacetGridGeometry {
  const {
    width,
    height,
    row_gap = 0,
    column_gap = 0,
    shared_bands: {
      title_height = 0,
      legend_width = 0,
      color_bar_width = 0,
      gap: shared_band_gap = 0,
    } = {},
  } = geometry
  assert_finite_non_negative(width, `width`)
  assert_finite_non_negative(height, `height`)
  assert_finite_non_negative(row_gap, `row_gap`)
  assert_finite_non_negative(column_gap, `column_gap`)
  assert_finite_non_negative(title_height, `shared_bands.title_height`)
  assert_finite_non_negative(legend_width, `shared_bands.legend_width`)
  assert_finite_non_negative(color_bar_width, `shared_bands.color_bar_width`)
  assert_finite_non_negative(shared_band_gap, `shared_bands.gap`)

  const has_title = title_height > 0
  const has_legend = legend_width > 0
  const has_color_bar = color_bar_width > 0
  const side_band_count = Number(has_legend) + Number(has_color_bar)
  const title_gap = has_title ? shared_band_gap : 0
  const panel_grid: Rect = {
    x: 0,
    y: title_height + title_gap,
    width: width - legend_width - color_bar_width - side_band_count * shared_band_gap,
    height: height - title_height - title_gap,
  }
  if (panel_grid.width < 0 || panel_grid.height < 0) {
    throw new RangeError(
      `Shared facet bands exceed grid size: ${width}x${height} with title ${title_height}, legend ${legend_width}, color_bar ${color_bar_width}, gap ${shared_band_gap}`,
    )
  }

  const resolved: ResolvedFacetGridGeometry = {
    panel_grid,
    panels: [],
    ...(has_title && {
      title: {
        band: `title`,
        rect: { x: 0, y: 0, width, height: title_height },
      },
    }),
    ...(has_legend && {
      legend: {
        band: `legend`,
        rect: {
          x: panel_grid.width + shared_band_gap,
          y: panel_grid.y,
          width: legend_width,
          height: panel_grid.height,
        },
      },
    }),
    ...(has_color_bar && {
      color_bar: {
        band: `color_bar`,
        rect: {
          x:
            panel_grid.width +
            shared_band_gap +
            (has_legend ? legend_width + shared_band_gap : 0),
          y: panel_grid.y,
          width: color_bar_width,
          height: panel_grid.height,
        },
      },
    }),
  }
  if (layout.panels.length === 0) return resolved
  if (layout.rows < 1) throw new RangeError(`rows must be positive when panels are present`)
  if (layout.columns < 1)
    throw new RangeError(`columns must be positive when panels are present`)

  const available_width = panel_grid.width - column_gap * (layout.columns - 1)
  const available_height = panel_grid.height - row_gap * (layout.rows - 1)
  if (available_width < 0 || available_height < 0) {
    throw new RangeError(
      `Facet gaps exceed panel grid size: ${panel_grid.width}x${panel_grid.height} with gaps ${column_gap}x${row_gap}`,
    )
  }
  const cell_width = available_width / layout.columns
  const cell_height = available_height / layout.rows
  resolved.panels = layout.panels.map((panel) => ({
    key: panel.key,
    rect: {
      x: panel_grid.x + panel.column * (cell_width + column_gap),
      y: panel_grid.y + panel.row * (cell_height + row_gap),
      width: panel.column_span * cell_width + (panel.column_span - 1) * column_gap,
      height: panel.row_span * cell_height + (panel.row_span - 1) * row_gap,
    },
  }))
  return resolved
}
