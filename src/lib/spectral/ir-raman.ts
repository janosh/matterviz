// Compute IR intensities and Raman activities for phonon modes at a q-point.
//
// IR intensities are computed here from Born effective charges and eigenvectors.
// Raman activities are NOT: they need polarizability derivatives (d alpha / d Q), which
// phonopy does not produce. Callers must supply either per-mode Raman tensors (from a
// LEPSILON finite-difference workflow, vasp_raman.py, phonopy-spectroscopy, ...) or
// precomputed activities. Nothing in this file invents Raman data from eigenvectors.

import { array_extent, type Matrix3x3, type Vec2, type Vec3 } from '$lib/math'
import { broaden_peaks, MAX_BROADENING_GRID_POINTS } from '$lib/lineshape'
import { SvelteSet } from 'svelte/reactivity'
import { convert_frequencies } from './frequency-units'
import { ACOUSTIC_FREQ_THRESHOLD, is_gamma_point } from './helpers'
import type {
  BornChargeData,
  Complex,
  FrequencyUnit,
  PhononMode,
  PhononModeData,
  PhononQPointModes,
  SpectrumKind,
  VibrationalMode,
  VibrationalSpectrum,
} from './types'

// Number of acoustic branches at Gamma.
const N_ACOUSTIC = 3

export type SpectrumCurve = { x: number[]; y: number[] }

// IR intensity of one mode: sum over cartesian alpha of |dipole derivative|^2, in e^2/amu.
// The mode-effective dipole derivative is the sum over atoms kappa and directions beta of
// Z*_{kappa,alpha beta} e_{kappa beta} / sqrt(M_kappa), one complex value per alpha.
// Dividing by sqrt(mass) converts phonopy's mass-weighted eigenvector into a displacement
// pattern; see the convention note in parse-phonon-modes.ts.
export function ir_intensity(
  eigenvector: Complex[][],
  masses: number[],
  born_charges: Matrix3x3[],
): number {
  const n_atoms = masses.length
  if (eigenvector.length !== n_atoms || born_charges.length !== n_atoms) {
    throw new Error(
      `ir_intensity: length mismatch — ${eigenvector.length} eigenvector blocks, ` +
        `${masses.length} masses, ${born_charges.length} Born charge tensors`,
    )
  }

  const dipole: Complex[] = [0, 1, 2].map((): Complex => [0, 0])
  for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
    const mass = masses[atom_idx]
    if (!Number.isFinite(mass) || mass <= 0) {
      throw new Error(`ir_intensity: atom ${atom_idx} has invalid mass ${mass}`)
    }
    const inv_sqrt_mass = 1 / Math.sqrt(mass)
    const charge = born_charges[atom_idx]
    const displacement = eigenvector[atom_idx]
    for (let alpha = 0; alpha < 3; alpha++) {
      for (let beta = 0; beta < 3; beta++) {
        const weight = charge[alpha][beta] * inv_sqrt_mass
        dipole[alpha][0] += weight * displacement[beta][0]
        dipole[alpha][1] += weight * displacement[beta][1]
      }
    }
  }
  return dipole.reduce((acc, [re_part, im_part]) => acc + re_part ** 2 + im_part ** 2, 0)
}

// Rotational invariants of a Raman (polarizability derivative) tensor for a randomly
// oriented sample. The tensor is symmetrised first: only the symmetric part contributes to
// non-resonant Raman scattering.
export function raman_invariants(tensor: Matrix3x3) {
  const sym = (row: number, col: number) => (tensor[row][col] + tensor[col][row]) / 2
  const [xx, yy, zz] = [tensor[0][0], tensor[1][1], tensor[2][2]]
  const [xy, yz, zx] = [sym(0, 1), sym(1, 2), sym(2, 0)]

  const isotropic = (xx + yy + zz) / 3 // a = trace/3
  // gamma^2
  const anisotropy_sq =
    ((xx - yy) ** 2 + (yy - zz) ** 2 + (zz - xx) ** 2) / 2 + 3 * (xy ** 2 + yz ** 2 + zx ** 2)
  const denominator = 45 * isotropic ** 2 + 4 * anisotropy_sq
  return {
    isotropic,
    anisotropy_sq,
    activity: 45 * isotropic ** 2 + 7 * anisotropy_sq,
    // 3 gamma^2 / (45 a^2 + 4 gamma^2)
    depolarization_ratio: denominator === 0 ? 0 : (3 * anisotropy_sq) / denominator,
  }
}

