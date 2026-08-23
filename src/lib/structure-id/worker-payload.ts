// Wire format between the per-frame geometry workers (structure-id, trajectory RDF) and their
// callers. The analyses read nothing but Cartesian positions, the lattice and (for the RDF's
// element pairs) one element per site, so that is all that crosses the thread boundary: one
// flat Float64Array instead of a snapshot of every site (species, abc, label, properties),
// which was 3.85x the bytes for the same answer.
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3, Vec3 } from '$lib/math'
import type { AnyStructure, LatticeType, Pbc, Site } from '$lib/structure'

export interface StructureIdPayload {
  // x, y, z of site 0, then site 1, ... in A
  xyz: Float64Array
  lattice?: LatticeType
  // Majority element per site; only sent when the analysis groups by species
  elements?: ElementSymbol[]
}

// Plain copies throughout: a Svelte $state proxy is not structured-cloneable, and the numbers
// read through it are.
export const to_structure_id_payload = (
  structure: AnyStructure,
  with_elements = false,
): StructureIdPayload => {
  const { sites } = structure
  const xyz = new Float64Array(sites.length * 3)
  for (const [site_idx, site] of sites.entries()) xyz.set(site.xyz, site_idx * 3)
  const payload: StructureIdPayload = { xyz }
  if (with_elements) payload.elements = sites.map((site) => site.species[0]?.element ?? `X`)
  if (!(`lattice` in structure)) return payload
  const { lattice } = structure
  payload.lattice = {
    ...lattice,
    matrix: lattice.matrix.map((row) => [...row] as Vec3) as Matrix3x3,
    pbc: [...lattice.pbc] as Pbc,
  }
  return payload
}

// Rebuild a structure the neighbor query can walk. Only `xyz`, `lattice` and `elements` carry
// data; the remaining Site fields exist to satisfy the type and are never read by the analyses.
export const structure_from_payload = ({
  xyz,
  lattice,
  elements,
}: StructureIdPayload): AnyStructure => {
  if (xyz.length % 3 !== 0) {
    throw new Error(
      `structure_from_payload: xyz holds ${xyz.length} numbers, not a multiple of 3`,
    )
  }
  const sites: Site[] = Array.from({ length: xyz.length / 3 }, (_unused, site_idx) => ({
    xyz: [xyz[site_idx * 3], xyz[site_idx * 3 + 1], xyz[site_idx * 3 + 2]],
    abc: [0, 0, 0],
    species: elements ? [{ element: elements[site_idx], occu: 1, oxidation_state: 0 }] : [],
    label: ``,
    properties: {},
  }))
  return lattice ? { sites, lattice } : { sites }
}
