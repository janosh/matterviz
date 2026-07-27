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

  const n_steps = Math.ceil((max_angle - min_angle) / step_size)
  const xs = new Float32Array(n_steps)
  const ys = new Float32Array(n_steps)
  for (let idx = 0; idx < n_steps; idx++) xs[idx] = min_angle + idx * step_size

  const { x: peak_pos, y: peak_int } = pattern

  for (let peak_idx = 0; peak_idx < peak_pos.length; peak_idx++) {
    const x0 = peak_pos[peak_idx]
    const intensity = peak_int[peak_idx]

    // Skip peaks too faint to register
    if (intensity < 1e-5) continue

    const fwhm = fwhm_fn(x0)
    // The width now gates the skip test below, not just the profile, so an unusable one
    // silently drops the peak (negative) or contributes nothing (0, NaN, Infinity) instead
    // of failing. step_size and range are validated the same way above.
    if (!Number.isFinite(fwhm) || fwhm <= 0) {
      throw new Error(`fwhm_fn must return > 0 and finite, got ${fwhm} at peak ${x0}`)
    }
    // Lorentzian tails are long, so a narrow window truncates them visibly; 20 * FWHM is
    // wide enough that the residual is below plotting resolution.
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
