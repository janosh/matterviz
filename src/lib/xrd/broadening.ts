// Bragg-angle instrumental broadening. The convolution itself is domain-neutral and lives in
// $lib/lineshape; only the Caglioti width model below is specific to degrees of 2θ.
import { broaden_peaks } from '$lib/lineshape'
import type { Vec2 } from '$lib/math'
import { to_radians } from '$lib/math'
import type { XrdPattern } from './index'

// Broadening parameters for simulated XRD pattern.
// U, V, W are Caglioti parameters.
// shape_factor (eta) is the Pseudo-Voigt mixing parameter (0 = Gaussian, 1 = Lorentzian).
export type BroadeningParams = { U: number; V: number; W: number; shape_factor: number }

export const DEFAULT_BROADENING: BroadeningParams = {
  U: 0.04,
  V: -0.02,
  W: 0.02,
  shape_factor: 0.5, // Mixed Gaussian/Lorentzian
}

// FWHM in degrees (2θ) at the Bragg angle `two_theta` (degrees) from the Caglioti formula
// FWHM^2 = U·tan^2(theta) + V·tan(theta) + W. Throws on a negative radicand: flooring it at
// 1e-9 gave a 3.16e-5 deg FWHM, far under the 0.02 deg grid step, dumping a peak's whole
// area-normalized intensity on one grid point.
export function caglioti_fwhm(two_theta: number, U: number, V: number, W: number): number {
  const tan_theta = Math.tan(to_radians(two_theta / 2))
  const radicand = U * tan_theta ** 2 + V * tan_theta + W
  if (!(radicand > 0)) {
    throw new Error(
      `Caglioti FWHM² = U·tan²θ + V·tanθ + W is ${radicand} at 2θ = ${two_theta}° ` +
        `(U=${U}, V=${V}, W=${W}). Widths must be real and positive; raise W or U.`,
    )
  }
  return Math.sqrt(radicand)
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
