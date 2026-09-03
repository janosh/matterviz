// Shared scattering factors for neutron/electron diffraction and total-PDF G(r) weighting.
// Kept free of Svelte imports so worker-side consumers (XRD, RDF) can pull it in cheaply.
import { element_by_symbol } from '$lib/element/data'
// is_elem_symbol lives in the Svelte-free leaf module; $lib/element re-exports Svelte components
import { is_elem_symbol } from '$lib/element/helpers'
import type { ElementSymbol } from '$lib/element'
// relative (not $lib/) since svelte-package leaves aliased JSON imports unresolved in dist/
import ATOMIC_SCATTERING_PARAMS from '../xrd/atomic_scattering_params.json' with { type: 'json' }
import NEUTRON_SCATTERING_LENGTHS from './neutron-scattering-lengths.json' with { type: 'json' }

// Deuterium is not a member of ELEM_SYMBOLS (which lists chemical elements only), but neutrons
// see H and D completely differently (-3.739 fm vs +6.671 fm), so both tables carry a `D` key —
// as does the existing atomic_scattering_params.json. Accept it everywhere a species is named.
export type ScatteringSpecies = ElementSymbol | `D`

export type RadiationType = `xray` | `neutron` | `electron`

// Bound coherent scattering lengths b_coh in femtometres (fm), natural isotopic abundance.
// Source: NIST NCNR table (https://www.ncnr.nist.gov/resources/n-lengths/list.html), i.e. the
// Sears (1992) compilation also used by pymatgen, ASE and diffpy. Negative signs are physical
// (H, Ti, V, Mn scatter with a 180° phase shift) and must never be dropped. For the strongly
// absorbing nuclides with complex b_coh (B, Cd, Sm, Eu, Gd) this is the real part only.
const NEUTRON_B_COH = NEUTRON_SCATTERING_LENGTHS as Partial<Record<ScatteringSpecies, number>>

// element -> [[a1, b1], [a2, b2], [a3, b3], [a4, b4]], the four-Gaussian fit read by calc-xrd.ts
const GAUSSIAN_PARAMS = ATOMIC_SCATTERING_PARAMS as Partial<
  Record<ScatteringSpecies, number[][]>
>

// Prefactor of the X-ray form factor in calc-xrd.ts: f_x(s) = Z − XRAY_GAUSSIAN_PREFACTOR · s² ·
// Σ aᵢ·exp(−bᵢ·s²), with s = sin(theta)/lambda = |g|/2 in inverse Angstrom.
export const XRAY_GAUSSIAN_PREFACTOR = 41.78214

// Mott–Bethe prefactor m0·e²/(2h²), i.e. m0·e²/(8·pi·eps0·h²) in SI, evaluated with CODATA 2018
// (m0 = 9.1093837015e-31 kg, e = 1.602176634e-19 C, h = 6.62607015e-34 J·s,
// eps0 = 8.8541878128e-12 F/m) and converted from 1/m to 1/Angstrom. Kept at full double
// precision so it does not become the dominant error term in f_e.
const MOTT_BETHE_PREFACTOR = 0.02393366096322682

// Mott–Bethe: f_e(s) = MOTT_BETHE_PREFACTOR · (Z − f_x(s)) / s², in Angstrom. Substituting
// the X-ray form factor gives Z − f_x(s) = XRAY_GAUSSIAN_PREFACTOR · s² · Σ aᵢ·exp(−bᵢ·s²),
// so the s² cancels EXACTLY and nothing ever divides by s:
//   f_e(s) = MOTT_BETHE_PREFACTOR · XRAY_GAUSSIAN_PREFACTOR · Σ aᵢ·exp(−bᵢ·s²)
// A literal transcription divides by s² and blows up at s -> 0, where the true
// f_e(0) = C · Σ aᵢ is finite. C = 0.9999995730780779, i.e. 41.78214 is the reciprocal of
// the Mott–Bethe prefactor to 4.3e-7 — the aᵢ are Doyle–Turner electron amplitudes pymatgen
// converts into X-ray factors. Kept as a product so that offset is not invented as 1.
export const ELECTRON_FORM_FACTOR_CONST = MOTT_BETHE_PREFACTOR * XRAY_GAUSSIAN_PREFACTOR

const assert_valid_s = (s_val: number): void => {
  if (!Number.isFinite(s_val) || s_val < 0) {
    throw new Error(
      `Invalid scattering variable s = ${s_val}. Expected a finite non-negative value of sin(theta)/lambda in 1/Angstrom.`,
    )
  }
}

