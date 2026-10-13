import type { ScaleType } from '#lib/plot/core/types.js'

type AxisSlot = `y` | `y2`
type VisibilityFilter<Series> = (series: Series, series_idx: number) => boolean

// Minimal shape needed to group and assign a series without depending on a
// particular plot family.
interface AxisAssignableSeries {
  axis_group?: string
  label?: string
  unit?: string
  visible?: boolean
  y_axis?: AxisSlot
}

export interface AxisValueSeries extends AxisAssignableSeries {
  y: readonly number[]
}

interface AxisGroup<Series extends AxisAssignableSeries> {
  key: string
  priority: number
  series: readonly Series[]
  series_indices: readonly number[]
}

interface AssignedAxisGroup<Series extends AxisAssignableSeries> extends AxisGroup<Series> {
  axis: AxisSlot
}

export interface AxisGroupingOptions<Series extends AxisAssignableSeries> {
  // Undefined visibility means visible, matching plot-series rendering.
  is_visible?: VisibilityFilter<Series>
  // Lower numeric values are assigned before higher ones (normally to y, then y2).
  priority?: (group_key: string, series: readonly Series[]) => number
}

interface AxisAssignmentBase<Series extends AxisAssignableSeries> {
  // One entry per input series. Hidden and overflow series remain unassigned.
  assignments: readonly (AxisSlot | undefined)[]
  groups: readonly AssignedAxisGroup<Series>[]
}

interface CompleteAxisAssignment<
  Series extends AxisAssignableSeries,
> extends AxisAssignmentBase<Series> {
  status: `assigned`
  overflow_groups: readonly []
}

export interface OverflowAxisAssignment<
  Series extends AxisAssignableSeries,
> extends AxisAssignmentBase<Series> {
  status: `overflow`
  error: AxisAssignmentOverflowError
  overflow_groups: readonly AxisGroup<Series>[]
}

type AxisAssignmentResult<Series extends AxisAssignableSeries> =
  | CompleteAxisAssignment<Series>
  | OverflowAxisAssignment<Series>

interface AxisScaleTypeOptions<Series extends AxisValueSeries> {
  is_visible?: VisibilityFilter<Series>
  can_use_log_scale: (series: Series) => boolean
}

// Supported value axes, filled in this order
const AXIS_SLOTS: readonly AxisSlot[] = [`y`, `y2`]
const FALLBACK_LABEL = `Value`
// Positive values on an axis must span at least this many decades for a log scale
const MIN_LOG_DECADES = 3

export class AxisAssignmentOverflowError extends Error {
  constructor(
    readonly group_keys: readonly string[],
    readonly reserved_axes: readonly AxisSlot[],
  ) {
    const available_count = AXIS_SLOTS.length - reserved_axes.length
    const reservation =
      reserved_axes.length === 0
        ? `${AXIS_SLOTS.length} axes`
        : `${available_count} available ${
            available_count === 1 ? `axis` : `axes`
          } (${reserved_axes.join(`, `)} reserved explicitly)`
    const group_kind = `${reserved_axes.length === 0 ? `` : `automatic `}axis ${
      group_keys.length === 1 ? `group` : `groups`
    }`
    super(
      `Cannot assign ${group_keys.length} visible ${group_kind} to ${reservation}: ${group_keys.join(
        `, `,
      )}`,
    )
    this.name = 'AxisAssignmentOverflowError'
  }
}

const default_is_visible = (series: AxisAssignableSeries): boolean => series.visible !== false

// No unit and no axis_group: nothing ties the series to any other
const is_unitless = (series: AxisAssignableSeries): boolean =>
  !series.axis_group?.trim() && !series.unit?.trim()

export const axis_group_key = (
  series: Pick<AxisAssignableSeries, `axis_group` | `unit`>,
): string => {
  const axis_group = series.axis_group?.trim()
  if (axis_group) return axis_group
  const unit = series.unit?.trim()
  if (unit) return unit
  return `dimensionless`
}

