// Re-express a bulk cell so that its c vector crosses the (hkl) lattice planes exactly
// once. Everything here is exact integer arithmetic on the lattice: no atom is created,
// destroyed or moved, only the choice of unit cell changes.
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Crystal, Pbc, Site } from '$lib/structure'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import { find_lattice_translations, make_site_grid, species_keys_of } from './translations'
import type { OrientedBulk, SlabOptions } from './types'
import { SLAB_POSITION_TOLERANCE } from './types'

// Lagrange reduction converges in a handful of steps; a cap turns a hypothetical
// non-terminating case into a loud failure instead of a frozen tab.
const MAX_REDUCTION_STEPS = 64

// (hkl) reduced by its gcd, after rejecting inputs that pick out no plane. Called once
// per public entry point; everything below it takes indices that are already reduced.
const reduced_miller_indices = (miller_indices: Vec3): Vec3 =>
  math.reduce_miller_indices(math.validate_miller_indices(miller_indices))

// Perpendicular distance between neighbouring (hkl) lattice planes, Å.
export const interplanar_spacing = (lattice_matrix: Matrix3x3, miller_indices: Vec3): number =>
  1 /
  Math.hypot(
    ...math.miller_plane_normal(lattice_matrix, reduced_miller_indices(miller_indices)),
  )

// Shortest basis of the 2D lattice spanned by two integer lattice rows, measured with
// the Cartesian metric of the parent lattice (Lagrange/Gauss reduction, which is optimal
// in 2D). The lattice they span is unchanged, so the cell keeps its atom count.
function gauss_reduce_pair(
  row_1: Vec3,
  row_2: Vec3,
  frac_to_cart: (frac: Vec3) => Vec3,
): [Vec3, Vec3] {
  let [short, long] = [row_1, row_2]
  for (let step = 0; step < MAX_REDUCTION_STEPS; step++) {
    const cart_short = frac_to_cart(short)
    const cart_long = frac_to_cart(long)
    const norm_short = math.dot(cart_short, cart_short)
    if (math.dot(cart_long, cart_long) < norm_short) {
      ;[short, long] = [long, short]
      continue
    }
    const factor = Math.round(math.dot(cart_short, cart_long) / norm_short)
    if (factor === 0) return [short, long]
    long = math.subtract(long, math.scale(short, factor))
  }
  throw new Error(
    `In-plane basis reduction did not converge in ${MAX_REDUCTION_STEPS} steps for rows ` +
      `${JSON.stringify(row_1)} and ${JSON.stringify(row_2)}`,
  )
}

// Integer multiples (m_1, m_2) that make cart_out − m_1·cart_1 − m_2·cart_2 as short as
// possible: the real least-squares solution rounded, plus its immediate neighbours since
// rounding each coefficient separately is not always optimal in an oblique basis.
function in_plane_reduction_multiples(
  cart_out: Vec3,
  cart_1: Vec3,
  cart_2: Vec3,
): [number, number] {
  const gram_11 = math.dot(cart_1, cart_1)
  const gram_12 = math.dot(cart_1, cart_2)
  const gram_22 = math.dot(cart_2, cart_2)
  const gram_det = gram_11 * gram_22 - gram_12 ** 2
  if (!(Math.abs(gram_det) > math.EPS)) {
    throw new Error(
      `In-plane vectors ${JSON.stringify(cart_1)} and ${JSON.stringify(cart_2)} are ` +
        `collinear (Gram determinant ${gram_det})`,
    )
  }
  const proj_1 = math.dot(cart_out, cart_1)
  const proj_2 = math.dot(cart_out, cart_2)
  const coeff_1 = (proj_1 * gram_22 - proj_2 * gram_12) / gram_det
  const coeff_2 = (gram_11 * proj_2 - gram_12 * proj_1) / gram_det

  let best: [number, number] = [0, 0]
  let best_len = Math.hypot(...cart_out)
  for (const mult_1 of [Math.floor(coeff_1), Math.ceil(coeff_1)]) {
    for (const mult_2 of [Math.floor(coeff_2), Math.ceil(coeff_2)]) {
      const shift = math.add(math.scale(cart_1, mult_1), math.scale(cart_2, mult_2))
      const len = Math.hypot(...math.subtract(cart_out, shift))
      if (len < best_len - math.EPS) [best, best_len] = [[mult_1, mult_2], len]
    }
  }
  return best
}

