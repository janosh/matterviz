// Programmatic crystal fixtures for the structure-identification tests. Built from lattice
// vectors + a fractional basis rather than parsed from files, so the ideal geometry (and hence
// the expected CNA type and CSP = 0) is exact rather than whatever a CIF rounded to.
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { calc_lattice_params, create_cart_to_frac, create_frac_to_cart } from '$lib/math'
import type { Crystal } from '$lib/structure'
import { make_site } from '$lib/structure/site'
import { make_rng } from '../numeric-helpers'

export const FCC_LATTICE_CONST = 3.615 // Å, Cu
export const BCC_LATTICE_CONST = 2.8665 // Å, alpha-Fe
const HCP_LATTICE_CONST = 3.209 // Å, Mg
const IDEAL_HCP_AXIAL_RATIO = Math.sqrt(8 / 3) // c/a for ideal hard-sphere packing

// Supercell from a conventional cell: `basis` are fractional coordinates in the unit cell,
// `reps` the repeat counts along a, b, c. Not make_supercell: that translates unit-cell xyz
// and wraps abc, which differs from the exact (rep + basis) / reps construction by up to
// 8e-15 A and the tests lean on the exact geometry.
function build_supercell(
  unit_matrix: Matrix3x3,
  basis: Vec3[],
  reps: [number, number, number],
  element: ElementSymbol,
): Crystal {
  const matrix = unit_matrix.map((row, axis) =>
    row.map((component) => component * reps[axis]),
  ) as Matrix3x3
  const frac_to_cart = create_frac_to_cart(matrix)

  const sites = []
  for (let rep_a = 0; rep_a < reps[0]; rep_a++) {
    for (let rep_b = 0; rep_b < reps[1]; rep_b++) {
      for (let rep_c = 0; rep_c < reps[2]; rep_c++) {
        for (const [basis_a, basis_b, basis_c] of basis) {
          const abc: Vec3 = [
            (rep_a + basis_a) / reps[0],
            (rep_b + basis_b) / reps[1],
            (rep_c + basis_c) / reps[2],
          ]
          sites.push(make_site(element, abc, frac_to_cart(abc), element))
        }
      }
    }
  }
  return {
    sites,
    lattice: { matrix, pbc: [true, true, true], ...calc_lattice_params(matrix) },
  }
}

const cubic = (lattice_const: number): Matrix3x3 => [
  [lattice_const, 0, 0],
  [0, lattice_const, 0],
  [0, 0, lattice_const],
]

const FCC_BASIS: Vec3[] = [
  [0, 0, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
  [0.5, 0.5, 0],
]
const BCC_BASIS: Vec3[] = [
  [0, 0, 0],
  [0.5, 0.5, 0.5],
]
// Hexagonal close packing: A layer at (0,0,0), B layer at (1/3, 2/3, 1/2)
const HCP_BASIS: Vec3[] = [
  [0, 0, 0],
  [1 / 3, 2 / 3, 0.5],
]

export const make_fcc = (
  reps: [number, number, number] = [4, 4, 4],
  lattice_const = FCC_LATTICE_CONST,
): Crystal => build_supercell(cubic(lattice_const), FCC_BASIS, reps, `Cu`)

export const make_bcc = (
  reps: [number, number, number] = [4, 4, 4],
  lattice_const = BCC_LATTICE_CONST,
): Crystal => build_supercell(cubic(lattice_const), BCC_BASIS, reps, `Fe`)

export function make_hcp(
  reps: [number, number, number] = [4, 4, 4],
  lattice_const = HCP_LATTICE_CONST,
  axial_ratio = IDEAL_HCP_AXIAL_RATIO,
): Crystal {
  const height = lattice_const * axial_ratio
  const hexagonal: Matrix3x3 = [
    [lattice_const, 0, 0],
    [-lattice_const / 2, (lattice_const * Math.sqrt(3)) / 2, 0],
    [0, 0, height],
  ]
  return build_supercell(hexagonal, HCP_BASIS, reps, `Mg`)
}

// Copy with site `removed_idx` deleted — a monovacancy. Its 12 former neighbors lose one bond
// each, so their CSP jumps while the rest of the crystal is untouched.
export function with_vacancy(crystal: Crystal, removed_idx: number): Crystal {
  if (removed_idx < 0 || removed_idx >= crystal.sites.length) {
    throw new Error(
      `with_vacancy: index ${removed_idx} outside 0..${crystal.sites.length - 1}`,
    )
  }
  return { ...crystal, sites: crystal.sites.filter((_site, idx) => idx !== removed_idx) }
}

// Copy with every atom displaced by a uniform random vector of at most `amplitude` Å per axis
export function with_random_displacements(
  crystal: Crystal,
  amplitude: number,
  seed: number,
): Crystal {
  const random = make_rng(seed)
  const cart_to_frac = create_cart_to_frac(crystal.lattice.matrix)
  const sites = crystal.sites.map((site) => {
    const xyz = site.xyz.map((coord) => coord + (random() * 2 - 1) * amplitude) as Vec3
    return { ...site, xyz, abc: cart_to_frac(xyz) }
  })
  return { ...crystal, sites }
}

// 13-atom Mackay icosahedron: a center plus the 12 vertices of a regular icosahedron. The
// vertices are the cyclic permutations of (0, ±1, ±phi), which put every vertex at
// sqrt(1 + phi²) from the center and every edge at 2, i.e. a center-to-vertex distance 5%
// below the edge. Non-periodic on purpose — this is a free cluster, not a crystal.
export function make_icosahedron(edge_length = 2.556): {
  sites: ReturnType<typeof make_site>[]
} {
  const golden = (1 + Math.sqrt(5)) / 2
  const scale = edge_length / 2
  const vertices: Vec3[] = []
  for (const sign_1 of [1, -1]) {
    for (const sign_2 of [1, -1]) {
      vertices.push(
        [0, sign_1, sign_2 * golden],
        [sign_1, sign_2 * golden, 0],
        [sign_2 * golden, 0, sign_1],
      )
    }
  }
  const positions: Vec3[] = [
    [0, 0, 0],
    ...vertices.map((vertex) => vertex.map((coord) => coord * scale) as Vec3),
  ]
  // No lattice, so abc is meaningless; it is set to xyz to keep the Site shape intact
  return { sites: positions.map((xyz) => make_site(`Au`, xyz, xyz, `Au`)) }
}

// Distance to the nearest neighbor of an ideal lattice, for sizing tolerances
export const fcc_nn_distance = (lattice_const = FCC_LATTICE_CONST): number =>
  lattice_const / Math.SQRT2
