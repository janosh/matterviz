// Structure identification: Common Neighbor Analysis and the centrosymmetry parameter.
// Runtime constants live next to the algorithm that defines them (CNA_TYPES in calc-cna.ts);
// this barrel holds only the shared option/result types, so nothing here can create an import
// cycle with the modules it re-exports.
import type { Pbc } from '$lib/structure'
import type { CnaTypeName } from './calc-cna'

export { compute_structure_id_async } from './async-compute.svelte'
export * from './calc-cna'
export * from './calc-csp'
export * from './calc-structure-id'
export * from './neighbors'
export { default as StructureTypePlot } from './StructureTypePlot.svelte'

// `adaptive` derives a per-atom cutoff from that atom's own neighbor distances (Stukowski 2012)
// and needs no lattice constant. `fixed` uses one global cutoff for the whole structure and
// requires `cutoff` to be set to 0.854 * a_fcc or 1.207 * a_bcc for the phase under study.
export type CnaMode = `adaptive` | `fixed`

export interface StructureIdOptions {
  cna_mode?: CnaMode
  // Required (and only used) when cna_mode is `fixed`
  cutoff?: number
  // Nearest neighbors entering the CSP sum: 12 for fcc, 8 for bcc. Must be even.
  n_csp_neighbors?: number
  // Skip either analysis when only the other is wanted. They share one neighbor list, so
  // running both costs barely more than running one.
  skip_cna?: boolean
  skip_csp?: boolean
  // Overrides the lattice's own periodicity flags
  pbc?: Pbc
}

export interface StructureIdResult {
  // One CNA_TYPES code per site, or null when skip_cna was set
  cna_types: Int8Array | null
  // Centrosymmetry per site in Å², or null when skip_csp was set. NaN for sites with fewer
  // than n_csp_neighbors neighbors.
  centrosymmetry: Float64Array | null
  // Site count per CNA type name; all five keys are always present (0 when absent)
  populations: Record<CnaTypeName, number>
  n_atoms: number
  cna_mode: CnaMode
  // The global cutoff in `fixed` mode; null in `adaptive` mode, where it varies per atom
  cutoff: number | null
  n_csp_neighbors: number
  // Sites that could not be given a CSP value because they have fewer than n_csp_neighbors
  // neighbors (cluster surfaces, isolated fragments)
  n_csp_undefined: number
  // Radius of the neighbor query that fed the analysis, in Å
  neighbor_cutoff: number
}
