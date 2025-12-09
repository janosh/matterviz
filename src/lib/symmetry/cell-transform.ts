// Cell transformation utilities for converting between original, conventional, and primitive cells
import type { ElementSymbol, Vec3 } from '$lib'
import { ATOMIC_NUMBER_TO_SYMBOL } from '$lib/composition/parse'
import * as math from '$lib/math'
import type { PymatgenStructure, Site } from '$lib/structure'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
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
  const lattice_T = math.transpose_3x3_matrix(lattice_matrix)

  // Build sites from positions and atomic numbers
  const sites: Site[] = cell.positions.map((abc, idx) => {
    const atomic_number = cell.numbers[idx]
    const element = ATOMIC_NUMBER_TO_SYMBOL[atomic_number] as ElementSymbol
    if (!element) {
      throw new Error(`Unknown atomic number: ${atomic_number}`)
    }

    // Wrap fractional coordinates to [0, 1) range (moyo-wasm may return outside)
    const wrapped_abc = wrap_to_unit_cell(abc as Vec3)

    // Convert fractional to Cartesian: xyz = lattice_T · abc
    const xyz = math.mat3x3_vec3_multiply(lattice_T, wrapped_abc)

    // Oxidation state is set to 0 (unknown) because moyo-wasm only provides atomic numbers.
    // transformed cell may have different/reordered sites, making it non-trivial to
    // map oxidation states from original structure.
    const species = [{ element, occu: 1, oxidation_state: 0 }]
    return { species, abc: wrapped_abc, xyz, label: element, properties: {} }
  })

  const lattice = {
    matrix: lattice_matrix,
    pbc: original_structure.lattice.pbc,
    ...lattice_params,
  }
  return { lattice, sites, charge: original_structure.charge, id: original_structure.id }
}

// Get the conventional (standardized) cell from symmetry analysis data.
// The conventional cell is the standard crystallographic setting for the space group.
export function get_conventional_cell(
  original_structure: PymatgenStructure, // The original input structure
  sym_data: MoyoDataset, // MoyoDataset from symmetry analysis containing std_cell
): PymatgenStructure { // The conventional cell as a PymatgenStructure
  return moyo_cell_to_structure(sym_data.std_cell, original_structure)
}

// Get the primitive cell from symmetry analysis data.
// The primitive cell is the smallest unit cell with one lattice point.
export function get_primitive_cell(
  original_structure: PymatgenStructure, // The original input structure
  sym_data: MoyoDataset, // MoyoDataset from symmetry analysis containing prim_std_cell
): PymatgenStructure { // The primitive cell as a PymatgenStructure
  return moyo_cell_to_structure(sym_data.prim_std_cell, original_structure)
}

// Transform a structure based on the selected cell type.
// Returns the original structure if cell_type is 'original' or if sym_data is not available.
export function transform_cell(
  structure: PymatgenStructure, // The original structure
  cell_type: CellType, // The desired cell type ('original', 'conventional', or 'primitive')
  sym_data: MoyoDataset | null, // Optional MoyoDataset from symmetry analysis
): PymatgenStructure { //transformed structure (or original if no transformation needed)
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
