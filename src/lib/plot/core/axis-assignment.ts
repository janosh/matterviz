import type { ScaleType } from './types'

type AxisSlot = `y1` | `y2`

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

interface AxisGroupingOptions<Series extends AxisAssignableSeries> {
  // Undefined visibility means visible, matching plot-series rendering.
  is_visible?: (series: Series, series_idx: number) => boolean
  // Lower numeric values are assigned before higher ones (normally to y1, then y2).
  priority?: (group_key: string, series: readonly Series[]) => number
}

export interface AxisAssignmentOptions<
  Series extends AxisAssignableSeries,
> extends AxisGroupingOptions<Series> {
  max_axes?: 1 | 2
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

interface AxisLabelOptions<Series extends AxisAssignableSeries> {
  is_visible?: (series: Series, series_idx: number) => boolean
  // A resolved assignment array or accessor is authoritative: undefined entries
  // stay unassigned instead of falling back to y1.
  axis?: readonly (AxisSlot | undefined)[] | AxisAccessor<Series>
  fallback_label?: string
}

interface AxisScaleTypeOptions<Series extends AxisValueSeries> {
  is_visible?: (series: Series, series_idx: number) => boolean
  axis?: readonly (AxisSlot | undefined)[] | AxisAccessor<Series>
  can_use_log_scale: (series: Series) => boolean
  min_log_decades?: number
}

type AxisAccessor<Series extends AxisAssignableSeries> = (
  series: Series,
  series_idx: number,
) => AxisSlot | undefined

export class AxisAssignmentOverflowError extends Error {
  readonly group_keys: readonly string[]
  readonly max_axes: number
  readonly reserved_axes: readonly AxisSlot[]

  constructor(
    group_keys: readonly string[],
    max_axes: number,
    reserved_axes: readonly AxisSlot[] = [],
  ) {
    const available_count = max_axes - reserved_axes.length
    const reservation =
      reserved_axes.length === 0
        ? `${max_axes} axes`
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
    this.group_keys = group_keys
    this.max_axes = max_axes
    this.reserved_axes = reserved_axes
  }
}

const default_is_visible = (series: AxisAssignableSeries): boolean => series.visible !== false

export const axis_group_key = (series: AxisAssignableSeries): string => {
  const axis_group = series.axis_group?.trim()
  if (axis_group) return axis_group
  const unit = series.unit?.trim()
  if (unit) return unit
  return `dimensionless`
}

const resolved_axis = <Series extends AxisAssignableSeries>(
  series: Series,
  series_idx: number,
  axis: readonly (AxisSlot | undefined)[] | AxisAccessor<Series> | undefined,
): AxisSlot | undefined => {
  if (typeof axis === `function`) return axis(series, series_idx)
  if (axis !== undefined) return axis[series_idx]
  return series.y_axis ?? `y1`
}

const series_on_axis = <Series extends AxisAssignableSeries>(
  series: readonly Series[],
  axis: AxisSlot,
  options: Pick<AxisLabelOptions<Series>, `is_visible` | `axis`>,
): Series[] =>
  series.filter(
    (series_data, series_idx) =>
      (options.is_visible ?? default_is_visible)(series_data, series_idx) &&
      resolved_axis(series_data, series_idx, options.axis) === axis,
  )

// Group visible series by axis_group (when present) or unit. Groups are sorted by ascending
// caller priority (lower values win y1), then first input occurrence so ties are deterministic.
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

// Preserve visible explicit assignments, then assign automatic groups only to
// unreserved axes. The aligned result keeps this operation pure.
export function assign_axes<Series extends AxisAssignableSeries>(
  series: readonly Series[],
  options: AxisAssignmentOptions<Series> = {},
): AxisAssignmentResult<Series> {
  const { is_visible = default_is_visible, max_axes = 2 } = options
  if (max_axes !== 1 && max_axes !== 2) {
    throw new Error(`max_axes must be 1 or 2, got ${max_axes}`)
  }

  const supported_axes: readonly AxisSlot[] = max_axes === 1 ? [`y1`] : [`y1`, `y2`]
  const assignments = Array<AxisSlot | undefined>(series.length).fill(undefined)
  series.forEach((series_data, series_idx) => {
    if (!is_visible(series_data, series_idx) || series_data.y_axis === undefined) return
    if (!supported_axes.includes(series_data.y_axis)) {
      throw new Error(
        `Series ${series_idx} explicitly uses ${series_data.y_axis}, which is unavailable with max_axes=${max_axes}`,
      )
    }
    assignments[series_idx] = series_data.y_axis
  })

  const candidate_groups = group_axis_series(series, options)
  const reserved_axes = supported_axes.filter((axis) =>
    candidate_groups.some((group) =>
      group.series.some((series_data) => series_data.y_axis === axis),
    ),
  )
  const available_axes = supported_axes.filter((axis) => !reserved_axes.includes(axis))
  const assigned_groups: AssignedAxisGroup<Series>[] = []
  const overflow_groups: AxisGroup<Series>[] = []
  const attempted_group_keys: string[] = []
  let automatic_group_idx = 0
  for (const group of candidate_groups) {
    const explicit_axes = supported_axes.filter((axis) =>
      group.series.some((series_data) => series_data.y_axis === axis),
    )
    if (explicit_axes.length === 0) {
      attempted_group_keys.push(group.key)
      const axis = available_axes[automatic_group_idx++]
      if (axis === undefined) {
        overflow_groups.push(group)
        continue
      }
      assigned_groups.push({ ...group, axis })
      group.series_indices.forEach((series_idx) => (assignments[series_idx] = axis))
      continue
    }

    const axis = explicit_axes[0]
    assigned_groups.push({ ...group, axis })
    if (explicit_axes.length === 1) {
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
      error: new AxisAssignmentOverflowError(attempted_group_keys, max_axes, reserved_axes),
    }
  }
  return { status: `assigned`, assignments, groups: assigned_groups, overflow_groups: [] }
}

function label_for_axis<Series extends AxisAssignableSeries>(
  series: readonly Series[],
  axis: AxisSlot,
  options: AxisLabelOptions<Series>,
): string {
  const { fallback_label = `Value` } = options
  const axis_series = series_on_axis(series, axis, options)
  if (axis_series.length === 0) return fallback_label

  const labels_by_unit = new Map<string, Set<string>>()
  for (const series_data of axis_series) {
    const unit = series_data.unit?.trim() ?? ``
    const labels = labels_by_unit.get(unit) ?? new Set<string>()
    labels.add(series_data.label ?? fallback_label)
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
  options: AxisLabelOptions<Series> = {},
): Record<AxisSlot, string> {
  return {
    y1: label_for_axis(series, `y1`, options),
    y2: label_for_axis(series, `y2`, options),
  }
}

export function axis_scale_types<Series extends AxisValueSeries>(
  series: readonly Series[],
  options: AxisScaleTypeOptions<Series>,
): Record<AxisSlot, ScaleType> {
  const { can_use_log_scale, min_log_decades = 3 } = options
  if (!Number.isFinite(min_log_decades) || min_log_decades < 0) {
    throw new Error(
      `min_log_decades must be a non-negative finite number, got ${min_log_decades}`,
    )
  }

  const scale_for_axis = (axis: AxisSlot): ScaleType => {
    const axis_series = series_on_axis(series, axis, options)
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
    return decade_span >= min_log_decades ? `log` : `linear`
  }

  return { y1: scale_for_axis(`y1`), y2: scale_for_axis(`y2`) }
}
