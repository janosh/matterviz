import { SvelteSet } from 'svelte/reactivity'
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
  fallback_label?: string
}

export interface AxisScaleTypeOptions<Series extends AxisValueSeries> {
  is_visible?: (series: Series, series_idx: number) => boolean
  can_use_log_scale: (series: Series) => boolean
  min_log_decades?: number
}

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

export const axis_group_key = (series: AxisAssignableSeries): string =>
  series.axis_group ?? series.unit ?? `dimensionless`

// Group visible series by axis_group (when present) or unit. Groups are sorted
// by caller priority, then first input occurrence so ties are deterministic.
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
  const assignments: (AxisSlot | undefined)[] = Array.from(
    { length: series.length },
    () => undefined,
  )
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
  const explicit_axes_for_group = (group: AxisGroup<Series>): AxisSlot[] =>
    supported_axes.filter((axis) => group.series.some((srs) => srs.y_axis === axis))
  const reserved_axes = supported_axes.filter((axis) =>
    candidate_groups.some((group) => explicit_axes_for_group(group).includes(axis)),
  )
  const available_axes = supported_axes.filter((axis) => !reserved_axes.includes(axis))
  const automatic_groups = candidate_groups.filter(
    (group) => explicit_axes_for_group(group).length === 0,
  )
  const assigned_automatic_groups = automatic_groups.slice(0, available_axes.length)
  const automatic_part = (group: AxisGroup<Series>): AxisGroup<Series> => {
    const automatic_indices = group.series
      .map((srs, group_idx) => (srs.y_axis === undefined ? group_idx : -1))
      .filter((group_idx) => group_idx >= 0)
    return {
      ...group,
      series: automatic_indices.map((group_idx) => group.series[group_idx]),
      series_indices: automatic_indices.map((group_idx) => group.series_indices[group_idx]),
    }
  }
  const assigned_groups = candidate_groups.flatMap((group) => {
    const explicit_axes = explicit_axes_for_group(group)
    const automatic_group_idx = assigned_automatic_groups.indexOf(group)
    const axis =
      explicit_axes[0] ??
      (automatic_group_idx === -1 ? undefined : available_axes[automatic_group_idx])
    return axis === undefined ? [] : [{ ...group, axis }]
  })
  for (const group of assigned_groups) {
    const conflicting_explicit_axes = explicit_axes_for_group(group).length > 1
    group.series_indices.forEach((series_idx, group_idx) => {
      if (conflicting_explicit_axes && group.series[group_idx].y_axis === undefined) return
      assignments[series_idx] ??= group.axis
    })
  }

  const unassigned_automatic_groups = new SvelteSet(
    automatic_groups.slice(available_axes.length),
  )
  const overflow_groups = candidate_groups.flatMap((group) => {
    if (unassigned_automatic_groups.has(group)) return [group]
    if (explicit_axes_for_group(group).length <= 1) return []
    const group_automatic_part = automatic_part(group)
    return group_automatic_part.series.length === 0 ? [] : [group_automatic_part]
  })
  if (overflow_groups.length > 0) {
    const attempted_automatic_groups = candidate_groups.flatMap((group) => {
      const explicit_axes = explicit_axes_for_group(group)
      if (explicit_axes.length === 0) return [group]
      if (explicit_axes.length === 1) return []
      const group_automatic_part = automatic_part(group)
      return group_automatic_part.series.length === 0 ? [] : [group_automatic_part]
    })
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
  const { is_visible = default_is_visible, fallback_label = `Value` } = options
  const axis_series = series.filter(
    (srs, series_idx) => is_visible(srs, series_idx) && (srs.y_axis ?? `y1`) === axis,
  )
  if (axis_series.length === 0) return fallback_label

  const unit_groups: { unit: string; labels: string[] }[] = []
  for (const srs of axis_series) {
    const unit = srs.unit ?? ``
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
  const { is_visible = default_is_visible, can_use_log_scale, min_log_decades = 3 } = options
  if (!Number.isFinite(min_log_decades) || min_log_decades < 0) {
    throw new Error(
      `min_log_decades must be a non-negative finite number, got ${min_log_decades}`,
    )
  }

  const scale_for_axis = (axis: AxisSlot): ScaleType => {
    const axis_series = series.filter(
      (srs, series_idx) => is_visible(srs, series_idx) && (srs.y_axis ?? `y1`) === axis,
    )
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
