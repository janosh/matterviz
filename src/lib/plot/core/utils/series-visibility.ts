// Null/empty legends hide; explicit show_legend wins. Pass the rendered entry count,
// with auto_default=false for hierarchy and Sankey charts that stay opt-in.
export const resolve_legend_visibility = (
  show_legend: boolean | undefined,
  legend: unknown,
  entry_count: number,
  auto_default = entry_count > 1,
): boolean => legend != null && entry_count > 0 && (show_legend ?? auto_default)

// Tri-state settings map `auto` onto the prop's undefined state.
export const LEGEND_VISIBILITY_MODES = [`auto`, `always`, `never`] as const
export type LegendVisibilityMode = (typeof LEGEND_VISIBILITY_MODES)[number]

export const legend_mode_to_prop = (mode: LegendVisibilityMode): boolean | undefined => {
  if (mode === `auto`) return undefined
  if (mode === `always`) return true
  if (mode === `never`) return false
  throw new Error(`Invalid legend visibility mode: ${String(mode)}`)
}

// Minimal series shape the visibility helpers need - generic over the concrete series
// type (DataSeries, BarSeries, BoxPlotSeries, ...) so toggled arrays keep their type
type VisSeries = {
  id?: string | number
  label?: string | null
  unit?: string
  y_axis?: string
  visible?: boolean
  x?: unknown
  y?: unknown
  values?: unknown // HistogramSeries samples
}

type SeriesAxisAccessor<Series extends VisSeries> = (
  series: Series,
  series_idx: number,
) => string | undefined

type SeriesSource = [string, string, string, ...unknown[]]

type SeriesVisibilitySnapshot = {
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
      ...data_sig(srs.values),
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
    const hide_incompatible =
      !is_target &&
      new_visibility &&
      target_axis !== undefined &&
      get_axis(srs, idx) === target_axis &&
      !have_compatible_units(toggled, srs) &&
      (srs.visible ?? true)
    return is_target || hide_incompatible
      ? { ...srs, visible: is_target ? new_visibility : false }
      : srs
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

// Stable identity a legend override is keyed by: id, else label, else position.
const series_key = (srs: VisSeries, idx: number): string =>
  srs.id != null ? `id:${srs.id}` : srs.label ? `label:${srs.label}` : `idx:${idx}`

// A legend-made visibility choice plus the host's value at the time it was made, so
// the override survives the host re-sending the same data but yields when the host
// itself flips `visible`.
type VisibilityOverride = { visible: boolean; parent_visible: boolean | undefined }

// Bundle the three legend visibility handlers (click toggle, group toggle,
// double-click isolate/restore) around a series accessor pair. Owns the
// isolate/restore snapshot and the user's visibility overrides internally so
// components don't each carry them.
//
// `get_series` returns the resolved series the chart renders, `set_series` writes the
// raw (bindable) prop so bound parents see legend toggles. Components derive the
// resolved series via `resolve(incoming)`: a series the user hid stays hidden when the
// parent replaces the array (one-way props, anywidget re-sending traits, rebuilt
// arrays) until the parent itself changes that series' `visible`.
export function create_legend_visibility<Series extends VisSeries>(
  get_series: () => Series[],
  set_series: (series: Series[]) => void,
  get_axis: SeriesAxisAccessor<Series> = (srs) => srs.y_axis,
): {
  resolve: (incoming: Series[]) => Series[]
  on_toggle: (series_idx: number) => void
  on_group_toggle: (group_name: string, series_indices: number[]) => void
  on_double_click: (series_idx: number) => void
} {
  let prev_visibility: SeriesVisibilitySnapshot | null = null
  // Plain Map on purpose: only read inside the component's `$derived` (which already
  // re-runs on every series change) and pruned there too, which a SvelteMap would
  // reject as an unsafe mutation.
  const overrides = new Map<string, VisibilityOverride>()

  const commit = (next: Series[]) => {
    const prev = get_series()
    next.forEach((srs, idx) => {
      // Charts tolerate nullish entries (skipped when rendering)
      if (!srs) return
      const next_visible = srs.visible ?? true
      if (next_visible === (prev[idx]?.visible ?? true)) return
      const key = series_key(srs, idx)
      // Without an override the rendered value is the host's value
      const existing = overrides.get(key)
      const parent_visible = existing ? existing.parent_visible : prev[idx]?.visible
      if (next_visible === (parent_visible ?? true)) overrides.delete(key)
      else overrides.set(key, { visible: next_visible, parent_visible })
    })
    set_series(next)
  }

  return {
    resolve: (incoming) =>
      incoming.map((srs, idx) => {
        if (!srs) return srs
        const key = series_key(srs, idx)
        const override = overrides.get(key)
        if (!override) return srs
        const { visible, parent_visible } = override
        // Neither our own write-back nor the value the user overrode: the host changed it
        if (srs.visible !== visible && srs.visible !== parent_visible) {
          overrides.delete(key)
          return srs
        }
        return srs.visible === visible ? srs : { ...srs, visible }
      }),
    // Raw host series only carry user-explicit axes. Automatic axes are resolved
    // after a legend toggle, so treating missing axes as y1 would hide a series
    // that can move to y2.
    on_toggle: (series_idx) =>
      commit(toggle_series_visibility(get_series(), series_idx, get_axis)),
    on_group_toggle: (_group_name, series_indices) =>
      commit(toggle_group_visibility(get_series(), series_indices)),
    on_double_click: (series_idx) => {
      const result = handle_legend_double_click(get_series(), series_idx, prev_visibility)
      commit(result.series)
      prev_visibility = result.prev_visibility
    },
  }
}
