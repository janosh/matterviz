// Classify space-group symmetry operations (W, w) into geometric symmetry elements:
// rotation/screw axes, mirror/glide planes, inversion centers, and rotoinversion axes.
// Everything is computed in fractional coordinates of the cell the operations refer to
// (moyo returns operations in the INPUT cell frame). To render in Cartesian space,
// convert direction and point via the direct lattice: cart = frac · L (rows = basis
// vectors). This single rule is valid for plane normals too: the Cartesian image of a
// fractional eigenvector is an eigenvector of the (orthogonal) Cartesian operator, so
// the −1 eigenvector of a mirror maps to the true Cartesian plane normal.
//
// Math summary for an operation x' = W·x + w with W an integer matrix of finite order n:
// - type from (det W, trace W): proper +1 → {3: identity, −1: 2-fold, 0: 3, 1: 4, 2: 6};
//   improper −1 → {−3: inversion, 1: mirror, 0: −3, −1: −4, −2: −6}
// - P = (1/n) Σₖ Wᵏ projects onto the invariant subspace (axis for rotations, plane for
//   mirrors, {0} for inversion/rotoinversion)
// - intrinsic (screw/glide) translation w_i = P·w; location part w_loc = w − w_i
// - fixed point x₀ = orbit average of the origin under (W, w_loc): since the translation
//   part of (W, w_loc)ⁿ vanishes, the average of {0, (W,w_loc)·0, …} is exactly fixed
import type { Matrix3x3, Vec3 } from '#lib/math'
import * as math from '#lib/math'
import { clip_frac_plane_to_cell } from '#lib/structure/lattice-planes'
import { whole_tile_counts } from '#lib/structure/supercell'
import { wrap_to_unit_cell } from '#lib/structure/pbc'
import type { MoyoCell, MoyoDataset } from '@spglib/moyo-wasm'

// All element kinds in display order (axes, planes, then point elements), followed by both
// the controls legend and symmetry_elements_from_ops.
export const SYM_ELEM_KINDS = [
  `rotation`,
  `screw`,
  `rotoinversion`,
  `mirror`,
  `glide`,
  `inversion`,
] as const
type SymmetryElementKind = (typeof SYM_ELEM_KINDS)[number]

export type SymmetryElement = {
  kind: SymmetryElementKind
  // Rotation order of the (proper part of the) operation: 2, 3, 4 or 6 for axes and
  // rotoinversions, 2 for mirror/glide planes, 1 for inversion centers
  order: number
  // ITA symbol, read in the standardized frame: "2", "2_1", "3_2", "m", "a"/"b"/"c"/"n"/"d"/"e"/"g"
  // (glides, see ita_glide_letter), "-1", "-4"
  label: string
  // Fractional direction: rotation/screw/rotoinversion axis, or mirror/glide plane
  // normal. Reduced integer vector with canonical sign. Null for inversion centers.
  axis: Vec3 | null
  // Mirror/glide planes only (else null): Miller indices n of the plane {x : n·x = n·point}, the
  // −1 eigenvector of Wᵀ. Exact and metric-free, unlike the normal direction `axis` (−1
  // eigenvector of W), which is parallel to n only under a metric the operation preserves.
  plane_normal: Vec3 | null
  // A fractional point on the element (on the axis / in the plane / the center),
  // wrapped into [0, 1)
  point: Vec3
  // Intrinsic screw/glide translation in fractional coordinates (null if none)
  translation: Vec3 | null
  // Lattice-invariant key of the element's geometric locus (the axis line, the plane, or the
  // center), independent of kind/label: a 2-fold, a 4_2 screw and a -4 on the same line share
  // it, which is how renderers find sub-axes to hide. See element_locus_key.
  locus: string
}

// Per-kind overlay visibility. Kinds absent from the record are hidden.
export type ShowSymmetryKinds = Partial<Record<SymmetryElementKind, boolean>>

// Default overlay visibility: proper rotation axes only. High-symmetry structures have 100+
// elements that, drawn at once, bury the structure; users opt into more kinds via
// SymmetryElementControls (or the show_kinds prop).
export const DEFAULT_SHOW_SYM_KINDS: ShowSymmetryKinds = { rotation: true }

// moyo's operations live in the input-cell frame, so the viewer blanks the overlay while a
// conventional/primitive cell is rendered. Shown by SymmetryElementControls and toasted by
// the structure viewer when the cell is switched with the overlay on.
export const SYM_ELEMENTS_INPUT_FRAME_NOTE = `Symmetry elements are drawn only in the original (input) cell`

// Render colors of SymmetryElements.svelte, the single source for the legend swatches
// too. Axes (rotation, screw, rotoinversion) are colored by rotation order in-scene.
export const SYM_ELEM_COLORS = {
  axis_by_order: { 2: `#e63946`, 3: `#2a9d8f`, 4: `#3a6fb0`, 6: `#9c27b0` } as Record<
    number,
    string
  >,
  mirror: `#ffb703`,
  glide: `#8ecae6`,
  inversion: `#555555`,
}
// Legend swatch for the order-colored axis kinds: the whole order palette, 2 → 6
const axis_palette = Object.values(SYM_ELEM_COLORS.axis_by_order).join(`, `)
const AXIS_SWATCH = `linear-gradient(90deg, ${axis_palette})`

// Human-readable labels + legend swatch (a CSS background) per kind, matching what
// SymmetryElements.svelte renders
export const SYM_ELEM_KIND_INFO: Record<
  SymmetryElementKind,
  { label: string; color: string }
> = {
  rotation: { label: `rotation axes`, color: AXIS_SWATCH },
  screw: { label: `screw axes`, color: AXIS_SWATCH },
  mirror: { label: `mirror planes`, color: SYM_ELEM_COLORS.mirror },
  glide: { label: `glide planes`, color: SYM_ELEM_COLORS.glide },
  rotoinversion: { label: `rotoinversion axes`, color: AXIS_SWATCH },
  inversion: { label: `inversion centers`, color: SYM_ELEM_COLORS.inversion },
}

// Tally elements per kind (for legend labels like "mirror planes (9)")
export function count_symmetry_elements(
  elements: readonly SymmetryElement[],
): Partial<Record<SymmetryElementKind, number>> {
  const counts: Partial<Record<SymmetryElementKind, number>> = {}
  for (const elem of elements) counts[elem.kind] = (counts[elem.kind] ?? 0) + 1
  return counts
}

// Whether some present element's kind is enabled in show_kinds. Gates declutter so callers
// don't hide polyhedra / shrink atoms when nothing draws (e.g. the rotation-only default on
// an inversion-only P-1 cell).
export const has_visible_symmetry_overlay = (
  elements: readonly SymmetryElement[],
  show_kinds: ShowSymmetryKinds = DEFAULT_SHOW_SYM_KINDS,
): boolean => elements.some((elem) => show_kinds[elem.kind] ?? false)

const ELEM_TOL = 1e-6

