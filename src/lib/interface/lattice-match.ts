// Zur–McGill coincidence-lattice matching (J. Appl. Phys. 55, 378 (1984)) of a film surface
// onto a substrate surface. Each slab's in-plane lattice is first written in its own 2D
// surface frame, so the search itself only ever touches 2-vectors and integer 2×2 matrices.
import type { Vec2 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { Crystal } from '#lib/structure/index.js'
import type {
  LatticeMatch,
  LatticeMatchOptions,
  MatchMatrices,
  MatchStrain,
  Matrix2x2,
  SurfaceFrame,
} from './types'
import { INTERFACE_DEFAULTS } from './types'

// Matches whose strains agree this closely (up to a film-lattice symmetry) are the same match
const SAME_STRAIN_TOL = 1e-6
// Cells searched per side (max_area / primitive area). Super-lattices of index ≤ N number
// ~0.8·N², so this bounds the search near 1e6 bases instead of hanging the tab.
const MAX_SUPERCELL_INDEX = 1000
// sin of the smallest angle allowed between two in-plane lattice vectors
const MIN_SIN_ANGLE = 1e-6
// Largest angle of a Gauss-reduced basis, which spans [60°, 120°]
const MAX_REDUCED_ANGLE = (2 * Math.PI) / 3

const dot2 = (vec_1: Vec2, vec_2: Vec2): number => vec_1[0] * vec_2[0] + vec_1[1] * vec_2[1]
export const det2 = ([[a00, a01], [a10, a11]]: Matrix2x2): number => a00 * a11 - a01 * a10
export const mul2 = (
  [[a00, a01], [a10, a11]]: Matrix2x2,
  [[b00, b01], [b10, b11]]: Matrix2x2,
): Matrix2x2 => [
  [a00 * b00 + a01 * b10, a00 * b01 + a01 * b11],
  [a10 * b00 + a11 * b10, a10 * b01 + a11 * b11],
]
// fresh per call: returned matches own their matrices
const identity_2x2 = (): Matrix2x2 => [
  [1, 0],
  [0, 1],
]

// Lattice rows a, b of `crystal` in its surface frame x ∥ a, y = n̂ × â, n̂ = unit(a × b).
export function surface_frame({ lattice }: Crystal): SurfaceFrame {
  const [vec_a, vec_b] = lattice.matrix
  const cross = math.cross_3d(vec_a, vec_b)
  const area = Math.hypot(...cross)
  const len_a = Math.hypot(...vec_a)
  if (!(area > MIN_SIN_ANGLE * len_a * Math.hypot(...vec_b))) {
    throw new Error(
      `In-plane lattice vectors a=${JSON.stringify(vec_a)} and b=${JSON.stringify(vec_b)} ` +
        `are degenerate or not finite (|a × b| = ${area} Å²)`,
    )
  }
  const normal = math.scale(cross, 1 / area)
  const axis_x = math.scale(vec_a, 1 / len_a)
  const axis_y = math.cross_3d(normal, axis_x)
  return {
    basis: [
      [len_a, 0],
      [math.dot(vec_b, axis_x), math.dot(vec_b, axis_y)],
    ],
    axes: [axis_x, axis_y, normal],
  }
}

// Rotation-free strain of the film basis stretched onto the substrate basis (rows u, v,
// each in its own surface frame). F maps film onto substrate, F·[u_f v_f] = [u_s v_s] in
// column form, so F = B_sᵀ·B_f⁻ᵀ and C = FᵀF = B_f⁻¹·G_s·B_f⁻ᵀ only depends on the
// substrate metric G_s. U = sqrt(C) in closed form for 2×2 SPD, R = F·U⁻¹.
export function match_strain(film: Matrix2x2, substrate: Matrix2x2): MatchStrain {
  const [[fa0, fa1], [fb0, fb1]] = film
  const [[sa0, sa1], [sb0, sb1]] = substrate
  const det_f = det2(film)
  // F = (B_f⁻¹·B_s)ᵀ with B_f⁻¹ = adj(B_f) / det
  const f00 = (fb1 * sa0 - fa1 * sb0) / det_f
  const f01 = (fa0 * sb0 - fb0 * sa0) / det_f
  const f10 = (fb1 * sa1 - fa1 * sb1) / det_f
  const f11 = (fa0 * sb1 - fb0 * sa1) / det_f
  const [c00, c01, c11] = [f00 ** 2 + f10 ** 2, f00 * f01 + f10 * f11, f01 ** 2 + f11 ** 2]
  const root_det = Math.sqrt(c00 * c11 - c01 * c01)
  const norm = Math.sqrt(c00 + c11 + 2 * root_det)
  const [u00, u01, u11] = [(c00 + root_det) / norm, c01 / norm, (c11 + root_det) / norm]
  const [exx, exy, eyy] = [u00 - 1, u01, u11 - 1]
  return {
    strain: [
      [exx, exy],
      [exy, eyy],
    ],
    von_mises: Math.sqrt(exx ** 2 - exx * eyy + eyy ** 2 + 3 * exy ** 2),
    // first column of R = F·U⁻¹ = F·adj(U) / det U, the positive det U dropping out of atan2
    rotation_deg: math.to_degrees(Math.atan2(f10 * u11 - f11 * u01, f00 * u11 - f01 * u01)),
  }
}

// The match that strains the film super-lattice film_matrix · film onto the substrate
// super-lattice substrate_matrix · substrate (2D bases from surface_frame)
export function match_of_matrices(
  substrate: Matrix2x2,
  film: Matrix2x2,
  { film_matrix, substrate_matrix }: MatchMatrices,
): LatticeMatch {
  const n_substrate_cells = det2(substrate_matrix)
  return {
    film_matrix,
    substrate_matrix,
    area: n_substrate_cells * det2(substrate),
    n_film_cells: det2(film_matrix),
    n_substrate_cells,
    ...match_strain(mul2(film_matrix, film), mul2(substrate_matrix, substrate)),
  }
}

// A super-lattice basis (rows = matrix · primitive rows) with the metric the matcher compares
type SuperLattice = {
  matrix: Matrix2x2
  uu: number
  vv: number
  angle: number
}

const super_lattice = (matrix: Matrix2x2, primitive: Matrix2x2): SuperLattice => {
  const [vec_u, vec_v] = mul2(matrix, primitive)
  const [uu, vv] = [dot2(vec_u, vec_u), dot2(vec_v, vec_v)]
  // non-degenerate bases keep |cos| < 1 - 1e-13, far from needing a clamp
  return { matrix, uu, vv, angle: Math.acos(dot2(vec_u, vec_v) / Math.sqrt(uu * vv)) }
}

// Lagrange–Gauss reduction tracked on the integer rows (u0, u1), (v0, v1), so the returned
// matrix is exactly the transform of the reduced basis: |u| ≤ |v| and |u·v| ≤ |u|²/2.
// Lengths come from the primitive metric, so nothing is allocated until the end. The swap
// is (u, v) → (v, −u) instead of an exchange to keep the basis right-handed.
function gauss_reduce(matrix: Matrix2x2, primitive: Matrix2x2): SuperLattice {
  const [[a0, a1], [b0, b1]] = primitive
  const [g_aa, g_ab, g_bb] = [a0 * a0 + a1 * a1, a0 * b0 + a1 * b1, b0 * b0 + b1 * b1]
  const metric = (r0: number, r1: number, s0: number, s1: number): number =>
    r0 * s0 * g_aa + (r0 * s1 + r1 * s0) * g_ab + r1 * s1 * g_bb
  let [[u0, u1], [v0, v1]] = matrix
  for (let iter = 0; iter < 100; iter++) {
    const uu = metric(u0, u1, u0, u1)
    const mult = Math.round(metric(u0, u1, v0, v1) / uu)
    v0 -= mult * u0
    v1 -= mult * u1
    if (metric(v0, v1, v0, v1) >= uu * (1 - 1e-12)) {
      return super_lattice(
        [
          [u0, u1],
          [v0, v1],
        ],
        primitive,
      )
    }
    ;[u0, u1, v0, v1] = [v0, v1, -u0, -u1]
  }
  throw new Error(`Gauss reduction of ${JSON.stringify(matrix)} did not converge`)
}

// All super-lattices of index n: Hermite normal forms [[i, j], [0, k]], i·k = n, 0 ≤ j < k,
// each Gauss-reduced
function reduced_super_lattices(primitive: Matrix2x2, index: number): SuperLattice[] {
  const lattices: SuperLattice[] = []
  for (let diag_a = 1; diag_a <= index; diag_a++) {
    if (index % diag_a !== 0) continue
    const diag_b = index / diag_a
    for (let off = 0; off < diag_b; off++) {
      lattices.push(
        gauss_reduce(
          [
            [diag_a, off],
            [0, diag_b],
          ],
          primitive,
        ),
      )
    }
  }
  return lattices
}

// A reduced basis is unique up to ties: |u| = |v| also admits (v, −u), and |2u·v| = |u|²
// admits (u, v − sgn(u·v)·u), e.g. hexagonal at 60° or at 120°. Comparing the film's
// partners against the substrate's reduced basis covers every tie (and near-tie within
// tolerance); away from ties the partners fail the length test by construction.
const with_tie_partners =
  (primitive: Matrix2x2) =>
  (lattice: SuperLattice): SuperLattice[] => {
    const [[u0, u1], [v0, v1]] = lattice.matrix
    const sign = lattice.angle <= Math.PI / 2 ? 1 : -1
    return [
      lattice,
      super_lattice(
        [
          [v0, v1],
          [-u0, -u1],
        ],
        primitive,
      ),
      super_lattice(
        [
          [u0, u1],
          [v0 - sign * u0, v1 - sign * u1],
        ],
        primitive,
      ),
    ]
  }

// Squared length `film_sq` within [lo_sq, hi_sq] times the substrate's
const length_fits = (film_sq: number, sub_sq: number, [lo_sq, hi_sq]: Vec2): boolean =>
  film_sq >= lo_sq * sub_sq && film_sq <= hi_sq * sub_sq

// v lengths agree within length_tol (bounds pre-squared by the caller) and angles within
// angle_tol, both relative to the substrate. The search window already fits the u lengths.
const v_and_angle_fit = (
  film: SuperLattice,
  substrate: SuperLattice,
  bounds: Vec2,
  angle_tol: number,
): boolean =>
  length_fits(film.vv, substrate.vv, bounds) &&
  Math.abs(film.angle - substrate.angle) <= angle_tol * substrate.angle

const squared_bounds = (length_tol: number): Vec2 => [
  (1 - length_tol) ** 2,
  (1 + length_tol) ** 2,
]

// Range of film / substrate super-cell area any match can have. Areas are |u|·|v|·sin θ, and
// for reduced substrate angles θ ∈ [60°, 120°] with |Δθ| ≤ angle_tol·θ,
// sin(θ + Δθ) / sin θ = cos Δθ + cot θ · sin Δθ lies within 1 ± angle_tol·max θ|cot θ|
// (2π/(3√3) at 120°), less Δθ²/2 below. 1e-9 of slack absorbs round-off at the edges.
function area_ratio_bounds(length_tol: number, angle_tol: number): Vec2 {
  const max_delta = angle_tol * MAX_REDUCED_ANGLE
  const sin_slope = max_delta / Math.sqrt(3)
  const [lo_sq, hi_sq] = squared_bounds(length_tol)
  return [
    lo_sq * Math.max(0, 1 - sin_slope - max_delta ** 2 / 2) * (1 - 1e-9),
    hi_sq * (1 + sin_slope) * (1 + 1e-9),
  ]
}

// Primitive cell area of a 2D basis, refusing anything the search could not handle
function basis_area(basis: Matrix2x2, name: string, max_area: number): number {
  const area = det2(basis)
  const [len_u, len_v] = basis.map((row) => Math.hypot(...row))
  if (!(area > MIN_SIN_ANGLE * len_u * len_v)) {
    throw new Error(
      `${name} in-plane basis ${JSON.stringify(basis)} must be finite, right-handed and ` +
        `non-degenerate, got area ${area} Å²`,
    )
  }
  if (max_area / area > MAX_SUPERCELL_INDEX) {
    throw new Error(
      `max_area=${max_area} Å² would search ${Math.floor(max_area / area)} ${name} cells of ` +
        `${area} Å² (limit ${MAX_SUPERCELL_INDEX}); lower max_area`,
    )
  }
  return area
}

function assert_in_range(value: number, name: string, upper = Infinity): void {
  if (value > 0 && value < upper) return
  throw new Error(`${name} must be in (0, ${upper}), got ${value}`)
}

// Orthogonal maps of the plane carrying the 2D lattice `basis` onto itself (its point group,
// minus ±1, which leave a strain tensor unchanged). Crystallographic rotations are 60°, 90° and
// 120°; mirror lines of a reduced basis run along lattice vectors with coefficients in [-2, 2].
// An operation belongs to the group iff it maps the basis rows to integer lattice coordinates.
function lattice_symmetries(basis: Matrix2x2): Matrix2x2[] {
  const [[a0, a1], [b0, b1]] = basis
  const det = det2(basis)
  const in_group = ([[g00, g01], [g10, g11]]: Matrix2x2): boolean =>
    basis.every(([x, y]) => {
      const [gx, gy] = [g00 * x + g01 * y, g10 * x + g11 * y]
      return [(gx * b1 - gy * b0) / det, (gy * a0 - gx * a1) / det].every(
        (coord) => Math.abs(coord - Math.round(coord)) < 1e-6,
      )
    })
  const rotations = [60, 90, 120].map((deg): Matrix2x2 => {
    const [cos, sin] = [Math.cos(math.to_radians(deg)), Math.sin(math.to_radians(deg))]
    return [
      [cos, -sin],
      [sin, cos],
    ]
  })
  const mirrors = [-2, -1, 0, 1, 2].flatMap((coef_a) =>
    [-2, -1, 0, 1, 2].flatMap((coef_b): Matrix2x2[] => {
      const [dx, dy] = [coef_a * a0 + coef_b * b0, coef_a * a1 + coef_b * b1]
      if (coef_a === 0 && coef_b === 0) return []
      const angle = 2 * Math.atan2(dy, dx)
      return [
        [
          [Math.cos(angle), Math.sin(angle)],
          [Math.sin(angle), -Math.cos(angle)],
        ],
      ]
    }),
  )
  return [...rotations, ...mirrors].filter(in_group)
}

// Strains equal up to a film-lattice symmetry g (ε₂ = g·ε₁·gᵀ): the same interface seen from a
// symmetry-equivalent film orientation
const same_strain = (
  { strain: strain_1 }: MatchStrain,
  { strain: strain_2 }: MatchStrain,
  symmetries: Matrix2x2[],
): boolean =>
  [identity_2x2(), ...symmetries].some((op) => {
    const rotated = mul2(mul2(op, strain_1), [
      [op[0][0], op[1][0]],
      [op[0][1], op[1][1]],
    ])
    return [0, 1].every((row) =>
      [0, 1].every(
        (col) => Math.abs(rotated[row][col] - strain_2[row][col]) <= SAME_STRAIN_TOL,
      ),
    )
  })

// All coincidence-lattice matches of `film` onto `substrate` (2D bases from surface_frame),
// smallest interface cell first, then lowest von Mises strain. Only the first of several
// matches with the same strain up to a film-lattice symmetry survives when its cell count
// divides theirs: equal cell counts are symmetry duplicates, integer multiples supercells.
export function match_lattices(
  substrate: Matrix2x2,
  film: Matrix2x2,
  options: LatticeMatchOptions = {},
): LatticeMatch[] {
  const {
    max_area = INTERFACE_DEFAULTS.max_area,
    length_tol = INTERFACE_DEFAULTS.length_tol,
    angle_tol = INTERFACE_DEFAULTS.angle_tol,
    max_matches = INTERFACE_DEFAULTS.max_matches,
  } = options
  assert_in_range(max_area, `max_area`)
  assert_in_range(length_tol, `length_tol`, 1)
  assert_in_range(angle_tol, `angle_tol`)
  if (!Number.isInteger(max_matches) || max_matches < 1) {
    throw new Error(`max_matches must be a positive integer, got ${max_matches}`)
  }
  const area_substrate = basis_area(substrate, `substrate`, max_area)
  const area_film = basis_area(film, `film`, max_area)
  const bounds = squared_bounds(length_tol)
  const [area_lo, area_hi] = area_ratio_bounds(length_tol, angle_tol)
  const max_n_film = Math.floor(max_area / area_film)
  const symmetries = lattice_symmetries(film)

  // Film super-lattices recur for many substrate indices, so they are built once per index
  const film_cache = new Map<number, SuperLattice[]>()
  const film_lattices = (index: number): SuperLattice[] => {
    let lattices = film_cache.get(index)
    if (!lattices) {
      lattices = reduced_super_lattices(film, index).flatMap(with_tie_partners(film))
      film_cache.set(index, lattices)
    }
    return lattices
  }

  // Substrate cells grow with n_sub, so once max_matches survive no larger cell can enter
  const kept: LatticeMatch[] = []
  for (let n_sub = 1; n_sub * area_substrate <= max_area; n_sub++) {
    // film cell counts whose area any match within the tolerances could have
    const n_equal_area = (n_sub * area_substrate) / area_film
    const n_film_min = Math.max(1, Math.ceil(n_equal_area * area_lo))
    const n_film_max = Math.min(max_n_film, Math.floor(n_equal_area * area_hi))
    if (n_film_min > n_film_max) continue
    // sorted by |u|², so each film basis only visits the substrate bases whose |u| fits
    const sub_lattices = reduced_super_lattices(substrate, n_sub).toSorted(
      (lattice_1, lattice_2) => lattice_1.uu - lattice_2.uu,
    )
    const sub_uus = Float64Array.from(sub_lattices, ({ uu }) => uu)
    const found: LatticeMatch[] = []
    for (let n_film = n_film_min; n_film <= n_film_max; n_film++) {
      for (const film_lattice of film_lattices(n_film)) {
        const min_uu = film_lattice.uu / bounds[1]
        const max_uu = film_lattice.uu / bounds[0]
        let sub_idx = math.partition_point(sub_uus, (uu) => uu < min_uu)
        for (; sub_idx < sub_uus.length && sub_uus[sub_idx] <= max_uu; sub_idx++) {
          const sub_lattice = sub_lattices[sub_idx]
          if (!v_and_angle_fit(film_lattice, sub_lattice, bounds, angle_tol)) continue
          found.push(
            match_of_matrices(substrate, film, {
              film_matrix: film_lattice.matrix,
              substrate_matrix: sub_lattice.matrix,
            }),
          )
        }
      }
    }
    found.sort((match_1, match_2) => match_1.von_mises - match_2.von_mises)
    for (const match of found) {
      const redundant = kept.some(
        (prev) => n_sub % prev.n_substrate_cells === 0 && same_strain(prev, match, symmetries),
      )
      if (redundant) continue
      kept.push(match)
      if (kept.length === max_matches) return kept
    }
  }
  return kept
}

// The 1×1 stacking of two primitive meshes (rows a → a, b → b) as a LatticeMatch, or null
// when they disagree by more than the tolerances
export function unit_cell_match(
  substrate: Matrix2x2,
  film: Matrix2x2,
  { length_tol, angle_tol }: { length_tol: number; angle_tol: number },
): LatticeMatch | null {
  const [film_cell, sub_cell] = [film, substrate].map((basis) =>
    super_lattice(identity_2x2(), basis),
  )
  const bounds = squared_bounds(length_tol)
  const fits =
    length_fits(film_cell.uu, sub_cell.uu, bounds) &&
    v_and_angle_fit(film_cell, sub_cell, bounds, angle_tol)
  const matrices = { film_matrix: identity_2x2(), substrate_matrix: identity_2x2() }
  return fits ? match_of_matrices(substrate, film, matrices) : null
}
