// Default high-symmetry band path of a crystal in the Setyawan–Curtarolo convention
// (Comput. Mater. Sci. 49, 299 (2010), doi:10.1016/j.commatsci.2010.05.010), the one pymatgen's
// HighSymmKPath uses by default. moyo's standardization supplies the Bravais lattice and
// conventional cell; SC's own cell choices (axis order, monoclinic unique axis a with α < 90°,
// triclinic reciprocal-angle signs) follow pymatgen's SpacegroupAnalyzer so labels and
// coordinates match its k-paths. Points come back in the SC primitive cell's reciprocal basis.
import * as math from '#lib/math'
import type { Matrix3x3, Vec2, Vec3 } from '#lib/math'
import { point_group_rotations } from '#lib/symmetry/analyze'
import { type CrystalSystem, spacegroup_to_crystal_sys } from '#lib/symmetry/spacegroups'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import type { KPathData } from './types'

// High-symmetry k-points (fractional in k_lattice, the reciprocal basis of `primitive`) and the
// path through them: each inner array is one continuous stretch of labels, and consecutive
// stretches are separate (a jump between them is not path).
export type HighSymmKPath = {
  variant: ScLatticeVariant
  kpoints: Record<string, Vec3>
  path: string[][]
  primitive: Matrix3x3 // the SC primitive cell the path is defined in (rows, input-fractional)
  k_lattice: Matrix3x3 // its reciprocal lattice (rows b_i incl. 2π), whose zone holds the path
}

// What high_symmetry_kpath reads from a moyo analysis of the cell (analyze_structure_symmetry)
export type KPathSymmetry = Pick<
  MoyoDataset,
  `number` | `hm_symbol` | `std_linear` | `operations`
>

// Lattice-parameter comparisons deciding between SC variants (e.g. kγ = 90° for MCLC2) are
// exact in SC; refined cells hit a boundary only up to float noise
const BOUNDARY_TOL = 1e-8
// Angle (degrees) below which a monoclinic cell angle counts as right
const RIGHT_ANGLE_TOL = 1e-3

// === Setyawan–Curtarolo k-point tables (transcribed from pymatgen's KPathSetyawanCurtarolo) ===

// SC conventional lengths, α (radians, between b and c) and the primitive cell's α (for RHL)
type ScCell = {
  a_len: number
  b_len: number
  c_len: number
  alpha: number
  prim_alpha: number
}
// Γ = 0 is implied; path stretches are `|`-separated, labels within one `-`-separated
type ScTable = { kpoints: Record<string, Vec3>; path: string }

// ORCF1 and ORCF3 share their points
const orcf1_3_points = ({ a_len, b_len, c_len }: ScCell): Record<string, Vec3> => {
  const zeta = (1 + a_len ** 2 / b_len ** 2 - a_len ** 2 / c_len ** 2) / 4
  const eta = (1 + a_len ** 2 / b_len ** 2 + a_len ** 2 / c_len ** 2) / 4
  return {
    A: [0.5, 0.5 + zeta, zeta],
    'A₁': [0.5, 0.5 - zeta, 1 - zeta],
    L: [0.5, 0.5, 0.5],
    T: [1, 0.5, 0.5],
    X: [0, eta, eta],
    'X₁': [1, 1 - eta, 1 - eta],
    Y: [0.5, 0, 0.5],
    Z: [0.5, 0.5, 0],
  }
}

