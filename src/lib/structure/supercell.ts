// Supercell generation utilities for PymatgenStructure
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { PymatgenStructure, Site } from './index'

type SupercellType = PymatgenStructure & {
  supercell_scaling?: Vec3
}

// Parse supercell scaling input from various formats. Can be "2x2x2", [2,2,2], or a single number.
// Returns [x, y, z] scaling factors.
export function parse_supercell_scaling(scaling: string | number | Vec3): Vec3 {
  if (typeof scaling === `string`) {
    // Parse "2x2x2" format
    const parts = scaling.toLowerCase().split(/[x×,\s]+/).filter((p) => p.trim())
    if (parts.length === 1) {
      const val = parseInt(parts[0], 10)
      if (isNaN(val) || val <= 0) {
        throw new Error(`Invalid supercell scaling: ${scaling}`)
      }
      return [val, val, val] as Vec3
    } else if (parts.length === 3) {
      const values = parts.map((val) => parseInt(val))
      if (values.some((val) => isNaN(val) || val <= 0)) {
        throw new Error(`Invalid supercell scaling: ${scaling}`)
      }
      return values as Vec3
    } else {
      throw new Error(
        `Invalid supercell format: ${scaling}. Use formats like "2x2x2" or "3x1x2"`,
      )
    }
  } else if (typeof scaling === `number`) {
    if (scaling <= 0 || !Number.isInteger(scaling)) {
      throw new Error(`Supercell scaling must be a positive integer, got: ${scaling}`)
    }
    return [scaling, scaling, scaling] as Vec3
  } else if (Array.isArray(scaling) && scaling.length === 3) {
    if (scaling.some((v) => !Number.isInteger(v) || v <= 0)) {
      throw new Error(
        `All supercell scaling factors must be positive integers: ${scaling}`,
      )
    }
    return scaling as Vec3
  } else {
    throw new Error(`Invalid supercell scaling format: ${scaling}`)
  }
}

// Generate all lattice points for a supercell. Takes [nx, ny, nz] scaling factors
// and returns array of fractional coordinates for lattice points
export function generate_lattice_points(scaling_factors: Vec3): Vec3[] {
  const [nx, ny, nz] = scaling_factors
  const points: Vec3[] = []

  // Generate in x, y, z order to match expected test results
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        points.push([i, j, k] as Vec3)
      }
    }
  }

  return points
}

// Scale a lattice matrix by supercell factors
// Takes original 3x3 lattice matrix and [nx, ny, nz] scaling factors
// Returns new scaled lattice matrix
export function scale_lattice_matrix(
  original_matrix: Matrix3x3,
  scaling_factors: Vec3,
): Matrix3x3 {
  const [nx, ny, nz] = scaling_factors

  // Scale each lattice vector by its corresponding factor
  return [
    math.scale(original_matrix[0], nx),
    math.scale(original_matrix[1], ny),
    math.scale(original_matrix[2], nz),
  ] as Matrix3x3
}

// Create a supercell from a PymatgenStructure
// Takes original structure, scaling factors, and whether to fold coordinates back to unit cell (default: true)
// Returns new supercell structure
export function make_supercell(
  structure: PymatgenStructure,
  scaling: string | number | Vec3,
  to_unit_cell: boolean = true,
): PymatgenStructure {
  if (!structure.lattice) {
    throw new Error(`Cannot create supercell: structure has no lattice`)
  }

  const scaling_factors = parse_supercell_scaling(scaling)
  const [nx, ny, nz] = scaling_factors

  // Create new scaled lattice
  const new_lattice_matrix = scale_lattice_matrix(
    structure.lattice.matrix,
    scaling_factors,
  )
  const det = nx * ny * nz

  // Calculate new lattice parameters efficiently
  const lattice_params = math.calc_lattice_params(new_lattice_matrix)

  const new_lattice = {
    ...structure.lattice,
    matrix: new_lattice_matrix,
    ...lattice_params,
  }

  // Generate all lattice points in the supercell
  const lattice_points = generate_lattice_points(scaling_factors)

  // Create new sites by replicating each original site at all lattice points
  const new_sites: Site[] = []

  for (const original_site of structure.sites) {
    for (const lattice_point of lattice_points) {
      // Convert lattice point to cartesian coordinates using original lattice
      // Use transpose of lattice matrix for proper coordinate conversion
      const translation_cart = math.mat3x3_vec3_multiply(
        math.transpose_3x3_matrix(structure.lattice.matrix),
        lattice_point,
      )

      // New cartesian position = original + translation
      const new_xyz = math.add(original_site.xyz, translation_cart) as Vec3

      // Calculate new fractional coordinates in the supercell lattice
      // Use transpose convention for coordinate conversion
      let new_abc = math.mat3x3_vec3_multiply(
        math.matrix_inverse_3x3(math.transpose_3x3_matrix(new_lattice_matrix)),
        new_xyz,
      ) as Vec3

      // Fold back to unit cell if requested
      if (to_unit_cell) {
        new_abc = new_abc.map((coord) => {
          // Use modulo to wrap coordinates to [0, 1)
          let wrapped = coord % 1
          if (wrapped < 0) wrapped += 1
          // Handle floating point precision: if very close to 1, set to 0
          if (Math.abs(wrapped - 1) < 1e-10) wrapped = 0
          return wrapped
        }) as Vec3
      }

      // Recalculate cartesian coordinates from wrapped fractional coordinates
      // to ensure consistency
      const final_xyz = math.mat3x3_vec3_multiply(
        math.transpose_3x3_matrix(new_lattice_matrix),
        new_abc,
      ) as Vec3

      // Create new site
      const new_site: Site = {
        ...original_site,
        xyz: final_xyz,
        abc: new_abc,
        // Update label to indicate supercell position if it has numeric suffix
        label: lattice_points.length > 1
          ? `${original_site.label}_${lattice_point.join(``)}`
          : original_site.label,
      }

      new_sites.push(new_site)
    }
  }

  // Create new supercell structure
  const supercell: SupercellType = {
    ...structure,
    lattice: new_lattice,
    sites: new_sites,
    // Scale charge if present
    charge: structure.charge ? structure.charge * det : structure.charge,
    // Add metadata for supercell detection
    supercell_scaling: scaling_factors,
  }

  return supercell
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

// Format supercell scaling factors for display
// Takes scaling factors and returns formatted string like "2×2×2"
export function format_supercell_scaling(scaling: Vec3): string {
  return scaling.join(`×`)
}