// `cart_out` with as much of the plane spanned by `cart_1` and `cart_2` subtracted off as
// integer multiples allow: the same lattice vector modulo in-plane translations, only
// shorter, which keeps the cell as close to orthogonal as the lattice permits.
export const shorten_in_plane = (cart_out: Vec3, cart_1: Vec3, cart_2: Vec3): Vec3 => {
  const [mult_1, mult_2] = in_plane_reduction_multiples(cart_out, cart_1, cart_2)
  const shift = math.add(math.scale(cart_1, mult_1), math.scale(cart_2, mult_2))
  return math.subtract(cart_out, shift)
}

// Unimodular integer matrix U with U · hkl = (1, 0, 0): row 0 crosses a single (hkl)
// plane and rows 1, 2 lie in the plane. Built by the extended Euclidean algorithm: every
// integer row operation that shrinks the working copy of hkl is mirrored on U (starting
// from the identity), so U · hkl tracks the working copy at all times and det U = ±1.
// `miller` must be reduced, otherwise the pivot ends at gcd(h, k, l) instead of 1.
function unimodular_completion(miller: Vec3): Matrix3x3 {
  const working: Vec3 = [...miller]
  const rows: Matrix3x3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  // Repeatedly reduce every entry modulo the smallest non-zero one until one entry is left
  for (let step = 0; step < MAX_REDUCTION_STEPS; step++) {
    const non_zero = [0, 1, 2].filter((axis) => working[axis] !== 0)
    if (non_zero.length === 1) break
    let pivot = non_zero[0]
    for (const axis of non_zero) {
      if (Math.abs(working[axis]) < Math.abs(working[pivot])) pivot = axis
    }
    for (const axis of non_zero) {
      if (axis === pivot) continue
      const quotient = Math.trunc(working[axis] / working[pivot])
      working[axis] -= quotient * working[pivot]
      rows[axis] = math.subtract(rows[axis], math.scale(rows[pivot], quotient))
    }
  }
  const pivot = working.findIndex((val) => val !== 0)
  if (pivot === -1 || Math.abs(working[pivot]) !== 1) {
    throw new Error(
      `Expected gcd 1 for reduced Miller indices ${JSON.stringify(miller)}, got ` +
        `${JSON.stringify(working)} after Euclidean reduction`,
    )
  }
  if (working[pivot] < 0) rows[pivot] = math.scale(rows[pivot], -1)
  const plane_rows = [0, 1, 2].filter((axis) => axis !== pivot).map((axis) => rows[axis])
  return [rows[pivot], plane_rows[0], plane_rows[1]]
}

// Unimodular integer transform P for the (hkl) surface: rows 0 and 1 span the plane
// (p · hkl = 0) and row 2 crosses exactly one interplanar spacing (p · hkl = 1), so the
// perpendicular height of the transformed c is d_hkl. |det P| = 1 means the transformed
// cell holds the same lattice points, hence the same atoms, as the input cell.
// `miller` must already be reduced by reduced_miller_indices.
export function slab_basis_transform(lattice_matrix: Matrix3x3, miller: Vec3): Matrix3x3 {
  const [out_of_plane, plane_row_1, plane_row_2] = unimodular_completion(miller)
  const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
  const [row_a, row_b] = gauss_reduce_pair(plane_row_1, plane_row_2, frac_to_cart)
  const [mult_a, mult_b] = in_plane_reduction_multiples(
    frac_to_cart(out_of_plane),
    frac_to_cart(row_a),
    frac_to_cart(row_b),
  )
  const row_c = math.subtract(
    out_of_plane,
    math.add(math.scale(row_a, mult_a), math.scale(row_b, mult_b)),
  )

  // Keep the cell right-handed: swapping the two in-plane rows flips the determinant
  // without leaving the plane or changing which side of it c points to. Every step above
  // was a unit-diagonal row operation or a swap, so |det| = 1 holds by construction.
  const rows: Matrix3x3 = [row_a, row_b, row_c]
  const oriented = math.dot(rows, lattice_matrix)
  return math.det_3x3(oriented) < 0 ? [row_b, row_a, row_c] : rows
}