const series_on_axis = <Series extends AxisAssignableSeries>(
  series: readonly Series[],
  axis: AxisSlot,
  is_visible: VisibilityFilter<Series> = default_is_visible,
): Series[] =>
  series.filter(
    (series_data, series_idx) =>
      is_visible(series_data, series_idx) && (series_data.y_axis ?? `y`) === axis,
  )

// Group visible series by axis_group (when present) or unit. Groups are sorted by ascending
// caller priority (lower values win y), then first input occurrence so ties are deterministic.
export function group_axis_series<Series extends AxisAssignableSeries>(
  series: readonly Series[],
  options: AxisGroupingOptions<Series> = {},
): AxisGroup<Series>[] {
  const { is_visible = default_is_visible, priority = () => 0 } = options
  const groups = new Map<string, { series: Series[]; series_indices: number[] }>()

  series.forEach((series_data, series_idx) => {
    if (!is_visible(series_data, series_idx)) return
    const key = axis_group_key(series_data)
    let group = groups.get(key)
    if (!group) {
      group = { series: [], series_indices: [] }
      groups.set(key, group)
    }
    group.series.push(series_data)
    group.series_indices.push(series_idx)
  })

  return [...groups]
    .map(([key, group]) => {
      const group_priority = priority(key, group.series)
      if (!Number.isFinite(group_priority)) {
        throw new TypeError(
          `Axis priority must be finite for group "${key}", got ${group_priority}`,
        )
      }
      return { key, ...group, priority: group_priority }
    })
    .toSorted((group_a, group_b) => group_a.priority - group_b.priority)
}

// Preserve visible explicit assignments, then assign automatic groups only to unreserved
// axes. An explicit axis on a unit/axis_group series carries its whole group; on a unitless
// series it pins only itself, keeping unit groups (not other unitless series) off that axis.
export function assign_axes<Series extends AxisAssignableSeries>(
  series: readonly Series[],
  options: AxisGroupingOptions<Series> = {},
): AxisAssignmentResult<Series> {
  const { is_visible = default_is_visible } = options
  const assignments = Array<AxisSlot | undefined>(series.length).fill(undefined)
  series.forEach((series_data, series_idx) => {
    if (!is_visible(series_data, series_idx) || series_data.y_axis === undefined) return
    // untyped hosts (anywidget JSON) can send any value; a stray one would draw on y while
    // dropping out of y's label and scale inference
    if (!AXIS_SLOTS.includes(series_data.y_axis)) {
      throw new Error(
        `Series ${series_idx} has y_axis=${JSON.stringify(series_data.y_axis)}, expected 'y' or 'y2'`,
      )
    }
    assignments[series_idx] = series_data.y_axis
  })

  const candidate_groups = group_axis_series(series, {
    ...options,
    is_visible: (series_data, series_idx) =>
      is_visible(series_data, series_idx) &&
      !(series_data.y_axis !== undefined && is_unitless(series_data)),
  })
  const reserved_by = (keep: (series_data: Series) => boolean): AxisSlot[] =>
    AXIS_SLOTS.filter((axis) =>
      series.some(
        (series_data, series_idx) =>
          is_visible(series_data, series_idx) &&
          series_data.y_axis === axis &&
          keep(series_data),
      ),
    )
  const reserved_axes = reserved_by(() => true)
  const reserved_by_units = reserved_by((series_data) => !is_unitless(series_data))
  const automatic_axes = new Set<AxisSlot>()
  const assigned_groups: AssignedAxisGroup<Series>[] = []
  const overflow_groups: AxisGroup<Series>[] = []
  const attempted_group_keys: string[] = []
  for (const group of candidate_groups) {
    const explicit_axes = AXIS_SLOTS.filter((axis) =>
      group.series.some((series_data) => series_data.y_axis === axis),
    )
    if (explicit_axes.length === 0) attempted_group_keys.push(group.key)
    const blocked_axes = group.series.every(is_unitless) ? reserved_by_units : reserved_axes
    const axis =
      explicit_axes[0] ??
      AXIS_SLOTS.find((slot) => !blocked_axes.includes(slot) && !automatic_axes.has(slot))
    if (axis === undefined) {
      overflow_groups.push(group)
      continue
    }
    if (explicit_axes.length === 0) automatic_axes.add(axis)
    assigned_groups.push({ ...group, axis })
    if (explicit_axes.length < 2) {
      group.series_indices.forEach((series_idx) => (assignments[series_idx] ??= axis))
      continue
    }
    const automatic_group = {
      ...group,
      series: group.series.filter((series_data) => series_data.y_axis === undefined),
      series_indices: group.series_indices.filter(
        (_series_idx, series_idx) => group.series[series_idx].y_axis === undefined,
      ),
    }
    if (automatic_group.series.length > 0) {
      overflow_groups.push(automatic_group)
      attempted_group_keys.push(automatic_group.key)
    }
  }
  if (overflow_groups.length > 0) {
    return {
      status: `overflow`,
      assignments,
      groups: assigned_groups,
      overflow_groups,
      error: new AxisAssignmentOverflowError(attempted_group_keys, reserved_axes),
    }
  }
  return { status: `assigned`, assignments, groups: assigned_groups, overflow_groups: [] }
}