const mat_round = (mat: Matrix3x3): Matrix3x3 =>
  mat.map((row) => row.map((val) => Math.round(val))) as Matrix3x3

const mat_scale = (mat: Matrix3x3, factor: number): Matrix3x3 =>
  mat.map((row) => row.map((val) => val * factor)) as Matrix3x3

export const is_identity = (mat: Matrix3x3): boolean =>
  mat.every((row, idx) => row.every((val, jdx) => val === (idx === jdx ? 1 : 0)))

const trace = (mat: Matrix3x3): number => mat[0][0] + mat[1][1] + mat[2][2]

// Projection onto the invariant (+1 eigenvalue) subspace P = (1/n) Σₖ Wᵏ, plus the
// matrix order n (crystallographic: 1, 2, 3, 4 or 6)
function invariant_projector(mat: Matrix3x3): { proj: Matrix3x3; order: number } {
  let sum = math.IDENTITY_3X3
  let power = mat
  for (let order = 1; order <= 6; order++) {
    if (is_identity(power)) return { proj: mat_scale(sum, 1 / order), order }
    sum = sum.map((row, idx) => math.add(row, power[idx])) as Matrix3x3
    power = mat_round(math.dot(power, mat))
  }
  throw new Error(`Matrix is not of finite crystallographic order`)
}

// Extract the (1D) invariant axis of a proper rotation as a reduced integer vector with
// canonical sign (first nonzero component positive). proj must have rank 1.
function axis_from_projector(proj: Matrix3x3, order: number): Vec3 | null {
  // n·P is an integer matrix whose nonzero columns all span the axis
  const int_proj = mat_round(mat_scale(proj, order))
  let best: Vec3 | null = null
  let best_norm = 0
  for (let col = 0; col < 3; col++) {
    const vec: Vec3 = [int_proj[0][col], int_proj[1][col], int_proj[2][col]]
    const norm = Math.abs(vec[0]) + Math.abs(vec[1]) + Math.abs(vec[2])
    if (norm > best_norm) {
      best = vec
      best_norm = norm
    }
  }
  if (!best) return null
  let axis = math.reduce_miller_indices(best)
  const first_nonzero = axis.find((val) => val !== 0) ?? 1
  // normalize -0 to 0 when flipping to canonical sign (first nonzero positive)
  if (first_nonzero < 0) axis = axis.map((val) => (val === 0 ? 0 : -val)) as Vec3
  return axis
}

// Fixed point of the affine map x ↦ W·x + w_loc as the orbit average of the origin.
// Exact whenever w_loc has no component in the invariant subspace (P·w_loc = 0).
function fixed_point(mat: Matrix3x3, w_loc: Vec3, order: number): Vec3 {
  let current: Vec3 = [0, 0, 0]
  const sum: Vec3 = [0, 0, 0]
  for (let iter = 0; iter < order; iter++) {
    if (iter > 0) current = math.add(math.mul_3x3_vec3(mat, current), w_loc)
    sum[0] += current[0]
    sum[1] += current[1]
    sum[2] += current[2]
  }
  return sum.map((val) => val / order) as Vec3
}

const is_integer = (val: number): boolean => Math.abs(val - Math.round(val)) < ELEM_TOL

// Components of (x, y, z) past ELEM_TOL
const n_nonzero = (x_val: number, y_val: number, z_val: number): number =>
  Number(Math.abs(x_val) > ELEM_TOL) +
  Number(Math.abs(y_val) > ELEM_TOL) +
  Number(Math.abs(z_val) > ELEM_TOL)

// Shortest representative of the glide class w_i + (Λ ∩ plane), exact even in sheared cells:
// Λ ∩ plane is the union of the centering cosets offset + ℤ-span(basis), and for a Gauss-reduced
// 2D basis every closest point to a target lies within ±1 of its rounded coordinates.
// Representatives are ordered so every operation of one geometric glide gets the same vector
// and letter: shorter, then sparser (R3c's c/2 beats the equally short (1/3,-1/3,1/6)), then
// lexicographically larger. Scalar arithmetic throughout: supercells bring one offset per
// in-plane lattice translation, and allocating per candidate was half of a 1000-site analysis.
function reduce_glide(
  w_intrinsic: Vec3,
  [first, second]: [Vec3, Vec3],
  offsets: readonly Vec3[],
): Vec3 {
  const [first_x, first_y, first_z] = first
  const [second_x, second_y, second_z] = second
  const g_11 = first_x * first_x + first_y * first_y + first_z * first_z
  const g_12 = first_x * second_x + first_y * second_y + first_z * second_z
  const g_22 = second_x * second_x + second_y * second_y + second_z * second_z
  const det = g_11 * g_22 - g_12 * g_12
  const [w_x, w_y, w_z] = w_intrinsic
  let [best_x, best_y, best_z] = w_intrinsic
  let best_sq = best_x * best_x + best_y * best_y + best_z * best_z
  let best_nonzero = n_nonzero(best_x, best_y, best_z)
  for (const [offset_x, offset_y, offset_z] of offsets) {
    const target_x = w_x - offset_x
    const target_y = w_y - offset_y
    const target_z = w_z - offset_z
    const proj_1 = target_x * first_x + target_y * first_y + target_z * first_z
    const proj_2 = target_x * second_x + target_y * second_y + target_z * second_z
    const coef_1 = Math.round((g_22 * proj_1 - g_12 * proj_2) / det)
    const coef_2 = Math.round((g_11 * proj_2 - g_12 * proj_1) / det)
    for (let mult_1 = coef_1 - 1; mult_1 <= coef_1 + 1; mult_1++) {
      for (let mult_2 = coef_2 - 1; mult_2 <= coef_2 + 1; mult_2++) {
        const cand_x = target_x - (mult_1 * first_x + mult_2 * second_x)
        const cand_y = target_y - (mult_1 * first_y + mult_2 * second_y)
        const cand_z = target_z - (mult_1 * first_z + mult_2 * second_z)
        const cand_sq = cand_x * cand_x + cand_y * cand_y + cand_z * cand_z
        const shorter = best_sq - cand_sq
        let wins: boolean
        if (Math.abs(shorter) > ELEM_TOL) wins = shorter > 0
        else {
          const sparser = best_nonzero - n_nonzero(cand_x, cand_y, cand_z)
          const diff_x = cand_x - best_x
          const diff_y = cand_y - best_y
          wins =
            sparser !== 0
              ? sparser > 0
              : Math.abs(diff_x) > ELEM_TOL
                ? diff_x > 0
                : Math.abs(diff_y) > ELEM_TOL
                  ? diff_y > 0
                  : cand_z - best_z > ELEM_TOL
        }
        if (!wins) continue
        best_x = cand_x
        best_y = cand_y
        best_z = cand_z
        best_sq = cand_sq
        best_nonzero = n_nonzero(cand_x, cand_y, cand_z)
      }
    }
  }
  return [best_x, best_y, best_z]
}

