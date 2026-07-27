import type { Vec2 } from '$lib/math'
import { clamp01 } from '$lib/utils'
import type { XrdPattern } from './index'

const LOG_2 = Math.log(2)

// Broadening parameters for simulated XRD pattern.
// U, V, W are Caglioti parameters.
// shape_factor (eta) is the Pseudo-Voigt mixing parameter (0 = Gaussian, 1 = Lorentzian).
export type BroadeningParams = {
  U: number
  V: number
  W: number
  shape_factor: number
}

export const DEFAULT_BROADENING: BroadeningParams = {
  U: 0.04,
  V: -0.02,
  W: 0.02,
  shape_factor: 0.5, // Mixed Gaussian/Lorentzian
}

// FWHM in degrees (2θ) at the Bragg angle `two_theta` (degrees) from the Caglioti formula
// FWHM^2 = U·tan^2(theta) + V·tan(theta) + W, floored to keep the square root real.
export function caglioti_fwhm(two_theta: number, U: number, V: number, W: number): number {
  const tan_theta = Math.tan((two_theta / 2) * (Math.PI / 180))
  return Math.sqrt(Math.max(1e-9, U * tan_theta ** 2 + V * tan_theta + W))
}

// Area-normalized Gaussian of width `fwhm` centered on `x0`, evaluated at `x`
const gaussian = (x: number, x0: number, fwhm: number): number => {
  const sigma = Math.max(fwhm, 1e-9) / (2 * Math.sqrt(2 * LOG_2))
  const prefactor = 1 / (sigma * Math.sqrt(2 * Math.PI))
  return prefactor * Math.exp(-((x - x0) ** 2) / (2 * sigma ** 2))
}

// Area-normalized Lorentzian of width `fwhm` centered on `x0`, evaluated at `x`
const lorentzian = (x: number, x0: number, fwhm: number): number => {
  const gamma = Math.max(fwhm, 1e-9) / 2
  return 1 / (Math.PI * gamma) / (1 + ((x - x0) / gamma) ** 2)
}

// Pseudo-Voigt profile: `eta` mixes Lorentzian (1) into Gaussian (0), clamped to [0, 1].
export function pseudo_voigt(x: number, x0: number, fwhm: number, eta: number): number {
  const safe_eta = clamp01(eta)
  return safe_eta * lorentzian(x, x0, fwhm) + (1 - safe_eta) * gaussian(x, x0, fwhm)
}

