import type { RadiationType } from '$lib/scattering'
import type { Crystal, Pbc } from '$lib/structure'
import { is_crystal } from '$lib/structure/validation'

export * from './calc-pdf'
export * from './calc-rdf'
export { default as PdfPlot } from './PdfPlot.svelte'
export { default as RdfPlot } from './RdfPlot.svelte'

// Normalize the `structures` prop shared by RdfPlot and PdfPlot (single crystal, array, or
// label->crystal record) into a labelled list. A lone crystal gets an empty label so callers
// can substitute the formula, which is what both components want.
export const label_structures = (
  structures?: Crystal | Crystal[] | Record<string, Crystal>,
): { struct: Crystal; label: string }[] => {
  if (!structures) return []
  if (Array.isArray(structures)) {
    return structures.map((struct, idx) => ({ struct, label: `Crystal ${idx + 1}` }))
  }
  if (is_crystal(structures)) return [{ struct: structures, label: `` }]
  return Object.entries(structures).map(([label, struct]) => ({ struct, label }))
}

export type RdfPattern = {
  r: number[]
  g_r: number[]
  element_pair?: [string, string]
}

export interface RdfEntry {
  label: string
  pattern: RdfPattern
  color?: string
  legend_group?: string // Group name for legend grouping (e.g. structure name)
}

export interface RdfOptions {
  center_species?: string
  neighbor_species?: string
  // Half-open distance range [0, cutoff) in Å, split into n_bins equal bins. `r` holds the
  // bin centres (idx + 0.5) · cutoff / n_bins.
  cutoff?: number
  n_bins?: number
  // Periodic axes to image along; defaults to the lattice's own pbc flags
  pbc?: Pbc
}

// An RdfPattern plus the reduced PDF G(r) and the number density it was built from
export interface PdfPattern extends RdfPattern {
  // G(r) = 4π·r·ρ0·(g(r) − 1)
  reduced_g_r: number[]
  // ρ0 = N/V of the whole structure in atoms/Å³, total even for a partial pattern
  rho_0: number
}

export interface TotalPdfOptions extends Omit<
  RdfOptions,
  `center_species` | `neighbor_species`
> {
  radiation?: RadiationType
  // s = sin(θ)/λ in 1/Å at which the x-ray/electron form factors are evaluated. PDF weights
  // must be Q-independent to factor out of the Fourier transform, so 0 (where f_x → Z) is the
  // conventional choice. Ignored for neutrons, whose b_coh is Q-independent anyway.
  s_val?: number
}

export interface TotalPdfPattern extends PdfPattern {
  radiation: RadiationType
  // w_ab keyed `A-B` over the E(E+1)/2 unordered pairs, INCLUDING the ×2 multiplicity that
  // unlike pairs pick up from the ordered Faber-Ziman sum. Sums to 1 across all entries.
  pair_weights: Record<string, number>
  // <b> = Σ_a c_a·b_a, in fm (neutron), electrons (x-ray) or Å (electron)
  mean_scattering_length: number
  partials: PdfPattern[]
}
