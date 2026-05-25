import type { DataSeries } from '$lib/plot/types'

export type StrRecord = Record<string, unknown>

type SeriesSource = [string, string, string, unknown, unknown]

export type SeriesVisibilitySnapshot = {
  visibility: boolean[]
  source: SeriesSource[]
}

const series_source = <Metadata extends StrRecord = StrRecord>(
  series: DataSeries<Metadata>[],
  length = series.length,
): SeriesSource[] =>
  series
    .slice(0, length)
    .map((srs) => [srs.label ?? ``, srs.unit ?? ``, srs.y_axis ?? ``, srs.x, srs.y])

const same_series_source = (
  series: SeriesSource[],
  snapshot_series: SeriesSource[],
): boolean =>
  series.length === snapshot_series.length &&
  series.every((source, idx) =>
    source.every((part, part_idx) => Object.is(part, snapshot_series[idx][part_idx])),
  )

export function have_compatible_units<Metadata extends StrRecord = StrRecord>(
  series1: DataSeries<Metadata>,
  series2: DataSeries<Metadata>,
): boolean {
  if (!series1.unit || !series2.unit) return true
  return series1.unit === series2.unit
}

export function toggle_series_visibility<Metadata extends StrRecord = StrRecord>(
  series: DataSeries<Metadata>[],
  series_idx: number,
): DataSeries<Metadata>[] {
  if (series_idx < 0 || series_idx >= series.length || !series[series_idx]) return series

  const toggled = series[series_idx]
  const new_visibility = !(toggled.visible ?? true)
  const target_axis = toggled.y_axis ?? `y1`

  return series.map((srs, idx) => {
    if (
      (toggled.label && srs.label === toggled.label) ||
      (idx === series_idx && !toggled.label)
    ) {
      return { ...srs, visible: new_visibility }
    }
    if (new_visibility && (srs.y_axis ?? `y1`) === target_axis) {
      if (!have_compatible_units(toggled, srs) && (srs.visible ?? true)) {
        return { ...srs, visible: false }
      }
    }
    return srs
  })
}

export function toggle_group_visibility<Metadata extends StrRecord = StrRecord>(
  series: DataSeries<Metadata>[],
  series_indices: number[],
): DataSeries<Metadata>[] {
  // Filter to valid indices upfront
  const valid_indices = series_indices.filter((idx) => idx >= 0 && idx < series.length)
  if (valid_indices.length === 0) return series

  const idx_set = new Set(valid_indices)

  // Check if all series in the group are currently visible
  const all_visible = valid_indices.every((idx) => series[idx].visible ?? true)

  // Toggle: if all visible, hide all; otherwise show all
  const new_visibility = !all_visible

  return series.map((srs, idx) =>
    idx_set.has(idx) ? { ...srs, visible: new_visibility } : srs,
  )
}

export function handle_legend_double_click<Metadata extends StrRecord = StrRecord>(
  series: DataSeries<Metadata>[],
  idx: number,
  prev_snapshot: SeriesVisibilitySnapshot | null,
): {
  series: DataSeries<Metadata>[]
  prev_visibility: SeriesVisibilitySnapshot | null
} {
  if (idx < 0 || idx >= series.length) {
    return { series, prev_visibility: prev_snapshot }
  }

  const { label } = series[idx]
  const current = series.map((srs) => srs.visible ?? true)
  const current_source = prev_snapshot
    ? series_source(series, prev_snapshot.visibility.length)
    : []
  const prev_visibility =
    prev_snapshot && same_series_source(current_source, prev_snapshot.source)
      ? prev_snapshot.visibility
      : null
  // Only check original series (ignore new ones added after isolation)
  const check_series = prev_visibility ? series.slice(0, prev_visibility.length) : series
  const is_isolated = check_series.every((srs, srs_idx) => {
    const in_group = label ? srs.label === label : srs_idx === idx
    return in_group ? (srs.visible ?? true) : !(srs.visible ?? true)
  })

  // Restore from isolation
  if (is_isolated && prev_visibility) {
    return {
      series: series.map((srs, srs_idx) =>
        srs_idx < prev_visibility.length && current[srs_idx] !== prev_visibility[srs_idx]
          ? { ...srs, visible: prev_visibility[srs_idx] }
          : srs,
      ),
      prev_visibility: null,
    }
  }

  // Isolate series
  const new_prev = prev_visibility
    ? prev_snapshot
    : current.filter(Boolean).length > 1
      ? {
          visibility: [...current],
          source: series_source(series),
        }
      : null
  return {
    series: series.map((srs, srs_idx) => {
      const in_group = label ? srs.label === label : srs_idx === idx
      return (srs.visible ?? true) !== in_group ? { ...srs, visible: in_group } : srs
    }),
    prev_visibility: new_prev,
  }
}
