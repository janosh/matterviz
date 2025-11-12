import type { DataSeries } from '$lib/plot/types'

export function have_compatible_units(series1: DataSeries, series2: DataSeries): boolean {
  if (!series1.unit || !series2.unit) return true
  return series1.unit === series2.unit
}

export function toggle_series_visibility(
  series: DataSeries[],
  series_idx: number,
): DataSeries[] {
  if (series_idx < 0 || series_idx >= series.length || !series[series_idx]) return series

  const toggled = series[series_idx] as DataSeries
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

export function handle_legend_double_click(
  series: DataSeries[],
  idx: number,
  prev_visibility: boolean[] | null,
): { series: DataSeries[]; previous_visibility: boolean[] | null } {
  if (idx < 0 || idx >= series.length) {
    return { series, previous_visibility: prev_visibility }
  }

  const { label } = series[idx]
  const current = series.map((srs) => srs.visible ?? true)
  // Only check original series (ignore new ones added after isolation)
  const check_series = prev_visibility ? series.slice(0, prev_visibility.length) : series
  const is_isolated = check_series.every((s, i) => {
    const in_group = label ? s.label === label : i === idx
    return in_group ? s.visible ?? true : !s.visible
  })

  // Restore from isolation
  if (is_isolated && prev_visibility) {
    return {
      series: series.map((srs, idx) =>
        idx < prev_visibility.length && current[idx] !== prev_visibility[idx]
          ? { ...srs, visible: prev_visibility[idx] }
          : srs
      ),
      previous_visibility: null,
    }
  }

  // Isolate series
  const new_prev = prev_visibility ??
    (current.filter(Boolean).length > 1 ? [...current] : null)
  return {
    series: series.map((srs, srs_idx) => {
      const in_group = label ? srs.label === label : srs_idx === idx
      return (srs.visible ?? true) !== in_group ? { ...srs, visible: in_group } : srs
    }),
    previous_visibility: new_prev,
  }
}
