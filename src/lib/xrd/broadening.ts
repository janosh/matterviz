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

// Calculates the Full Width at Half Maximum (FWHM) at a given theta angle
// using the Caglioti formula: FWHM^2 = U * tan^2(theta) + V * tan(theta) + W
export function caglioti_fwhm(
  two_theta: number, // Angle in degrees (2θ)
  U: number, // Caglioti parameter U
  V: number, // Caglioti parameter V
  W: number, // Caglioti parameter W
): number { // FWHM in degrees (2θ)
  const theta_rad = (two_theta / 2) * (Math.PI / 180)
  const tan_theta = Math.tan(theta_rad)
  const fwhm_sq = U * tan_theta ** 2 + V * tan_theta + W
  // Ensure non-negative squared width
  return Math.sqrt(Math.max(1e-9, fwhm_sq))
}

// Normalized Gaussian profile. x: position, x0: peak center, fwhm: Full Width at Half Maximum
function gaussian(x: number, x0: number, fwhm: number): number { // Intensity at x
  const safe_fwhm = Math.max(fwhm, 1e-9)
  const sigma = safe_fwhm / (2 * Math.sqrt(2 * LOG_2))
  const prefactor = 1 / (sigma * Math.sqrt(2 * Math.PI))
  const exponent = -((x - x0) ** 2) / (2 * sigma ** 2)
  return prefactor * Math.exp(exponent)
}

// Normalized Lorentzian profile. x: position, x0: peak center, fwhm: Full Width at Half Maximum
function lorentzian(x: number, x0: number, fwhm: number): number { // Intensity at x
  const safe_fwhm = Math.max(fwhm, 1e-9)
  const gamma = safe_fwhm / 2
  const prefactor = 1 / (Math.PI * gamma)
  const denominator = 1 + ((x - x0) / gamma) ** 2
  return prefactor / denominator
}

// Pseudo-Voigt profile (linear combination of Gaussian and Lorentzian).
export function pseudo_voigt(
  x: number, // Position
  x0: number, // Peak center
  fwhm: number, // Full Width at Half Maximum
  eta: number, // Mixing parameter (0 = Gaussian, 1 = Lorentzian)
): number { // Intensity at x
  // Clamp eta to [0, 1]
  const safe_eta = Math.max(0, Math.min(1, eta))
  return (
    safe_eta * lorentzian(x, x0, fwhm) + (1 - safe_eta) * gaussian(x, x0, fwhm)
  )
}

// Computes a broadened XRD pattern from discrete peaks.
export function compute_broadened_pattern(
  pattern: XrdPattern, // Discrete XRD pattern (peaks)
  params: BroadeningParams, // Broadening parameters (U, V, W, shape_factor)
  range: [number, number], // Angular range [min, max] in degrees
  step_size: number = 0.02, // Step size in degrees (default 0.02)
): XrdPattern { // Continuous broadened pattern
  if (!Number.isFinite(step_size) || step_size <= 0) {
    throw new Error(`step_size must be > 0 and finite`)
  }

  const [min_angle, max_angle] = range
  if (
    !Number.isFinite(min_angle) || !Number.isFinite(max_angle) || max_angle <= min_angle
  ) {
    throw new Error(`range must be finite and max > min`)
  }

  const { U, V, W, shape_factor } = params

  // Create x grid
  const n_steps = Math.ceil((max_angle - min_angle) / step_size)
  const xs = new Float32Array(n_steps)
  const ys = new Float32Array(n_steps)

  for (let i = 0; i < n_steps; i++) {
    xs[i] = min_angle + i * step_size
  }

  const { x: peak_pos, y: peak_int } = pattern

  // Optimization: Process each peak and add to grid
  for (let p = 0; p < peak_pos.length; p++) {
    const x0 = peak_pos[p]
    const intensity = peak_int[p]

    // Skip negligible peaks
    if (intensity < 1e-5) continue
    // Skip peaks outside range (with some buffer)
    if (x0 < min_angle - 5 || x0 > max_angle + 5) continue

    const fwhm = caglioti_fwhm(x0, U, V, W)

    // Define window for calculation (e.g. +/- 10 * FWHM or fixed reasonable range)
    // Lorentzian tails are long, so we need a decent window.
    // 20 * FWHM is usually sufficient for visual purposes.
    const window = 20 * fwhm
    const start_idx = Math.max(
      0,
      Math.floor((x0 - window - min_angle) / step_size),
    )
    const end_idx = Math.min(
      n_steps - 1,
      Math.ceil((x0 + window - min_angle) / step_size),
    )

    for (let i = start_idx; i <= end_idx; i++) {
      const x = xs[i]
      ys[i] += intensity * pseudo_voigt(x, x0, fwhm, shape_factor)
    }
  }

  // Convert back to number[]
  // We don't map hkls to continuous profile points usually,
  // or we could try to map them to the nearest peak, but for now leave undefined.
  return { x: Array.from(xs), y: Array.from(ys) }
}