// [[a1, b1], ..., [a4, b4]] of the four-Gaussian fit Σ aᵢ·exp(−bᵢ·s²) behind the X-ray and
// electron form factors. Throws for species without a fit rather than returning a zero
// factor that would silently drop the species from a pattern.
export function gaussian_params(element: ScatteringSpecies): number[][] {
  const params = GAUSSIAN_PARAMS[element]
  if (!params) {
    throw new Error(
      `No atomic scattering coefficients for ${element}. Extend ATOMIC_SCATTERING_PARAMS.`,
    )
  }
  return params
}

const gaussian_sum = (element: ScatteringSpecies, s_sq: number): number => {
  const params = gaussian_params(element)
  let total = 0
  for (const [amplitude, decay] of params) total += amplitude * Math.exp(-decay * s_sq)
  return total
}

// Atomic number seen by the X-ray form factor. Deuterium has hydrogen's electronic structure,
// so only neutrons, which see the nucleus, tell them apart.
export function form_factor_z(element: ScatteringSpecies): number {
  const entry = element_by_symbol.get(element === `D` ? `H` : element)
  if (!entry) throw new Error(`No atomic number for ${element}.`)
  return entry.number
}

// Bound coherent neutron scattering length b_coh in femtometres (fm). Throws rather than
// defaulting to 0: a missing nucleus would silently produce a plausible but wrong pattern.
export function neutron_scattering_length(element: ScatteringSpecies): number {
  const b_coh = NEUTRON_B_COH[element]
  // explicit undefined check, not truthiness — b_coh is legitimately negative for H, Ti, V, Mn
  if (b_coh === undefined) {
    throw new Error(
      `No neutron scattering length for ${element}. Extend NEUTRON_SCATTERING_LENGTHS.`,
    )
  }
  return b_coh
}

// s² beyond which f_x(s) = Z − prefactor·s²·Σaᵢexp(−bᵢs²) stops being usable. The aᵢ are
// Doyle–Turner ELECTRON amplitudes and the Mott–Bethe inversion only holds at small s: as
// s → ∞ the correction term vanishes and the expression climbs back to +Z, whereas a real
// form factor (the transform of a positive, monotonically decreasing charge density) decays
// to 0 and is never negative. Unclamped, hydrogen dips to −0.0021 near s = 0.85 and returns
// to 1.000 by s = 4, which inverted whole Mo/Ag Kα patterns (a pure artifact at 165° taking
// the 100 while the real 16° reflection reported 9).
//
// The turning point is where d/du [u·Σaᵢexp(−bᵢu)] = Σaᵢexp(−bᵢu)(1 − bᵢu) crosses zero,
// with u = s². That derivative is Σaᵢ > 0 at u = 0 and negative for large u, so bisection
// converges. Cached per element: this is called once per species per pattern.
const turning_point_cache = new Map<ScatteringSpecies, number>()
export const gaussian_turning_point = (element: ScatteringSpecies): number => {
  const cached = turning_point_cache.get(element)
  if (cached !== undefined) return cached
  // Without this an unknown species gets an all-zero slope, and the bisection below
  // "converges" on ~1e-24 and caches it, so this exported function hands back a number
  // where gaussian_sum would have said which element is missing
  const params = gaussian_params(element)
  const slope = (u_val: number) => {
    let total = 0
    for (const [amplitude, decay] of params) {
      total += amplitude * Math.exp(-decay * u_val) * (1 - decay * u_val)
    }
    return total
  }
  let [lo, hi] = [0, 1]
  while (slope(hi) > 0 && hi < 1e4) hi *= 2
  for (let iter = 0; iter < 80; iter++) {
    const mid = (lo + hi) / 2
    if (slope(mid) > 0) lo = mid
    else hi = mid
  }
  turning_point_cache.set(element, hi)
  return hi
}

// X-ray atomic form factor in electrons, f_x(s) = Z − 41.78214·s²·Σ aᵢ·exp(−bᵢ·s²), held
// flat past the point where that fit turns back up (see gaussian_turning_point) and floored
// at 0. Beyond the turning point the parameterization carries no information, so the
// minimum is the closest defensible value - and it is far closer to the true (near-zero)
// high-s factor than the +Z the raw expression returns.
export function xray_form_factor(element: ScatteringSpecies, s_val: number): number {
  assert_valid_s(s_val)
  const s_sq = Math.min(s_val * s_val, gaussian_turning_point(element))
  const raw =
    form_factor_z(element) - XRAY_GAUSSIAN_PREFACTOR * s_sq * gaussian_sum(element, s_sq)
  return Math.max(0, raw)
}

