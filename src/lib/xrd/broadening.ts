// Bragg-angle instrumental broadening. The convolution itself is domain-neutral and lives in
// #lib/lineshape; only the Caglioti width model below is specific to degrees of 2θ.
import { broaden_peaks } from '#lib/lineshape.js'
import { to_radians, type Vec2 } from '#lib/math.js'
import type { XrdPattern } from './index'

// Caglioti U, V, W plus the pseudo-Voigt mixing shape_factor (0 = Gaussian, 1 = Lorentzian)
export type BroadeningParams = { U: number; V: number; W: number; shape_factor: number }

export const DEFAULT_BROADENING: BroadeningParams = {
  U: 0.04,
  V: -0.02,
  W: 0.02,
  shape_factor: 0.5,
}

// Caglioti FWHM² = U·tan²θ + V·tanθ + W, in degrees 2θ. Throws on a non-positive radicand:
// flooring it gave a FWHM far under the grid step, dumping a whole peak on one grid point.
export function caglioti_fwhm(
  two_theta: number,
  coeff_u: number,
  coeff_v: number,
  coeff_w: number,
): number {
  const tan_theta = Math.tan(to_radians(two_theta / 2))
  const radicand = coeff_u * tan_theta ** 2 + coeff_v * tan_theta + coeff_w
  if (!(radicand > 0)) {
    throw new Error(
      `Caglioti FWHM² = U·tan²θ + V·tanθ + W is ${radicand} at 2θ = ${two_theta}° ` +
        `(U=${coeff_u}, V=${coeff_v}, W=${coeff_w}). Widths must be real and positive; raise W or U.`,
    )
  }
  return Math.sqrt(radicand)
}

// Broaden discrete peaks with Caglioti angle-dependent widths
export const compute_broadened_pattern = (
  pattern: XrdPattern,
  params: BroadeningParams,
  range: Vec2, // [min, max] in degrees
  step_size: number = 0.02, // degrees
): XrdPattern =>
  broaden_peaks(
    pattern,
    (peak_center) => caglioti_fwhm(peak_center, params.U, params.V, params.W),
    params.shape_factor,
    range,
    step_size,
  )