// Rebuild a Crystal around a new lattice matrix and site list. `charge` is passed in
// rather than carried over because only the caller knows whether the new cell still holds
// the same amount of matter as the old one. Bonds are indexed by site and tied to the old
// cell, so they are the one property that cannot follow the atoms into the new cell.
export function assemble_crystal(
  source: Crystal,
  matrix: Matrix3x3,
  sites: Site[],
  pbc: Pbc,
  charge: number | undefined,
): Crystal {
  const { bonds: _bonds, ...properties } = source.properties ?? {}
  return {
    lattice: { matrix, pbc, ...math.calc_lattice_params(matrix) },
    sites,
    ...(source.id === undefined ? {} : { id: source.id }),
    ...(charge === undefined ? {} : { charge }),
    ...(Object.keys(properties).length === 0 ? {} : { properties }),
  }
}

// Shrink the in-plane cell to the smallest one the crystal is periodic under. Only
// translations with no component along c qualify: they leave every atom's height
// untouched, so they stay symmetries once the crystal is cleaved into a slab.
function primitivize_in_plane(
  matrix: Matrix3x3,
  sites: Site[],
): { matrix: Matrix3x3; sites: Site[]; index: number } {
  const translations = find_lattice_translations(sites, matrix, { in_plane_only: true })
  if (translations.length === 0) return { matrix, sites, index: 1 }

  // Two shortest independent vectors of a 2D lattice always form a basis (Minkowski), and
  // the parent in-plane vectors are already Gauss-reduced, so the shortest vectors of the
  // finer lattice are within a couple of cells of each translation. Should that ever fail
  // to reach them, the index check below rejects the result rather than shrinking the cell
  // by the wrong amount.
  const frac_to_cart = math.create_frac_to_cart(matrix)
  const offsets = [-2, -1, 0, 1, 2]
  const candidates = [[0, 0], ...translations]
    .flatMap(([trans_a, trans_b]) =>
      offsets.flatMap((mult_a) =>
        offsets.map((mult_b) => frac_to_cart([trans_a + mult_a, trans_b + mult_b, 0])),
      ),
    )
    .toSorted((left, right) => Math.hypot(...left) - Math.hypot(...right))
  const first = candidates.find((cart) => Math.hypot(...cart) > math.EPS)
  if (!first) {
    throw new Error(`All in-plane candidate vectors of ${JSON.stringify(matrix)} are zero`)
  }
  const second = candidates.find(
    (cart) => Math.hypot(...math.cross_3d(first, cart)) > math.EPS,
  )
  if (!second) {
    throw new Error(
      `Could not find a second independent in-plane vector among ` +
        `${translations.length + 1} translations of ${JSON.stringify(matrix)}`,
    )
  }

  // Shorten c against the new, smaller in-plane cell — it stays the same lattice vector
  // plus in-plane lattice translations, so the lattice and the spacing are untouched.
  const reduced: Matrix3x3 = [first, second, shorten_in_plane(matrix[2], first, second)]
  if (math.det_3x3(reduced) < 0) [reduced[0], reduced[1]] = [reduced[1], reduced[0]]

  const index = Math.abs(math.det_3x3(matrix) / math.det_3x3(reduced))
  const expected_index = translations.length + 1
  if (Math.abs(index - expected_index) > 1e-6) {
    throw new Error(
      `In-plane primitive cell is ${index}x smaller but ${expected_index} translations ` +
        `were found; reduced lattice ${JSON.stringify(reduced)}`,
    )
  }

  const cart_to_frac = math.create_cart_to_frac(reduced)
  const frac_to_cart_reduced = math.create_frac_to_cart(reduced)
  const kept: Site[] = []
  const keys = species_keys_of(sites)
  const grid = make_site_grid(reduced)
  for (const [idx, site] of sites.entries()) {
    const abc = wrap_to_unit_cell(cart_to_frac(site.xyz))
    if (grid.find(abc, keys[idx]) >= 0) continue
    grid.add(abc, keys[idx], kept.length)
    kept.push({ ...site, abc, xyz: frac_to_cart_reduced(abc) })
  }
  if (kept.length * expected_index !== sites.length) {
    throw new Error(
      `In-plane primitive cell kept ${kept.length} of ${sites.length} sites, expected ` +
        `${sites.length / expected_index} at index ${expected_index}`,
    )
  }
  return { matrix: reduced, sites: kept, index: expected_index }
}