// ITA type of one glide vector t (fractional, standardized conventional frame) of a plane:
// a/b/c half a basis vector; n half a face diagonal of an axis-normal plane (one spanned by two
// basis vectors, i.e. a plane-equation covector with one nonzero entry) or half the body
// diagonal; d a quarter of those; `diag` half a face diagonal in a diagonal plane, e.g.
// (a+b)/2 normal to [1-10], which is g alone but pairs with c/2 into e (I-centred cells);
// g anything else. `m` for the null vector. Hexagonal frames name only c: their 3-folds map the
// diagonal vectors above onto unnamed ones, so a letter would differ between equivalent planes.
function glide_type(glide_vec: Vec3, axis_plane: boolean, hexagonal: boolean): string {
  const quarters = glide_vec.map((val) => val * 4)
  if (!quarters.every(is_integer)) return `g`
  const abs_quarters = quarters.map((val) => Math.abs(Math.round(val)))
  const n_half = abs_quarters.filter((val) => val === 2).length
  const n_quarter = abs_quarters.filter((val) => val === 1).length
  if (n_half + n_quarter === 0) return `m`
  if (hexagonal) return n_quarter === 0 && n_half === 1 && abs_quarters[2] === 2 ? `c` : `g`
  if (n_quarter === 0) {
    if (n_half === 1) return [`a`, `b`, `c`][abs_quarters.indexOf(2)]
    return n_half === 3 || axis_plane ? `n` : `diag`
  }
  return n_half === 0 && n_quarter === (axis_plane ? 2 : 3) ? `d` : `g`
}

// ITA letter of the mirror/glide (W, w) from its whole glide class w_i + (Λ ∩ plane), read in a
// standardized conventional frame (info built there): m if the class holds the null vector, e
// (double glide) if it holds two of a, b, c, n (or a diagonal (a±b)/2 next to c/2), else the
// single a/b/c/n, then d, else g. Classifying the whole class, not one reduced representative,
// makes the letter independent of the representative and the input cell.
function ita_glide_letter(
  { normal_eq, plane_basis, plane_offsets }: RotationInfo & { kind: `mirror` },
  w_intrinsic: Vec3,
  hexagonal: boolean,
): string {
  const axis_plane = normal_eq.filter((val) => val !== 0).length === 1
  const [first, second] = plane_basis
  const gram = [math.dot(first, first), math.dot(first, second), math.dot(second, second)]
  const det = gram[0] * gram[2] - gram[1] ** 2
  const types = new Set<string>()
  // Class members with every component in [-1/2, 1/2] (all named glide vectors are)
  for (const offset of plane_offsets) {
    const target = math.subtract(w_intrinsic, offset)
    const [proj_1, proj_2] = [math.dot(target, first), math.dot(target, second)]
    const coef_1 = Math.round((gram[2] * proj_1 - gram[1] * proj_2) / det)
    const coef_2 = Math.round((gram[0] * proj_2 - gram[1] * proj_1) / det)
    for (let mult_1 = coef_1 - 2; mult_1 <= coef_1 + 2; mult_1++) {
      for (let mult_2 = coef_2 - 2; mult_2 <= coef_2 + 2; mult_2++) {
        const cand = math.subtract(
          target,
          math.add(math.scale(first, mult_1), math.scale(second, mult_2)),
        )
        if (cand.every((val) => Math.abs(val) <= 0.5 + ELEM_TOL))
          types.add(glide_type(cand, axis_plane, hexagonal))
      }
    }
  }
  if (types.has(`m`)) return `m`
  const singles = [...types].filter((type) => type !== `d` && type !== `g`)
  if (singles.length > 1) return `e`
  if (singles.length === 1) return singles[0] === `diag` ? `g` : singles[0]
  return types.has(`d`) ? `d` : `g`
}

// All translation-independent data derived from a rotation matrix W (plus centerings), one
// shape per kind. Cached per distinct W in symmetry_elements_from_ops: supercell inputs can
// carry thousands of operations sharing at most 48 distinct rotation matrices, so re-deriving
// projectors/axes/periods per operation dominates runtime without this cache.
type RotationInfo = { mat: Matrix3x3; proj: Matrix3x3; mat_order: number; order: number } & (
  | { kind: `inversion` }
  | {
      kind: `proper`
      axis: Vec3
      // the rows [dual, ...covectors] of math.unimodular_completion(axis)
      covectors: [Vec3, Vec3]
      dual: Vec3
      // shortest lattice period along the axis in units of `axis` (1 for primitive lattices)
      period: number
      // W turns clockwise seen from the tip of +axis (see classify_with_rotation_info)
      negative_sense: boolean
    }
  | { kind: `rotoinversion`; axis: Vec3; covectors: [Vec3, Vec3] }
  | {
      kind: `mirror`
      axis: Vec3
      // Plane-equation covector, SymmetryElement.plane_normal: keying a plane offset off the
      // direction `axis` instead gets the wrong period in non-cubic metrics
      normal_eq: Vec3
      // the in-plane lattice Λ ∩ plane as plane_offsets + ℤ-span(plane_basis): plane_basis
      // spans ℤ³ ∩ plane and plane_offsets are the centerings lifted into the plane
      plane_basis: [Vec3, Vec3]
      plane_offsets: Vec3[]
    }
)

