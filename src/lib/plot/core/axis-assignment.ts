import type { ScaleType } from './types'

export type AxisSlot = `y1` | `y2`

// Minimal shape needed to group and assign a series without depending on a
// particular plot family.
export interface AxisAssignableSeries {
  axis_group?: string
  label?: string
  unit?: string
  visible?: boolean
  y_axis?: AxisSlot
}

export interface AxisValueSeries extends AxisAssignableSeries {
  y: readonly number[]
}

export interface AxisGroup<Series extends AxisAssignableSeries> {
  key: string
  priority: number
  series: readonly Series[]
  series_indices: readonly number[]
}

export interface AssignedAxisGroup<
  Series extends AxisAssignableSeries,
> extends AxisGroup<Series> {
  axis: AxisSlot
}

export interface AxisGroupingOptions<Series extends AxisAssignableSeries> {
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

export interface CompleteAxisAssignment<
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

export type AxisAssignmentResult<Series extends AxisAssignableSeries> =
  | CompleteAxisAssignment<Series>
  | OverflowAxisAssignment<Series>

export interface AxisLabelOptions<Series extends AxisAssignableSeries> {
  is_visible?: (series: Series, series_idx: number) => boolean
  // A resolved assignment array or accessor is authoritative: undefined entries
  // stay unassigned instead of falling back to y1.
  axis?: readonly (AxisSlot | undefined)[] | AxisAccessor<Series>
  fallback_label?: string
}

export interface AxisScaleTypeOptions<Series extends AxisValueSeries> {
  is_visible?: (series: Series, series_idx: number) => boolean
  axis?: readonly (AxisSlot | undefined)[] | AxisAccessor<Series>
  can_use_log_scale: (series: Series) => boolean
  min_log_decades?: number
}

export type AxisAccessor<Series extends AxisAssignableSeries> = (
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
  return unit ? unit : `dimensionless`
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
    (srs, series_idx) =>
      (options.is_visible ?? default_is_visible)(srs, series_idx) &&
      resolved_axis(srs, series_idx, options.axis) === axis,
  )

// Group visible series by axis_group (when present) or unit. Groups are sorted by ascending
// caller priority (lower values win y1), then first input occurrence so ties are deterministic.
export function group_axis_series<Series extends AxisAssignableSeries>(
  series: readonly Series[],
  options: AxisGroupingOptions<Series> = {},
): AxisGroup<Series>[] {
  const { is_visible = default_is_visible, priority = () => 0 } = options
  const groups: {
    key: string
    series: Series[]
    series_indices: number[]
  }[] = []

  series.forEach((srs, series_idx) => {
    if (!is_visible(srs, series_idx)) return
    const key = axis_group_key(srs)
    let group = groups.find((candidate) => candidate.key === key)
    if (!group) {
      group = { key, series: [], series_indices: [] }
      groups.push(group)
    }
    group.series.push(srs)
    group.series_indices.push(series_idx)
  })

  return groups
    .map((group) => {
      const group_priority = priority(group.key, group.series)
      if (!Number.isFinite(group_priority)) {
        throw new TypeError(
          `Axis priority must be finite for group "${group.key}", got ${group_priority}`,
        )
      }
      return { ...group, priority: group_priority }
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
  series.forEach((srs, series_idx) => {
    if (!is_visible(srs, series_idx) || srs.y_axis === undefined) return
    if (!supported_axes.includes(srs.y_axis)) {
      throw new Error(
        `Series ${series_idx} explicitly uses ${srs.y_axis}, which is unavailable with max_axes=${max_axes}`,
      )
    }
    assignments[series_idx] = srs.y_axis
  })

  const candidate_groups = group_axis_series(series, options)
  const explicit_axes_by_group = candidate_groups.map((group) =>
    supported_axes.filter((axis) => group.series.some((srs) => srs.y_axis === axis)),
  )
  const reserved_axes = supported_axes.filter((axis) =>
    explicit_axes_by_group.some((explicit_axes) => explicit_axes.includes(axis)),
  )
  const available_axes = supported_axes.filter((axis) => !reserved_axes.includes(axis))
  const assigned_groups: AssignedAxisGroup<Series>[] = []
  const overflow_groups: AxisGroup<Series>[] = []
  const attempted_automatic_groups: AxisGroup<Series>[] = []
  let automatic_group_idx = 0
  for (const [group_idx, group] of candidate_groups.entries()) {
    const explicit_axes = explicit_axes_by_group[group_idx]
    if (explicit_axes.length === 0) {
      attempted_automatic_groups.push(group)
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
      series: group.series.filter((srs) => srs.y_axis === undefined),
      series_indices: group.series_indices.filter(
        (_series_idx, idx) => group.series[idx].y_axis === undefined,
      ),
    }
    if (automatic_group.series.length > 0) {
      overflow_groups.push(automatic_group)
      attempted_automatic_groups.push(automatic_group)
    }
  }
  if (overflow_groups.length > 0) {
    return {
      status: `overflow`,
      assignments,
      groups: assigned_groups,
      overflow_groups,
      error: new AxisAssignmentOverflowError(
        attempted_automatic_groups.map((group) => group.key),
        max_axes,
        reserved_axes,
      ),
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

  const unit_groups: { unit: string; labels: string[] }[] = []
  for (const srs of axis_series) {
    const unit = srs.unit?.trim() ?? ``
    let unit_group = unit_groups.find((group) => group.unit === unit)
    if (!unit_group) {
      unit_group = { unit, labels: [] }
      unit_groups.push(unit_group)
    }
    const label = srs.label ?? fallback_label
    if (!unit_group.labels.includes(label)) unit_group.labels.push(label)
  }
  const formatted_groups = unit_groups.map(({ unit, labels }) => {
    const combined_label = labels.toSorted().join(` / `)
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
    if (axis_series.length === 0 || axis_series.some((srs) => !can_use_log_scale(srs))) {
      return `linear`
    }

    let min_value = Infinity
    let max_value = -Infinity
    for (const srs of axis_series) {
      for (const value of srs.y) {
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
