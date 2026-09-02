// Peak-shape convolution: turning a stick spectrum into a sampled continuum. Domain-neutral
// on purpose — XRD drives it with Caglioti Bragg-angle widths in degrees 2θ (see
// $lib/xrd/broadening) and IR/Raman with constant or frequency-dependent widths in cm^-1
// (see $lib/spectral/ir-raman), so nothing here may assume either scale.
import type { Vec2 } from '$lib/math'

// Gaussian sigma per unit FWHM: fwhm = 2 sqrt(2 ln 2) sigma
const SIGMA_PER_FWHM = 1 / (2 * Math.sqrt(2 * Math.log(2)))

// Parallel x/y arrays: discrete peaks on the way in, a sampled curve on the way out.
type PeakCurve = { x: number[]; y: number[] }

// Accumulates pseudo-Voigt peaks onto a uniform grid, with the FWHM model supplied by the
// caller. Unit-agnostic: the faint-peak cut is a fraction of the tallest peak and the reach
// test uses each peak's own width, so callers need not adapt either to their x or intensity
// scale. Line shapes are area-normalized, so each peak's integrated intensity survives (bar
// the +/-20 FWHM truncation and grid discretisation).
export function broaden_peaks(
  peaks: PeakCurve, // Discrete peak positions and intensities
  fwhm_fn: (peak_center: number) => number, // FWHM model evaluated at each peak center
  shape_factor: number, // Pseudo-Voigt mixing parameter (0 = Gaussian, 1 = Lorentzian)
  range: Vec2, // [min, max] in the peaks' x units
  step_size: number, // Grid step in the peaks' x units
): PeakCurve {
  if (!Number.isFinite(step_size) || step_size <= 0) {
    throw new Error(`step_size must be > 0 and finite, got ${step_size}`)
  }
  // Out-of-range eta is a caller bug, not something to clamp: a NaN would silently turn the
  // whole curve NaN and an eta of 1.2 would dip the Gaussian share negative
  if (!(shape_factor >= 0 && shape_factor <= 1)) {
    throw new Error(`shape_factor must be in [0, 1], got ${shape_factor}`)
  }

  const [min_x, max_x] = range
  if (!Number.isFinite(min_x) || !Number.isFinite(max_x) || max_x <= min_x) {
    throw new Error(`range must be finite and max > min`)
  }
  // Ragged input is silent otherwise: a short y makes every grid point NaN, and a long one
  // lets the intensity floor be set by a peak that has no position and so never renders,
  // erasing the real ones
  if (peaks.x.length !== peaks.y.length) {
    throw new Error(`peaks have ${peaks.x.length} positions but ${peaks.y.length} intensities`)
  }

  // +1 samples max_x itself; ceil() stopped a full step short on evenly dividing spans
  // ([10, 90] at 0.02 ended at 89.98). Uneven spans are unaffected, floor+1 and ceil agree.
  const n_steps = Math.floor((max_x - min_x) / step_size) + 1
  // f64, not f32: at cm^-1 values in the thousands f32 resolves to ~2.4e-4, which shows up
  // as grid-dependent noise whenever the same peaks are broadened over two different spans
  const xs = new Float64Array(n_steps)
  const ys = new Float64Array(n_steps)
  for (let idx = 0; idx < n_steps; idx++) xs[idx] = min_x + idx * step_size

  const { x: peak_pos, y: peak_int } = peaks

  // Relative to the tallest peak, not absolute: e^2/amu IR intensities can sit entirely
  // below any fixed cut. Taken over the whole input rather than the part inside `range`, so
  // the cut does not shift when the caller narrows the window. Looped, not spread: a
  // supercell pattern carries thousands of reflections.
  let tallest = 0
  for (const intensity of peak_int) {
    // Both are silent otherwise: one NaN makes every grid point NaN, and one Infinity puts
    // the floor at Infinity, dropping every real peak for an empty curve
    if (!Number.isFinite(intensity)) {
      throw new TypeError(`peak intensities must be finite, got ${intensity}`)
    }
    if (intensity > tallest) tallest = intensity
  }
  const intensity_floor = 1e-5 * tallest

  for (let peak_idx = 0; peak_idx < peak_pos.length; peak_idx++) {
    const x0 = peak_pos[peak_idx]
    const intensity = peak_int[peak_idx]

    // <=, not <: an all-zero pattern puts the floor at 0, and a strict < would then walk
    // every peak's full window accumulating zeros (measured 597ms for 5000 peaks on a
    // 5000-point grid, against 0.3ms). Dropping a peak sitting exactly on the floor is
    // immaterial — it is 1e-5 of the tallest.
    if (intensity <= intensity_floor) continue

    const fwhm = fwhm_fn(x0)
    // The width gates the skip test below, not just the profile, so an unusable one would
    // silently drop the peak (negative) or contribute nothing (0, NaN, Infinity) instead of
    // failing. step_size and range are validated the same way above.
    if (!Number.isFinite(fwhm) || fwhm <= 0) {
      throw new Error(`fwhm_fn must return > 0 and finite, got ${fwhm} at peak ${x0}`)
    }
    // Lorentzian tails are long, so a narrow window truncates them visibly; 20 * FWHM is
    // wide enough that the residual is below plotting resolution. Deliberately NOT bounded
    // by the grid span: start_idx/end_idx below are already clamped, so even a diverging
    // fwhm_fn costs only one pass, while a span-derived window makes the same peaks broaden
    // to different values depending on how much of them the caller asked to plot.
    const window = 20 * fwhm
    // Skip peaks whose tails cannot reach the grid. The margin is the peak's own window, not
    // a fixed number of x-units: cm^-1 spectra run FWHM of tens, where an off-grid peak
    // still contributes visibly.
    if (x0 + window < min_x || x0 - window > max_x) continue
    const start_idx = Math.max(0, Math.floor((x0 - window - min_x) / step_size))
    const end_idx = Math.min(n_steps - 1, Math.ceil((x0 + window - min_x) / step_size))

    // Area-normalized pseudo-Voigt: shape_factor mixes Lorentzian (1) into Gaussian (0).
    // Per-peak constants hoisted out of the grid loop.
    const sigma = fwhm * SIGMA_PER_FWHM
    const gauss_prefactor = (1 - shape_factor) / (sigma * Math.sqrt(2 * Math.PI))
    const gauss_exponent = -1 / (2 * sigma * sigma)
    const gamma = fwhm / 2
    const lorentz_prefactor = shape_factor / (Math.PI * gamma)
    const inv_gamma_sq = 1 / (gamma * gamma)
    for (let idx = start_idx; idx <= end_idx; idx++) {
      const offset_sq = (xs[idx] - x0) ** 2
      ys[idx] +=
        intensity *
        (gauss_prefactor * Math.exp(gauss_exponent * offset_sq) +
          lorentz_prefactor / (1 + offset_sq * inv_gamma_sq))
    }
  }

  // Only x/y come back: a continuous profile has no single reflection (or mode) per grid
  // point, so any per-peak labelling the caller attached does not survive
  return { x: Array.from(xs), y: Array.from(ys) }
}
