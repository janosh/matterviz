import { calc_lattice_params } from '$lib/math'
import type { PdfWeighting } from '$lib/scattering'
import { pdf_scattering_weights } from '$lib/scattering'
import type { Crystal } from '$lib/structure'
import { to_error } from '$lib/utils'
import { calculate_all_pair_rdfs, calculate_rdf } from './calc-rdf'
import type {
  PdfPattern,
  RdfOptions,
  RdfPattern,
  TotalPdfOptions,
  TotalPdfPattern,
} from './index'

// PDF analysis needs the first peak resolved to ~0.01-0.02 Å, so the RDF defaults (15 Å over
// 75 bins = 0.2 Å bins) are an order of magnitude too coarse. These constants sit BESIDE the
// RDF defaults in prepare_rdf rather than replacing them: existing RDF callers depend on 0.2 Å.
export const PDF_DEFAULT_CUTOFF = 30
export const PDF_DEFAULT_N_BINS = 1500

// ?? rather than a spread default so an explicit `cutoff: undefined` still gets the PDF value
const with_pdf_defaults = <T extends RdfOptions>(options: T): T => ({
  ...options,
  cutoff: options.cutoff ?? PDF_DEFAULT_CUTOFF,
  n_bins: options.n_bins ?? PDF_DEFAULT_N_BINS,
})

// Occupancy-weighted atom count per element. Mirrors exactly the weights calc-rdf sums for its
// ideal-gas normalization (Σ occu over the sites carrying that element), so the fractions c_a
// derived here stay in step with the g_ab(r) they multiply. Any other composition source
// (formula string, oxidation-state map) could silently disagree on partial occupancies.
export function site_composition(structure: Crystal): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const site of structure.sites) {
    for (const { element, occu } of site.species) {
      counts[element] = (counts[element] ?? 0) + occu
    }
  }
  return counts
}

// Number density ρ0 = N/V in atoms/Å³, using the original cell exactly as calc-rdf's
// normalization does — not the expanded image cloud.
export function number_density(structure: Crystal): number {
  if (!structure.lattice?.matrix) {
    throw new Error(`Crystal must have a lattice to compute the PDF number density`)
  }
  const { volume } = calc_lattice_params(structure.lattice.matrix)
  const composition = Object.values(site_composition(structure))
  const n_atoms = composition.reduce((sum, count) => sum + count, 0)
  if (!(volume > 0)) {
    throw new Error(`Crystal lattice volume is ${volume} Å³, cannot form ρ0 = N/V`)
  }
  if (!(n_atoms > 0)) {
    throw new Error(
      `Crystal has ${n_atoms} atoms (occupancy-weighted) across ${structure.sites.length} sites, cannot form ρ0 = N/V`,
    )
  }
  return n_atoms / volume
}

// G(r) = 4π·r·ρ0·(g(r) − 1), the reduced pair distribution function (Keen 2001 nomenclature).
// A pure pointwise transform of g(r) — no Fourier transform is involved. It → 0 at large r,
// and below the distance of closest approach, where g(r) = 0, it is exactly the straight line
// −4π·r·ρ0, which is the standard sanity check on any measured PDF.
// For a PARTIAL g_ab(r) the convention is to keep the TOTAL ρ0 here, so that the partials add
// up to the total G(r) with the scattering weights and nothing else.
const reduced_pdf = (pattern: RdfPattern, rho_0: number): number[] =>
  pattern.r.map((radius, idx) => 4 * Math.PI * radius * rho_0 * (pattern.g_r[idx] - 1))

// n = ∫ 4π·r²·ρ·g(r) dr over [r_min, r_max), the coordination number in that shell.
// We expose this integral rather than the radial distribution R(r) = 4π·r²·ρ·g(r) as an array:
// R(r) carries no information beyond g(r) and ρ, and integrating it over a shell is the one
// thing it is actually used for. Pass the TOTAL density for a total g(r), and the NEIGHBOUR
// species density N_b/V for a partial g_ab(r), since n_ab counts b atoms around one a atom.
export function coordination_number(
  pattern: RdfPattern,
  density: number,
  options: { r_min?: number; r_max?: number } = {},
): number {
  const { r_min = 0, r_max = Infinity } = options
  if (r_max <= r_min) {
    throw new Error(`Empty integration window: r_max=${r_max} must exceed r_min=${r_min}`)
  }
  if (pattern.r.length < 2) {
    throw new Error(
      `Cannot infer a bin width from ${pattern.r.length} bin(s); need at least 2 uniformly spaced bin centres`,
    )
  }
  // calc-rdf emits uniformly spaced bin CENTRES, r[idx] = (idx + 0.5)·bin_size
  const bin_size = pattern.r[1] - pattern.r[0]
  let total = 0
  for (let bin_idx = 0; bin_idx < pattern.r.length; bin_idx++) {
    const radius = pattern.r[bin_idx]
    if (radius < r_min || radius >= r_max) continue
    total += 4 * Math.PI * radius ** 2 * density * pattern.g_r[bin_idx] * bin_size
  }
  return total
}

