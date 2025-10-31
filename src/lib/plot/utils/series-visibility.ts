import type { DataSeries } from '$lib/plot'

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
  const label = series[idx]?.label
  const current = series.map((srs) => srs?.visible ?? true)
  const is_isolated = series.every((s, i) => {
    const in_group = label ? s.label === label : i === idx
    return in_group ? (s?.visible ?? true) : !(s?.visible ?? true)
  })

  if (is_isolated && prev_visibility) {
    return {
      series: series.map((srs, idx) => {
        // Only restore visibility if we have a saved value for this index
        // (new series added after isolation should keep their current visibility)
        if (idx < prev_visibility.length && current[idx] !== prev_visibility[idx]) {
          return { ...srs, visible: prev_visibility[idx] }
        }
        return srs
      }),
      previous_visibility: null,
    }
  }

  const new_prev = current.filter((v) => v).length > 1 ? [...current] : null
  return {
    series: series.map((srs, srs_idx) => {
      const in_group = label ? srs.label === label : srs_idx === idx
      return (srs?.visible ?? true) !== in_group ? { ...srs, visible: in_group } : srs
    }),
    previous_visibility: new_prev,
  }
}
