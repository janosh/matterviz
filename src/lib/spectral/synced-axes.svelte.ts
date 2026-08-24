// Side-by-side plots (bands + DOS) that share a frequency / energy axis: one y_axis config per
// panel, reset whenever the data or caller axes change, and linked so a zoom in either panel
// moves the other while a reset returns both to the shared range.
import type { Sides } from '$lib/plot/core/layout'
import type { Vec2 } from '$lib/math'
import {
  axis_with_range,
  max_side_padding,
  reconcile_shared_axis_ranges,
} from '$lib/plot/core/shared-axes'
import type { AxisConfig } from '$lib/plot/core/types'
import { compute_frequency_range, extract_efermi } from './helpers'

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
      const next = {
        t: Math.max(value.t ?? 0, resolved.t),
        b: Math.max(value.b ?? 0, resolved.b),
      }
      if (next.t > (value.t ?? 0) + 0.5 || next.b > (value.b ?? 0) + 0.5) value = next
    },
  }
}

interface BandsDosSyncInputs {
  band_structs: () => unknown
  doses: () => unknown
  bands_y_axis: () => AxisConfig | undefined
  dos_y_axis: () => AxisConfig | undefined
  bands_padding: () => Sides | undefined
  dos_padding: () => Sides | undefined
  // DOS horizontal beside the bands (frequency on both y axes); false stacks it below with
  // density on y, where only the bands axis takes part in the link
  side_by_side: () => boolean
  // false keeps the two frequency axes independent (no shared range, no zoom link)
  shared_axis?: () => boolean
  sync_zoom: () => boolean
  // Top/bottom padding both side-by-side panels start from
  base_padding: Sides
}

// Everything a bands panel and a DOS panel need to share one frequency / energy axis: the
// data range both span, the Fermi level, a linked y_axis config per panel and the vertical
// padding that keeps their y scales pixel-aligned (BandsAndDos, BrillouinBandsDos).
export function create_bands_dos_sync(inputs: BandsDosSyncInputs) {
  const shared = () => inputs.shared_axis?.() ?? true
  const shared_range = $derived(
    shared() ? compute_frequency_range(inputs.band_structs(), inputs.doses()) : undefined,
  )
  const fermi_level = $derived(
    extract_efermi(inputs.band_structs()) ?? extract_efermi(inputs.doses()),
  )
  // Side by side, the DOS axis label defaults to empty since the bands axis already names
  // the quantity; a caller's label still wins
  const default_axes = (): AxisConfig[] => [
    axis_with_range(inputs.bands_y_axis(), shared_range),
    inputs.side_by_side()
      ? axis_with_range({ label: ``, ...inputs.dos_y_axis() }, shared_range)
      : { ...inputs.dos_y_axis() },
  ]
  const synced = create_synced_y_axes({
    default_axes,
    // axis configs by value: callers commonly pass fresh object literals
    sources: () => [
      inputs.band_structs(),
      inputs.doses(),
      inputs.side_by_side(),
      shared(),
      JSON.stringify({ bands: inputs.bands_y_axis(), dos: inputs.dos_y_axis() }),
    ],
    shared_range: () => shared_range,
    sync_zoom: inputs.sync_zoom,
    linked_count: () => (inputs.side_by_side() ? 2 : 1),
  })
  // Side-wise maxima preserve caller padding while keeping y-scale pixel spans identical. The
  // padding each panel settled on is fed back in: a DOS legend pushed below its plot widens
  // that panel's bottom margin, which must reach the bands panel too or the shared energy
  // axis drifts. ScatterPlot stacks outside reservations on the axis pad with max(), so this
  // converges after one round instead of ratcheting.
  const floor = shared_resolved_padding_floor()
  const shared_padding = $derived(
    inputs.side_by_side()
      ? max_side_padding(
          [inputs.base_padding, inputs.bands_padding(), inputs.dos_padding(), floor.value],
          [`t`, `b`],
        )
      : {},
  )
  return {
    get shared_range() {
      return shared_range
    },
    get fermi_level() {
      return fermi_level
    },
    get y_axes() {
      return synced.y_axes
    },
    get shared_padding() {
      return shared_padding
    },
    // bind:resolved_padding setter for both panels
    raise_padding: (resolved: Required<Sides> | undefined) => floor.raise(resolved),
  }
}