// MCLC1 (kγ > 90°) and MCLC2 (kγ = 90°) share their points but for MCLC2's F₃
const mclc1_2_points = (
  { a_len, b_len, c_len, alpha }: ScCell,
  with_f3: boolean,
): Record<string, Vec3> => {
  const [cos_alpha, sin_alpha] = [Math.cos(alpha), Math.sin(alpha)]
  const zeta = (2 - (b_len * cos_alpha) / c_len) / (4 * sin_alpha ** 2)
  const eta = 0.5 + (2 * zeta * c_len * cos_alpha) / b_len
  const psi = 0.75 - a_len ** 2 / (4 * b_len ** 2 * sin_alpha ** 2)
  const phi = psi + ((0.75 - psi) * b_len * cos_alpha) / c_len
  return {
    N: [0.5, 0, 0],
    'N₁': [0, -0.5, 0],
    F: [1 - zeta, 1 - zeta, 1 - eta],
    'F₁': [zeta, zeta, eta],
    'F₂': [-zeta, -zeta, 1 - eta],
    ...(with_f3 && { 'F₃': [1 - zeta, -zeta, 1 - eta] as Vec3 }),
    I: [phi, 1 - phi, 0.5],
    'I₁': [1 - phi, phi - 1, 0.5],
    L: [0.5, 0.5, 0.5],
    M: [0.5, 0, 0.5],
    X: [1 - psi, psi - 1, 0],
    'X₁': [psi, 1 - psi, 0],
    'X₂': [psi - 1, -psi, 0],
    Y: [0.5, 0.5, 0],
    'Y₁': [-0.5, -0.5, 0],
    Z: [0, 0, 0.5],
  }
}

// The H, M, N, X, Y and Z points of MCLC3 to MCLC5, from their ζ, η, μ and δ
const mclc3_5_points = (
  zeta: number,
  eta: number,
  mu: number,
  delta: number,
): Record<string, Vec3> => ({
  H: [zeta, zeta, eta],
  'H₁': [1 - zeta, -zeta, 1 - eta],
  'H₂': [-zeta, -zeta, 1 - eta],
  M: [0.5, 0, 0.5],
  N: [0.5, 0, 0],
  'N₁': [0, -0.5, 0],
  X: [0.5, -0.5, 0],
  Y: [mu, mu, delta],
  'Y₁': [1 - mu, -mu, -delta],
  'Y₂': [-mu, -mu, -delta],
  'Y₃': [mu, mu - 1, delta],
  Z: [0, 0, 0.5],
})

// MCLC3 and MCLC4 share their points
const mclc3_4_points = ({ a_len, b_len, c_len, alpha }: ScCell): Record<string, Vec3> => {
  const [cos_alpha, sin_alpha] = [Math.cos(alpha), Math.sin(alpha)]
  const mu = (1 + b_len ** 2 / a_len ** 2) / 4
  const delta = (b_len * c_len * cos_alpha) / (2 * a_len ** 2)
  const zeta = mu - 0.25 + (1 - (b_len * cos_alpha) / c_len) / (4 * sin_alpha ** 2)
  const eta = 0.5 + (2 * zeta * c_len * cos_alpha) / b_len
  const phi = 1 + zeta - 2 * mu
  const psi = eta - 2 * delta
  return {
    F: [1 - phi, 1 - phi, 1 - psi],
    'F₁': [phi, phi - 1, psi],
    'F₂': [1 - phi, -phi, 1 - psi],
    I: [0.5, -0.5, 0.5],
    ...mclc3_5_points(zeta, eta, mu, delta),
  }
}

const TRI_PATH = `X-Γ-Y|L-Γ-Z|N-Γ-M|R-Γ`

