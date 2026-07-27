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

// Mott–Bethe: f_e(s) = MOTT_BETHE_PREFACTOR · (Z − f_x(s)) / s², in Angstrom.
// Substituting the X-ray form factor above gives Z − f_x(s) = XRAY_GAUSSIAN_PREFACTOR · s² ·
// Σ aᵢ·exp(−bᵢ·s²), so the s² cancels EXACTLY and no division by s ever happens:
//   f_e(s) = MOTT_BETHE_PREFACTOR · XRAY_GAUSSIAN_PREFACTOR · Σ aᵢ·exp(−bᵢ·s²)
// This matters because a literal transcription of Mott–Bethe divides by s² and blows up at
// s -> 0 (forward scattering), whereas the true f_e(0) = C · Σ aᵢ is finite and positive.
// C = 0.02393366096322682 · 41.78214 = 0.9999995730780779, i.e. 41.78214 is the reciprocal of
// the Mott–Bethe prefactor to 4.3e-7 relative — the aᵢ are Doyle–Turner electron-scattering
// amplitudes that pymatgen converts into X-ray factors. We multiply the two constants instead of
// hard-coding 1 so the physics stays auditable and the tiny offset is not silently invented.
export const ELECTRON_FORM_FACTOR_CONST = MOTT_BETHE_PREFACTOR * XRAY_GAUSSIAN_PREFACTOR

const assert_valid_s = (s_val: number): void => {
  if (!Number.isFinite(s_val) || s_val < 0) {
    throw new Error(
      `Invalid scattering variable s = ${s_val}. Expected a finite non-negative value of sin(theta)/lambda in 1/Angstrom.`,
    )
  }
}

// Σ aᵢ·exp(−bᵢ·s²), shared by the X-ray and electron form factors
const gaussian_sum = (element: ScatteringSpecies, s_sq: number): number => {
  const params = GAUSSIAN_PARAMS[element]
  if (!params) {
    throw new Error(
      `No atomic scattering coefficients for ${element}. Extend ATOMIC_SCATTERING_PARAMS.`,
    )
  }
  let total = 0
  for (const [amplitude, decay] of params) total += amplitude * Math.exp(-decay * s_sq)
  return total
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

// X-ray atomic form factor in electrons, f_x(s) = Z − 41.78214·s²·Σ aᵢ·exp(−bᵢ·s²).
// Mirrors the inline expression in calc-xrd.ts, which we cannot import from without
// pulling in the whole pattern-computation module.
export function xray_form_factor(element: ScatteringSpecies, s_val: number): number {
  assert_valid_s(s_val)
  const s_sq = s_val * s_val
  // Deuterium has hydrogen's electronic structure, so X-rays and electrons see it as H
  const entry = element_by_symbol.get(element === `D` ? `H` : element)
  if (!entry) throw new Error(`No atomic number for ${element}.`)
  return entry.number - XRAY_GAUSSIAN_PREFACTOR * s_sq * gaussian_sum(element, s_sq)
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
