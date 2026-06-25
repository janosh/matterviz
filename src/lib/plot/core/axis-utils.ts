// Shared utilities for interactive axis functionality

import { to_error } from '$lib/utils'
import type {
  AxisConfig,
  AxisLoadError,
  BarSeries,
  DataLoaderFn,
  DataSeries,
} from '$lib/plot/core/types'

// Shared axis defaults across plot components (single source of truth)
export const AXIS_DEFAULTS = {
  format: ``,
  scale_type: `linear` as const,
  ticks: 5,
  label_shift: { x: 0, y: 0 },
  tick: { label: { shift: { x: 0, y: 0 }, inside: false } },
  range: [null, null] as [number | null, number | null],
}

type AxisType = `x` | `x2` | `y` | `y2`

// Merge new series with preserved UI state from old series.
// Matches by stable id first, then by index only for ordered id-less series.
export function merge_series_state<T extends DataSeries | BarSeries>(
  old_series: T[],
  new_series: T[],
): T[] {
  // Build id lookup map for O(1) matching (string or number ids)
  const by_id = new Map<string | number, T>()
  for (const srs of old_series) {
    if (srs.id !== undefined && srs.id !== ``) by_id.set(srs.id, srs)
  }

  return new_series.map((new_srs, idx) => {
    const old_srs =
      new_srs.id !== undefined && new_srs.id !== `` ? by_id.get(new_srs.id) : old_series[idx]
    if (!old_srs) {
      return new_srs
    }

    // Preserve UI state: visibility and styling from old series if not in new
    const result: Record<string, unknown> = { ...new_srs }
    result.visible ??= old_srs.visible

    // Preserve style properties only when key exists in BOTH series (guards against
    // cross-type injection when T is a union like DataSeries | BarSeries)
    for (const key of [`point_style`, `line_style`, `color`]) {
      if (key in old_srs && key in new_srs && result[key] === undefined) {
        result[key] = old_srs[key as keyof typeof old_srs]
      }
    }
    return result as T
  })
}

// Read/write accessors a plot supplies so the shared axis-change logic can drive its reactive
// state. Each axis has independent get/set so a plot may read a merged $derived but write the raw
// $bindable prop (e.g. BarPlot's secondary axes) without pushing library defaults into bound state.
export interface AxisChangeState<T extends DataSeries | BarSeries> {
  axes: Record<AxisType, { get: () => AxisConfig; set: (config: AxisConfig) => void }>
  series: { get: () => T[]; set: (series: T[]) => void }
  loading: { get: () => AxisType | null; set: (axis: AxisType | null) => void }
}

// Axis-change loader: `handle_axis_change` loads new data for an axis property change via the
// data_loader (reading `get_props` fresh each call so callbacks stay current), and `try_auto_load`
// loads the first axis option once when series start empty. Reads state through getters so a
// component `$effect(try_auto_load)` tracks them reactively.
export function create_axis_loader<T extends DataSeries | BarSeries>(
  state: AxisChangeState<T>,
  get_props: () => {
    data_loader?: DataLoaderFn<Record<string, unknown>, T>
    on_axis_change?: (axis: AxisType, key: string, new_series: T[]) => void
    on_error?: (error: AxisLoadError) => void
  },
) {
  let auto_load_attempted = false // prevent infinite retries on failure

  // No-op when already loading, or when the key is unchanged and series are already present
  const handle_axis_change = async (axis: AxisType, key: string) => {
    const { data_loader, on_axis_change, on_error } = get_props()
    if (!data_loader || state.loading.get()) return
    const axis_config = state.axes[axis].get()
    const prev_key = axis_config.selected_key
    if (prev_key === key && state.series.get().length > 0) return

    state.axes[axis].set({ ...axis_config, selected_key: key }) // immediate UI feedback
    state.loading.set(axis)
    let merged: T[] = state.series.get()
    let load_error: AxisLoadError | undefined
    try {
      const result = await data_loader(axis, key, state.series.get())
      merged = merge_series_state(state.series.get(), result.series)
      state.series.set(merged)
      // !== undefined (not truthiness) so a loader can intentionally clear a label/unit to ``
      if (result.axis_label !== undefined || result.axis_unit !== undefined) {
        const current = state.axes[axis].get()
        state.axes[axis].set({
          ...current,
          label: result.axis_label ?? current.label,
          unit: result.axis_unit ?? current.unit,
        })
      }
    } catch (err) {
      console.error(`Failed to load data for ${axis}=${key}:`, err)
      state.axes[axis].set(axis_config) // revert every axis field mutated above, not just selected_key
      load_error = { axis, key, message: to_error(err).message }
    } finally {
      state.loading.set(null) // always clears, even if a consumer callback below throws
    }
    // callbacks run only after internal state is fully settled, so a throwing consumer callback
    // can neither leave `loading` stuck nor trigger the loader rollback
    if (load_error) {
      on_error?.(load_error)
      return
    }
    on_axis_change?.(axis, key, merged)
  }

  // Auto-load once if series is empty but options exist (x-axis first, then y)
  const try_auto_load = () => {
    if (state.series.get().length > 0 || !get_props().data_loader || auto_load_attempted)
      return
    for (const axis of [`x`, `y`] as const) {
      const config = state.axes[axis].get()
      if (config.options?.length) {
        auto_load_attempted = true
        handle_axis_change(axis, config.selected_key ?? config.options[0].key).catch(() => {})
        return
      }
    }
  }
  return { handle_axis_change, try_auto_load }
}

// Constants for axis label foreignObject positioning (all values in px)
// Use minimal dimensions - overflow: visible handles any dropdown expansion
export const AXIS_LABEL_CONTAINER = {
  width: 200, // container width for centering; dropdown can overflow
  height: 24, // single line height; dropdown options overflow downward
  x_offset: 100, // half of width for horizontal centering
  y_offset: 12, // half of height for vertical centering
} as const