export interface IrRamanOptions {
  // Per-mode polarizability derivative tensors (d alpha / d Q), one per mode. Must come
  // from a real derivative calculation; they cannot be derived from eigenvectors.
  raman_tensors?: Matrix3x3[] | null
  // Already-averaged Raman activities, one per mode. Takes precedence over raman_tensors.
  raman_activities?: number[] | null
  // |frequency| below which a Gamma-point mode may be classified acoustic (THz). Doubles
  // as the imaginary cutoff: a mode below -threshold is a genuine instability rather than
  // the near-zero numerical noise every finite-difference force constant matrix carries.
  acoustic_threshold?: number
}

// Classify which mode indices are acoustic. Only meaningful at Gamma, where the three
// lowest-|frequency| branches go to zero; away from Gamma this returns an empty set.
export function acoustic_mode_indices(
  modes: PhononMode[],
  q_position: Vec3,
  threshold = ACOUSTIC_FREQ_THRESHOLD,
): SvelteSet<number> {
  if (!is_gamma_point(q_position)) return new SvelteSet()
  return new SvelteSet(
    modes
      .map((mode, mode_idx) => ({ mode_idx, abs_freq: Math.abs(mode.frequency) }))
      .toSorted((left, right) => left.abs_freq - right.abs_freq)
      .slice(0, N_ACOUSTIC)
      .filter((entry) => entry.abs_freq < threshold)
      .map((entry) => entry.mode_idx),
  )
}

// Compute IR (and, when polarizability data is supplied, Raman) activities for the modes
// at one q-point.
export function compute_ir_raman_spectrum(
  qpoint: PhononQPointModes,
  masses: number[],
  born: BornChargeData,
  options: IrRamanOptions = {},
): VibrationalSpectrum {
  const {
    raman_tensors = null,
    raman_activities = null,
    acoustic_threshold = ACOUSTIC_FREQ_THRESHOLD,
  } = options
  const { modes, q_position } = qpoint
  const n_atoms = masses.length

  if (born.born_charges.length !== n_atoms) {
    throw new Error(
      `compute_ir_raman_spectrum: ${born.born_charges.length} Born charge tensors for ` +
        `${n_atoms} atoms. BORN files list only symmetry-independent sites unless expanded.`,
    )
  }
  if (modes.length !== 3 * n_atoms) {
    throw new Error(
      `compute_ir_raman_spectrum: ${modes.length} modes for ${n_atoms} atoms, expected ` +
        `3N = ${3 * n_atoms}`,
    )
  }
  if (raman_tensors && raman_tensors.length !== modes.length) {
    throw new Error(
      `compute_ir_raman_spectrum: ${raman_tensors.length} Raman tensors for ${modes.length} modes`,
    )
  }
  if (raman_activities && raman_activities.length !== modes.length) {
    throw new Error(
      `compute_ir_raman_spectrum: ${raman_activities.length} Raman activities for ` +
        `${modes.length} modes`,
    )
  }

  const acoustic = acoustic_mode_indices(modes, q_position, acoustic_threshold)

  const vibrational_modes = modes.map((mode, mode_idx): VibrationalMode => {
    const { eigenvector, frequency } = mode
    if (!eigenvector) {
      throw new Error(
        `compute_ir_raman_spectrum: mode ${mode_idx} has no eigenvector; IR intensities ` +
          `cannot be computed from frequencies alone`,
      )
    }
    const invariants = raman_tensors ? raman_invariants(raman_tensors[mode_idx]) : null
    return {
      mode_idx,
      frequency,
      ir_intensity: ir_intensity(eigenvector, masses, born.born_charges),
      raman_activity: raman_activities?.[mode_idx] ?? invariants?.activity ?? null,
      depolarization_ratio: invariants?.depolarization_ratio ?? null,
      is_acoustic: acoustic.has(mode_idx),
      // Per-mode, so the cutoff has to be absolute. A fraction of the spectrum's total
      // weight would make the same -1.5 THz mode imaginary in a 9-mode cell and real in a
      // 48-mode one, which is not a property of the mode.
      is_imaginary: frequency < -acoustic_threshold,
    }
  })

  return {
    modes: vibrational_modes,
    n_atoms,
    q_position,
    has_raman: Boolean(raman_tensors ?? raman_activities),
  }
}

