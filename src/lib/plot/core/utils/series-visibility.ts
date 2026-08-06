// Minimal series shape the visibility helpers need - generic over the concrete series
// type (DataSeries, BarSeries, BoxPlotSeries, ...) so toggled arrays keep their type
type VisSeries = {
  label?: string | null
  unit?: string
  y_axis?: string
  visible?: boolean
  x?: unknown
  y?: unknown
}

export type SeriesAxisAccessor<Series extends VisSeries> = (
  series: Series,
  series_idx: number,
) => string | undefined

type SeriesSource = [string, string, string, ...unknown[]]

export type SeriesVisibilitySnapshot = {
  visibility: boolean[]
  source: SeriesSource[]
}

// Length + first/last element: a by-value signature for x/y data. Deliberately NOT
// array identity: inside components those are $state proxies whose identity changes
// when the series prop is reassigned (e.g. by the isolate itself), which made the
// snapshot reject itself and permanently broke restore-from-isolation.
const data_sig = (arr: unknown): unknown[] =>
  Array.isArray(arr) ? [arr.length, arr[0], arr[arr.length - 1]] : [arr]

const series_source = (series: VisSeries[], length = series.length): SeriesSource[] =>
  series
    .slice(0, length)
    .map((srs) => [
      srs.label ?? ``,
      srs.unit ?? ``,
      srs.y_axis ?? ``,
      ...data_sig(srs.x),
      ...data_sig(srs.y),
    ])

const same_series_source = (
  series: SeriesSource[],
  snapshot_series: SeriesSource[],
): boolean =>
  series.length === snapshot_series.length &&
  series.every(
    (source, idx) =>
      source.length === snapshot_series[idx].length &&
      source.every((part, part_idx) => Object.is(part, snapshot_series[idx][part_idx])),
  )

export function have_compatible_units(series1: VisSeries, series2: VisSeries): boolean {
  if (!series1.unit || !series2.unit) return true
  return series1.unit === series2.unit
}

export function toggle_series_visibility<Series extends VisSeries>(
  series: Series[],
  series_idx: number,
  get_axis: SeriesAxisAccessor<Series> = (srs) => srs.y_axis ?? `y1`,
): Series[] {
  if (series_idx < 0 || series_idx >= series.length || !series[series_idx]) return series

  const toggled = series[series_idx]
  const new_visibility = !(toggled.visible ?? true)
  const target_axis = get_axis(toggled, series_idx)

  return series.map((srs, idx) => {
    const is_target = toggled.label ? srs.label === toggled.label : idx === series_idx
    if (is_target) {
      return { ...srs, visible: new_visibility }
    }
    if (
      new_visibility &&
      target_axis !== undefined &&
      get_axis(srs, idx) === target_axis &&
      !have_compatible_units(toggled, srs) &&
      (srs.visible ?? true)
    ) {
      return { ...srs, visible: false }
    }
    return srs
  })
}

export function toggle_group_visibility<Series extends VisSeries>(
  series: Series[],
  series_indices: number[],
): Series[] {
  const valid_indices = series_indices.filter((idx) => idx >= 0 && idx < series.length)
  if (valid_indices.length === 0) return series

  const all_visible = valid_indices.every((idx) => series[idx].visible ?? true)
  return series.map((srs, idx) =>
    valid_indices.includes(idx) ? { ...srs, visible: !all_visible } : srs,
  )
}

export function handle_legend_double_click<Series extends VisSeries>(
  series: Series[],
  idx: number,
  prev_snapshot: SeriesVisibilitySnapshot | null,
): {
  series: Series[]
  prev_visibility: SeriesVisibilitySnapshot | null
} {
  if (idx < 0 || idx >= series.length) {
    return { series, prev_visibility: prev_snapshot }
  }

  const { label } = series[idx]
  const current = series.map((srs) => srs.visible ?? true)
  const prev_visibility =
    prev_snapshot &&
    same_series_source(
      series_source(series, prev_snapshot.visibility.length),
      prev_snapshot.source,
    )
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

// Bundle the three legend visibility handlers (click toggle, group toggle,
// double-click isolate/restore) around a series accessor pair. Owns the
// isolate/restore snapshot internally so components don't each carry it.
export function create_legend_visibility<Series extends VisSeries>(
  get_series: () => Series[],
  set_series: (series: Series[]) => void,
  get_axis: SeriesAxisAccessor<Series> = (srs) => srs.y_axis,
): {
  on_toggle: (series_idx: number) => void
  on_group_toggle: (group_name: string, series_indices: number[]) => void
  on_double_click: (series_idx: number) => void
} {
  let prev_visibility: SeriesVisibilitySnapshot | null = null
  return {
    // Raw host series only carry user-explicit axes. Automatic axes are resolved
    // after a legend toggle, so treating missing axes as y1 would hide a series
    // that can move to y2.
    on_toggle: (series_idx) =>
      set_series(toggle_series_visibility(get_series(), series_idx, get_axis)),
    on_group_toggle: (_group_name, series_indices) =>
      set_series(toggle_group_visibility(get_series(), series_indices)),
    on_double_click: (series_idx) => {
      const result = handle_legend_double_click(get_series(), series_idx, prev_visibility)
      set_series(result.series)
      prev_visibility = result.prev_visibility
    },
  }
}
