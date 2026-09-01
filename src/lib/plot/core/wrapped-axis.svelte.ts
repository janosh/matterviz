import type { Vec2 } from '$lib/math'
import { is_valid_range, sync_axis_range } from './shared-axes'
import type { AxisConfig } from './types'

interface WrappedAxisOptions {
  // The wrapper's axis: data-derived defaults (label, the range it pins) with the caller's
  // axis prop spread last so the caller's settings win
  default_axis: () => AxisConfig
  // The range `default_axis` pins, so a zoom back onto it is not frozen into the caller's prop
  // (see sync_axis_range). Only read when `prop` is set.
  default_range?: () => Vec2 | undefined
  // The caller's bindable axis prop, when the wrapper relays its zooms: BandsAndDos links its
  // panels through Bands' and Dos' y_axis
  prop?: { get: () => AxisConfig; set: (axis: AxisConfig) => void }
}

// The axis config a wrapper (Bands, Dos, IrRamanSpectrum) binds to the ScatterPlot it wraps.
// The plot writes rect zooms into it and `[null, null]` on a double-click reset; the reset
// returns the axis to the wrapper's default (its k-path or padded frequency range) rather than
// the plot's auto range. With `prop`, zooms are mirrored into the caller's prop and a reset
// clears the prop's range, which a parent pinning it reads as the reset signal.
export function wrapped_axis(opts: WrappedAxisOptions) {
  const default_axis = $derived(opts.default_axis())
  // writable derived: the plot's writes land here, a new default (data, units, caller prop)
  // replaces them
  let axis = $derived(default_axis)
  $effect(() => {
    if (opts.prop) {
      const prop = opts.prop.get()
      const next = sync_axis_range(prop, axis.range, opts.default_range?.())
      if (next !== prop) opts.prop.set(next)
    }
    // identity guard: a default that itself carries an invalid range must not be re-assigned
    // forever
    if (axis !== default_axis && !is_valid_range(axis.range)) axis = default_axis
  })
  return {
    get value(): AxisConfig {
      return axis
    },
    set value(next: AxisConfig) {
      axis = next
    },
  }
}
