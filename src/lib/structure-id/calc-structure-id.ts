// Top-level structure identification: one neighbor query feeds both CNA and CSP.
import type { AnyStructure } from '$lib/structure'
import type { CnaTypeName } from './calc-cna'
import { calc_cna, CNA_TYPE_NAMES } from './calc-cna'
import { calc_centrosymmetry, validate_csp_neighbors } from './calc-csp'
import type { StructureIdOptions, StructureIdResult } from './index'
import type { NeighborList } from './neighbors'
import { build_neighbor_list, find_k_nearest } from './neighbors'

// Neighbors a-CNA needs: 8 first-shell + 6 second-shell bcc candidates
const N_ADAPTIVE_CNA_NEIGHBORS = 14

// site.properties keys written by apply_structure_id. `cna_type` holds a CNA_TYPES code
// (0 other, 1 fcc, 2 hcp, 3 bcc, 4 ico); `centrosymmetry` holds Å².
export const CNA_TYPE_PROPERTY = `cna_type`
export const CENTROSYMMETRY_PROPERTY = `centrosymmetry`

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
  // Reject bad N before find_k_nearest grows a cutoff for a k that can never be satisfied.
  if (!skip_csp) validate_csp_neighbors(n_csp_neighbors)
  // Fixed-cutoff CNA is DEFINED by its cutoff, so that query is the one it must see. Every
  // other case takes a k-nearest query sized for whichever analysis wants more neighbors.
  const use_fixed_cutoff = cna_mode === `fixed` && !skip_cna
  let list: NeighborList
  if (use_fixed_cutoff) {
    if (!(cutoff !== undefined && cutoff > 0)) {
      throw new Error(
        `calc_structure_id: cna_mode 'fixed' needs a positive cutoff (0.854 * a_fcc or ` +
          `1.207 * a_bcc for the phase under study), got ${cutoff}`,
      )
    }
    list = build_neighbor_list(structure, { cutoff, pbc })
  } else {
    const k_neighbors = Math.max(
      skip_cna ? 0 : N_ADAPTIVE_CNA_NEIGHBORS,
      skip_csp ? 0 : n_csp_neighbors,
    )
    list = find_k_nearest(structure, k_neighbors, { pbc }).list
  }

  const cna_types = skip_cna ? null : calc_cna(list, cna_mode, cutoff)
  const centrosymmetry = skip_csp ? null : calc_centrosymmetry(list, n_csp_neighbors)

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
    cutoff: use_fixed_cutoff ? (cutoff ?? null) : null,
    n_csp_neighbors,
    n_csp_undefined,
    neighbor_cutoff: list.cutoff,
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

// Population of each CNA type as a fraction of all atoms, for plotting phase fractions over
// trajectory frames without every caller re-dividing by n_atoms
export const structure_type_fractions = (
  result: StructureIdResult,
): Record<CnaTypeName, number> =>
  Object.fromEntries(
    CNA_TYPE_NAMES.map((name) => [name, result.populations[name] / result.n_atoms]),
  ) as Record<CnaTypeName, number>

// Name for a numeric code, for tooltips and legends
export const cna_type_name = (code: number): CnaTypeName => {
  const name = CNA_TYPE_NAMES[code]
  if (!name) throw new Error(`cna_type_name: ${code} is not a CNA type code (0-4)`)
  return name
}
