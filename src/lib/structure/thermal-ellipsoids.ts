// Anisotropic displacement parameters (ADPs): the Cartesian U tensor parse_cif stores per site
// (site.properties[ADP_KEY], Å²) and the thermal ellipsoid it draws at a probability level
import type { Matrix3x3, Vec3 } from '#lib/math'
import { det_3x3, is_finite_matrix3x3 } from '#lib/math'
import type { Site } from './index'

// Site property holding the Cartesian mean-square displacement tensor U (Å², symmetric 3x3)
export const ADP_KEY = `adp_U_cart`
// CIF's U_ij component order
export const ADP_COMPONENTS = [`11`, `22`, `33`, `12`, `13`, `23`] as const

export const site_adp = (site: Site | undefined): Matrix3x3 | undefined => {
  const value = site?.properties?.[ADP_KEY]
  return is_finite_matrix3x3(value) ? value : undefined
}

// Eigen-decomposition of a symmetric 3x3 matrix by cyclic Jacobi rotations: eigenvalues
// ascending, eigenvectors as the matching COLUMNS of `vectors` (a proper rotation, det +1).
// Converges quadratically: < 10 sweeps to f64 precision.
export function symmetric_eigen_3x3(matrix: Matrix3x3): { values: Vec3; vectors: Matrix3x3 } {
  const mat = matrix.map((row) => [...row])
  const vecs = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const tolerance = 1e-15 * Math.max(...matrix.flat().map(Math.abs))
  for (let sweep = 0; sweep < 50; sweep++) {
    if (Math.hypot(mat[0][1], mat[0][2], mat[1][2]) <= tolerance) break
    for (const [row, col] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (mat[row][col] === 0) continue
      // rotation angle zeroing mat[row][col] (Numerical Recipes' stable form)
      const theta = (mat[col][col] - mat[row][row]) / (2 * mat[row][col])
      const tangent = Math.sign(theta || 1) / (Math.abs(theta) + Math.hypot(theta, 1))
      const cosine = 1 / Math.hypot(tangent, 1)
      const sine = tangent * cosine
      // A <- J^T A J (columns, then rows of mat), V <- V J (columns of vecs)
      for (const target of [mat, vecs]) {
        for (const vec of target) {
          const [v_row, v_col] = [vec[row], vec[col]]
          vec[row] = cosine * v_row - sine * v_col
          vec[col] = sine * v_row + cosine * v_col
        }
      }
      for (let idx = 0; idx < 3; idx++) {
        const [m_row, m_col] = [mat[row][idx], mat[col][idx]]
        mat[row][idx] = cosine * m_row - sine * m_col
        mat[col][idx] = sine * m_row + cosine * m_col
      }
    }
  }
  const order = [0, 1, 2].toSorted((idx_a, idx_b) => mat[idx_a][idx_a] - mat[idx_b][idx_b])
  const values = order.map((idx) => mat[idx][idx]) as Vec3
  const vectors = vecs.map((row) => order.map((idx) => row[idx])) as Matrix3x3
  // Jacobi rotations keep det +1, but sorting may swap two columns: flip one back
  if (det_3x3(vectors) < 0) for (const row of vectors) row[2] = -row[2]
  return { values, vectors }
}

// Probability that a 3D standard normal lies within radius `radius` (chi distribution with
// 3 degrees of freedom): erf(r/√2) - √(2/π) r exp(-r²/2)
const erf = (value: number): number => {
  // Taylor series below 3, erfc continued fraction above: ~1e-15 (A&S 7.1.26 is only 1.5e-7)
  const abs = Math.abs(value)
  if (abs < 3) {
    let term = abs
    let sum = abs
    for (let idx = 1; idx < 200 && Math.abs(term) > 1e-17 * sum; idx++) {
      term *= (-abs * abs) / idx
      sum += term / (2 * idx + 1)
    }
    return (Math.sign(value) * 2 * sum) / Math.sqrt(Math.PI)
  }
  let fraction = 0
  for (let idx = 60; idx >= 1; idx--) fraction = idx / 2 / (abs + fraction)
  const erfc = Math.exp(-abs * abs) / Math.sqrt(Math.PI) / (abs + fraction)
  return Math.sign(value) * (1 - erfc)
}
export const chi3_cdf = (radius: number): number =>
  erf(radius / Math.SQRT2) - Math.sqrt(2 / Math.PI) * radius * Math.exp((-radius * radius) / 2)

// Ellipsoid scale c_p: the semi-axes of the surface enclosing probability p are c_p √λ_i for
// the eigenvalues λ_i of U (ORTEP convention, e.g. c = 1.5382 at 50%). Bisection on chi3_cdf,
// memoized since every site of a structure asks for the same few probabilities.
const scale_memo = new Map<number, number>()
export function ellipsoid_scale(probability: number): number {
  if (!(probability > 0 && probability < 1))
    throw new Error(`Ellipsoid probability must be in (0, 1), got ${probability}`)
  const cached = scale_memo.get(probability)
  if (cached !== undefined) return cached
  let [low, high] = [0, 10]
  for (let iter = 0; iter < 100; iter++) {
    const mid = (low + high) / 2
    if (chi3_cdf(mid) < probability) low = mid
    else high = mid
  }
  if (scale_memo.size >= 64) scale_memo.clear()
  scale_memo.set(probability, (low + high) / 2)
  return (low + high) / 2
}

// Semi-axes (Å, ascending) and their unit directions (columns of `axes`, a proper rotation)
// of the ellipsoid enclosing `probability` of a site's displacement, plus `transform`, the
// linear map taking the unit sphere onto it (axes · diag(semi_axes)). A tensor that is not
// positive definite (a refinement artifact) has no ellipsoid: null.
export function thermal_ellipsoid(
  adp: Matrix3x3,
  probability: number,
): { semi_axes: Vec3; axes: Matrix3x3; transform: Matrix3x3 } | null {
  const { values, vectors } = symmetric_eigen_3x3(adp)
  if (!(values[0] > 0)) return null
  const scale = ellipsoid_scale(probability)
  const semi_axes = values.map((val) => scale * Math.sqrt(val)) as Vec3
  const transform = vectors.map((row) =>
    row.map((val, col) => val * semi_axes[col]),
  ) as Matrix3x3
  return { semi_axes, axes: vectors, transform }
}

// A site's thermal ellipsoid at `probability`, null without an ADP (or a non-positive-definite one)
export const site_ellipsoid = (site: Site, probability: number) => {
  const adp = site_adp(site)
  return adp ? thermal_ellipsoid(adp, probability) : null
}
