// Side-by-side plots (bands + DOS) that share a frequency / energy axis: one y_axis config per
// panel and the live view of each, linked so a zoom in either panel moves the other while a
// reset returns both to the shared range.
import type { Sides } from '$lib/plot/core/layout'
import type { Vec2 } from '$lib/math'
import { vec2_equal } from '$lib/plot/core/interactions'
import { axis_with_range, max_side_padding } from '$lib/plot/core/shared-axes'
import type { AxisConfig, AxisRanges } from '$lib/plot/core/types'
import { compute_frequency_range, extract_efermi } from './helpers'

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
// data range both span, the Fermi level, a y_axis config per panel, the two panels' live views
// linked on y, and the vertical padding that keeps their y scales pixel-aligned (BandsAndDos,
// BrillouinBandsDos).
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
  const y_axes = $derived<AxisConfig[]>([
    axis_with_range(inputs.bands_y_axis(), shared_range),
    inputs.side_by_side()
      ? axis_with_range({ label: ``, ...inputs.dos_y_axis() }, shared_range)
      : { ...inputs.dos_y_axis() },
  ])
  // Each panel's `view` (bind:view). Side by side both y axes carry the frequency, so the
  // panel whose y view moved since the last agreed range leads and the other follows; a
  // reset in one panel shows up as a move back to the shared range and resets the other too.
  // Until the panels agree on a zoom (mount, link re-enabled) the shared range is the
  // baseline, so a panel left zoomed while the link was off leads once it is back on.
  const views = $state<(Partial<AxisRanges> | undefined)[]>([undefined, undefined])
  let synced_y: Vec2 | undefined
  $effect(() => {
    if (!inputs.sync_zoom() || !inputs.side_by_side() || !shared_range) {
      synced_y = undefined
      return
    }
    const baseline = synced_y ?? shared_range
    const panel_y = views.map((view) => view?.y)
    const lead = panel_y.find((range) => range && !vec2_equal(range, baseline))
    if (!lead) return
    synced_y = [...lead]
    for (const [idx, range] of panel_y.entries()) {
      if (!range || !vec2_equal(range, lead)) views[idx] = { ...views[idx], y: [...lead] }
    }
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
      return y_axes
    },
    views,
    get shared_padding() {
      return shared_padding
    },
    // bind:resolved_padding setter for both panels
    raise_padding: (resolved: Required<Sides> | undefined) => floor.raise(resolved),
  }
}
