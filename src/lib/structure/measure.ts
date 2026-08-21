// functions for measuring distances and angles between structure sites

import type { LatticeConverters, Matrix3x3, Vec3 } from '$lib/math'
import {
  add,
  create_lattice_converters,
  cross_3d,
  dot,
  EPS,
  min_image_displacement,
  scale,
  subtract,
  to_degrees,
} from '$lib/math'
import type { MeasureMode, Site } from '$lib/structure'
import type { Pbc } from './pbc'

type AngleMode = `degrees` | `radians`

export const MAX_SELECTED_SITES = 8

// Modes that measure one fixed ordered tuple. They cap at that arity and a further pick rolls
// the oldest out, keeping the measurement live: angle mode used to draw every center/pair
// combination (N(N-1)(N-2)/2, i.e. 168 wedges at 8 sites) and dihedral mode rendered only at
// exactly 4, blanking when a fifth atom joined. Every other mode accumulates a set up to the
// shared ceiling and refuses past it, since no pick can be dropped without changing the answer.
const ORDERED_TUPLE_SIZES = { angle: 3, dihedral: 4 } as const

export const max_measured_sites = (mode: MeasureMode): number =>
  ORDERED_TUPLE_SIZES[mode as keyof typeof ORDERED_TUPLE_SIZES] ?? MAX_SELECTED_SITES

export const rolls_measured_sites = (mode: MeasureMode): boolean => mode in ORDERED_TUPLE_SIZES

// Calculate minimum image displacement between two points under PBC
// If lattice_matrix is null/undefined, returns Euclidean displacement.
// pbc flags disable wrapping along non-periodic axes (e.g. slab vacuum directions).
export function displacement_pbc(
  from: Vec3,
  to: Vec3,
  lattice_matrix: Matrix3x3 | null | undefined,
  converters?: LatticeConverters,
  pbc?: Pbc,
): Vec3 {
  if (!lattice_matrix) return subtract(to, from)
  return min_image_displacement(from, to, lattice_matrix, converters, pbc)
}

export function angle_between_vectors(v1: Vec3, v2: Vec3, mode: AngleMode = `degrees`) {
  const n1 = Math.hypot(v1[0], v1[1], v1[2])
  const n2 = Math.hypot(v2[0], v2[1], v2[2])
  if (n1 === 0 || n2 === 0) return 0

  // Normalize dot product to get cosine, clamped to [-1, 1] to avoid acos NaN
  const cos_angle = dot(v1, v2) / (n1 * n2)
  const clamped = Math.max(-1, Math.min(1, cos_angle))

  const ang = Math.acos(clamped)
  return mode === `degrees` ? to_degrees(ang) : ang
}

// Unwrap a chain of positions so consecutive points are minimum-image neighbors, anchored on
// the first. Angles and torsions are reported from minimum-image displacements, so an overlay
// drawn between raw in-cell coordinates depicts a different geometry than the one measured;
// this returns the positions to draw instead. Torsions chain three such displacements (see
// `dihedral_angle`). The angle overlay needs no helper: it already holds both displacements.
export function pbc_chain_positions(
  positions: Vec3[],
  lattice_matrix: Matrix3x3 | null | undefined,
  pbc?: Pbc,
): Vec3[] {
  const converters = lattice_matrix ? create_lattice_converters(lattice_matrix) : undefined
  const chain = positions.slice(0, 1)
  for (const position of positions.slice(1)) {
    const previous = chain[chain.length - 1]
    chain.push(
      add(previous, displacement_pbc(previous, position, lattice_matrix, converters, pbc)),
    )
  }
  return chain
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
        `Species mismatch at site ${idx}: reference has ${ref_element}, current has ` +
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
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  p4: Vec3,
  lattice_matrix: Matrix3x3 | null | undefined,
  pbc?: Pbc,
  mode: AngleMode = `degrees`,
): number {
  // One converter set for all three bonds instead of three (this runs per label render)
  const converters = lattice_matrix ? create_lattice_converters(lattice_matrix) : undefined
  const bond_12 = displacement_pbc(p1, p2, lattice_matrix, converters, pbc)
  const bond_23 = displacement_pbc(p2, p3, lattice_matrix, converters, pbc)
  const bond_34 = displacement_pbc(p3, p4, lattice_matrix, converters, pbc)

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
  return mode === `degrees` ? to_degrees(ang) : ang
}
