// functions for measuring distances and angles between structure sites

import { display_idx } from '#lib/labels.js'
import type { LatticeConverters, Matrix3x3, Vec3 } from '#lib/math.js'
import {
  clamp,
  add,
  create_lattice_converters,
  cross_3d,
  dot,
  EPS,
  min_image_displacement,
  same_position,
  scale,
  subtract,
  to_degrees,
} from '#lib/math.js'
import type { MeasureMode, Site } from '#lib/structure/index.js'
import type { Pbc } from './pbc'

export const MAX_SELECTED_SITES = 8

// Angle and dihedral measure one ordered tuple: past its arity the oldest pick rolls out, so
// the measurement stays live. Other modes accumulate up to MAX_SELECTED_SITES and then refuse,
// since no pick can be dropped without changing the answer.
const ORDERED_TUPLE_SIZES = { angle: 3, dihedral: 4 } as const

export const max_measured_sites = (mode: MeasureMode): number =>
  ORDERED_TUPLE_SIZES[mode as keyof typeof ORDERED_TUPLE_SIZES] ?? MAX_SELECTED_SITES

export const rolls_measured_sites = (mode: MeasureMode): boolean => mode in ORDERED_TUPLE_SIZES

// Calculate minimum image displacement between two points under PBC
// If lattice_matrix is null/undefined, returns Euclidean displacement.
// pbc flags disable wrapping along non-periodic axes (e.g. slab vacuum directions).
export function displacement_pbc(
  from: Vec3,
  target: Vec3,
  lattice_matrix: Matrix3x3 | null | undefined,
  converters?: LatticeConverters,
  pbc?: Pbc,
): Vec3 {
  if (!lattice_matrix) return subtract(target, from)
  return min_image_displacement(from, target, lattice_matrix, converters, pbc)
}

// Displacement between two picked (so drawn) sites: the drawn one when it already is a shortest
// image, e.g. an image atom picked beside its neighbor or one of several equidistant images,
// else the minimum image, for a pick of the in-cell copy across a cell face. A pick of a site's
// own image keeps its lattice vector, which the minimum image would collapse to zero.
export function pick_displacement(
  from: Vec3,
  target: Vec3,
  lattice_matrix: Matrix3x3 | null | undefined,
  converters?: LatticeConverters,
  pbc?: Pbc,
): Vec3 {
  const drawn = subtract(target, from)
  if (!lattice_matrix) return drawn
  const min_image = min_image_displacement(from, target, lattice_matrix, converters, pbc)
  const min_len = Math.hypot(...min_image)
  return min_len < EPS || Math.hypot(...drawn) <= min_len + 1e-6 ? drawn : min_image
}

// Angle between two vectors in degrees (0 for a zero-length vector)
export function angle_between_vectors(vector_1: Vec3, vector_2: Vec3): number {
  const norm_1 = Math.hypot(...vector_1)
  const norm_2 = Math.hypot(...vector_2)
  if (norm_1 === 0 || norm_2 === 0) return 0
  // Normalize dot product to get cosine, clamped to [-1, 1] to avoid acos NaN
  const ang = Math.acos(clamp(dot(vector_1, vector_2) / (norm_1 * norm_2), -1, 1))
  return to_degrees(ang)
}