export type OrientedBulkOptions = Pick<SlabOptions, `primitive_in_plane`>

// Re-express `crystal` in the cell whose c crosses the (hkl) planes once. The result is
// still bulk (periodic in all three directions) — make_slab cleaves and adds the vacuum.
export function make_oriented_bulk(
  crystal: Crystal,
  miller_indices: Vec3,
  options: OrientedBulkOptions = {},
): OrientedBulk {
  const { primitive_in_plane = true } = options
  if (!crystal.lattice) throw new Error(`Cannot build a slab: structure has no lattice`)
  if (crystal.sites.length === 0) {
    throw new Error(`Cannot build a slab: structure has no sites`)
  }
  // Cutting a surface means choosing a new cell of an infinite 3D lattice. Handed a slab
  // or a molecule in a box, every step below still runs and returns numbers — d_hkl comes
  // out as the box height, vacuum and all — so refuse the input instead. An absent pbc
  // means fully periodic here as everywhere else in the codebase; only an axis the input
  // itself declares non-periodic is rejected.
  const { matrix: parent_matrix } = crystal.lattice
  const pbc: Pbc = crystal.lattice.pbc ?? [true, true, true]
  if (!pbc.every(Boolean)) {
    throw new Error(
      `Cannot cut a slab from a structure that is not periodic along all three axes, ` +
        `got pbc ${JSON.stringify(pbc)}`,
    )
  }
  const miller = reduced_miller_indices(miller_indices)

  const transform = slab_basis_transform(parent_matrix, miller)
  // Row-vector convention: new lattice rows are integer combinations of the old rows
  const matrix = math.dot(transform, parent_matrix)
  // and abc_new · P = abc_old, i.e. abc_new = transpose(P⁻¹) · abc_old
  const to_new_frac = math.transpose_3x3_matrix(math.matrix_inverse_3x3(transform))
  const frac_to_cart = math.create_frac_to_cart(matrix)
  const sites: Site[] = crystal.sites.map((site) => {
    const abc = wrap_to_unit_cell(math.mat3x3_vec3_multiply(to_new_frac, site.abc))
    return { ...site, abc, xyz: frac_to_cart(abc) }
  })

  // A unimodular transform relabels the same lattice, so two atoms can only coincide in
  // the new cell if they already did in the input. Every translation search below treats
  // coincident same-species sites as one, so refuse them here with a message that names
  // the actual problem.
  const keys = species_keys_of(sites)
  const occupied = make_site_grid(matrix)
  for (const [idx, site] of sites.entries()) {
    const clash = occupied.find(site.abc, keys[idx])
    if (clash >= 0) {
      throw new Error(
        `Input structure has two ${keys[idx]} sites within ${SLAB_POSITION_TOLERANCE} Å of ` +
          `each other (sites ${clash} and ${idx})`,
      )
    }
    occupied.add(site.abc, keys[idx], idx)
  }

  const oriented = primitive_in_plane
    ? primitivize_in_plane(matrix, sites)
    : { matrix, sites, index: 1 }
  const in_plane_index = oriented.index
  // c · hkl = 1 makes the perpendicular height of the oriented cell exactly d_hkl
  const d_hkl = math.cell_heights(oriented.matrix)[2]

  // The transform is unimodular, so the oriented cell holds exactly the input atoms and
  // keeps its charge. primitive_in_plane then divides the cell — and the charge it
  // carries — by in_plane_index.
  const charge = crystal.charge === undefined ? undefined : crystal.charge / in_plane_index

  return {
    crystal: assemble_crystal(crystal, oriented.matrix, oriented.sites, pbc, charge),
    transform,
    miller_indices: miller,
    d_hkl,
    normal: math.normalize_vec(math.miller_plane_normal(parent_matrix, miller)),
    in_plane_index,
  }
}
