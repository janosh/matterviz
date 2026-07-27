// Supercell generation utilities for Crystal
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal, Site, StructureBond } from './index'
import { wrap_frac_coord } from './pbc'
import { normalize_structure_bond } from './bonding'

type SupercellType = Crystal & {
  supercell_scaling?: Vec3
}

const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor

const replicate_bonds_for_supercell = (
  bonds: StructureBond[],
  n_sites: number,
  scaling_factors: Vec3,
): StructureBond[] => {
  const [scale_x, scale_y, scale_z] = scaling_factors
  const replicated: StructureBond[] = []
  const site_offset = ([cell_x, cell_y, cell_z]: Vec3): number =>
    (cell_z * scale_x * scale_y + cell_y * scale_x + cell_x) * n_sites
  for (const [source_cell_idx, source_cell] of generate_lattice_points(
    scaling_factors,
  ).entries()) {
    const source_offset = source_cell_idx * n_sites
    for (const { site_idx_1, site_idx_2, order, cell_shift = [0, 0, 0] } of bonds) {
      const target_raw: Vec3 = [
        source_cell[0] + cell_shift[0],
        source_cell[1] + cell_shift[1],
        source_cell[2] + cell_shift[2],
      ]
      const target_cell: Vec3 = [
        mod(target_raw[0], scale_x),
        mod(target_raw[1], scale_y),
        mod(target_raw[2], scale_z),
      ]
      const supercell_shift = target_raw.map((val, idx) =>
        Math.floor(val / scaling_factors[idx]),
      ) as Vec3
      const target_offset = site_offset(target_cell)
      replicated.push(
        normalize_structure_bond(
          site_idx_1 + source_offset,
          site_idx_2 + target_offset,
          order,
          supercell_shift,
        ),
      )
    }
  }
  return replicated
}

// Parse supercell scaling input from various formats. Can be "2x2x2", "2", [2,2,2], or a single number.
// Returns [x, y, z] scaling factors.
export function parse_supercell_scaling(scaling: string | number | Vec3): Vec3 {
  if (typeof scaling === `number`) {
    if (scaling <= 0 || !Number.isInteger(scaling)) {
      throw new Error(`Supercell scaling must be a positive integer, got: ${scaling}`)
    }
    return [scaling, scaling, scaling]
  }
  if (Array.isArray(scaling) && scaling.length === 3) {
    if (scaling.some((val) => !Number.isInteger(val) || val <= 0)) {
      throw new Error(`All supercell scaling factors must be positive integers: ${scaling}`)
    }
    return scaling
  }
  if (typeof scaling === `string`) {
    // Parse "2x2x2" format
    const parts = scaling
      .trim()
      .toLowerCase()
      .split(/[x×,\s]+/)
      .filter((part) => part.length > 0)

    if (parts.length === 1 || parts.length === 3) {
      // Check that all parts are strictly digits to avoid scientific notation/hex/etc per tests
      if (parts.every((part) => /^\d+$/.test(part))) {
        const values = parts.map(Number)
        if (values.every((val) => val > 0)) {
          return (parts.length === 1 ? [values[0], values[0], values[0]] : values) as Vec3
        }
      }
    }
  }
  throw new Error(`Invalid supercell scaling: ${scaling}`)
}

// Generate all lattice points for a supercell. Takes [scale_x, scale_y, scale_z] scaling factors
// and returns array of fractional coordinates for lattice points
export function generate_lattice_points(scaling_factors: Vec3): Vec3[] {
  const [scale_x, scale_y, scale_z] = scaling_factors
  const count = scale_x * scale_y * scale_z
  const points: Vec3[] = Array(count)

  let write_idx = 0
  // Generate in x, y, z order to match expected test results
  for (let kk = 0; kk < scale_z; kk++) {
    for (let jj = 0; jj < scale_y; jj++) {
      for (let ii = 0; ii < scale_x; ii++) {
        points[write_idx++] = [ii, jj, kk]
      }
    }
  }

  return points
}

// Re-export from $lib/math for backward compatibility
export { scale_lattice_matrix } from '$lib/math'