// Translation-independent analysis of a rotation matrix. Returns null for the identity
// (pure translations define no geometric element).
function build_rotation_info(
  rotation: readonly number[],
  centerings: readonly Vec3[],
): RotationInfo | null {
  const mat = mat_round(math.mat3x3_from_flat_col_major(rotation))
  const det = Math.round(math.det_3x3(mat))
  const mat_trace = Math.round(trace(mat))

  if (det === 1 && mat_trace === 3) return null // identity or pure translation

  const { proj, order: mat_order } = invariant_projector(mat)
  const base = { mat, proj, mat_order }

  if (det === -1 && mat_trace === -3) return { ...base, kind: `inversion`, order: 1 }

  if (det === 1) {
    // proper rotation (order from trace: −1→2, 0→3, 1→4, 2→6)
    const proper_order_by_trace: Record<number, number> = { [-1]: 2, 0: 3, 1: 4, 2: 6 }
    const order = proper_order_by_trace[mat_trace]
    if (!order) throw new Error(`Invalid proper rotation trace ${mat_trace}`)
    const axis = axis_from_projector(proj, mat_order)
    if (!axis) throw new Error(`Failed to extract rotation axis`)
    const [dual, ...covectors] = math.unimodular_completion(axis)
    // Shortest lattice period along the axis (1 for primitive lattices; 1/2 for (1/2,1/2,1/2)
    // along ⟨111⟩ in body-centered cells). A centering c lies on the axis line mod ℤ³ iff both
    // covectors map it to integers, and then sits at dual·c mod 1 along it.
    let period = 1
    for (const centering of centerings) {
      if (!covectors.every((covector) => is_integer(math.dot(covector, centering)))) continue
      const raw = math.dot(dual, centering)
      const lambda = raw - Math.floor(raw + ELEM_TOL)
      if (lambda > ELEM_TOL && lambda < period) period = lambda
    }
    // Sense of rotation from det[axis, x, W·x] for any x off the axis (0 for 2-folds)
    const probe: Vec3 = axis[1] === 0 && axis[2] === 0 ? [0, 1, 0] : [1, 0, 0]
    const negative_sense = math.det_3x3([axis, probe, math.mul_3x3_vec3(mat, probe)]) < 0
    return { ...base, kind: `proper`, order, axis, covectors, dual, period, negative_sense }
  }

  // Improper: mirror/glide (trace 1) or rotoinversion −3/−4/−6. The proper part −W is a
  // rotation about the same axis (the plane normal for mirrors).
  const proper_part = mat_scale(mat, -1)
  const { proj: proper_proj, order: proper_order } = invariant_projector(proper_part)
  const axis = axis_from_projector(proper_proj, proper_order)
  if (!axis) throw new Error(`Failed to extract improper-operation axis`)

  if (mat_trace === 1) {
    // Plane-equation normal: the −1 eigenvector of Wᵀ, obtained as the +1 eigenvector of
    // −Wᵀ exactly the way `axis` above is the +1 eigenvector of −W. Integer and primitive
    // like `axis`, but a covector — see SymmetryElement.plane_normal for why they differ.
    const transposed = math.transpose_3x3(proper_part)
    const { proj: t_proj, order: t_order } = invariant_projector(transposed)
    const normal_eq = axis_from_projector(t_proj, t_order)
    if (!normal_eq) throw new Error(`Failed to extract mirror plane-equation normal`)
    // A centering with integer height normal_eq·c has a translate in the plane: c − height·lift
    const [lift, ...plane_basis] = math.unimodular_completion(normal_eq)
    const plane_offsets: Vec3[] = [[0, 0, 0]]
    for (const centering of centerings) {
      const height = math.dot(normal_eq, centering)
      if (!is_integer(height)) continue
      const in_plane = math.subtract(centering, math.scale(lift, Math.round(height)))
      plane_offsets.push(in_plane)
    }
    return { ...base, kind: `mirror`, order: 2, axis, normal_eq, plane_basis, plane_offsets }
  }

  const rotoinv_order_by_trace: Record<number, number> = { 0: 3, [-1]: 4, [-2]: 6 }
  const order = rotoinv_order_by_trace[mat_trace]
  if (!order) throw new Error(`Invalid improper rotation trace ${mat_trace}`)
  const [, ...covectors] = math.unimodular_completion(axis)
  return { ...base, kind: `rotoinversion`, order, axis, covectors }
}

// Snap both ends of [0, 1): 1 - 1e-9 and 0 identify the same in-cell locus.
const locus_coord = (val: number) =>
  (Math.abs(val) < 1e-4 || Math.abs(val - 1) < 1e-4 ? 0 : val).toFixed(4)

// Canonical key for the geometric locus of an element at `point` with rotation data `info`.
// Elements are identified modulo lattice translations:
// - inversion centers: the wrapped center
// - planes: (normal, offset s = x₀·normal_eq mod 1) — lattice translations change s by an
//   integer since normal_eq is an integer covector
// - axis lines: (direction, n·x₀ mod 1 for the covector basis n₁, n₂ annihilating the axis,
//   constant along the line) — a wrapped perpendicular foot would split equivalent lines
function element_locus_key(point: Vec3, info: RotationInfo): string {
  // Fractional coordinate of an integer covector against the element point, mod 1. Both
  // operands are lattice quantities, so a lattice translation shifts this by an integer
  // and the wrapped value is invariant — which is what "modulo lattice translations" needs.
  const covector_coord = (covector: Vec3) => {
    const raw = math.dot(point, covector)
    return locus_coord(raw - Math.floor(raw + 1e-6))
  }
  if (info.kind === `inversion`) return `center|${point.map(locus_coord).join(`,`)}`
  const axis_key = info.axis.join(`,`)
  if (info.kind === `mirror`) return `plane|${axis_key}|${covector_coord(info.normal_eq)}`
  const [first, second] = info.covectors
  return `line|${axis_key}|${covector_coord(first)},${covector_coord(second)}`
}

// Screw part λ of a proper operation, w_i = λ·axis, reduced modulo the lattice period along
// the axis (0 for plain rotations)
function screw_lambda(info: RotationInfo & { kind: `proper` }, w_intrinsic: Vec3): number {
  const { dual, period } = info
  const lambda_raw = math.dot(dual, w_intrinsic)
  const lambda = lambda_raw - period * Math.floor(lambda_raw / period + ELEM_TOL)
  return lambda > ELEM_TOL ? lambda : 0
}

// ITA symbol of the operation (info.mat, w), read in the frame info was built in: "2", "4_2",
// "-4", "-1", or a plane letter (see ita_glide_letter; `hexagonal` describes that frame)
function element_label(info: RotationInfo, width_value: Vec3, hexagonal: boolean): string {
  const { kind, order } = info
  if (kind === `inversion`) return `-1`
  if (kind === `rotoinversion`) return `-${order}`
  const w_intrinsic = math.mul_3x3_vec3(info.proj, width_value)
  if (kind === `mirror`) return ita_glide_letter(info, w_intrinsic, hexagonal)
  const lambda = screw_lambda(info, w_intrinsic)
  if (lambda === 0) return `${order}`
  // ITA's N_p advances p/N of the period per +2π/N turn about +axis (3⁻ with 2/3 c is 3_1). In a
  // left-handed cell the labels mirror, like moyo's space-group number (P3_1 reads P3_2).
  const turn_part = Math.round((order * lambda) / info.period) % order
  return `${order}_${info.negative_sense ? (order - turn_part) % order : turn_part}`
}

// Geometry of the operation (info.mat, w) given precomputed rotation-dependent data, under the
// ITA `label` (from element_label, possibly evaluated in another frame of the same group)
function classify_with_rotation_info(
  info: RotationInfo,
  width_value: Vec3,
  label: string,
): SymmetryElement {
  const { mat, proj, mat_order, order } = info
  const w_intrinsic = math.mul_3x3_vec3(proj, width_value)
  const w_loc = math.subtract(width_value, w_intrinsic)
  const point = wrap_to_unit_cell(fixed_point(mat, w_loc, mat_order))
  const locus = element_locus_key(point, info)
  const base = { order, point, locus, label, plane_normal: null, translation: null }

  if (info.kind === `inversion`) return { ...base, kind: `inversion`, axis: null }
  const { kind, axis } = info

  if (kind === `proper`) {
    const is_screw = label.includes(`_`)
    return {
      ...base,
      kind: is_screw ? `screw` : `rotation`,
      axis,
      translation: is_screw ? math.scale(axis, screw_lambda(info, w_intrinsic)) : null,
    }
  }

  if (kind === `mirror`) {
    const is_glide = label !== `m`
    return {
      ...base,
      kind: is_glide ? `glide` : `mirror`,
      axis,
      plane_normal: info.normal_eq,
      translation: is_glide
        ? reduce_glide(w_intrinsic, info.plane_basis, info.plane_offsets)
        : null,
    }
  }

  // Rotoinversion −3/−4/−6 (no intrinsic translation: P = 0, so w_i = 0)
  return { ...base, kind, axis }
}

