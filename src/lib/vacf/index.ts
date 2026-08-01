import type { WindowOptions, WindowType } from '$lib/fft'
import type { Pbc } from '$lib/structure'
import type { TrajectoryPositionStream } from '$lib/trajectory'

export { compute_vacf_async } from './async-compute.svelte'
export * from './calc-vacf'
export * from './collect'
export { default as TrajectoryVacfPane } from './TrajectoryVacfPane.svelte'
export { default as VacfPlot } from './VacfPlot.svelte'

// VACF consumes a whole-trajectory position sweep plus, when the file stored them, a
// parallel velocity buffer. Same flat frame-major layout as `positions` so both can be
// transferred (not cloned) into a worker: velocities[(frame * n_atoms + atom) * 3 + axis].
export type VacfInput = TrajectoryPositionStream & {
  // Null / absent means the file carried no velocities and they must be differentiated
  // out of the positions. Length must be exactly n_frames * n_atoms * 3.
  velocities?: Float64Array | null
  // Velocity unit as written by the parser, e.g. `Å/fs` for extXYZ or `Å/ps` for a
  // LAMMPS metal-units dump. Only used to label axes; no conversion is applied.
  velocity_unit?: string | null
}

// Where the velocities analysed came from.
// - `stored`: read straight off the file (`VacfInput.velocities`)
// - `central_difference`: (r(t+1) - r(t-1)) / (2 dt) of the unwrapped positions
export type VelocitySource = `stored` | `central_difference`

// Frequency axes the VDOS can be reported on. `1/frame` is the honest answer when no
// timestep was supplied — see the no-dt discussion on `VacfOptions.dt`. Named apart from
// $lib/spectral's FREQUENCY_UNITS, which lists the phonon-DOS units (eV, meV, Ha) that a
// classical MD spectrum has no business reporting.
export const VACF_FREQUENCY_UNITS = [`THz`, `cm^-1`, `1/frame`] as const
export type VacfFrequencyUnit = (typeof VACF_FREQUENCY_UNITS)[number]

// Time units whose inverse is expressible in THz. A dt in anything else can still drive
// the lag axis, but asking for a THz / cm^-1 VDOS on top of it throws.
export const TIME_UNIT_TO_THZ: Record<string, number> = { fs: 1000, ps: 1, ns: 0.001 }

export interface VdosOptions {
  // Hann by default: it reaches exactly zero with zero slope at the truncation lag, so
  // the mirrored (even) signal stays C1-continuous and sidelobes fall off as f^-3 instead
  // of the rectangular window's f^-1. A raw truncated VACF rings hard enough to bury real
  // low-frequency structure. `gaussian` trades a wider main lobe for even lower sidelobes;
  // `none` is there to see the ringing the window suppresses.
  window?: WindowType
  window_options?: WindowOptions
  // Zero-pad the mirrored VACF to `zero_pad_factor * 2 * n_lags` (rounded up to a power of
  // two) before transforming. Padding only interpolates the spectrum — it buys a finer
  // frequency grid, not resolution.
  zero_pad_factor?: number
  // Defaults to `THz` when a dt with a THz-convertible time_unit was supplied, else
  // `1/frame`. Explicitly asking for THz / cm^-1 without such a dt throws.
  frequency_unit?: VacfFrequencyUnit
  // Skip the transform entirely (the pane does this while only the VACF is on screen)
  skip?: boolean
}

export interface VacfOptions {
  // Time per collected frame. Left unset the lag axis is labelled in frames and the VDOS
  // axis in inverse frames, because nothing in TrajectoryType records a timestep.
  dt?: number
  // Mandatory whenever dt is given (e.g. `fs`, `ps`), same rule as calc_msd
  time_unit?: string
  // Largest lag as a fraction of the velocity series length. 0.5 by default: beyond that
  // there are too few time origins left for the average to mean anything.
  max_lag_fraction?: number
  // Cap on the number of distinct lags before lag sub-sampling kicks in. Sub-sampling lags
  // lowers the VDOS Nyquist frequency (see `lag_stride` in VacfResult), so this default is
  // far higher than calc_msd's 200.
  max_lags?: number
  lag_stride?: number
  // Sub-sample time origins. Omit to auto-tune against `work_budget`.
  origin_stride?: number
  work_budget?: number
  pbc?: Pbc
  // Skip the unwrap pass before differentiating (set automatically when the source
  // already stores unwrapped coordinates). Ignored when velocities are read off the file.
  skip_unwrap?: boolean
  // `auto` (default) prefers stored velocities and differentiates only when there are
  // none. `stored` throws when the input carries no velocities instead of silently
  // switching method; `central_difference` ignores stored velocities.
  velocity_source?: VelocitySource | `auto`
  vdos?: VdosOptions
}

export interface VacfCurve {
  // `Total` for the all-atom curve, otherwise the element symbol
  label: string
  n_atoms: number
  // <v(t0 + lag) . v(t0)> averaged over atoms and time origins, in (velocity_unit)^2.
  // Entry 0 is the lag-0 value, i.e. the mean squared speed.
  vacf: number[]
  // vacf divided by vacf[0]; exactly 1 at lag 0 unless every atom is at rest
  vacf_normalized: number[]
  // Standard error of the mean of `vacf` over (overlapping, hence correlated) time
  // origins, so a lower bound on the true uncertainty
  std_error: number[]
  // Number of time origins averaged at each lag (decreases with lag)
  n_origins: number[]
  // Power spectrum of the windowed NORMALIZED VACF, one entry per frequency. Empty when
  // the VDOS was skipped. Normalizing per curve makes the element spectra comparable in
  // shape, at the cost of the total no longer being their atom-weighted sum — read the
  // per-element weights off `vacf[0]` if you need to recombine them.
  vdos: number[]
  // Frequency of the largest VDOS entry, in VacfResult.frequency_unit. Null when skipped.
  peak_frequency: number | null
}

export interface VacfResult {
  // Lags in frames of the velocity series (which is 2 frames shorter than the collected
  // position series when velocities came from central differences)
  lags: number[]
  // lags * dt — identical to `lags` when no dt was supplied
  times: number[]
  curves: VacfCurve[]
  dt: number
  // `frame` when no dt was supplied
  time_unit: string
  x_label: string
  // Frequency grid of the VDOS, in `frequency_unit`. Empty when the VDOS was skipped.
  frequencies: number[]
  frequency_unit: VacfFrequencyUnit
  frequency_label: string
  // Window applied to the VACF before transforming, and the transform length used
  window: WindowType
  n_fft: number
  velocity_source: VelocitySource
  // Units of the raw (un-normalized) VACF, e.g. `(Å/ps)^2`
  velocity_unit: string
  // Frames in the velocity series that was analysed
  n_frames: number
  n_atoms: number
  // True when positions were unwrapped across periodic images before differentiating.
  // Always false for stored velocities, which need no unwrapping.
  unwrapped: boolean
  lag_stride: number
  origin_stride: number
  // Every `frame_stride`-th source frame was collected (carried through from the input)
  frame_stride: number
}