// Reduced PDF G(r) for one structure. With center_species/neighbor_species set this is the
// partial G_ab(r); without them it is the composition-averaged (unweighted) G(r).
export function calculate_pdf(structure: Crystal, options: RdfOptions = {}): PdfPattern {
  const rho_0 = number_density(structure)
  const pattern = calculate_rdf(structure, with_pdf_defaults(options))
  return { ...pattern, rho_0, reduced_g_r: reduced_pdf(pattern, rho_0) }
}

// Total scattering-weighted PDF: g(r) = Σ_ab w_ab·g_ab(r) and G(r) = 4π·r·ρ0·(g(r) − 1), with
// Faber-Ziman weights w_ab = c_a·c_b·b_a·b_b/<b>² supplied by $lib/scattering.
export function calculate_total_pdf(
  structure: Crystal,
  options: TotalPdfOptions = {},
): TotalPdfPattern {
  const { radiation = `xray`, s_val = 0, ...rdf_options } = options
  const rho_0 = number_density(structure)
  const composition = site_composition(structure)

  let weighting: PdfWeighting
  try {
    weighting = pdf_scattering_weights(composition, radiation, s_val)
  } catch (exc) {
    // Re-throw with the structure's composition attached. $lib/scattering deliberately throws
    // on a missing nucleus or a null-matrix <b> = 0; swallowing that would hand back a
    // plausible-looking but physically wrong pattern.
    const formula = Object.entries(composition)
      .map(([element, count]) => `${element}${count}`)
      .join(``)
    const reason = to_error(exc).message
    throw new Error(`Cannot weight a total ${radiation} PDF for ${formula}: ${reason}`, {
      cause: exc,
    })
  }

  // No emptiness check: number_density above already rejects a structure with no atoms,
  // and any atom yields at least a self-pair.
  const partial_rdfs = calculate_all_pair_rdfs(structure, with_pdf_defaults(rdf_options))

  const radii = partial_rdfs[0].r
  const n_bins = radii.length
  const g_r: number[] = Array(n_bins).fill(0)
  const pair_weights: Record<string, number> = {}

  for (const partial of partial_rdfs) {
    if (!partial.element_pair) {
      throw new Error(`calculate_all_pair_rdfs returned a pattern with no element_pair`)
    }
    const [el_a, el_b] = partial.element_pair
    // The Faber-Ziman sum runs over ORDERED pairs (a, b), but calculate_all_pair_rdfs emits
    // the E(E+1)/2 UNORDERED pairs. g_ab = g_ba by symmetry, so an unlike pair stands in for
    // two ordered terms and must carry twice the weight of a like pair. Dropping this factor
    // of 2 is the classic total-PDF bug: the weights then sum to less than 1, so the total
    // g(r) tends to something below 1 and every cross correlation is under-weighted.
    const multiplicity = el_a === el_b ? 1 : 2
    const weight = multiplicity * weighting.pair_weight(el_a, el_b)
    pair_weights[`${el_a}-${el_b}`] = weight
    for (let bin_idx = 0; bin_idx < n_bins; bin_idx++) {
      g_r[bin_idx] += weight * partial.g_r[bin_idx]
    }
  }

  return {
    r: radii,
    g_r,
    rho_0,
    reduced_g_r: reduced_pdf({ r: radii, g_r }, rho_0),
    radiation,
    pair_weights,
    mean_scattering_length: weighting.mean_scattering_length,
    // every partial's `r` is the same array instance as `radii` above (one shared grid), so
    // treat the r arrays on the result as read-only: mutating one mutates all of them
    partials: partial_rdfs.map((partial) => ({
      ...partial,
      rho_0,
      reduced_g_r: reduced_pdf(partial, rho_0),
    })),
  }
}