// Convenience wrapper: take parsed phonopy mode data plus a BORN file and produce the
// spectrum at the requested q-point (default: the first Gamma point in the file).
export function spectrum_from_phonon_data(
  data: PhononModeData,
  born: BornChargeData,
  options: IrRamanOptions & { qpoint_index?: number } = {},
): VibrationalSpectrum {
  const { qpoint_index, ...spectrum_options } = options
  const resolved_index =
    qpoint_index ?? data.qpoints.findIndex((qpt) => is_gamma_point(qpt.q_position))
  // Only the Gamma search can legitimately come back empty; an explicit negative index is a
  // caller error and falls through to the out-of-range message below
  if (qpoint_index === undefined && resolved_index < 0) {
    const listed = data.qpoints.map((qpt) => qpt.q_position.join(`,`)).join(`; `)
    throw new Error(`spectrum_from_phonon_data: no Gamma point among q-points [${listed}]`)
  }
  const qpoint = data.qpoints[resolved_index]
  if (!qpoint) {
    throw new Error(
      `spectrum_from_phonon_data: q-point index ${resolved_index} out of range ` +
        `(${data.qpoints.length} q-points)`,
    )
  }
  const masses = data.atoms.map((atom) => atom.mass)
  return compute_ir_raman_spectrum(qpoint, masses, born, spectrum_options)
}

// Discrete stick spectrum: mode frequencies (converted to `unit`) against their activity.
// Acoustic and imaginary modes are dropped by default — acoustic modes carry no IR activity
// by the Born charge sum rule, and imaginary modes are not physical excitations.
export function spectrum_sticks(
  spectrum: VibrationalSpectrum,
  kind: SpectrumKind = `ir`,
  options: {
    unit?: FrequencyUnit
    include_acoustic?: boolean
    include_imaginary?: boolean
  } = {},
): SpectrumCurve & { modes: VibrationalMode[] } {
  const { unit = `cm^-1`, include_acoustic = false, include_imaginary = false } = options
  if (kind === `raman` && !spectrum.has_raman) {
    throw new Error(
      `spectrum_sticks: Raman requested but this spectrum has no polarizability data. ` +
        `Supply raman_tensors or raman_activities when computing it.`,
    )
  }

  const selected = spectrum.modes.filter(
    (mode) =>
      (include_acoustic || !mode.is_acoustic) && (include_imaginary || !mode.is_imaginary),
  )
  return {
    x: convert_frequencies(
      selected.map((mode) => mode.frequency),
      unit,
    ),
    y: selected.map((mode) =>
      kind === `ir` ? mode.ir_intensity : (mode.raman_activity ?? 0),
    ),
    // the modes behind each stick, in stick order, so a plot can map sticks back to modes
    modes: selected,
  }
}

export interface BroadenOptions {
  fwhm?: number // constant FWHM in the stick spectrum's own x units
  fwhm_fn?: (peak_center: number) => number // frequency-dependent width, wins over fwhm
  shape_factor?: number // pseudo-Voigt mixing: 0 = Gaussian, 1 = Lorentzian
  range?: Vec2 // x range of the output grid, defaults to the stick range padded by 10 FWHM
  step_size?: number // grid spacing, defaults to FWHM/20
}

