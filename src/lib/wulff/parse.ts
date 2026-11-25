// Surface energies from Materials Project or pymatgen JSON, as compute_wulff_shape's input.
// Plain TypeScript: no pymatgen needed to read either.
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import type { WulffFacetInput } from './types'

// J/m² per eV/Å²: e / 1e-20 m² with CODATA 2018's exact e. The Materials Project's own
// conversion (16.0217656) differs by 5e-8 relative.
export const EV_PER_A2_TO_J_PER_M2 = 16.02176634

export type ParsedSurfaceEnergies = {
  facets: WulffFacetInput[]
  lattice?: Matrix3x3 // pymatgen's WulffShape lattice (an MP document has none)
  label?: string // material id and formula of an MP document
}

const is_record = (val: unknown): val is Record<string, unknown> =>
  typeof val === `object` && val !== null && !Array.isArray(val)
const is_number = (val: unknown): val is number =>
  typeof val === `number` && Number.isFinite(val)

// (h k l), or hexagonal Miller-Bravais (h k i l) as the Materials Project lists them, whose
// redundant i = -(h + k) is dropped
const to_miller = (raw: unknown, where: string): Vec3 => {
  const ints = Array.isArray(raw) && raw.every(Number.isInteger) ? (raw as number[]) : []
  if (ints.length === 3) return [ints[0], ints[1], ints[2]]
  const [h_idx, k_idx, i_idx, l_idx] = ints
  if (ints.length === 4 && i_idx === -(h_idx + k_idx)) return [h_idx, k_idx, l_idx]
  throw new Error(
    `${where}: expected Miller indices (h k l) or (h k i l) with i = -(h + k), got ${JSON.stringify(raw)}`,
  )
}

// A Materials Project surface-property document ({ surfaces: [{ miller_index,
// surface_energy (J/m²) or surface_energy_EV_PER_ANG2 }] }, alone, as an API response's
// { data: [doc] } or keyed by its material id) or pymatgen WulffShape's arguments ({ lattice, miller_list, e_surf_list },
// energies read as J/m², lattice a 3x3 matrix or a Lattice.as_dict()).
export function parse_surface_energies(json: unknown): ParsedSurfaceEnergies {
  let data = json
  // documents keyed by material id (pymatgen's surface_samples.json) or an MP API response
  const docs = is_record(data)
    ? Array.isArray(data.data)
      ? data.data
      : Object.entries(data).every(([key, doc]) => key.startsWith(`mp-`) && is_record(doc))
        ? Object.values(data)
        : null
    : null
  if (docs?.length === 1) data = docs[0]
  else if (docs) throw new Error(`File holds ${docs.length} materials, pass one`)
  if (is_record(data) && Array.isArray(data.surfaces)) {
    const facets = data.surfaces.map((surface: unknown, idx): WulffFacetInput => {
      const where = `surfaces[${idx}]`
      if (!is_record(surface)) throw new Error(`${where} is not an object`)
      const { surface_energy, surface_energy_EV_PER_ANG2: ev_per_a2 } = surface
      const energy = is_number(surface_energy)
        ? surface_energy
        : is_number(ev_per_a2)
          ? ev_per_a2 * EV_PER_A2_TO_J_PER_M2
          : null
      if (energy === null) {
        throw new Error(`${where} has neither surface_energy nor surface_energy_EV_PER_ANG2`)
      }
      return { miller: to_miller(surface.miller_index, where), energy }
    })
    const { material_id, pretty_formula } = data
    const label = [material_id, pretty_formula].filter((val) => typeof val === `string`)
    return { facets, ...(label.length > 0 && { label: label.join(` `) }) }
  }
  if (is_record(data) && Array.isArray(data.miller_list) && Array.isArray(data.e_surf_list)) {
    const { miller_list, e_surf_list } = data
    if (miller_list.length !== e_surf_list.length) {
      throw new Error(
        `miller_list has ${miller_list.length} entries but e_surf_list ${e_surf_list.length}`,
      )
    }
    const matrix = is_record(data.lattice) ? data.lattice.matrix : data.lattice
    const rows = Array.isArray(matrix) ? (matrix as unknown[]) : []
    if (
      rows.length !== 3 ||
      !rows.every((row) => Array.isArray(row) && row.length === 3 && row.every(is_number))
    ) {
      throw new Error(`lattice must be a 3x3 matrix or a pymatgen Lattice dict with one`)
    }
    const facets = miller_list.map((miller: unknown, idx): WulffFacetInput => {
      const energy = e_surf_list[idx]
      if (!is_number(energy)) throw new Error(`e_surf_list[${idx}] is not a number`)
      return { miller: to_miller(miller, `miller_list[${idx}]`), energy }
    })
    return { facets, lattice: rows as Matrix3x3 }
  }
  throw new Error(
    `Unsupported surface-energy JSON: expected a Materials Project surface document ({ surfaces: [{ miller_index, surface_energy }] }) or pymatgen WulffShape fields ({ lattice, miller_list, e_surf_list })`,
  )
}