// The 25 lattice variants SC tabulate a path for
const SC_TABLES = {
  CUB: () => ({
    kpoints: { X: [0, 0.5, 0], R: [0.5, 0.5, 0.5], M: [0.5, 0.5, 0] },
    path: `Γ-X-M-Γ-R-X|M-R`,
  }),
  FCC: () => ({
    kpoints: {
      K: [3 / 8, 3 / 8, 3 / 4],
      L: [0.5, 0.5, 0.5],
      U: [5 / 8, 1 / 4, 5 / 8],
      W: [0.5, 1 / 4, 3 / 4],
      X: [0.5, 0, 0.5],
    },
    path: `Γ-X-W-K-Γ-L-U-W-L-K|U-X`,
  }),
  BCC: () => ({
    kpoints: { H: [0.5, -0.5, 0.5], P: [0.25, 0.25, 0.25], N: [0, 0, 0.5] },
    path: `Γ-H-N-Γ-P-H|P-N`,
  }),
  TET: () => ({
    kpoints: {
      A: [0.5, 0.5, 0.5],
      M: [0.5, 0.5, 0],
      R: [0, 0.5, 0.5],
      X: [0, 0.5, 0],
      Z: [0, 0, 0.5],
    },
    path: `Γ-X-M-Γ-Z-R-A-Z|X-R|M-A`,
  }),
  BCT1: ({ a_len, c_len }) => {
    const eta = (1 + c_len ** 2 / a_len ** 2) / 4
    return {
      kpoints: {
        M: [-0.5, 0.5, 0.5],
        N: [0, 0.5, 0],
        P: [0.25, 0.25, 0.25],
        X: [0, 0, 0.5],
        Z: [eta, eta, -eta],
        'Z₁': [-eta, 1 - eta, eta],
      },
      path: `Γ-X-M-Γ-Z-P-N-Z₁-M|X-P`,
    }
  },
  BCT2: ({ a_len, c_len }) => {
    const eta = (1 + a_len ** 2 / c_len ** 2) / 4
    const zeta = a_len ** 2 / (2 * c_len ** 2)
    return {
      kpoints: {
        N: [0, 0.5, 0],
        P: [0.25, 0.25, 0.25],
        Σ: [-eta, eta, eta],
        'Σ₁': [eta, 1 - eta, -eta],
        X: [0, 0, 0.5],
        Y: [-zeta, zeta, 0.5],
        'Y₁': [0.5, 0.5, -zeta],
        Z: [0.5, 0.5, -0.5],
      },
      path: `Γ-X-Y-Σ-Γ-Z-Σ₁-N-P-Y₁-Z|X-P`,
    }
  },
  ORC: () => ({
    kpoints: {
      R: [0.5, 0.5, 0.5],
      S: [0.5, 0.5, 0],
      T: [0, 0.5, 0.5],
      U: [0.5, 0, 0.5],
      X: [0.5, 0, 0],
      Y: [0, 0.5, 0],
      Z: [0, 0, 0.5],
    },
    path: `Γ-X-S-Y-Γ-Z-U-R-T-Z|Y-T|U-X|S-R`,
  }),
  ORCF1: (cell) => ({
    kpoints: orcf1_3_points(cell),
    path: `Γ-Y-T-Z-Γ-X-A₁-Y|T-X₁|X-A-Z|L-Γ`,
  }),
  ORCF2: ({ a_len, b_len, c_len }) => {
    const phi = (1 + c_len ** 2 / b_len ** 2 - c_len ** 2 / a_len ** 2) / 4
    const eta = (1 + a_len ** 2 / b_len ** 2 - a_len ** 2 / c_len ** 2) / 4
    const delta = (1 + b_len ** 2 / a_len ** 2 - b_len ** 2 / c_len ** 2) / 4
    return {
      kpoints: {
        C: [0.5, 0.5 - eta, 1 - eta],
        'C₁': [0.5, 0.5 + eta, eta],
        D: [0.5 - delta, 0.5, 1 - delta],
        'D₁': [0.5 + delta, 0.5, delta],
        L: [0.5, 0.5, 0.5],
        H: [1 - phi, 0.5 - phi, 0.5],
        'H₁': [phi, 0.5 + phi, 0.5],
        X: [0, 0.5, 0.5],
        Y: [0.5, 0, 0.5],
        Z: [0.5, 0.5, 0],
      },
      path: `Γ-Y-C-D-X-Γ-Z-D₁-H-C|C₁-Z|X-H₁|H-Y|L-Γ`,
    }
  },
  ORCF3: (cell) => ({ kpoints: orcf1_3_points(cell), path: `Γ-Y-T-Z-Γ-X-A₁-Y|X-A-Z|L-Γ` }),
  ORCI: ({ a_len, b_len, c_len }) => {
    const zeta = (1 + a_len ** 2 / c_len ** 2) / 4
    const eta = (1 + b_len ** 2 / c_len ** 2) / 4
    const delta = (b_len ** 2 - a_len ** 2) / (4 * c_len ** 2)
    const mu = (a_len ** 2 + b_len ** 2) / (4 * c_len ** 2)
    return {
      kpoints: {
        L: [-mu, mu, 0.5 - delta],
        'L₁': [mu, -mu, 0.5 + delta],
        'L₂': [0.5 - delta, 0.5 + delta, -mu],
        R: [0, 0.5, 0],
        S: [0.5, 0, 0],
        T: [0, 0, 0.5],
        W: [0.25, 0.25, 0.25],
        X: [-zeta, zeta, zeta],
        'X₁': [zeta, 1 - zeta, -zeta],
        Y: [eta, -eta, eta],
        'Y₁': [1 - eta, eta, -eta],
        Z: [0.5, 0.5, -0.5],
      },
      path: `Γ-X-L-T-W-R-X₁-Z-Γ-Y-S-W|L₁-Y|Y₁-Z`,
    }
  },
  ORCC: ({ a_len, b_len }) => {
    const zeta = (1 + a_len ** 2 / b_len ** 2) / 4
    return {
      kpoints: {
        A: [zeta, zeta, 0.5],
        'A₁': [-zeta, 1 - zeta, 0.5],
        R: [0, 0.5, 0.5],
        S: [0, 0.5, 0],
        T: [-0.5, 0.5, 0.5],
        X: [zeta, zeta, 0],
        'X₁': [-zeta, 1 - zeta, 0],
        Y: [-0.5, 0.5, 0],
        Z: [0, 0, 0.5],
      },
      path: `Γ-X-S-R-A-Z-Γ-Y-X₁-A₁-T-Y|Z-T`,
    }
  },
  HEX: () => ({
    kpoints: {
      A: [0, 0, 0.5],
      H: [1 / 3, 1 / 3, 0.5],
      K: [1 / 3, 1 / 3, 0],
      L: [0.5, 0, 0.5],
      M: [0.5, 0, 0],
    },
    path: `Γ-M-K-Γ-A-L-H-A|L-M|K-H`,
  }),
  RHL1: ({ prim_alpha }) => {
    const eta = (1 + 4 * Math.cos(prim_alpha)) / (2 + 4 * Math.cos(prim_alpha))
    const nu = 3 / 4 - eta / 2
    return {
      kpoints: {
        B: [eta, 0.5, 1 - eta],
        'B₁': [0.5, 1 - eta, eta - 1],
        F: [0.5, 0.5, 0],
        L: [0.5, 0, 0],
        'L₁': [0, 0, -0.5],
        P: [eta, nu, nu],
        'P₁': [1 - nu, 1 - nu, 1 - eta],
        'P₂': [nu, nu, eta - 1],
        Q: [1 - nu, nu, 0],
        X: [nu, 0, -nu],
        Z: [0.5, 0.5, 0.5],
      },
      path: `Γ-L-B₁|B-Z-Γ-X|Q-F-P₁-Z|L-P`,
    }
  },
  RHL2: ({ prim_alpha }) => {
    const eta = 1 / (2 * Math.tan(prim_alpha / 2) ** 2)
    const nu = 3 / 4 - eta / 2
    return {
      kpoints: {
        F: [0.5, -0.5, 0],
        L: [0.5, 0, 0],
        P: [1 - nu, -nu, 1 - nu],
        'P₁': [nu, nu - 1, nu - 1],
        Q: [eta, eta, eta],
        'Q₁': [1 - eta, -eta, -eta],
        Z: [0.5, -0.5, 0.5],
      },
      path: `Γ-P-Z-Q-Γ-F-P₁-Q₁-L-Z`,
    }
  },
  MCL: ({ b_len, c_len, alpha }) => {
    const eta = (1 - (b_len * Math.cos(alpha)) / c_len) / (2 * Math.sin(alpha) ** 2)
    const nu = 0.5 - (eta * c_len * Math.cos(alpha)) / b_len
    return {
      kpoints: {
        A: [0.5, 0.5, 0],
        C: [0, 0.5, 0.5],
        D: [0.5, 0, 0.5],
        'D₁': [0.5, 0, -0.5],
        E: [0.5, 0.5, 0.5],
        H: [0, eta, 1 - nu],
        'H₁': [0, 1 - eta, nu],
        'H₂': [0, eta, -nu],
        M: [0.5, eta, 1 - nu],
        'M₁': [0.5, 1 - eta, nu],
        'M₂': [0.5, eta, -nu],
        X: [0, 0.5, 0],
        Y: [0, 0, 0.5],
        'Y₁': [0, 0, -0.5],
        Z: [0.5, 0, 0],
      },
      path: `Γ-Y-H-C-E-M₁-A-X-H₁|M-D-Z|Y-D`,
    }
  },
  MCLC1: (cell) => ({
    kpoints: mclc1_2_points(cell, false),
    path: `Γ-Y-F-L-I|I₁-Z-F₁|Y-X₁|X-Γ-N|M-Γ`,
  }),
  MCLC2: (cell) => ({ kpoints: mclc1_2_points(cell, true), path: `Γ-Y-F-L-I|I₁-Z-F₁|N-Γ-M` }),
  MCLC3: (cell) => ({ kpoints: mclc3_4_points(cell), path: `Γ-Y-F-H-Z-I-F₁|H₁-Y₁-X-Γ-N|M-Γ` }),
  MCLC4: (cell) => ({ kpoints: mclc3_4_points(cell), path: `Γ-Y-F-H-Z-I|H₁-Y₁-X-Γ-N|M-Γ` }),
  MCLC5: ({ a_len, b_len, c_len, alpha }) => {
    const [cos_alpha, sin_alpha] = [Math.cos(alpha), Math.sin(alpha)]
    const zeta =
      (b_len ** 2 / a_len ** 2 + (1 - (b_len * cos_alpha) / c_len) / sin_alpha ** 2) / 4
    const eta = 0.5 + (2 * zeta * c_len * cos_alpha) / b_len
    const mu =
      eta / 2 + b_len ** 2 / (4 * a_len ** 2) - (b_len * c_len * cos_alpha) / (2 * a_len ** 2)
    const nu = 2 * mu - zeta
    const rho = 1 - (zeta * a_len ** 2) / b_len ** 2
    const omega =
      ((4 * nu - 1 - (b_len ** 2 * sin_alpha ** 2) / a_len ** 2) * c_len) /
      (2 * b_len * cos_alpha)
    const delta = (zeta * c_len * cos_alpha) / b_len + omega / 2 - 0.25
    return {
      kpoints: {
        F: [nu, nu, omega],
        'F₁': [1 - nu, 1 - nu, 1 - omega],
        'F₂': [nu, nu - 1, omega],
        I: [rho, 1 - rho, 0.5],
        'I₁': [1 - rho, rho - 1, 0.5],
        L: [0.5, 0.5, 0.5],
        ...mclc3_5_points(zeta, eta, mu, delta),
      },
      path: `Γ-Y-F-L-I|I₁-Z-H-F₁|H₁-Y₁-X-Γ-N|M-Γ`,
    }
  },
  TRI1a: () => ({
    kpoints: {
      L: [0.5, 0.5, 0],
      M: [0, 0.5, 0.5],
      N: [0.5, 0, 0.5],
      R: [0.5, 0.5, 0.5],
      X: [0.5, 0, 0],
      Y: [0, 0.5, 0],
      Z: [0, 0, 0.5],
    },
    path: TRI_PATH,
  }),
  TRI1b: () => ({
    kpoints: {
      L: [0.5, -0.5, 0],
      M: [0, 0, 0.5],
      N: [-0.5, -0.5, 0.5],
      R: [0, -0.5, 0.5],
      X: [0, -0.5, 0],
      Y: [0.5, 0, 0],
      Z: [-0.5, 0, 0.5],
    },
    path: TRI_PATH,
  }),
} satisfies Record<string, (cell: ScCell) => ScTable>

