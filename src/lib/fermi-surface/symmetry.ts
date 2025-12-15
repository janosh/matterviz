// Point group symmetry operations for Fermi surface tiling
import type { Matrix4Tuple } from '$lib/math'

// Identity 4x4 matrix (column-major for Three.js)
// deno-fmt-ignore
export const IDENTITY_4x4: Matrix4Tuple = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]

// All permutations of (0, 1, 2) for axis swaps
const AXIS_PERMUTATIONS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const

// All sign combinations for coordinate flips
const SIGN_COMBINATIONS = [
  [1, 1, 1],
  [1, 1, -1],
  [1, -1, 1],
  [1, -1, -1],
  [-1, 1, 1],
  [-1, 1, -1],
  [-1, -1, 1],
  [-1, -1, -1],
] as const

// Generate the 48 symmetry operations of the cubic Oh point group.
// These are all combinations of axis permutations (6) and sign flips (8).
// Used to tile the irreducible BZ to fill the full first Brillouin zone.
function generate_oh_symmetry_matrices(): Matrix4Tuple[] {
  const matrices: Matrix4Tuple[] = []

  for (const perm of AXIS_PERMUTATIONS) {
    for (const sign of SIGN_COMBINATIONS) {
      // Column-major 4x4 matrix: element at (row, col) is at index col*4 + row
      const mat: number[] = new Array(16).fill(0)
      mat[15] = 1 // w component

      // Build 3x3 rotation part: M[row][col] = sign[row] if perm[row] === col
      for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
          mat[col * 4 + row] = perm[row] === col ? sign[row] : 0
        }
      }
      matrices.push(mat as Matrix4Tuple)
    }
  }

  return matrices
}

// Pre-computed Oh symmetry matrices (48 operations)
export const OH_SYMMETRY_MATRICES = generate_oh_symmetry_matrices()
