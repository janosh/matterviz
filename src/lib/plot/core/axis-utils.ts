// Shared utilities for interactive axis functionality

import { AXIS_TITLE_OFFSET } from '$lib/plot/core/layout'
import type { AxisConfig, AxisKey, AxisLoader } from '$lib/plot/core/types'

// Shared axis defaults across plot components (single source of truth)
export const AXIS_DEFAULTS = {
  format: ``,
  scale_type: `linear` as const,
  ticks: 5,
  label_shift: { x: 0, y: 0 },
  tick_label: { shift: { x: 0, y: 0 }, inside: false },
  range: [null, null] as [number | null, number | null],
}
// The top (x2) axis title sits above the top edge by the tick-label band
export const X2_AXIS_DEFAULTS = {
  ...AXIS_DEFAULTS,
  label_shift: { x: 0, y: AXIS_TITLE_OFFSET },
}

// Secondary-axis configs with library defaults merged in. Returned rather than assigned back
// into the $bindable props, which would push library defaults into the parent's bound state.
export const merge_secondary_axes = (
  y2_axis: AxisConfig | undefined,
  x2_axis: AxisConfig | undefined,
): { y2: AxisConfig; x2: AxisConfig } => ({
  y2: { ...AXIS_DEFAULTS, ...y2_axis },
  x2: { ...X2_AXIS_DEFAULTS, ...x2_axis },
})

// Tick labels of a categorical axis (slot index -> category name). A user-supplied label
// mapping (a Record) wins; a tick count or tick positions don't apply to category slots
// and are ignored. Undefined without categories so the axis falls back to generated ticks.
export const category_tick_labels = (
  categories: readonly string[],
  user_ticks: AxisConfig[`ticks`],
): AxisConfig[`ticks`] => {
  if (categories.length === 0) return undefined
  if (user_ticks != null && typeof user_ticks === `object` && !Array.isArray(user_ticks)) {
    return user_ticks
  }
  return Object.fromEntries(categories.map((cat, idx) => [idx, cat]))
}

// Caller-owned async loading. Superseded or cancelled loads return undefined, even when
// the loader ignores its AbortSignal. Axes load independently; cancel() aborts all of them.
export function create_axis_loader<Result>(loader: AxisLoader<Result>) {
  const active = new Map<AxisKey, AbortController>()
  return {
    cancel: () => {
      const previous = [...active.values()]
      active.clear()
      for (const controller of previous) controller.abort()
    },
    load: async (axis: AxisKey, key: string): Promise<Result | undefined> => {
      const previous = active.get(axis)
      const controller = new AbortController()
      active.set(axis, controller)
      previous?.abort()
      try {
        if (controller.signal.aborted) return undefined
        const result = await loader(axis, key, controller.signal)
        return controller.signal.aborted ? undefined : result
      } catch (error) {
        if (!controller.signal.aborted) throw error
        return undefined
      } finally {
        if (active.get(axis) === controller) active.delete(axis)
      }
    },
  }
}