// Arc marking the angle at `center` between two edges: points slerped from the first edge's
// direction to the second's, the label spot on its bisector between the vertex atom's surface
// and the arc, and the angle in degrees. The radius is `radius_fraction` of the shorter edge, but
// at least 0.2 Å past `atom_radius` (the drawn vertex atom, which would hide a depth-tested arc)
// and at most 0.9 of the shorter edge (no arc if that leaves it inside the atom). Null for a zero-length edge. A straight (or zero) angle
// spans no plane to bend in: no arc, label on the first edge.
export function angle_arc(
  center: Vec3,
  vector_1: Vec3,
  vector_2: Vec3,
  { radius_fraction = 0.31, atom_radius = 0, segments = 24 } = {},
): { points: Vec3[]; label_position: Vec3; degrees: number } | null {
  const [len_1, len_2] = [Math.hypot(...vector_1), Math.hypot(...vector_2)]
  if (len_1 < EPS || len_2 < EPS) return null
  const [unit_1, unit_2] = [scale(vector_1, 1 / len_1), scale(vector_2, 1 / len_2)]
  const angle = Math.acos(clamp(dot(unit_1, unit_2), -1, 1))
  const sin_angle = Math.sin(angle)
  const flat = sin_angle < 1e-6
  const direction = (fraction: number): Vec3 =>
    flat
      ? unit_1
      : add(
          scale(unit_1, Math.sin((1 - fraction) * angle) / sin_angle),
          scale(unit_2, Math.sin(fraction * angle) / sin_angle),
        )
  const min_len = Math.min(len_1, len_2)
  const radius = Math.min(
    0.9 * min_len,
    Math.max(radius_fraction * min_len, atom_radius + 0.2),
  )
  // an arc inside its atom (huge atoms on short edges) is hidden by depth testing: skip it
  const points =
    flat || radius <= atom_radius
      ? []
      : Array.from({ length: segments + 1 }, (_unused, idx) =>
          add(center, scale(direction(idx / segments), radius)),
        )
  // midway from the atom's surface (or 60% of the radius, for small atoms) to the arc
  const label_dist = (Math.min(Math.max(atom_radius, 0.6 * radius), radius) + radius) / 2
  const label_position = add(center, scale(direction(0.5), label_dist))
  return { points, label_position, degrees: to_degrees(angle) }
}

// Unwrap a chain of picked positions so consecutive points are nearest images (see
// `pick_displacement`), then shift it by the lattice vector that puts the most points on their
// drawn atoms (no shift on a tie). Angles and torsions are reported from these displacements,
// so an overlay drawn between raw in-cell coordinates depicts a different geometry than the one
// measured; this returns the positions to draw instead: the picked angle triangle, or the
// torsion chain of three such displacements (see `dihedral_angle`).
export function pbc_chain_positions(
  positions: Vec3[],
  lattice_matrix: Matrix3x3 | null | undefined,
  pbc?: Pbc,
): Vec3[] {
  const converters = lattice_matrix ? create_lattice_converters(lattice_matrix) : undefined
  // each step from its own two picks, not from the previous (maybe shifted) chain point, which
  // nobody drew: else the drawn-image test runs against the wrong pair and the result depends
  // on pick order
  const chain = positions.slice(0, 1)
  for (let idx = 1; idx < positions.length; idx++) {
    const step = pick_displacement(
      positions[idx - 1],
      positions[idx],
      lattice_matrix,
      converters,
      pbc,
    )
    chain.push(add(chain[idx - 1], step))
  }
  const offsets = positions.map((position, idx) => subtract(position, chain[idx]))
  const matches = (offset: Vec3) =>
    offsets.filter((other) => same_position(other, offset)).length
  const shift = offsets.reduce<Vec3>(
    (best, offset) => (matches(offset) > matches(best) ? offset : best),
    [0, 0, 0],
  )
  return chain.map((position) => add(position, shift))
}

type DisplacementField = {
  vectors: Vec3[] // per-site reference -> current displacement, in Cartesian Angstrom
  rmsd: number // root-mean-square displacement over all sites
  max_displacement: number
}

// UI-facing digest of a DisplacementField: either the two numbers worth reading or the reason
// there are none. Discriminated on `error` so the success branch narrows both to `number`.
export type DisplacementSummary =
  | { rmsd: number; max_displacement: number; error: null }
  | { rmsd?: undefined; max_displacement?: undefined; error: string }