// Accumulates pseudo-Voigt peaks onto a uniform grid, with the FWHM model supplied by the
// caller. Bragg-angle broadening (Caglioti) is only one such model — vibrational spectra need
// constant or frequency-dependent widths, for which the Caglioti formula is meaningless.
// Unit-agnostic: the faint-peak cut is a fraction of the tallest peak and the reach test
// uses each peak's own width, so callers need not adapt either to their x or intensity scale.
export function broaden_peaks(
  pattern: XrdPattern, // Discrete peaks
  fwhm_fn: (peak_center: number) => number, // FWHM model evaluated at each peak center
  shape_factor: number, // Pseudo-Voigt mixing parameter (0 = Gaussian, 1 = Lorentzian)
  range: Vec2, // [min, max] in the pattern's x units
  step_size: number = 0.02, // Grid step in the pattern's x units
): XrdPattern {
  if (!Number.isFinite(step_size) || step_size <= 0) {
    throw new Error(`step_size must be > 0 and finite`)
  }

  const [min_angle, max_angle] = range
  if (!Number.isFinite(min_angle) || !Number.isFinite(max_angle) || max_angle <= min_angle) {
    throw new Error(`range must be finite and max > min`)
  }
  // Ragged input is silent otherwise: a short y makes every grid point NaN, and a long one
  // lets the intensity floor be set by a peak that has no position and so never renders,
  // erasing the real ones
  if (pattern.x.length !== pattern.y.length) {
    throw new Error(
      `pattern has ${pattern.x.length} positions but ${pattern.y.length} intensities`,
    )
  }

  const n_steps = Math.ceil((max_angle - min_angle) / step_size)
  // f64, not f32: at cm^-1 values in the thousands f32 resolves to ~2.4e-4, which shows up
  // as grid-dependent noise whenever the same sticks are broadened over two different spans
  const xs = new Float64Array(n_steps)
  const ys = new Float64Array(n_steps)
  for (let idx = 0; idx < n_steps; idx++) xs[idx] = min_angle + idx * step_size

  const { x: peak_pos, y: peak_int } = pattern

  // Relative to the tallest peak, not absolute: e^2/amu IR intensities can sit entirely
  // below any fixed cut. Taken over the whole input rather than the part inside `range`, so
  // the cut does not shift when the caller narrows the window. Looped, not spread: a
  // supercell pattern carries thousands of reflections.
  let tallest = 0
  for (const intensity of peak_int) {
    // Both are silent otherwise: one NaN makes every grid point NaN, and one Infinity puts
    // the floor at Infinity, dropping every real peak for an empty curve
    if (!Number.isFinite(intensity)) {
      throw new TypeError(`pattern intensities must be finite, got ${intensity}`)
    }
    if (intensity > tallest) tallest = intensity
  }
  const intensity_floor = 1e-5 * tallest

  for (let peak_idx = 0; peak_idx < peak_pos.length; peak_idx++) {
    const x0 = peak_pos[peak_idx]
    const intensity = peak_int[peak_idx]

    // <=, not <: an all-zero pattern puts the floor at 0, and a strict < would then walk
    // every peak's full window accumulating zeros (measured 597ms for 5000 sticks on a
    // 5000-point grid, against 0.3ms). Dropping a peak sitting exactly on the floor is
    // immaterial — it is 1e-5 of the tallest.
    if (intensity <= intensity_floor) continue

    const fwhm = fwhm_fn(x0)
    // The width now gates the skip test below, not just the profile, so an unusable one
    // silently drops the peak (negative) or contributes nothing (0, NaN, Infinity) instead
    // of failing. step_size and range are validated the same way above.
    if (!Number.isFinite(fwhm) || fwhm <= 0) {
      throw new Error(`fwhm_fn must return > 0 and finite, got ${fwhm} at peak ${x0}`)
    }
    // Lorentzian tails are long, so a narrow window truncates them visibly; 20 * FWHM is
    // wide enough that the residual is below plotting resolution. Deliberately NOT bounded
    // by the grid span: start_idx/end_idx below are already clamped, so even a diverging
    // fwhm_fn costs only one pass, while a span-derived window makes the same sticks
    // broaden to different values depending on how much of them the caller asked to plot.
    const window = 20 * fwhm
    // Skip peaks whose tails cannot reach the grid. The margin is the peak's own window, not
    // a fixed number of x-units: cm^-1 spectra run FWHM of tens, where an off-grid peak
    // still contributes visibly.
    if (x0 + window < min_angle || x0 - window > max_angle) continue
    const start_idx = Math.max(0, Math.floor((x0 - window - min_angle) / step_size))
    const end_idx = Math.min(n_steps - 1, Math.ceil((x0 + window - min_angle) / step_size))

    for (let idx = start_idx; idx <= end_idx; idx++) {
      ys[idx] += intensity * pseudo_voigt(xs[idx], x0, fwhm, shape_factor)
    }
  }

  // hkls are dropped: a continuous profile has no single reflection per grid point
  return { x: Array.from(xs), y: Array.from(ys) }
}

// Computes a broadened XRD pattern from discrete peaks, using Caglioti angle-dependent widths.
export const compute_broadened_pattern = (
  pattern: XrdPattern,
  params: BroadeningParams,
  range: Vec2, // Angular range [min, max] in degrees
  step_size: number = 0.02, // Step size in degrees
): XrdPattern =>
  broaden_peaks(
    pattern,
    (peak_center) => caglioti_fwhm(peak_center, params.U, params.V, params.W),
    params.shape_factor,
    range,
    step_size,
  )