// Classify a single operation (rotation as flat column-major 9-array, translation
// vector, both fractional) in a standardized (ITA conventional) frame. Returns null for the
// identity and pure (centering) translations, which define no geometric element. For centered
// cells, pass the centering vectors so intrinsic screw/glide translations are reduced modulo
// the TRUE lattice — e.g. along a ⟨111⟩ axis of a body-centered cell the lattice period
// is (1/2)(1,1,1), and a C-centering-composed mirror is still a mirror, not an n-glide.
// `hexagonal`: hexagonal axes (trigonal and hexagonal groups), see glide_type.
export function classify_symmetry_op(
  rotation: readonly number[],
  translation: readonly number[],
  centerings: readonly Vec3[] = [],
  hexagonal = false,
): SymmetryElement | null {
  const info = build_rotation_info(rotation, centerings)
  if (!info) return null
  const width_value = translation as Vec3
  return classify_with_rotation_info(
    info,
    width_value,
    element_label(info, width_value, hexagonal),
  )
}

// Add vec mod ℤ³ to a set of distinct nonzero translations, keyed snapped to 1e-6 so
// 1 - 1e-9 and 0 coincide
const add_translation = (group: Map<string, Vec3>, vec: Vec3): void => {
  const wrapped = wrap_to_unit_cell(vec)
  const key = wrapped.map((val) => Math.round(val * 1e6) % 1_000_000).join(`,`)
  if (key !== `0,0,0` && !group.has(key)) group.set(key, wrapped)
}

// Whether `score` is lexicographically larger than `other` beyond 1e-6
const lex_greater = (score: number[], other: number[]): boolean => {
  const idx = score.findIndex((val, jdx) => Math.abs(val - other[jdx]) > 1e-6)
  return idx !== -1 && score[idx] > other[idx]
}

// The operations (input frame) and moyo's standardized conventional cell relative to the input
export type SymmetryFrameData = Pick<
  MoyoDataset,
  `operations` | `std_linear` | `std_origin_shift` | `std_rotation_matrix`
> & { std_cell: Pick<MoyoCell, `lattice`> }

// The frame labels are read in, x_std = std_from_input·x + std_origin: moyo's standardized frame
// (std_from_input = std_linear⁻¹, std_origin = −std_from_input·std_origin_shift) moved by the
// group operation (M, m), x' = M·x_std + m, that puts a, b, c closest to Cartesian x, y, z
// (lexicographically largest unit basis vectors). Every (M, m) maps the operations onto
// themselves, so each choice is a standard setting, but moyo picks one by the input cell: for a
// cubic crystal it may make the input's c its a, relabelling a/b/c glides. The Cartesian rule
// gives the conventional cell, primitive cell and permuted axes of one crystal the same labels.
function label_frame({
  operations,
  std_linear,
  std_origin_shift,
  std_cell,
  std_rotation_matrix,
}: SymmetryFrameData): { std_from_input: Matrix3x3; std_origin: Vec3 } {
  const input_from_std = math.mat3x3_from_flat_col_major(std_linear)
  const std_from_input = math.inverse_3x3(input_from_std)
  const std_origin = math.scale(
    math.mul_3x3_vec3(std_from_input, [...std_origin_shift] as Vec3),
    -1,
  )
  // Cartesian rows of the standardized basis in the input's orientation: moyo's refined cell
  // rotated back
  const std_basis = math.dot(
    math.mat3x3_from_flat_row_major([...std_cell.lattice.basis]),
    math.mat3x3_from_flat_col_major(std_rotation_matrix),
  )
  const unit_rows = (mat: Matrix3x3) =>
    math
      .dot(math.transpose_3x3(math.inverse_3x3(mat)), std_basis)
      .flatMap((row) => math.scale(row, 1 / Math.hypot(...row)))
  // the identity (moyo's own frame) is a group element even when not listed
  let best = {
    score: unit_rows(math.IDENTITY_3X3),
    mat: math.IDENTITY_3X3,
    shift: [0, 0, 0] as Vec3,
  }
  const visited = new Set<string>()
  for (const { rotation, translation } of operations) {
    const rot_key = rotation.join(`,`)
    if (visited.has(rot_key)) continue
    visited.add(rot_key)
    const input_mat = math.mat3x3_from_flat_col_major(rotation)
    const mat = mat_round(math.dot(math.dot(std_from_input, input_mat), input_from_std))
    if (Math.round(math.det_3x3(mat)) !== 1) continue // keep the handedness (screw senses)
    const score = unit_rows(mat)
    if (!lex_greater(score, best.score)) continue
    // m = w_std of the operation: std_from_input·w + (I − M)·std_origin
    const shift = math.add(
      math.mul_3x3_vec3(std_from_input, translation),
      math.subtract(std_origin, math.mul_3x3_vec3(mat, std_origin)),
    )
    best = { score, mat, shift }
  }
  return {
    std_from_input: math.dot(best.mat, std_from_input),
    std_origin: math.add(math.mul_3x3_vec3(best.mat, std_origin), best.shift),
  }
}

