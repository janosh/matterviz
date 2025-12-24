// Supercell generation utilities for Crystal
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal, Site } from './index'

// Wrap fractional coordinates to [0, 1) range, clamping near-1 values to 0
const wrap_frac = (coord: number): number => {
  const wrapped = ((coord % 1) + 1) % 1
  return wrapped >= 1 - 1e-10 ? 0 : wrapped
}

type SupercellType = Crystal & {
  supercell_scaling?: Vec3
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
      throw new Error(
        `All supercell scaling factors must be positive integers: ${scaling}`,
      )
    }
    return scaling as Vec3
  }
  if (typeof scaling === `string`) {
    // Parse "2x2x2" format
    const parts = scaling.trim().toLowerCase().split(/[x×,\s]+/).filter((part) =>
      part.length > 0
    )

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
  const points: Vec3[] = new Array(count)

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

// Scale a lattice matrix by supercell factors
// Takes original 3x3 lattice matrix and [scale_x, scale_y, scale_z] scaling factors
// Returns new scaled lattice matrix
export function scale_lattice_matrix(
  orig_matrix: math.Matrix3x3,
  scaling_factors: Vec3,
): math.Matrix3x3 {
  const [nx, ny, nz] = scaling_factors
  const [a, b, c] = orig_matrix
  // Scale each lattice vector by its corresponding factor
  return [
    [a[0] * nx, a[1] * nx, a[2] * nx],
    [b[0] * ny, b[1] * ny, b[2] * ny],
    [c[0] * nz, c[1] * nz, c[2] * nz],
  ]
}

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
  const new_lattice_matrix = scale_lattice_matrix(orig_matrix, supercell_scaling)
  const lattice_params = math.calc_lattice_params(new_lattice_matrix)

  const new_lattice = {
    ...structure.lattice,
    matrix: new_lattice_matrix,
    ...lattice_params,
  }

  // Pre-allocate sites array
  const n_sites = structure.sites.length
  const new_sites: Site[] = new Array(n_sites * total_cells)

  // Destructure lattice vectors for fast inline arithmetic (avoid function calls in hot loop)
  const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = orig_matrix
  const [sx, sy, sz] = supercell_scaling

  let write_idx = 0
  const sites = structure.sites

  // Loop order: k, j, i to match typical pymatgen/standard ordering
  for (let kk = 0; kk < scale_z; kk++) {
    for (let jj = 0; jj < scale_y; jj++) {
      for (let ii = 0; ii < scale_x; ii++) {
        const label_suffix = total_cells > 1 ? `_${ii}${jj}${kk}` : ``

        // Translation = ii * vec_a + jj * vec_b + kk * vec_c (inlined for performance)
        const tx = ii * ax + jj * bx + kk * cx
        const ty = ii * ay + jj * by + kk * cy
        const tz = ii * az + jj * bz + kk * cz

        for (let site_idx = 0; site_idx < n_sites; site_idx++) {
          const site = sites[site_idx]

          // new_abc = (old_abc + [ii, jj, kk]) / supercell_scaling
          let new_a = (site.abc[0] + ii) / sx
          let new_b = (site.abc[1] + jj) / sy
          let new_c = (site.abc[2] + kk) / sz

          if (to_unit_cell) {
            new_a = wrap_frac(new_a)
            new_b = wrap_frac(new_b)
            new_c = wrap_frac(new_c)
          }

          new_sites[write_idx++] = {
            species: site.species,
            xyz: [site.xyz[0] + tx, site.xyz[1] + ty, site.xyz[2] + tz],
            abc: [new_a, new_b, new_c],
            label: label_suffix ? `${site.label}${label_suffix}` : site.label,
            properties: { ...site.properties, orig_unit_cell_idx: site_idx },
          }
        }
      }
    }
  }

  return {
    ...structure,
    lattice: new_lattice,
    sites: new_sites,
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
