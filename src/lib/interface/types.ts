// Shared types and defaults for the heterointerface builder. Everything here reaches the
// package root through `export *`, hence the INTERFACE_ prefix on the defaults.
import type { Vec2, Vec3 } from '#lib/math.js'
import type { Crystal } from '#lib/structure/index.js'

// 2×2 matrix stored as rows. Integer-valued for in-plane supercell transforms, real for strain.
export type Matrix2x2 = [Vec2, Vec2]

export const INTERFACE_DEFAULTS = {
  max_area: 400, // Å², largest coincidence cell searched on either side
  length_tol: 0.03, // relative mismatch of the two super-lattice vector lengths
  angle_tol: 0.01, // relative mismatch of the angle between them
  max_matches: 50,
  gap: 2, // Å between the substrate top and the film bottom
  vacuum: 15, // Å above the film
} as const

// A slab's surface expressed in 2D: x ∥ a, y = n̂ × â, n̂ = unit(a × b).
export type SurfaceFrame = {
  // In-plane lattice rows a and b in that frame, Å. Right-handed by construction (b_y > 0).
  basis: Matrix2x2
  // Cartesian unit vectors of the frame's x and y axes and of the normal n̂
  axes: [Vec3, Vec3, Vec3]
}

// Rotation-free strain of the film once it is stretched onto the substrate's lattice
export type MatchStrain = {
  // ε = U − I with U the right stretch of the deformation F (F = R·U), symmetric, in the
  // film's surface frame (x ∥ film a). Positive = the film is stretched.
  strain: Matrix2x2
  // sqrt(εxx² − εxx·εyy + εyy² + 3εxy²)
  von_mises: number
  // In-plane rotation R that carries the stretched film onto the substrate, degrees
  // counter-clockwise about the normal. Matches equivalent under a lattice symmetry can differ
  // here by that symmetry's angle.
  rotation_deg: number
}

// film_matrix · [a_f, b_f] and substrate_matrix · [a_s, b_s] are the two right-handed
// super-lattice bases the film is strained between
export type MatchMatrices = { film_matrix: Matrix2x2; substrate_matrix: Matrix2x2 }

// One coincidence-lattice match, with Gauss-reduced super-lattice bases from match_lattices
export type LatticeMatch = MatchStrain &
  MatchMatrices & {
    // Area of the substrate super-cell, i.e. of the interface cell, Å²
    area: number
    n_film_cells: number
    n_substrate_cells: number
  }

// Defaults in INTERFACE_DEFAULTS
export type LatticeMatchOptions = {
  max_area?: number
  length_tol?: number
  angle_tol?: number
  max_matches?: number
}

export type InterfaceOptions = {
  // Super-lattices to stack, e.g. a match from match_lattices; omitted = stack the two
  // primitive meshes 1×1. The strain is always recomputed for the given slabs.
  match?: MatchMatrices
  gap?: number
  vacuum?: number
  // In-plane registry offset of the film, fractional coordinates of the interface cell
  shift?: Vec2
}

export type InterfaceInfo = {
  match: LatticeMatch
  gap: number
  vacuum: number
  shift: Vec2
  // Distance between the lowest and highest atomic plane of each slab, Å
  substrate_thickness: number
  film_thickness: number
  n_substrate_sites: number
  n_film_sites: number
}

export type InterfaceRole = `substrate` | `film`

export type Heterostructure = Crystal & { interface_info: InterfaceInfo }