// Create a supercell from a Crystal
// Takes original structure, scaling factors, and whether to fold coordinates back to unit cell (default: true)
// Returns new supercell structure
export function make_supercell(
  structure: Crystal,
  scaling: string | number | Vec3,
  to_unit_cell: boolean = true,
): Crystal {
  if (!structure.lattice) {
    throw new Error(`Cannot create supercell: structure has no lattice`)
  }

  const supercell_scaling = parse_supercell_scaling(scaling)
  const [scale_x, scale_y, scale_z] = supercell_scaling
  const total_cells = scale_x * scale_y * scale_z

  // Short circuit for 1x1x1 (no actual supercell needed)
  if (scale_x === 1 && scale_y === 1 && scale_z === 1) {
    return { ...structure, supercell_scaling } as SupercellType
  }

  const orig_matrix = structure.lattice.matrix
  // Create new scaled lattice
  const new_matrix = math.scale_lattice_matrix(orig_matrix, supercell_scaling)
  const lattice_params = math.calc_lattice_params(new_matrix)

  const new_lattice = { ...structure.lattice, matrix: new_matrix, ...lattice_params }

  // Pre-allocate sites array
  const n_sites = structure.sites.length
  const new_sites: Site[] = Array(n_sites * total_cells)

  // Destructure lattice vectors for fast inline arithmetic (avoid function calls in hot loop)
  const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = orig_matrix

  let write_idx = 0
  const sites = structure.sites

  // wrap_frac_coord rounds via toFixed, which costs more than the rest of the loop body.
  // A coordinate only depends on its own axis' cell index, so precomputing per axis runs
  // it n_sites * (scale_x + scale_y + scale_z) times instead of 3 * n_sites * total_cells.
  const wrapped_frac = supercell_scaling.map((scale, axis) => {
    const coords = new Float64Array(n_sites * scale)
    for (let cell_idx = 0; cell_idx < scale; cell_idx++) {
      for (let site_idx = 0; site_idx < n_sites; site_idx++) {
        const coord = (sites[site_idx].abc[axis] + cell_idx) / scale
        coords[cell_idx * n_sites + site_idx] = to_unit_cell ? wrap_frac_coord(coord) : coord
      }
    }
    return coords
  })
  // How far the wrap moved each coordinate, in units of the ORIGINAL lattice vector (the
  // supercell-fractional shift times `scale`), so the Cartesian offset below is just the
  // shift against the already-destructured lattice rows. Zero unless the input `abc` lay
  // outside [0,1) — but when it did, `abc` was wrapped while `xyz` was not, so the two
  // described cells a lattice vector apart and consumers reading `abc` (PBC image
  // generation, symmetry) disagreed with those reading `xyz` (rendering, bonding) about
  // where the atom is. Applied to `xyz` so both always name the same position.
  const frac_shift = supercell_scaling.map((scale, axis) => {
    const shifts = new Float64Array(n_sites * scale)
    if (!to_unit_cell) return shifts
    for (let cell_idx = 0; cell_idx < scale; cell_idx++) {
      for (let site_idx = 0; site_idx < n_sites; site_idx++) {
        const flat_idx = cell_idx * n_sites + site_idx
        const coord = (sites[site_idx].abc[axis] + cell_idx) / scale
        shifts[flat_idx] = (wrapped_frac[axis][flat_idx] - coord) * scale
      }
    }
    return shifts
  })
  const any_frac_shift = frac_shift.some((axis_shifts) =>
    axis_shifts.some((shift) => shift !== 0),
  )

  // Identical for every image of a base site, so build once and share the reference —
  // supercell sites already share their base site's `species` array the same way.
  const site_properties = sites.map((site, site_idx) => ({
    ...site.properties,
    orig_unit_cell_idx: site_idx,
  }))

  const needs_label_separator = supercell_scaling.some((scale) => scale > 10)

  // Loop order: k, j, i to match typical pymatgen/standard ordering
  for (let kk = 0; kk < scale_z; kk++) {
    for (let jj = 0; jj < scale_y; jj++) {
      for (let ii = 0; ii < scale_x; ii++) {
        // 1x1x1 short-circuits above, so every site gets a cell-index suffix. Bare
        // concatenation stops being injective once an index reaches two digits — a
        // [12,12,2] supercell gave 288 sites but only 284 distinct labels, since
        // (1,10,0) and (11,0,0) both render as "_1100" — so separate the indices when
        // any axis can produce one. Small supercells keep the compact form.
        const label_suffix = needs_label_separator ? `_${ii}_${jj}_${kk}` : `_${ii}${jj}${kk}`

        // Translation = ii * vec_a + jj * vec_b + kk * vec_c (inlined for performance)
        const tx = ii * ax + jj * bx + kk * cx
        const ty = ii * ay + jj * by + kk * cy
        const tz = ii * az + jj * bz + kk * cz

        for (let site_idx = 0; site_idx < n_sites; site_idx++) {
          const site = sites[site_idx]
          let [wx, wy, wz] = [0, 0, 0]
          if (any_frac_shift) {
            const [shift_a, shift_b, shift_c] = [
              frac_shift[0][ii * n_sites + site_idx],
              frac_shift[1][jj * n_sites + site_idx],
              frac_shift[2][kk * n_sites + site_idx],
            ]
            wx = shift_a * ax + shift_b * bx + shift_c * cx
            wy = shift_a * ay + shift_b * by + shift_c * cy
            wz = shift_a * az + shift_b * bz + shift_c * cz
          }

          new_sites[write_idx++] = {
            species: site.species,
            xyz: [site.xyz[0] + tx + wx, site.xyz[1] + ty + wy, site.xyz[2] + tz + wz],
            abc: [
              wrapped_frac[0][ii * n_sites + site_idx],
              wrapped_frac[1][jj * n_sites + site_idx],
              wrapped_frac[2][kk * n_sites + site_idx],
            ],
            label: `${site.label}${label_suffix}`,
            properties: site_properties[site_idx],
          }
        }
      }
    }
  }

  const properties =
    structure.properties?.bonds === undefined
      ? structure.properties
      : {
          ...structure.properties,
          bonds: replicate_bonds_for_supercell(
            structure.properties.bonds,
            n_sites,
            supercell_scaling,
          ),
        }

  return {
    ...structure,
    lattice: new_lattice,
    sites: new_sites,
    properties,
    charge: structure.charge ? structure.charge * total_cells : structure.charge,
    supercell_scaling,
  } as SupercellType
}

// Validate supercell input string
// Takes user input string and returns true if valid, false otherwise
export function is_valid_supercell_input(input: string): boolean {
  try {
    parse_supercell_scaling(input)
    return true
  } catch {
    return false
  }
}
