import { axis_group_key } from '../axis-assignment'

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
  legend_id?: string | number
  label?: string | null
  legend_group?: string
  unit?: string
  axis_group?: string
  y_axis?: string
  visible?: boolean
}

type SeriesAxisAccessor<Series extends VisSeries> = (
  series: Series,
  series_idx: number,
) => string | undefined

export const same_legend_item = (
  target: VisSeries,
  item: VisSeries | undefined,
  target_idx: number,
  idx: number,
): boolean =>
  target.legend_id != null || item?.legend_id != null
    ? target.legend_id != null && target.legend_id === item?.legend_id
    : target.id != null || item?.id != null || !target.label
      ? target_idx === idx
      : target.label === item?.label && target.legend_group === item.legend_group

const can_share_axis = (series1: VisSeries, series2: VisSeries): boolean =>
  series1.axis_group?.trim() || series2.axis_group?.trim()
    ? axis_group_key(series1) === axis_group_key(series2)
    : !series1.unit || !series2.unit || series1.unit === series2.unit

// Legend interaction owns only hidden IDs; input series are never replaced or mutated.
export function create_legend_visibility<Series extends VisSeries>(
  get_series: () => Series[],
  get_hidden: () => readonly (string | number)[] | undefined,
  set_hidden: (hidden: (string | number)[]) => void,
  get_axis: SeriesAxisAccessor<Series> = (srs) => srs.y_axis,
) {
  let snapshot: {
    hidden: readonly (string | number)[]
    isolated: Set<string | number>
    keys: Set<string | number>
  } | null = null
  const get_key = (srs: Series, idx: number) => srs.legend_id ?? srs.id ?? idx
  const keys_of = (items: Series[]) =>
    new Set(items.flatMap((srs, idx) => (srs ? [get_key(srs, idx)] : [])))
  const hidden_keys_of = (
    items: Series[],
    is_hidden = (srs: Series, _idx: number) => srs.visible === false,
  ) => [
    ...new Set(
      items.flatMap((srs, idx) => (srs && is_hidden(srs, idx) ? [get_key(srs, idx)] : [])),
    ),
  ]
  const commit = (
    next: Series[],
    is_hidden?: (srs: Series, idx: number) => boolean,
  ): (string | number)[] => {
    const keys = keys_of(next)
    const hidden = [
      ...new Set([
        ...(get_hidden() ?? []).filter((key) => !keys.has(key)),
        ...hidden_keys_of(next, is_hidden),
      ]),
    ]
    set_hidden(hidden)
    return hidden
  }
  return {
    resolve: (incoming: readonly Series[]): Series[] => {
      const selected_hidden = get_hidden()
      const hidden = selected_hidden && new Set(selected_hidden)
      const seen = new Set<string | number>()
      const key_owners = new Map<string | number, Series>()
      return incoming.map((srs, idx) => {
        if (!srs) return srs
        const drawing_key = srs.id ?? idx
        if (seen.has(drawing_key))
          throw new Error(
            `Series keys must be unique, got duplicate "${drawing_key}". Supply unique IDs for every series when mixing explicit IDs with positional IDs.`,
          )
        seen.add(drawing_key)
        const series_key = get_key(srs, idx)
        const owner = key_owners.get(series_key)
        if (owner && (srs.legend_id == null || owner.legend_id !== srs.legend_id))
          throw new Error(`Legend key "${series_key}" conflicts with a drawing series ID`)
        if (owner && (owner.legend_group ?? ``) !== (srs.legend_group ?? ``))
          throw new Error(`Legend key "${series_key}" spans different legend groups`)
        key_owners.set(series_key, srs)
        return hidden ? { ...srs, visible: !hidden.has(series_key) } : srs
      })
    },
    on_toggle: (series_idx: number) => {
      snapshot = null
      const series = get_series()
      const target = series[series_idx]
      if (!target) {
        commit(series)
        return
      }
      const visible = !(target.visible ?? true)
      const axis = get_axis(target, series_idx)
      commit(series, (srs, idx) =>
        same_legend_item(target, srs, series_idx, idx)
          ? !visible
          : (visible &&
              axis !== undefined &&
              get_axis(srs, idx) === axis &&
              !can_share_axis(target, srs)) ||
            srs.visible === false,
      )
    },
    on_group_toggle: (_group_name: string, series_indices: number[]) => {
      snapshot = null
      const series = get_series()
      const indices = new Set(series_indices.filter((idx) => idx >= 0 && idx < series.length))
      const legend_ids = new Set(
        [...indices].flatMap((idx) =>
          series[idx].legend_id != null ? [series[idx].legend_id] : [],
        ),
      )
      series.forEach((srs, idx) => {
        if (srs?.legend_id != null && legend_ids.has(srs.legend_id)) indices.add(idx)
      })
      const all_visible = [...indices].every((idx) => series[idx].visible ?? true)
      commit(series, (srs, idx) => (indices.has(idx) ? all_visible : srs.visible === false))
    },
    on_double_click: (series_idx: number) => {
      const series = get_series()
      const target = series[series_idx]
      if (!target) return
      const hidden = get_hidden() ?? hidden_keys_of(series)
      const keys = keys_of(series)
      const in_sync =
        snapshot &&
        snapshot.keys.size === keys.size &&
        [...keys].every((key) => snapshot?.keys.has(key)) &&
        hidden.length === snapshot.isolated.size &&
        hidden.every((key) => snapshot?.isolated.has(key))
      const isolated = series.every(
        (srs, idx) =>
          !srs || (srs.visible !== false) === same_legend_item(target, srs, series_idx, idx),
      )
      if (isolated && in_sync && snapshot) {
        set_hidden([...snapshot.hidden])
        snapshot = null
      } else {
        snapshot = {
          hidden: in_sync && snapshot ? snapshot.hidden : hidden,
          keys,
          isolated: new Set(
            commit(series, (srs, idx) => !same_legend_item(target, srs, series_idx, idx)),
          ),
        }
      }
    },
  }
}