export type ScLatticeVariant = keyof typeof SC_TABLES

// === Cell standardization ===

// Rows of `rows` (lattice vectors in input-fractional coordinates) in Cartesian
const to_cartesian = (rows: Matrix3x3, lattice: Matrix3x3): Matrix3x3 =>
  math.dot(rows, lattice)

const norm = (vec: Vec3): number => Math.hypot(...vec)
// Angle between two vectors in degrees
const angle_deg = (vec_a: Vec3, vec_b: Vec3): number =>
  math.to_degrees(Math.acos(math.dot(vec_a, vec_b) / (norm(vec_a) * norm(vec_b))))
// Interaxial angles α (b, c), β (a, c), γ (a, b) of row vectors, in degrees
const cell_angles = ([vec_a, vec_b, vec_c]: Matrix3x3): Vec3 => [
  angle_deg(vec_b, vec_c),
  angle_deg(vec_a, vec_c),
  angle_deg(vec_a, vec_b),
]
const negate = (vec: Vec3): Vec3 => math.scale(vec, -1)

// Row indices of `rows` sorted by Cartesian length (stable, as Python's sorted)
const by_length = (cart: Matrix3x3, indices: number[]): number[] =>
  indices.toSorted((idx_a, idx_b) => norm(cart[idx_a]) - norm(cart[idx_b]))