// Distinct symmetry elements (modulo lattice translations) of space-group operations. Each
// operation is classified, then re-anchored with lattice offsets t ∈ ℤ³ to enumerate the
// in-cell instances of its family (e.g. P-1's 8 inversion centers at half-lattice points).
// Elements sharing a locus but not a symbol (a 2-fold inside a 4-fold) stay separate entries.
// Geometry is computed in the operations' (input) frame; labels in the standardized
// conventional frame where the ITA letters are defined (see label_frame), so a primitive,
// conventional or axis-permuted input of one crystal labels alike.
export function symmetry_elements_from_ops(sym_data: SymmetryFrameData): SymmetryElement[] {
  const { operations } = sym_data
  // Centering vectors are the pure-translation operations (identity rotation, w ∉ ℤ³).
  // They define the true lattice for screw/glide reduction in centered cells.
  // Deduplicated since supercell inputs repeat sublattice translations.
  const centering_group = new Map<string, Vec3>()
  for (const { rotation, translation } of operations)
    if (is_identity(mat_round(math.mat3x3_from_flat_col_major(rotation))))
      add_translation(centering_group, translation)
  const centerings = [...centering_group.values()]

  // The standardized frame's centerings: the input lattice (basis vectors and centerings) seen
  // from the conventional cell mod ℤ³, closed under addition (a primitive input's basis vectors
  // generate the F centering)
  const { std_from_input, std_origin } = label_frame(sym_data)
  const input_from_std = math.inverse_3x3(std_from_input)
  const basis_images = math.transpose_3x3(std_from_input) // rows = std_from_input·eⱼ
  const std_group = new Map<string, Vec3>()
  const add_std = (vec: Vec3) => add_translation(std_group, vec)
  for (const image of basis_images) add_std(image)
  for (const centering of centerings) add_std(math.mul_3x3_vec3(std_from_input, centering))
  // Map iteration visits entries added during the loop, so this reaches the closure
  for (const vec of std_group.values())
    for (const image of basis_images) add_std(math.add(vec, image))
  const std_centerings = [...std_group.values()]

  // Rotation-dependent analysis in both frames per distinct rotation (null: identity), with
  // W_std = Q·W·Q⁻¹ for Q = std_from_input (supercell inputs repeat at most 48 distinct W
  // across thousands of ops)
  type RotationData = { info: RotationInfo; std_info: RotationInfo; std_offset: Vec3 }
  const info_cache = new Map<string, RotationData | null>()
  const std_mats: Matrix3x3[] = []
  for (const { rotation } of operations) {
    const rot_key = rotation.join(`,`)
    if (info_cache.has(rot_key)) continue
    const mat = math.mat3x3_from_flat_col_major(rotation)
    const raw_std_mat = math.dot(math.dot(std_from_input, mat), input_from_std)
    if (!raw_std_mat.flat().every(is_integer)) {
      throw new Error(
        `Rotation ${rot_key} is not integral in the standardized frame (std_linear ${sym_data.std_linear.join(`,`)})`,
      )
    }
    const std_mat = mat_round(raw_std_mat)
    std_mats.push(std_mat)
    const info = build_rotation_info(rotation, centerings)
    const std_info = build_rotation_info(math.transpose_3x3(std_mat).flat(), std_centerings)
    // w_std = Q·w + (I − W_std)·q for x_std = Q·x + q
    const std_offset = math.subtract(std_origin, math.mul_3x3_vec3(std_mat, std_origin))
    info_cache.set(rot_key, info && std_info && { info, std_info, std_offset })
  }
  // Hexagonal axes: a proper 3- or 6-fold (trace 0 or 2) fixing c
  const hexagonal = std_mats.some(
    (mat) =>
      Math.round(math.det_3x3(mat)) === 1 &&
      [0, 2].includes(trace(mat)) &&
      mat[0][2] === 0 &&
      mat[1][2] === 0 &&
      mat[2][2] === 1,
  )
  const label_cache = new Map<string, string>()
  const seen = new Map<string, SymmetryElement>()
  for (const { rotation, translation } of operations) {
    const rot_key = rotation.join(`,`)
    const data = info_cache.get(rot_key)
    if (!data) continue // identity / pure translation
    const { info, std_info, std_offset } = data
    // Family members are the offsets modulo (I − W)ℤ³ and lattice vectors along the element, a
    // finite group: closing under +eⱼ visits each, where a fixed t ∈ {0,1}³ misses sheared ones
    const [w_x, w_y, w_z] = translation
    const shifts: Vec3[] = [[0, 0, 0]]
    for (const [s_x, s_y, s_z] of shifts) {
      const width_value: Vec3 = [w_x + s_x, w_y + s_y, w_z + s_z]
      const std_width = math.add(math.mul_3x3_vec3(std_from_input, width_value), std_offset)
      // Not mod ℤ³: a lattice translation moves the element, and a moved plane can change letter
      const label_key = `${rot_key}|${std_width.map((val) => Math.round(val * 1e6)).join(`,`)}`
      let label = label_cache.get(label_key)
      if (label === undefined) {
        label = element_label(std_info, std_width, hexagonal)
        label_cache.set(label_key, label)
      }
      const elem = classify_with_rotation_info(info, width_value, label)
      // A rotoinversion fixes a center, not every point along its axis line.
      const center = elem.kind === `rotoinversion` ? elem.point.map(locus_coord).join(`,`) : ``
      const key = `${elem.kind}|${elem.label}|${elem.locus}|${center}`
      if (seen.has(key)) continue
      seen.set(key, elem)
      shifts.push([s_x + 1, s_y, s_z], [s_x, s_y + 1, s_z], [s_x, s_y, s_z + 1])
    }
  }
  // Stable order: by kind (SYM_ELEM_KINDS sequence), then descending order, label, point.
  // Sort keys are built once per element, not twice per comparison (30k elements of a
  // 1000-site supercell); the collator is what localeCompare uses, without its per-call setup.
  const collator = new Intl.Collator()
  return [...seen.values()]
    .map((elem) => ({
      elem,
      kind_idx: SYM_ELEM_KINDS.indexOf(elem.kind),
      point_key: elem.point.join(`,`),
    }))
    .toSorted(
      (key_1, key_2) =>
        key_1.kind_idx - key_2.kind_idx ||
        key_2.elem.order - key_1.elem.order ||
        collator.compare(key_1.elem.label, key_2.elem.label) ||
        collator.compare(key_1.point_key, key_2.point_key),
    )
    .map(({ elem }) => elem)
}

// Evenly spaced dashes (centers from the segment start, lengths) along a segment (Å) that
// touch both ends, stretching the gap, so dashed (translation-carrying, as in ITA) screw axes
// still span the full cell.
export function dash_segments(
  length: number,
  dash: number,
  gap: number,
): { center: number; length: number }[] {
  if (!(length > 0) || !(dash > 0) || gap < 0) return []
  if (length <= dash) return [{ center: length / 2, length }]
  const count = Math.floor((length + gap) / (dash + gap))
  if (count <= 1) return [{ center: length / 2, length: dash }]
  // count·dash + (count−1)·gap_actual = length, with gap_actual ≥ gap by construction
  const gap_actual = (length - count * dash) / (count - 1)
  return Array.from({ length: count }, (_, idx) => ({
    center: idx * (dash + gap_actual) + dash / 2,
    length: dash,
  }))
}

// Fractional direction or point to Cartesian (lattice rows are basis vectors). Valid for plane
// normals too: fractional eigenvectors map to eigenvectors of the Cartesian operator.
export const frac_to_cart_direction = (frac: Vec3, lattice: Matrix3x3): Vec3 =>
  math.create_frac_to_cart(lattice)(frac)

// Cartesian endpoints of the fractional line point + t·direction clipped to [0,1]³ (slab
// method), or null if it misses the cell.
export function clip_line_to_cell(
  point: Vec3,
  direction: Vec3,
  lattice: Matrix3x3,
): [Vec3, Vec3] | null {
  const eps = 1e-9
  let t_min = -Infinity
  let t_max = Infinity
  for (let dim = 0; dim < 3; dim++) {
    if (Math.abs(direction[dim]) < eps) {
      if (point[dim] < -eps || point[dim] > 1 + eps) return null // parallel, outside slab
      continue
    }
    const t_0 = (0 - point[dim]) / direction[dim]
    const t_1 = (1 - point[dim]) / direction[dim]
    t_min = Math.max(t_min, Math.min(t_0, t_1))
    t_max = Math.min(t_max, Math.max(t_0, t_1))
  }
  if (t_min >= t_max - eps || !Number.isFinite(t_min) || !Number.isFinite(t_max)) return null
  const to_cart = math.create_frac_to_cart(lattice)
  const endpoint = (t_param: number): Vec3 =>
    to_cart(point.map((coord, idx) => coord + t_param * direction[idx]) as Vec3)
  return [endpoint(t_min), endpoint(t_max)]
}

