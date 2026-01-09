// Shared utilities for interactive axis functionality

import type {
  AxisConfig,
  AxisLoadError,
  BarSeries,
  DataLoaderFn,
  DataLoaderResult,
  DataSeries,
} from './types'

type AxisType = `x` | `y` | `y2`

// Merge new series with preserved UI state from old series
// Matches by id first (string or number), then falls back to index
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
    // Match by id if available (string or number), otherwise fall back to index
    const old_srs = (new_srs.id !== undefined && new_srs.id !== ``
      ? by_id.get(new_srs.id)
      : undefined) ??
      old_series[idx]
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

// State accessors for axis change handler - enables sharing logic across plot components
export interface AxisChangeState<T extends DataSeries | BarSeries> {
  get_axis: (axis: AxisType) => AxisConfig
  set_axis: (axis: AxisType, config: AxisConfig) => void
  get_series: () => T[]
  set_series: (series: T[]) => void
  get_loading: () => AxisType | null
  set_loading: (axis: AxisType | null) => void
}

// Handle axis property change - loads new data via data_loader
// Returns a function bound to the component's state accessors
export function create_axis_change_handler<T extends DataSeries | BarSeries>(
  state: AxisChangeState<T>,
  data_loader: DataLoaderFn<Record<string, unknown>, T> | undefined,
  on_axis_change?: (axis: AxisType, key: string, new_series: T[]) => void,
  on_error?: (error: AxisLoadError) => void,
): (axis: AxisType, key: string) => Promise<void> {
  return async (axis: AxisType, key: string) => {
    if (!data_loader || state.get_loading()) return

    const axis_config = state.get_axis(axis)
    const prev_key = axis_config.selected_key

    // Skip if key unchanged AND series already loaded (allows initial load when series empty)
    if (prev_key === key && state.get_series().length > 0) return

    // Update selected_key immediately for UI feedback
    state.set_axis(axis, { ...axis_config, selected_key: key })
    state.set_loading(axis)

    try {
      const result: DataLoaderResult<Record<string, unknown>, T> = await data_loader(
        axis,
        key,
        state.get_series(),
      )

      // Merge new series with preserved state from old series
      const merged = merge_series_state(state.get_series(), result.series)
      state.set_series(merged)

      // Update axis label/unit if provided
      if (result.axis_label || result.axis_unit) {
        const current = state.get_axis(axis)
        state.set_axis(axis, {
          ...current,
          label: result.axis_label ?? current.label,
          unit: result.axis_unit ?? current.unit,
        })
      }

      on_axis_change?.(axis, key, merged)
    } catch (err) {
      console.error(`Failed to load data for ${axis}=${key}:`, err)

      // Revert selection
      state.set_axis(axis, { ...state.get_axis(axis), selected_key: prev_key })

      const message = err instanceof Error ? err.message : String(err)
      on_error?.({ axis, key, message })
    } finally {
      state.set_loading(null)
    }
  }
}

// Constants for axis label foreignObject positioning (all values in px)
// Use minimal dimensions - overflow: visible handles any dropdown expansion
export const AXIS_LABEL_CONTAINER = {
  width: 200, // container width for centering; dropdown can overflow
  height: 24, // single line height; dropdown options overflow downward
  x_offset: 100, // half of width for horizontal centering
  y_offset: 12, // half of height for vertical centering
} as const