// oxfmt-ignore
const PERMUTATIONS_3 = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as const

// SC monoclinic cell: unique axis a, α < 90° (between b and c), b < c for P; C-centered cells
// keep c. Mirrors pymatgen's get_conventional_standard_structure(international_monoclinic=
// False), incl. its last-valid-permutation-wins loop.
function monoclinic_conventional(
  std: Matrix3x3,
  lattice: Matrix3x3,
  centered: boolean,
): Matrix3x3 {
  const cart = to_cartesian(std, lattice)
  const perms = centered ? [[0, 1, 2] as const, [1, 0, 2] as const] : PERMUTATIONS_3
  let chosen: Matrix3x3 | null = null
  for (const [idx_a, idx_b, idx_c] of perms) {
    const alpha = angle_deg(cart[idx_b], cart[idx_c])
    if (Math.abs(alpha - 90) < RIGHT_ANGLE_TOL) continue
    if (!centered && norm(cart[idx_b]) >= norm(cart[idx_c])) continue
    chosen =
      alpha > 90
        ? [negate(std[idx_a]), negate(std[idx_b]), std[idx_c]]
        : [std[idx_a], std[idx_b], std[idx_c]]
  }
  if (chosen) return chosen
  const sorted = centered ? [...by_length(cart, [0, 1]), 2] : by_length(cart, [0, 1, 2])
  return sorted.map((idx) => std[idx]) as Matrix3x3
}