function label_for_axis<Series extends AxisAssignableSeries>(
  series: readonly Series[],
  axis: AxisSlot,
  is_visible?: VisibilityFilter<Series>,
): string {
  const axis_series = series_on_axis(series, axis, is_visible)
  if (axis_series.length === 0) return FALLBACK_LABEL

  const labels_by_unit = new Map<string, Set<string>>()
  for (const series_data of axis_series) {
    const unit = series_data.unit?.trim() ?? ``
    const labels = labels_by_unit.get(unit) ?? new Set<string>()
    labels.add(series_data.label ?? FALLBACK_LABEL)
    labels_by_unit.set(unit, labels)
  }
  const formatted_groups = [...labels_by_unit].map(([unit, labels]) => {
    const combined_label = [...labels].toSorted().join(` / `)
    return unit ? `${combined_label} (${unit})` : combined_label
  })
  return formatted_groups.toSorted().join(` / `)
}

export function axis_labels<Series extends AxisAssignableSeries>(
  series: readonly Series[],
  { is_visible }: { is_visible?: VisibilityFilter<Series> } = {},
): Record<AxisSlot, string> {
  return {
    y: label_for_axis(series, `y`, is_visible),
    y2: label_for_axis(series, `y2`, is_visible),
  }
}

export function axis_scale_types<Series extends AxisValueSeries>(
  series: readonly Series[],
  options: AxisScaleTypeOptions<Series>,
): Record<AxisSlot, ScaleType> {
  const { can_use_log_scale, is_visible } = options
  const scale_for_axis = (axis: AxisSlot): ScaleType => {
    const axis_series = series_on_axis(series, axis, is_visible)
    if (
      axis_series.length === 0 ||
      axis_series.some((series_data) => !can_use_log_scale(series_data))
    ) {
      return `linear`
    }

    let min_value = Infinity
    let max_value = -Infinity
    for (const series_data of axis_series) {
      for (const value of series_data.y) {
        if (!Number.isFinite(value)) continue
        min_value = Math.min(min_value, value)
        max_value = Math.max(max_value, value)
      }
    }
    if (!Number.isFinite(min_value) || min_value <= 0) return `linear`
    const decade_span = Math.log10(max_value) - Math.log10(min_value)
    return decade_span >= MIN_LOG_DECADES ? `log` : `linear`
  }

  return { y: scale_for_axis(`y`), y2: scale_for_axis(`y2`) }
}
