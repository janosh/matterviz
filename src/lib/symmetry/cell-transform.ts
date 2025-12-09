// Cell transformation utilities for converting between original, conventional, and primitive cells
import type { ElementSymbol, Vec3 } from '$lib'
import { ATOMIC_NUMBER_TO_SYMBOL } from '$lib/composition/parse'
import * as math from '$lib/math'
import type { PymatgenStructure, Site } from '$lib/structure'
import type { MoyoCell, MoyoDataset } from '@spglib/moyo-wasm'

export type CellType = `original` | `conventional` | `primitive`

/**
 * Convert a MoyoCell (from moyo-wasm symmetry analysis) to PymatgenStructure format.
 * MoyoCell has a flat 9-element basis array and atomic numbers; this converts to
 * the full PymatgenStructure with lattice parameters and element symbols.
 *
 * @param cell - The MoyoCell from symmetry analysis (std_cell or prim_std_cell)
 * @param original_structure - The original structure (used to preserve pbc and other metadata)
 * @returns A PymatgenStructure with the transformed cell
 */
export function moyo_cell_to_structure(
  cell: MoyoCell,
  original_structure: PymatgenStructure,
): PymatgenStructure {
  // Convert flat 9-element basis to 3x3 matrix
  // moyo-wasm uses the same row-major serialization for both input and output
  // (see to_cell_json comment: column-major(B) == row-major(RB))
  // So the flat array is row-major: [a1, a2, a3, b1, b2, b3, c1, c2, c3]
  // where each row is a lattice vector in the pymatgen convention
  const basis = cell.lattice.basis
  const lattice_matrix: math.Matrix3x3 = [
    [basis[0], basis[1], basis[2]], // First lattice vector (a)
    [basis[3], basis[4], basis[5]], // Second lattice vector (b)
    [basis[6], basis[7], basis[8]], // Third lattice vector (c)
  ]

  // Calculate lattice parameters from matrix
  const lattice_params = math.calc_lattice_params(lattice_matrix)

  // Build sites from positions and atomic numbers
  const sites: Site[] = cell.positions.map((abc, idx) => {
    const atomic_number = cell.numbers[idx]
    const element = ATOMIC_NUMBER_TO_SYMBOL[atomic_number] as ElementSymbol
    if (!element) {
      throw new Error(`Unknown atomic number: ${atomic_number}`)
    }

    // Wrap fractional coordinates to [0, 1) range
    // moyo-wasm may return coordinates outside this range
    const wrapped_abc = wrap_to_unit_cell(abc as Vec3)

    // Convert fractional to Cartesian coordinates: xyz = abc · lattice_matrix
    const xyz = frac_to_cart(wrapped_abc, lattice_matrix)

    return {
      species: [{ element, occu: 1, oxidation_state: 0 }],
      abc: wrapped_abc,
      xyz,
      label: element,
      properties: {},
    }
  })

  return {
    lattice: {
      matrix: lattice_matrix,
      pbc: original_structure.lattice.pbc,
      ...lattice_params,
    },
    sites,
    charge: original_structure.charge,
    id: original_structure.id,
  }
}

/**
 * Wrap fractional coordinates to [0, 1) range.
 * Handles periodicity by taking the fractional part of each coordinate.
 *
 * @param frac - Fractional coordinates that may be outside [0, 1)
 * @returns Wrapped fractional coordinates in [0, 1)
 */
function wrap_to_unit_cell(frac: Vec3): Vec3 {
  return frac.map((coord) => {
    // Use modulo to wrap to [0, 1), handling negative values correctly
    const wrapped = ((coord % 1) + 1) % 1
    // Handle floating point precision: values very close to 1 should become 0
    return wrapped >= 0.9999999999 ? 0 : wrapped
  }) as Vec3
}

/**
 * Convert fractional coordinates to Cartesian coordinates.
 * xyz = [a, b, c] · [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]
 *
 * @param frac - Fractional coordinates [a, b, c]
 * @param lattice_matrix - 3x3 lattice matrix where each row is a lattice vector
 * @returns Cartesian coordinates [x, y, z]
 */
function frac_to_cart(frac: Vec3, lattice_matrix: math.Matrix3x3): Vec3 {
  const [fa, fb, fc] = frac
  const [avec, bvec, cvec] = lattice_matrix
  return [
    fa * avec[0] + fb * bvec[0] + fc * cvec[0],
    fa * avec[1] + fb * bvec[1] + fc * cvec[1],
    fa * avec[2] + fb * bvec[2] + fc * cvec[2],
  ]
}

/**
 * Get the conventional (standardized) cell from symmetry analysis data.
 * The conventional cell is the standard crystallographic setting for the space group.
 *
 * @param original_structure - The original input structure
 * @param sym_data - MoyoDataset from symmetry analysis containing std_cell
 * @returns The conventional cell as a PymatgenStructure
 */
export function get_conventional_cell(
  original_structure: PymatgenStructure,
  sym_data: MoyoDataset,
): PymatgenStructure {
  return moyo_cell_to_structure(sym_data.std_cell, original_structure)
}

/**
 * Get the primitive cell from symmetry analysis data.
 * The primitive cell is the smallest unit cell with one lattice point.
 *
 * @param original_structure - The original input structure
 * @param sym_data - MoyoDataset from symmetry analysis containing prim_std_cell
 * @returns The primitive cell as a PymatgenStructure
 */
export function get_primitive_cell(
  original_structure: PymatgenStructure,
  sym_data: MoyoDataset,
): PymatgenStructure {
  return moyo_cell_to_structure(sym_data.prim_std_cell, original_structure)
}

/**
 * Transform a structure based on the selected cell type.
 * Returns the original structure if cell_type is 'original' or if sym_data is not available.
 *
 * @param structure - The original structure
 * @param cell_type - The desired cell type ('original', 'conventional', or 'primitive')
 * @param sym_data - Optional MoyoDataset from symmetry analysis
 * @returns The transformed structure (or original if no transformation needed)
 */
export function transform_cell(
  structure: PymatgenStructure,
  cell_type: CellType,
  sym_data: MoyoDataset | null,
): PymatgenStructure {
  if (cell_type === `original` || !sym_data) {
    return structure
  }

  if (cell_type === `conventional`) {
    return get_conventional_cell(structure, sym_data)
  }

  if (cell_type === `primitive`) {
    return get_primitive_cell(structure, sym_data)
  }

  // Fallback to original (should never reach here with proper typing)
  return structure
}