// Reciprocal-lattice angles (degrees) of row vectors in Cartesian
const reciprocal_angles = (cart: Matrix3x3): Vec3 => cell_angles(math.reciprocal_lattice(cart))

// SC triclinic cell: the sign variant of the reduced cell whose reciprocal angles are all
// acute or all obtuse (TRI1b/TRI1a), last match winning as in pymatgen
function triclinic_conventional(std: Matrix3x3, lattice: Matrix3x3): Matrix3x3 {
  let chosen: Matrix3x3 | null = null
  // oxfmt-ignore
  for (const signs of [[1, 1, 1], [-1, 1, -1], [-1, -1, 1], [1, -1, -1]]) {
    const rows = std.map((row, idx) => math.scale(row, signs[idx])) as Matrix3x3
    const angles = reciprocal_angles(to_cartesian(rows, lattice))
    if (angles.every((angle) => angle <= 90) || angles.every((angle) => angle > 90))
      chosen = rows
  }
  if (!chosen) {
    throw new Error(
      `No sign variant of the triclinic cell has all-acute or all-obtuse reciprocal angles`,
    )
  }
  return chosen
}

// Rows: SC primitive vectors in units of the SC conventional ones
// oxfmt-ignore
const CONV_TO_PRIM: Record<string, Matrix3x3> = {
  P: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  R: [[2 / 3, 1 / 3, 1 / 3], [-1 / 3, 1 / 3, 1 / 3], [-1 / 3, -2 / 3, 1 / 3]],
  I: [[-0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, -0.5]],
  F: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
  C_monoclinic: [[0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 1]],
  C_orthorhombic: [[0.5, -0.5, 0], [0.5, 0.5, 0], [0, 0, 1]],
}

