// Top-level structure identification: a k-nearest neighbor query feeds adaptive CNA and CSP;
// fixed-cutoff CNA runs on the cutoff query that defines it.
import type { AnyStructure, Pbc } from '$lib/structure'
import { neighbor_query } from '$lib/structure/bonding'
import type { CnaMode, CnaTypeName } from './calc-cna'
import { calc_cna, CNA_TYPE_NAMES } from './calc-cna'
import { calc_centrosymmetry, validate_csp_neighbors } from './calc-csp'

// Neighbors a-CNA needs: 8 first-shell + 6 second-shell bcc candidates
const N_ADAPTIVE_CNA_NEIGHBORS = 14

// site.properties keys written by apply_structure_id. `cna_type` holds a CNA_TYPES code
// (0 other, 1 fcc, 2 hcp, 3 bcc, 4 ico); `centrosymmetry` holds A^2.
export const CNA_TYPE_PROPERTY = `cna_type`
export const CENTROSYMMETRY_PROPERTY = `centrosymmetry`

export interface StructureIdOptions {
  cna_mode?: CnaMode
  // Required (and only used) when cna_mode is `fixed`
  cutoff?: number
  // Nearest neighbors entering the CSP sum: 12 for fcc, 8 for bcc. Must be even.
  n_csp_neighbors?: number
  // Skip either analysis when only the other is wanted. In adaptive mode they share one
  // neighbor list, so running both costs barely more than running one.
  skip_cna?: boolean
  skip_csp?: boolean
  // Overrides the lattice's own periodicity flags
  pbc?: Pbc
}

export interface StructureIdResult {
  // One CNA_TYPES code per site, or null when skip_cna was set
  cna_types: Int8Array | null
  // Centrosymmetry per site in A^2, or null when skip_csp was set. NaN for sites with fewer
  // than n_csp_neighbors neighbors.
  centrosymmetry: Float64Array | null
  // Site count per CNA type name; all five keys are always present (0 when absent)
  populations: Record<CnaTypeName, number>
  n_atoms: number
  cna_mode: CnaMode
  n_csp_neighbors: number
  // Sites that could not be given a CSP value because they have fewer than n_csp_neighbors
  // neighbors (cluster surfaces, isolated fragments)
  n_csp_undefined: number
  // Largest radius searched by the neighbor queries that fed the analysis, in A: the grown
  // k-nearest radius, or the fixed CNA cutoff when that was the only query
  neighbor_cutoff: number
}

export function calc_structure_id(
  structure: AnyStructure,
  options: StructureIdOptions = {},
): StructureIdResult {
  const {
    cna_mode = `adaptive`,
    cutoff,
    n_csp_neighbors = 12,
    skip_cna = false,
    skip_csp = false,
    pbc,
  } = options

  const n_atoms = structure.sites.length
  if (n_atoms === 0) throw new Error(`calc_structure_id: structure has no sites`)
  if (skip_cna && skip_csp) {
    throw new Error(
      `calc_structure_id: skip_cna and skip_csp are both set, nothing to compute`,
    )
  }
  // Reject bad N before the k-nearest search grows a cutoff for a k that can never be satisfied.
  if (!skip_csp) validate_csp_neighbors(n_csp_neighbors)
  // Fixed-cutoff CNA is DEFINED by its cutoff, so that query is the one it must see. Adaptive
  // CNA and CSP both want the k nearest neighbors and share one query sized for whichever
  // asks for more. CSP never runs on the fixed-cutoff list: the shell a cutoff encloses is
  // not the k nearest (a vacancy neighbor's 11-atom shell would read as NaN, a wide cutoff
  // would need its block truncated), so in fixed mode it gets its own k query.
  const fixed_cutoff = cna_mode === `fixed` && !skip_cna ? (cutoff ?? NaN) : null
  if (fixed_cutoff !== null && !(fixed_cutoff > 0)) {
    throw new Error(
      `calc_structure_id: cna_mode 'fixed' needs a positive cutoff (0.854 * a_fcc or ` +
        `1.207 * a_bcc for the phase under study), got ${cutoff}`,
    )
  }
  const k_neighbors = Math.max(
    skip_cna || fixed_cutoff !== null ? 0 : N_ADAPTIVE_CNA_NEIGHBORS,
    skip_csp ? 0 : n_csp_neighbors,
  )

  let cna_types: Int8Array | null = null
  let centrosymmetry: Float64Array | null = null
  let neighbor_cutoff = 0
  if (fixed_cutoff !== null) {
    const list = neighbor_query(structure, { cutoff: fixed_cutoff, pbc })
    cna_types = calc_cna(list, `fixed`)
    neighbor_cutoff = list.cutoff
  }
  if (k_neighbors > 0) {
    const list = neighbor_query(structure, { k: k_neighbors, pbc })
    if (!skip_cna && fixed_cutoff === null) cna_types = calc_cna(list, cna_mode)
    if (!skip_csp) centrosymmetry = calc_centrosymmetry(list, n_csp_neighbors)
    neighbor_cutoff = Math.max(neighbor_cutoff, list.cutoff)
  }

  const populations = Object.fromEntries(CNA_TYPE_NAMES.map((name) => [name, 0])) as Record<
    CnaTypeName,
    number
  >
  if (cna_types) for (const code of cna_types) populations[CNA_TYPE_NAMES[code]]++

  let n_csp_undefined = 0
  if (centrosymmetry) {
    for (const value of centrosymmetry) if (Number.isNaN(value)) n_csp_undefined++
  }

  return {
    cna_types,
    centrosymmetry,
    populations,
    n_atoms,
    cna_mode,
    n_csp_neighbors,
    n_csp_undefined,
    neighbor_cutoff,
  }
}

// Write per-site results into site.properties. Kept separate from calc_structure_id so the
// worker can ship plain buffers back and the caller decides whether to mutate the structure.
export function apply_structure_id(structure: AnyStructure, result: StructureIdResult): void {
  const { sites } = structure
  if (sites.length !== result.n_atoms) {
    throw new Error(
      `apply_structure_id: result covers ${result.n_atoms} atoms but the structure has ` +
        `${sites.length} sites; the result belongs to a different structure or frame`,
    )
  }
  for (const [site_idx, site] of sites.entries()) {
    if (result.cna_types) site.properties[CNA_TYPE_PROPERTY] = result.cna_types[site_idx]
    if (result.centrosymmetry) {
      site.properties[CENTROSYMMETRY_PROPERTY] = result.centrosymmetry[site_idx]
    }
  }
}

// Name for a numeric code, for tooltips and legends
export const cna_type_name = (code: number): CnaTypeName => {
  const name = CNA_TYPE_NAMES[code]
  if (!name) throw new Error(`cna_type_name: ${code} is not a CNA type code (0-4)`)
  return name
}