// Electron atomic form factor in Angstrom via Mott–Bethe. Finite at s = 0 by construction.
export function electron_form_factor(element: ScatteringSpecies, s_val: number): number {
  assert_valid_s(s_val)
  return ELECTRON_FORM_FACTOR_CONST * gaussian_sum(element, s_val * s_val)
}

// Scattering power of one species for the given radiation, evaluated at s = sin(theta)/lambda.
// Units differ per radiation (fm / electrons / Angstrom), which is harmless for PDF weights
// because every weight is a ratio in which the unit cancels.
export function scattering_length(
  element: ScatteringSpecies,
  radiation: RadiationType,
  s_val = 0,
): number {
  if (radiation === `neutron`) return neutron_scattering_length(element)
  if (radiation === `xray`) return xray_form_factor(element, s_val)
  if (radiation === `electron`) return electron_form_factor(element, s_val)
  throw new Error(`Unknown radiation type ${radiation}. Expected xray, neutron or electron.`)
}

export type PdfWeighting = {
  // <b> = Σ_a c_a·b_a, in the unit of the chosen radiation
  mean_scattering_length: number
  // b_a per species, keyed exactly as the input composition
  scattering_lengths: Record<string, number>
  // input amounts normalized to sum to 1
  fractions: Record<string, number>
  // w_ab = c_a·c_b·b_a·b_b / <b>², summing to exactly 1 over all ordered pairs (a, b)
  pair_weight: (element_a: string, element_b: string) => number
}

const to_species = (symbol: string): ScatteringSpecies => {
  if (symbol === `D` || is_elem_symbol(symbol)) return symbol
  throw new Error(`Unknown element symbol ${symbol} in composition.`)
}

// Faber–Ziman weights for a total pair distribution function G(r). Takes a plain
// element -> amount record so the RDF module needs no composition types. Amounts are
// normalized internally, so raw atom counts and fractions both work.
// s defaults to 0 because PDF weights must be Q-independent to factor out of the Fourier
// transform; at s = 0 the X-ray form factor reduces to Z, the usual convention.
export function pdf_scattering_weights(
  composition: Record<string, number>,
  radiation: RadiationType,
  s_val = 0,
): PdfWeighting {
  const entries = Object.entries(composition)
  if (entries.length === 0) {
    throw new Error(`Empty composition. Cannot compute PDF scattering weights.`)
  }

  let total_amount = 0
  for (const [symbol, amount] of entries) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(
        `Invalid amount ${amount} for ${symbol} in composition. Expected a finite non-negative number.`,
      )
    }
    total_amount += amount
  }
  if (total_amount === 0) {
    throw new Error(`Composition amounts sum to 0. Cannot normalize to fractions.`)
  }

  const fractions: Record<string, number> = {}
  const scattering_lengths: Record<string, number> = {}
  let mean_scattering_length = 0
  let mean_abs_scattering_length = 0
  for (const [symbol, amount] of entries) {
    const fraction = amount / total_amount
    const b_val = scattering_length(to_species(symbol), radiation, s_val)
    fractions[symbol] = fraction
    scattering_lengths[symbol] = b_val
    mean_scattering_length += fraction * b_val
    mean_abs_scattering_length += fraction * Math.abs(b_val)
  }

  // Null-matrix compositions (e.g. Ti/Zr tuned so the negative b of Ti cancels Zr for neutrons)
  // have <b> = 0, which makes the 1/<b>² normalization singular. Fail loudly instead of handing
  // back Infinity or NaN weights that would look like a real but nonsensical G(r).
  if (
    mean_abs_scattering_length === 0 ||
    Math.abs(mean_scattering_length) < 1e-8 * mean_abs_scattering_length
  ) {
    throw new Error(
      `Mean scattering length is ${mean_scattering_length} for ${radiation} radiation. ` +
        `PDF pair weights w_ab = c_a·c_b·b_a·b_b / <b>² are undefined for null-matrix compositions.`,
    )
  }

  const mean_sq = mean_scattering_length * mean_scattering_length
  const pair_weight = (element_a: string, element_b: string): number => {
    const frac_a = fractions[element_a]
    const frac_b = fractions[element_b]
    if (frac_a === undefined || frac_b === undefined) {
      const missing = frac_a === undefined ? element_a : element_b
      throw new Error(
        `${missing} is not part of the composition passed to pdf_scattering_weights (has ${Object.keys(
          fractions,
        ).join(`, `)}).`,
      )
    }
    return (
      (frac_a * frac_b * scattering_lengths[element_a] * scattering_lengths[element_b]) /
      mean_sq
    )
  }

  return { mean_scattering_length, scattering_lengths, fractions, pair_weight }
}