// Trigonal joins hexagonal, its R-centered groups being RHL
type CrystalFamily = Exclude<CrystalSystem, `trigonal`>
const crystal_family = (spg_number: number): CrystalFamily => {
  const system = spacegroup_to_crystal_sys(spg_number)
  if (!system) throw new Error(`Invalid space group number ${spg_number}`)
  return system === `trigonal` ? `hexagonal` : system
}

// SC conventional cell (rows in input-fractional coordinates) from moyo's ITA-standard one
function sc_conventional(
  family: CrystalFamily,
  centering: string,
  std: Matrix3x3,
  lattice: Matrix3x3,
): Matrix3x3 {
  const cart = to_cartesian(std, lattice)
  if (family === `orthorhombic`) {
    // keep the centered face in the ab plane: C stays, A (Amm2 & co.) moves a to c
    const order =
      centering === `C`
        ? [...by_length(cart, [0, 1]), 2]
        : centering === `A`
          ? [...by_length(cart, [1, 2]), 0]
          : by_length(cart, [0, 1, 2])
    return order.map((idx) => std[idx]) as Matrix3x3
  }
  if (family === `monoclinic`) return monoclinic_conventional(std, lattice, centering === `C`)
  if (family === `triclinic`) return triclinic_conventional(std, lattice)
  // cubic, tetragonal (moyo puts the unique axis c last) and hexagonal axes stay as moyo
  // gives them: SC's choices among them differ only by lattice symmetry
  return std
}

const conv_to_prim = (family: CrystalFamily, centering: string): Matrix3x3 => {
  const key =
    centering === `C` || centering === `A`
      ? `C_${family === `monoclinic` ? `monoclinic` : `orthorhombic`}`
      : centering
  const matrix = CONV_TO_PRIM[key]
  if (!matrix) throw new Error(`Unsupported lattice centering ${centering} (${family})`)
  return matrix
}

// The SC path variant for an SC conventional cell (Cartesian rows) and primitive cell
// (Cartesian rows), as pymatgen's KPathSetyawanCurtarolo picks it
function sc_variant(
  family: CrystalFamily,
  centering: string,
  { a_len, b_len, c_len, alpha }: ScCell,
  prim: Matrix3x3,
): ScLatticeVariant {
  if (family === `cubic`) return centering === `F` ? `FCC` : centering === `I` ? `BCC` : `CUB`
  if (family === `tetragonal`) {
    if (centering === `P`) return `TET`
    return c_len < a_len ? `BCT1` : `BCT2`
  }
  if (family === `orthorhombic`) {
    if (centering === `F`) {
      const lhs = 1 / a_len ** 2
      const rhs = 1 / b_len ** 2 + 1 / c_len ** 2
      if (Math.abs(lhs - rhs) < BOUNDARY_TOL * lhs) return `ORCF3`
      return lhs > rhs ? `ORCF1` : `ORCF2`
    }
    if (centering === `I`) return `ORCI`
    return centering === `C` || centering === `A` ? `ORCC` : `ORC`
  }
  if (family === `hexagonal`) {
    if (centering !== `R`) return `HEX`
    return cell_angles(prim)[0] < 90 ? `RHL1` : `RHL2`
  }
  if (family === `monoclinic`) {
    if (centering === `P`) return `MCL`
    const k_gamma = reciprocal_angles(prim)[2]
    if (Math.abs(k_gamma - 90) < BOUNDARY_TOL * 90) return `MCLC2`
    if (k_gamma > 90) return `MCLC1`
    const criterion =
      (b_len * Math.cos(alpha)) / c_len + (b_len ** 2 * Math.sin(alpha) ** 2) / a_len ** 2
    if (Math.abs(criterion - 1) < BOUNDARY_TOL) return `MCLC4`
    return criterion < 1 ? `MCLC3` : `MCLC5`
  }
  const [k_alpha, k_beta, k_gamma] = reciprocal_angles(prim)
  if (k_alpha > 90 && k_beta > 90 && k_gamma >= 90) return `TRI1a`
  if (k_alpha < 90 && k_beta < 90 && k_gamma <= 90) return `TRI1b`
  throw new Error(
    `Triclinic reciprocal angles ${[k_alpha, k_beta, k_gamma].map((angle) => angle.toFixed(3)).join(`, `)} fit neither TRI1a nor TRI1b`,
  )
}