// Order-independent key of a segment or polygon (Cartesian vertices rounded to 1e-6 Å), so
// pieces clipped from different points on the same line or plane compare equal
export const piece_key = (piece: readonly Vec3[]): string =>
  piece
    .map((vert) => vert.map((coord) => Math.round(coord * 1e6)).join(`,`))
    .toSorted()
    .join(`|`)

// Integer k with value + k in the range of the integer covector over the unit cell (its summed
// negative and positive components). Face or edge touches are left for the clipper to drop.
function shifts_into_cell(value: number, covector: Vec3): number[] {
  const lower = covector.reduce((sum, val) => sum + Math.min(val, 0), 0)
  const upper = covector.reduce((sum, val) => sum + Math.max(val, 0), 0)
  const first = Math.ceil(lower - value - ELEM_TOL)
  return Array.from(
    { length: Math.floor(upper - value + ELEM_TOL) - first + 1 },
    (_, idx) => first + idx,
  )
}

// Every in-cell Cartesian segment of the lattice translates of the axis line through `point`
// along the primitive integer `axis`. A translate is fixed by its coordinates (n₁·x, n₂·x) for
// the covectors annihilating the axis, which lattice translations step through all of ℤ², so
// exactly the integer steps into each coordinate's cell range can cross the cell.
export function clip_axis_family(point: Vec3, axis: Vec3, lattice: Matrix3x3): [Vec3, Vec3][] {
  const [dual, first, second] = math.unimodular_completion(axis)
  // Lattice steps moving (n₁·x, n₂·x) by (1, 0) and (0, 1): columns of [n₁; n₂; d]⁻¹ (det ±1)
  const sign = math.det_3x3([first, second, dual])
  const [step_1, step_2] = [math.cross_3d(second, dual), math.cross_3d(dual, first)]
  const segments: [Vec3, Vec3][] = []
  for (const shift_1 of shifts_into_cell(math.dot(first, point), first)) {
    for (const shift_2 of shifts_into_cell(math.dot(second, point), second)) {
      const translate = point.map(
        (coord, idx) => coord + sign * (shift_1 * step_1[idx] + shift_2 * step_2[idx]),
      ) as Vec3
      const segment = clip_line_to_cell(translate, axis, lattice)
      if (segment) segments.push(segment)
    }
  }
  return segments
}

// Every in-cell Cartesian polygon of the lattice translates n·x = n·point + k (k ∈ ℤ) of the
// plane through `point` with primitive integer covector n = `plane_normal`
export function clip_plane_family(
  point: Vec3,
  plane_normal: Vec3,
  lattice: Matrix3x3,
): Vec3[][] {
  const level = math.dot(plane_normal, point)
  return shifts_into_cell(level, plane_normal)
    .map((shift) => clip_frac_plane_to_cell(plane_normal, level + shift, lattice))
    .filter((polygon) => polygon.length > 0)
}

// Bound merged geometry allocation after removing redundant copies.
export const MAX_TILED_SYM_ELEMENTS = 4000
const MAX_TILING_VISITS = 1_000_000
const MAX_CLIP_ATTEMPTS = 1_000_000

// Deduplicate translations along planes/axes, but retain every translated center marker.
// A plane moves by the integer plane_normal · offset and a line by the offset modulo its axis
// (parallelism is affine), each modulo the supercell lattice, so both keys are exact and
// independent of the metric. Identity keeps different operations sharing a locus distinct.
const tiled_element_key = (element: SymmetryElement, supercell: Matrix3x3) => {
  const identity = `${element.kind}|${element.label}|${element.order}|${element.locus}`
  const { axis, kind, plane_normal } = element
  let key = (offset: Vec3): string =>
    (kind === `rotoinversion` ? math.add(element.point, offset) : offset).join(`,`)
  let changes = [true, true, true]
  if (plane_normal) {
    // levels n·offset that differ by a multiple of gcd(M·n) are one family in the supercell
    const period = math.gcd_all(math.mul_3x3_vec3(supercell, plane_normal))
    key = (offset) => String(((math.dot(plane_normal, offset) % period) + period) % period)
    changes = plane_normal.map((component) => component !== 0)
  } else if (axis && (kind === `rotation` || kind === `screw`)) {
    // a line moves by its offset's coordinates (n₁·o, n₂·o) for covectors annihilating the
    // axis, taken modulo the supercell rows' coordinates (a triangular 2D basis), so lines one
    // supercell translation apart are one family, as for planes
    const [, first, second] = math.unimodular_completion(axis)
    const coords = (vec: Vec3): Vec3 => [math.dot(first, vec), math.dot(second, vec), 0]
    const [[h11, h12], [, h22]] = triangular_basis(supercell.map(coords) as Matrix3x3)
    key = (offset) => {
      const [x_coord, y_coord] = coords(offset)
      const wraps = Math.floor(x_coord / h11)
      const y_wrapped = y_coord - wraps * h12
      return `${x_coord - wraps * h11},${((y_wrapped % h22) + h22) % h22}`
    }
    changes = axis.map((_, idx) =>
      axis.some((component, other) => other !== idx && component !== 0),
    )
  }
  return { identity, key, changes }
}

// Integer rows reduced (by Euclid row operations) to an upper-triangular basis of the same
// lattice: the box ∏[0, |H_ii|) of integer vectors is then one set of coset representatives
// of ℤ³ modulo the lattice, i.e. the cells a supercell M (any integer matrix) holds
const triangular_basis = (matrix: Matrix3x3): number[][] => {
  const rows = matrix.map((row) => [...row])
  for (let col = 0; col < 3; col++) {
    for (let row = col + 1; row < 3; row++) {
      while (rows[row][col] !== 0) {
        const quotient = Math.trunc(rows[col][col] / rows[row][col])
        rows[col] = rows[col].map((val, idx) => val - quotient * rows[row][idx])
        ;[rows[col], rows[row]] = [rows[row], rows[col]]
      }
    }
  }
  return rows
}