// Per-site displacement from a reference geometry to the current one, e.g. unrelaxed vs relaxed.
// Uses minimum-image displacements rather than raw coordinate subtraction: an atom that relaxed
// across a cell face has moved a fraction of an Angstrom, but its coordinates jump by a whole
// lattice vector, which would draw an arrow spanning the entire box and wreck the RMSD.
// Sites pair up by index, so both a count mismatch and a species mismatch throw — zipping the
// shorter list or dropping Si onto O would report a confidently wrong number.
export function compute_displacements(
  reference_sites: Site[],
  current_sites: Site[],
  lattice_matrix: Matrix3x3 | null | undefined,
  pbc?: Pbc,
): DisplacementField {
  if (reference_sites.length !== current_sites.length) {
    throw new Error(
      `Cannot compare structures with different atom counts: reference has ` +
        `${reference_sites.length} sites, current has ${current_sites.length}`,
    )
  }
  // Built once rather than per site: min_image_displacement rebuilds the cart<->frac
  // converters for every call it isn't handed them, which dominates a 2000-site recompute.
  const converters = lattice_matrix ? create_lattice_converters(lattice_matrix) : undefined
  const vectors = current_sites.map((site, idx) => {
    const ref_site = reference_sites[idx]
    const ref_element = ref_site.species[0]?.element
    const cur_element = site.species[0]?.element
    if (ref_element !== cur_element) {
      throw new Error(
        `Species mismatch at site ${display_idx(idx)}: reference has ${ref_element}, current has ` +
          `${cur_element}. Displacements pair sites by index, so both geometries must ` +
          `list the same atoms in the same order.`,
      )
    }
    return displacement_pbc(ref_site.xyz, site.xyz, lattice_matrix, converters, pbc)
  })
  let sum_sq = 0
  let max_sq = 0
  for (const vec of vectors) {
    const norm_sq = vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2
    sum_sq += norm_sq
    max_sq = Math.max(max_sq, norm_sq)
  }
  return {
    vectors,
    rmsd: vectors.length > 0 ? Math.sqrt(sum_sq / vectors.length) : 0,
    max_displacement: Math.sqrt(max_sq),
  }
}

// Signed torsion (dihedral) angle of the chain p1-p2-p3-p4, in (-180, 180] degrees.
// Chains three minimum-image displacements instead of differencing Cartesian coordinates,
// so a torsion whose atoms straddle a cell boundary measures the real bonded geometry
// rather than the angle to a distant periodic image.
// atan2 (not acos) is what makes the result signed: the sign follows the IUPAC convention,
// i.e. viewed along p2->p3, a positive angle means the front bond p2->p1 must rotate clockwise
// to eclipse the rear bond p3->p4. Enantiomers and gauche+/gauche- conformers therefore stay
// distinguishable, and the sign labels their handedness correctly.
export function dihedral_angle(
  point_1: Vec3,
  point_2: Vec3,
  point_3: Vec3,
  point_4: Vec3,
  lattice_matrix: Matrix3x3 | null | undefined,
  pbc?: Pbc,
): number {
  // One converter set for all three bonds instead of three (this runs per label render)
  const converters = lattice_matrix ? create_lattice_converters(lattice_matrix) : undefined
  const bond_12 = pick_displacement(point_1, point_2, lattice_matrix, converters, pbc)
  const bond_23 = pick_displacement(point_2, point_3, lattice_matrix, converters, pbc)
  const bond_34 = pick_displacement(point_3, point_4, lattice_matrix, converters, pbc)

  // Plane normals of the p1-p2-p3 and p2-p3-p4 triangles
  const normal_123 = cross_3d(bond_12, bond_23)
  const normal_234 = cross_3d(bond_23, bond_34)
  const axis_len = Math.hypot(...bond_23)

  // Any three collinear consecutive points (or a coincident pair) leave a plane undefined,
  // so there is no torsion to report. Returning 0 keeps callers off the 0/0 NaN that atan2
  // would otherwise produce, matching angle_between_vectors' zero-length-vector behavior.
  const lengths = [axis_len, Math.hypot(...normal_123), Math.hypot(...normal_234)]
  if (lengths.some((len) => len < EPS)) return 0

  const axis_hat = scale(bond_23, 1 / axis_len)
  const ang = Math.atan2(
    dot(cross_3d(normal_123, normal_234), axis_hat),
    dot(normal_123, normal_234),
  )
  return to_degrees(ang)
}