// Convolve a stick spectrum with pseudo-Voigt line shapes. Delegates to the XRD module's
// broaden_peaks with an injected width model: the Caglioti Bragg-angle formula it defaults
// to is meaningless for vibrational spectra, which want constant or frequency-dependent
// widths. Line shapes are area-normalised, so the integrated intensity of each stick is
// preserved (up to the +/-20 FWHM truncation window and grid discretisation).
//
// broaden_peaks is unit-agnostic (see its contract), so sticks go through unscaled.
export function broaden_spectrum(
  sticks: SpectrumCurve,
  options: BroadenOptions = {},
): SpectrumCurve {
  const { fwhm = 10, fwhm_fn, shape_factor = 0.5 } = options
  if (sticks.x.length !== sticks.y.length) {
    throw new Error(
      `broaden_spectrum: ${sticks.x.length} positions but ${sticks.y.length} intensities`,
    )
  }
  // Before the width checks, so both the constant and the fwhm_fn path treat "nothing to
  // broaden" as a no-op rather than one throwing and the other returning empty
  if (sticks.x.length === 0) return { x: [], y: [] }

  // broaden_peaks rejects NaN/Infinity and an out-of-range shape_factor itself, but silently
  // drops a negative intensity via its relative floor, coming back as an all-zero curve
  // indistinguishable from "no such mode". Not producible by ir_intensity/raman_activity
  // (both sums of squares), so it is a caller bug.
  for (const [stick_idx, intensity] of sticks.y.entries()) {
    if (intensity < 0) {
      throw new Error(
        `broaden_spectrum: stick ${stick_idx} at ${sticks.x[stick_idx]} has negative ` +
          `intensity ${intensity}`,
      )
    }
  }

  // Widths are needed up front to size the grid, so validate them here rather than letting
  // a NaN step_size fail inside broaden_peaks with no peak named.
  const width_at = fwhm_fn ?? (() => fwhm)
  const widths = sticks.x.map((peak_center) => {
    const width = width_at(peak_center)
    if (!Number.isFinite(width) || width <= 0) {
      throw new Error(
        `broaden_spectrum: fwhm must be > 0 and finite, got ${width} at peak ${peak_center}`,
      )
    }
    return width
  })
  const [min_width, max_width] = array_extent(widths)
  const [min_stick, max_stick] = array_extent(sticks.x)
  const [range_lo, range_hi] =
    options.range ?? ([min_stick - 10 * max_width, max_stick + 10 * max_width] as Vec2)
  const step_size = options.step_size ?? min_width / 20

  const n_points = Math.ceil((range_hi - range_lo) / step_size)
  // Every width can be individually sane while their RATIO is not: the grid spans
  // 10*max_width past the sticks in steps of min_width/20, so a soft mode 9 orders below
  // the rest asks for ~1e12 points and broaden_peaks fills them in an uninterruptible loop.
  if (n_points > MAX_BROADENING_GRID_POINTS) {
    throw new Error(
      `broaden_spectrum: ${n_points} grid points over [${range_lo}, ${range_hi}] at step ` +
        `${step_size}. Widths span ${min_width}..${max_width}; pass an explicit step_size ` +
        `or range for a spectrum with this width spread.`,
    )
  }

  return broaden_peaks(sticks, width_at, shape_factor, [range_lo, range_hi], step_size)
}

// Scale a curve so its maximum is 1. Used for the transmittance presentation, which inverts
// the result, so an unbounded or all-zero absorbance would silently render a flat line at 1
// instead of failing. A loop, not Math.max(...values): broadened grids run to 1e7 points, far
// past the spread-argument limit.
export function scale_to_max(values: number[]): number[] {
  let max_val = -Infinity
  for (const val of values) {
    if (!Number.isFinite(val)) max_val = NaN
    if (val > max_val) max_val = val
  }
  if (!Number.isFinite(max_val) || max_val <= 0) {
    throw new Error(
      `scale_to_max needs a positive finite maximum over ${values.length} values, got ${max_val}`,
    )
  }
  return values.map((val) => val / max_val)
}

// Absorbance flipped to transmittance: a baseline of 1 with the strongest absorption at 0.
export const to_transmittance = (absorbance: number[]): number[] =>
  scale_to_max(absorbance).map((val) => 1 - val)