// Translate elements through the supercell M's cells, then map coordinates/directions by M⁻¹
// into the supercell basis (centers wrapped into it; lines and planes are drawn as families
// of supercell translates anyway). Deduplicate after each axis to avoid walking every tile.
// Refusal returns a visible reason, never a partial overlay or a render-time exception.
function symmetry_tiling(
  elements: SymmetryElement[],
  supercell: Matrix3x3,
  collect_elements: boolean,
): { elements: SymmetryElement[]; unavailable_reason: string | null } {
  const counts = whole_tile_counts(
    triangular_basis(supercell).map((row, idx) => Math.abs(row[idx])) as Vec3,
  )
  const n_tiles = counts[0] * counts[1] * counts[2]
  const unavailable = (reason: string) => ({
    elements: [],
    unavailable_reason: `Symmetry overlay for tiling ${counts.join(`x`)} ${reason}. Reduce the supercell or hide element kinds.`,
  })
  const too_many = `exceeds ${MAX_TILED_SYM_ELEMENTS} unique elements`
  const too_costly = `exceeds the axis and plane clipping work limit`
  if (!counts.every(Number.isFinite)) return unavailable(`needs finite repeat counts`)
  if (!elements.length) return { elements, unavailable_reason: null }
  // x · M⁻¹ as integer numerators (det · M⁻ᵀ = cof(M)) over det. Cofactors and det (row 0's
  // expansion) are exact in BigInt, where Number products of large entries round past 2^53;
  // entries round to integers (fractional repeat counts are whole tiles)
  const big_dot = (big_row: bigint[], vec: number[]): bigint =>
    big_row.reduce((sum, val, col) => sum + val * BigInt(Math.round(vec[col])), 0n)
  const others = (idx: number) => [0, 1, 2].filter((other) => other !== idx)
  const big_cofactors = [0, 1, 2].map((row) => {
    const [m0, m1] = others(row).map((idx) =>
      supercell[idx].map((val) => BigInt(Math.round(val))),
    )
    return [0, 1, 2].map((col) => {
      const [c0, c1] = others(col)
      const minor = m0[c0] * m1[c1] - m0[c1] * m1[c0]
      return (row + col) % 2 ? -minor : minor
    })
  })
  const det = Number(big_dot(big_cofactors[0], supercell[0]))
  const numerators = big_cofactors.map((row) => row.map(Number)) as Matrix3x3
  const shrink = (vec: Vec3): Vec3 =>
    math.mul_3x3_vec3(numerators, vec).map((val) => val / det) as Vec3
  const supercell_t = math.transpose_3x3(supercell)
  // an offset is reduced by the whole supercells it spans, so the supercell holds every
  // image of a center inside the input cell (others stay outside)
  const supercell_point = (point: Vec3, offset: Vec3): Vec3 => {
    const whole_cells = math.mul_3x3_vec3(supercell_t, shrink(offset).map(Math.floor) as Vec3)
    const center = shrink(math.add(point, math.subtract(offset, whole_cells)))
    // input-cell points wrap into the supercell; explicit outside-cell points stay as given
    if (!point.every((val) => val >= 0 && val < 1)) return center
    return center.map((val) => val - Math.floor(val)) as Vec3
  }
  // Directions stay primitive integer vectors in the block basis, as the family clippers need:
  // axis · M⁻¹ = cof(M)·axis / det: its direction sign(det)·cof(M)·axis reduced exactly in
  // BigInt (huge diagonal supercells pass 2^53; a float ratio search merged near-parallel axes)
  const big_gcd = (val_a: bigint, val_b: bigint): bigint =>
    val_b === 0n ? (val_a < 0n ? -val_a : val_a) : big_gcd(val_b, val_a % val_b)
  const block_axis = (axis: Vec3): Vec3 => {
    const dir = big_cofactors.map((row) => big_dot(row, axis) * BigInt(Math.sign(det)))
    const divisor = dir.reduce(big_gcd, 0n) || 1n
    return dir.map((val) => Number(val / divisor)) as Vec3
  }
  const block_normal = (normal: Vec3): Vec3 =>
    math.reduce_miller_indices(math.mul_3x3_vec3(supercell, normal))
  // Axes and planes are drawn by clipping every family translate that can cross the cell
  // (clip_axis_family, clip_plane_family: L1 norm + 1 shifts per covector), bounded here
  // where the block-basis directions are known
  const shift_count = (covector: Vec3) =>
    covector.reduce((sum, val) => sum + Math.abs(val), 0) + 1
  const clip_attempts = ({ axis, plane_normal }: SymmetryElement): number => {
    if (plane_normal) return shift_count(block_normal(plane_normal))
    if (!axis) return 0
    const [, first, second] = math.unimodular_completion(block_axis(axis))
    return shift_count(first) * shift_count(second)
  }
  const attempts = elements.map(clip_attempts)
  const total_attempts = attempts.reduce((sum, val) => sum + val, 0)
  // an already-sheared input cell can hand over costly families even without a supercell
  if (is_identity(supercell) && elements.length <= MAX_TILED_SYM_ELEMENTS)
    return total_attempts <= MAX_CLIP_ATTEMPTS
      ? { elements, unavailable_reason: null }
      : unavailable(too_costly)
  // Below these upper bounds, none of the element, traversal or clipping caps can be hit.
  if (
    !collect_elements &&
    elements.length * n_tiles <= MAX_TILED_SYM_ELEMENTS &&
    total_attempts * n_tiles <= MAX_CLIP_ATTEMPTS
  )
    return { elements: [], unavailable_reason: null }
  const tiled: SymmetryElement[] = []
  const seen = new Set<string>()
  let visits = 0
  let clip_work = 0
  for (const [element_idx, element] of elements.entries()) {
    const { identity, key, changes } = tiled_element_key(element, supercell)
    let offsets: Vec3[] = [[0, 0, 0]]
    // Exact keys only gain distinct values as axes are added, so the cap holds after each axis
    for (const axis of [2, 1, 0].filter((dim) => counts[dim] > 1 && changes[dim])) {
      const unique = new Map<string, Vec3>()
      for (const offset of offsets) {
        for (let step = 0; step < counts[axis]; step++) {
          if (++visits > MAX_TILING_VISITS) return unavailable(`exceeds the tiling work limit`)
          const shifted: Vec3 = [...offset]
          shifted[axis] = step
          const locus = key(shifted)
          if (!unique.has(locus)) unique.set(locus, shifted)
          if (unique.size > MAX_TILED_SYM_ELEMENTS) return unavailable(too_many)
        }
      }
      offsets = [...unique.values()]
    }
    for (const offset of offsets) {
      const locus = `${identity}|${key(offset)}`
      if (seen.has(locus)) continue
      if (seen.size >= MAX_TILED_SYM_ELEMENTS) return unavailable(too_many)
      seen.add(locus)
      if ((clip_work += attempts[element_idx]) > MAX_CLIP_ATTEMPTS)
        return unavailable(too_costly)
      if (collect_elements)
        tiled.push({
          ...element,
          point: supercell_point(element.point, offset),
          axis: element.axis && block_axis(element.axis),
          plane_normal: element.plane_normal && block_normal(element.plane_normal),
          translation: element.translation && shrink(element.translation),
        })
    }
  }
  return { elements: tiled, unavailable_reason: null }
}

// The controls can preflight candidates without allocating block-frame element copies.
export const symmetry_tiling_reason = (
  elements: SymmetryElement[],
  supercell: Matrix3x3,
): string | null => symmetry_tiling(elements, supercell, false).unavailable_reason

export const tile_symmetry_elements = (
  elements: SymmetryElement[],
  supercell: Matrix3x3,
): { elements: SymmetryElement[]; unavailable_reason: string | null } =>
  symmetry_tiling(elements, supercell, true)
