import type { CompositionType } from '$lib/composition'
import { array_max, type Vec2, type Vec3 } from '$lib/math'
import type { RadiationType } from '$lib/scattering'
import type { RadiationKey } from './calc-xrd'

export * from './broadening'
export * from './calc-xrd'
export * from './parse'
export * from './saed'
export { default as SaedPattern } from './SaedPattern.svelte'
export { default as XrdPlot } from './XrdPlot.svelte'

export type Hkl = Vec3
export type HklObj = { hkl: Hkl; multiplicity?: number }
// One enumerated reflection: Miller indices plus |g| = 1/d, hence s = sin(theta)/lambda =
// |g|/2. Cartesian g is deliberately not stored: only SAED needs it and rebuilds it from hkl.
export type RecipPoint = { hkl: Hkl; g_norm: number }
export type HklFormat = `compact` | `full` | null

// Render Miller indices in crystallographic notation.
// `compact` uses the overbar convention for negative indices (1̄ instead of -1) via the
// combining overline U+0305, which requires font support for combining characters and is
// applied to each digit so multi-digit indices like 1̄2̄ read correctly.
export function format_hkl(hkl: Hkl, format: HklFormat): string {
  if (format === `full`) return `(${hkl.join(`, `)})`
  if (format !== `compact`) return ``
  const overbar = (val: number) =>
    String(-val)
      .split(``)
      .map((digit) => `${digit}\u0305`)
      .join(``)
  return hkl.map((val) => (val < 0 ? overbar(val) : `${val}`)).join(``)
}

export type XrdPattern = { x: number[]; y: number[]; hkls?: HklObj[][]; d_hkls?: number[] }

// Thin a long measured scan to at most `max_points` for rendering: uniform sampling plus
// the strongest local maxima (up to 30% of the slots), so peaks that fall between uniform
// samples survive. Patterns at or under the budget are returned as is. Peaks count when
// they rise above 5% of the pattern maximum.
export function decimate_pattern(pattern: XrdPattern, max_points: number): XrdPattern {
  const { x: x_vals, y: y_vals } = pattern
  const num_points = x_vals.length
  if (num_points <= max_points) return pattern
  const threshold = 0.05 * array_max(y_vals)
  const peaks: number[] = []
  for (let idx = 1; idx < num_points - 1; idx++) {
    const [prev, val, next] = [y_vals[idx - 1], y_vals[idx], y_vals[idx + 1]]
    if (val > prev && val > next && val > threshold) peaks.push(idx)
  }
  const peak_slots = Math.min(peaks.length, Math.floor(max_points * 0.3))
  const uniform_slots = max_points - peak_slots
  const top_peaks = peaks
    .toSorted((idx_a, idx_b) => y_vals[idx_b] - y_vals[idx_a])
    .slice(0, peak_slots)
  const step = (num_points - 1) / Math.max(1, uniform_slots - 1)
  const uniform = Array.from({ length: uniform_slots }, (_, idx) => Math.round(idx * step))
  const selected = [...new Set([...uniform, ...top_peaks])].toSorted(
    (idx_a, idx_b) => idx_a - idx_b,
  )
  const pick = <Item>(values: Item[]): Item[] => selected.map((idx) => values[idx])
  const { hkls, d_hkls } = pattern
  return {
    x: pick(x_vals),
    y: pick(y_vals),
    ...(hkls && { hkls: pick(hkls) }),
    ...(d_hkls && { d_hkls: pick(d_hkls) }),
  }
}

export type XrdOptions = {
  wavelength?: number | RadiationKey
  // Probe particle (default `xray`). Neutron and electron patterns reuse the same geometry,
  // Debye-Waller damping, peak merging and family multiplicities — only the per-element
  // scattering amplitude and the Lorentz(-polarization) factor change.
  radiation?: RadiationType
  // Electron accelerating voltage in kV, converted to a wavelength relativistically by
  // electron_wavelength(). Only valid together with radiation: `electron`, and mutually
  // exclusive with an explicit numeric `wavelength`.
  accelerating_voltage?: number
  debye_waller_factors?: CompositionType
  scaled?: boolean
  // 2θ window in degrees. Omitted → [0, 90] (see compute_xrd_pattern for why it stops short
  // of the Lorentz singularity); null → unbounded up to the Bragg maximum 2/λ
  two_theta_range?: Vec2 | null
  // Merge tolerance for peaks in degrees (default = TWO_THETA_TOL)
  peak_merge_tol?: number
  // Scaled intensity threshold (% of max) to include a peak (default = SCALED_INTENSITY_TOL)
  scaled_intensity_tol?: number
}

// One diffraction spot in a zone-axis (SAED) pattern.
export type SaedSpot = {
  hkl: Hkl
  // Cartesian reciprocal vector projected onto the plane perpendicular to the zone axis,
  // in the orthonormal in-plane frame from compute_in_plane_basis(). Units 1/Angstrom.
  position_2d: Vec2
  // |F_hkl|² times the relrod excitation weight, scaled so the strongest spot is 100
  intensity: number
  // |h·u + k·v + l·w|: 0 = ZOLZ, 1 = FOLZ, ≥ 2 = HOLZ
  laue_zone: number
  // d = 1/|g| in Angstrom
  d_spacing: number
  // Excitation error s_g in 1/Angstrom (negative when the point lies inside the Ewald sphere)
  excitation_error: number
}

export type SaedPatternData = {
  spots: SaedSpot[]
  // Direct-lattice zone axis [u, v, w] the pattern was computed for
  zone_axis: Vec3
  // Electron wavelength in Angstrom actually used
  wavelength: number
  // Radius of the enumerated reciprocal sphere in 1/Angstrom
  max_g: number
  // Orthonormal in-plane basis (Cartesian) that position_2d is expressed in
  in_plane_basis: [Vec3, Vec3]
}

export type SaedOptions = {
  // Direct-lattice zone axis [u, v, w] (default [0, 0, 1])
  zone_axis?: Vec3
  // Electron wavelength in Angstrom; supply this or accelerating_voltage, not both
  wavelength?: number
  // Accelerating voltage in kV (default 200 when no wavelength is given)
  accelerating_voltage?: number
  // Enumeration radius in 1/Angstrom (default 2, i.e. d ≥ 0.5 Å)
  max_g?: number
  // Foil thickness in Angstrom. Sets the relrod length 2/t, hence both the excitation-error
  // cutoff |s_g| < 1/t and the sinc² intensity weight (default 50 Å).
  crystal_thickness?: number
  debye_waller_factors?: CompositionType
  // Keep only spots whose scaled intensity exceeds this (% of the strongest spot, default 1e-3)
  intensity_tol?: number
}

export interface PatternEntry {
  label: string
  pattern: XrdPattern
  color?: string
}