// Among the crystal's symmetry-equivalent copies (point-group images, and their negatives, as
// time reversal makes k and -k equivalent) of the SC primitive basis, the one closest to the
// input basis: an input that already is the SC primitive cell keeps SC's own coordinates.
function closest_equivalent_basis(prim: Matrix3x3, rotations: Matrix3x3[]): Matrix3x3 {
  let [best, best_dist] = [prim, Infinity]
  for (const rotation of rotations) {
    for (const sign of [1, -1]) {
      // a lattice vector v (input-fractional column) maps to W·v, i.e. rows P·Wᵀ
      const candidate = math
        .dot(prim, math.transpose_3x3(rotation))
        .map((row) => math.scale(row, sign)) as Matrix3x3
      const dist = candidate
        .flat()
        .reduce((sum, val, flat_idx) => sum + (val - (flat_idx % 4 === 0 ? 1 : 0)) ** 2, 0)
      if (dist < best_dist - 1e-9) [best, best_dist] = [candidate, dist]
    }
  }
  return best
}

// Setyawan–Curtarolo high-symmetry k-path of a crystal with lattice `lattice` (rows a_i, Å),
// given moyo's analysis of it (analyze_structure_symmetry). k-points are SC's own fractional
// coordinates in the reciprocal basis of `primitive` (also for a non-primitive input cell, e.g.
// conventional fcc, whose smaller zone would leave points outside it).
export function high_symmetry_kpath(
  lattice: Matrix3x3,
  sym_data: KPathSymmetry,
): HighSymmKPath {
  const family = crystal_family(sym_data.number)
  const centering = sym_data.hm_symbol.trim()[0]
  if (!centering || !`PABCFIR`.includes(centering))
    throw new Error(`Unrecognized centering in Hermann-Mauguin symbol "${sym_data.hm_symbol}"`)
  // moyo: x_std = L⁻¹·x_input, so std basis vector j is column j of L in input-fractional coords
  const std = math.transpose_3x3(math.mat3x3_from_flat_col_major(sym_data.std_linear))
  const conv = sc_conventional(family, centering, std, lattice)
  const prim = math.dot(conv_to_prim(family, centering), conv)
  const [conv_cart, prim_cart] = [to_cartesian(conv, lattice), to_cartesian(prim, lattice)]
  const [a_len, b_len, c_len] = conv_cart.map(norm)
  const [alpha, prim_alpha] = [conv_cart, prim_cart].map((cart) =>
    math.to_radians(cell_angles(cart)[0]),
  )
  const cell = { a_len, b_len, c_len, alpha, prim_alpha }
  const variant = sc_variant(family, centering, cell, prim_cart)
  const table: ScTable = SC_TABLES[variant](cell)
  const kpoints: Record<string, Vec3> = { Γ: [0, 0, 0], ...table.kpoints }
  const primitive = closest_equivalent_basis(prim, point_group_rotations(sym_data.operations))
  const path = table.path.split(`|`).map((stretch) => stretch.split(`-`))
  const k_lattice = math.reciprocal_lattice(to_cartesian(primitive, lattice), { two_pi: true })
  return { variant, kpoints, path, primitive, k_lattice }
}

// BrillouinZone's `k_path` for a high-symmetry path: Cartesian points, one per label visit,
// with every path stretch a branch
export function kpath_to_k_path_data({
  kpoints,
  path,
  k_lattice,
}: Pick<HighSymmKPath, `kpoints` | `path` | `k_lattice`>): KPathData {
  const [points, labels, branches]: [Vec3[], string[], Vec2[]] = [[], [], []]
  const frac_to_cart = math.create_frac_to_cart(k_lattice)
  for (const stretch of path) {
    branches.push([points.length, points.length + stretch.length - 1])
    for (const label of stretch) {
      const frac = kpoints[label]
      if (!frac) throw new Error(`k-path label ${label} has no k-point`)
      points.push(frac_to_cart(frac))
      labels.push(label)
    }
  }
  return { points, labels, branches }
}
