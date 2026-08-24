// Side-by-side plots (bands + DOS) that share a frequency / energy axis: one y_axis config per
// panel, reset whenever the data or caller axes change, and linked so a zoom in either panel
// moves the other while a reset returns both to the shared range.
import type { Sides } from '$lib/plot/core/layout'
import type { Vec2 } from '$lib/math'
import { reconcile_shared_axis_ranges } from '$lib/plot/core/shared-axes'
import type { AxisConfig } from '$lib/plot/core/types'

interface SyncedYAxesConfig {
  // Fresh per-panel axes; re-evaluated whenever `sources` change
  default_axes: () => AxisConfig[]
  // Identity-compared inputs whose change discards the current zoom and rebuilds the axes
  sources: () => unknown[]
  // Data range both panels span; undefined disables the zoom link
  shared_range: () => Vec2 | undefined
  sync_zoom: () => boolean
  // How many leading axes take part in the zoom link (a vertical DOS puts density on y,
  // so a stacked layout only links the bands panel). Default: every axis.
  linked_count?: () => number
}

export function create_synced_y_axes(config: SyncedYAxesConfig): { y_axes: AxisConfig[] } {
  const state = $state({ y_axes: config.default_axes() })
  let synced_zoom_range: Vec2 | null = null
  // Seeded from the same sources the initial axes were built from, so the first effect run
  // is a no-op rather than a second default_axes() call
  let prev_sources = config.sources()
  $effect(() => {
    const sources = config.sources()
    if (
      sources.length === prev_sources.length &&
      sources.every((source, idx) => source === prev_sources[idx])
    ) {
      return
    }
    prev_sources = sources
    state.y_axes = config.default_axes()
    synced_zoom_range = null
  })
  // Detect zoom changes and sync between panels (runs first to capture child updates)
  $effect(() => {
    const shared_range = config.shared_range()
    if (!config.sync_zoom()) synced_zoom_range = null
    if (!config.sync_zoom() || !shared_range) return
    const linked = config.linked_count?.() ?? state.y_axes.length
    const update = reconcile_shared_axis_ranges(
      state.y_axes.slice(0, linked),
      shared_range,
      synced_zoom_range,
    )
    if (!update) return
    synced_zoom_range = update.synced_range
    state.y_axes = [...update.axes, ...state.y_axes.slice(linked)]
  })
  return state
}

// Floor for the vertical padding two side-by-side panels share. A panel that moves its
// legend/colorbar outside widens its own bottom margin, and the other panel must follow or the
// shared frequency axis drifts; the panels report what they settled on and the floor is only
// ever raised (half-pixel tolerance), so the feedback through the plot solver cannot oscillate.
export function shared_resolved_padding_floor() {
  let value = $state<Sides>({})
  return {
    get value(): Sides {
      return value
    },
    raise(resolved: Required<Sides> | undefined): void {
      if (!resolved) return
      const next = { ...value }
      let raised = false
      for (const side of [`t`, `b`] as const) {
        if (resolved[side] > (next[side] ?? 0) + 0.5) {
          next[side] = resolved[side]
          raised = true
        }
      }
      if (raised) value = next
    },
  }
}
