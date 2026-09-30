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
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { clip_frac_plane_to_cell } from '$lib/structure/lattice-planes'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import type { MoyoDataset } from '@spglib/moyo-wasm'

// All element kinds in display order (axes first, then planes, then point elements).
// Single source of truth for ordering — both the controls legend and the element list
// returned by symmetry_elements_from_ops follow this sequence.
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
  // ITA-style symbol: "2", "2_1", "3_2", "m", "a"/"b"/"c"/"n"/"d"/"g" (glides), "-1", "-4"
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

// Default overlay visibility: a SINGLE kind (proper rotation axes). High-symmetry
// structures easily have 100+ distinct elements which, drawn all at once, bury the
// structure entirely. Users opt into additional kinds individually via
// SymmetryElementControls (or the show_kinds prop).
export const DEFAULT_SHOW_SYM_KINDS: ShowSymmetryKinds = { rotation: true }

// moyo's operations live in the input-cell frame, so the viewer blanks the overlay while a
// conventional/primitive cell is rendered. Shown by SymmetryElementControls and toasted by
// the structure viewer when the cell is switched with the overlay on.
export const SYM_ELEMENTS_INPUT_FRAME_NOTE = `Symmetry elements are drawn only in the original (input) cell`

// Default render colors of SymmetryElements.svelte, the single source for the legend swatches
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
// SymmetryElements.svelte renders by default
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

// Whether the overlay would actually draw something: at least one PRESENT element whose
// kind is ENABLED in show_kinds. Used to gate declutter so callers don't hide polyhedra /
// shrink atoms when the enabled kinds match no present element (e.g. the rotation-only
// default on an inversion-only P-1 cell).
export const has_visible_symmetry_overlay = (
  elements: readonly SymmetryElement[],
  show_kinds: ShowSymmetryKinds = DEFAULT_SHOW_SYM_KINDS,
): boolean => elements.some((elem) => show_kinds[elem.kind] ?? false)

const ELEM_TOL = 1e-6

// moyo-wasm serializes nalgebra matrices as flat 9-arrays in COLUMN-major order
export const mat3_from_flat_col_major = (flat: readonly number[]): Matrix3x3 => [
  [flat[0], flat[3], flat[6]],
  [flat[1], flat[4], flat[7]],
  [flat[2], flat[5], flat[8]],
]

const mat_round = (mat: Matrix3x3): Matrix3x3 =>
  mat.map((row) => row.map((val) => Math.round(val))) as Matrix3x3

const mat_add = (mat_a: Matrix3x3, mat_b: Matrix3x3): Matrix3x3 =>
  mat_a.map((row, idx) => row.map((val, jdx) => val + mat_b[idx][jdx])) as Matrix3x3

const mat_scale = (mat: Matrix3x3, factor: number): Matrix3x3 =>
  mat.map((row) => row.map((val) => val * factor)) as Matrix3x3

const mat_negate = (mat: Matrix3x3): Matrix3x3 => mat_scale(mat, -1)

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
    sum = mat_add(sum, power)
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
  const divisor = math.gcd_all(best)
  let axis = best.map((val) => val / divisor) as Vec3
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
    if (iter > 0) current = math.add(math.mat3x3_vec3_multiply(mat, current), w_loc)
    sum[0] += current[0]
    sum[1] += current[1]
    sum[2] += current[2]
  }
  return sum.map((val) => val / order) as Vec3
}

const is_integer = (val: number): boolean => Math.abs(val - Math.round(val)) < ELEM_TOL

const is_zero_vec = (vec: Vec3): boolean => vec.every((val) => Math.abs(val) < ELEM_TOL)

// Order on glide representatives so every operation of one geometric glide gets the same vector
// and letter: shorter, then sparser (R3c's c/2 beats the equally short (1/3,-1/3,1/6)), then
// lexicographically larger
const n_nonzero = (vec: Vec3): number => vec.filter((val) => Math.abs(val) > ELEM_TOL).length
const precedes = (cand: Vec3, best: Vec3): boolean => {
  const shorter = math.dot(best, best) - math.dot(cand, cand)
  if (Math.abs(shorter) > ELEM_TOL) return shorter > 0
  const sparser = n_nonzero(best) - n_nonzero(cand)
  if (sparser !== 0) return sparser > 0
  const decisive = math.subtract(cand, best).find((val) => Math.abs(val) > ELEM_TOL)
  return decisive !== undefined && decisive > 0
}

// Shortest representative of the glide class w_i + (Λ ∩ plane), exact even in sheared cells:
// Λ ∩ plane is the union of the centering cosets offset + ℤ-span(basis), and for a Gauss-reduced
// 2D basis every closest point to a target lies within ±1 of its rounded coordinates
function reduce_glide(
  w_intrinsic: Vec3,
  [first, second]: [Vec3, Vec3],
  offsets: readonly Vec3[],
): Vec3 {
  const g_11 = math.dot(first, first)
  const g_12 = math.dot(first, second)
  const g_22 = math.dot(second, second)
  const det = g_11 * g_22 - g_12 * g_12
  let best = w_intrinsic
  for (const offset of offsets) {
    const target = math.subtract(w_intrinsic, offset)
    const [proj_1, proj_2] = [math.dot(target, first), math.dot(target, second)]
    const coef_1 = Math.round((g_22 * proj_1 - g_12 * proj_2) / det)
    const coef_2 = Math.round((g_11 * proj_2 - g_12 * proj_1) / det)
    for (let mult_1 = coef_1 - 1; mult_1 <= coef_1 + 1; mult_1++) {
      for (let mult_2 = coef_2 - 1; mult_2 <= coef_2 + 1; mult_2++) {
        const cand = target.map(
          (val, idx) => val - (mult_1 * first[idx] + mult_2 * second[idx]),
        ) as Vec3
        if (precedes(cand, best)) best = cand
      }
    }
  }
  return best
}

// Glide letter from the reduced glide vector: a/b/c (half along one cell axis),
// n (half along a face/body diagonal), d (quarter diagonal), g otherwise
function glide_letter(glide_vec: Vec3): string {
  const doubled = glide_vec.map((val) => val * 2)
  const is_int = (vals: number[]) =>
    vals.every((val) => Math.abs(val - Math.round(val)) < 1e-4)
  if (is_int(doubled)) {
    const nonzero = doubled.map((val) => Math.round(val)).filter((val) => val !== 0)
    if (nonzero.length === 1)
      return [`a`, `b`, `c`][doubled.findIndex((val) => Math.round(val) !== 0)]
    return `n`
  }
  if (is_int(glide_vec.map((val) => val * 4))) return `d`
  return `g`
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
  const mat = mat_round(mat3_from_flat_col_major(rotation))
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
    const negative_sense =
      math.det_3x3([axis, probe, math.mat3x3_vec3_multiply(mat, probe)]) < 0
    return { ...base, kind: `proper`, order, axis, covectors, dual, period, negative_sense }
  }

  // Improper: mirror/glide (trace 1) or rotoinversion −3/−4/−6. The proper part −W is a
  // rotation about the same axis (the plane normal for mirrors).
  const proper_part = mat_negate(mat)
  const { proj: proper_proj, order: proper_order } = invariant_projector(proper_part)
  const axis = axis_from_projector(proper_proj, proper_order)
  if (!axis) throw new Error(`Failed to extract improper-operation axis`)

  if (mat_trace === 1) {
    // Plane-equation normal: the −1 eigenvector of Wᵀ, obtained as the +1 eigenvector of
    // −Wᵀ exactly the way `axis` above is the +1 eigenvector of −W. Integer and primitive
    // like `axis`, but a covector — see SymmetryElement.plane_normal for why they differ.
    const transposed = math.transpose_3x3_matrix(proper_part)
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

// Classify the operation (info.mat, w) given precomputed rotation-dependent data
function classify_with_rotation_info(info: RotationInfo, width_value: Vec3): SymmetryElement {
  const { mat, proj, mat_order, order } = info
  const w_intrinsic = math.mat3x3_vec3_multiply(proj, width_value)
  const w_loc = math.subtract(width_value, w_intrinsic)
  const point = wrap_to_unit_cell(fixed_point(mat, w_loc, mat_order))
  const locus = element_locus_key(point, info)

  if (info.kind === `inversion`)
    return {
      kind: `inversion`,
      order,
      label: `-1`,
      axis: null,
      plane_normal: null,
      point,
      translation: null,
      locus,
    }
  const { kind, axis } = info

  if (kind === `proper`) {
    // Screw component: w_i = λ·axis, so λ = dual·w_i, reduced modulo the lattice period
    const { dual, period, negative_sense } = info
    const lambda_raw = math.dot(dual, w_intrinsic)
    let lambda = lambda_raw - period * Math.floor(lambda_raw / period + ELEM_TOL)
    if (Math.abs(lambda) < ELEM_TOL) lambda = 0
    const is_screw = lambda > ELEM_TOL
    // ITA's N_p advances p/N of the period per +2π/N turn about +axis, so 3⁻ with 2/3 c lies on a
    // 3_1 axis. The sense is taken in the cell basis: a left-handed cell mirrors the labels like
    // moyo's space-group number (a P3_1 crystal reads P3_2 with 3_2 axes).
    const turn_part = Math.round((order * lambda) / period) % order
    const screw_part = negative_sense ? (order - turn_part) % order : turn_part
    return {
      kind: is_screw ? `screw` : `rotation`,
      order,
      label: is_screw ? `${order}_${screw_part}` : `${order}`,
      axis,
      plane_normal: null,
      point,
      translation: is_screw ? math.scale(axis, lambda) : null,
      locus,
    }
  }

  if (kind === `mirror`) {
    const glide_vec = reduce_glide(w_intrinsic, info.plane_basis, info.plane_offsets)
    const is_glide = !is_zero_vec(glide_vec)
    return {
      kind: is_glide ? `glide` : `mirror`,
      order,
      label: is_glide ? glide_letter(glide_vec) : `m`,
      axis,
      plane_normal: info.normal_eq,
      point,
      translation: is_glide ? glide_vec : null,
      locus,
    }
  }

  // Rotoinversion −3/−4/−6 (no intrinsic translation: P = 0, so w_i = 0)
  return {
    kind,
    order,
    label: `-${order}`,
    axis,
    plane_normal: null,
    point,
    translation: null,
    locus,
  }
}

// Classify a single operation (rotation as flat column-major 9-array, translation
// vector, both fractional). Returns null for the identity and pure (centering)
// translations, which define no geometric element. For non-primitive (centered) cells,
// pass the centering vectors so intrinsic screw/glide translations are reduced modulo
// the TRUE lattice — e.g. along a ⟨111⟩ axis of a body-centered cell the lattice period
// is (1/2)(1,1,1), and a C-centering-composed mirror is still a mirror, not an n-glide.
export function classify_symmetry_op(
  rotation: readonly number[],
  translation: readonly number[],
  centerings: readonly Vec3[] = [],
): SymmetryElement | null {
  const info = build_rotation_info(rotation, centerings)
  return info ? classify_with_rotation_info(info, translation as Vec3) : null
}

// Derive all distinct symmetry elements (modulo lattice translations) from a list of
// space-group operations. Each operation is classified, then re-anchored with lattice
// offsets t to enumerate the distinct in-cell instances of its element family (e.g. the
// inversion centers of P-1 sit at all 8 half-lattice points; 2-fold axes recur at quarter
// positions). Elements sharing the same geometric locus but different symbols (e.g. a 2-fold
// axis inside a 4-fold axis) are kept as separate entries — filter by `order`/`label`
// downstream if desired.
export function symmetry_elements_from_ops(
  operations: MoyoDataset[`operations`],
): SymmetryElement[] {
  // Centering vectors are the pure-translation operations (identity rotation, w ∉ ℤ³).
  // They define the true lattice for screw/glide reduction in centered cells.
  // Deduplicated since supercell inputs repeat sublattice translations.
  const centering_keys = new Set<string>()
  const centerings: Vec3[] = []
  for (const { rotation, translation } of operations) {
    if (!is_identity(mat_round(mat3_from_flat_col_major(rotation)))) continue
    const wrapped = wrap_to_unit_cell(translation)
    if (is_zero_vec(wrapped)) continue
    const key = wrapped.map((val) => val.toFixed(6)).join(`,`)
    if (centering_keys.has(key)) continue
    centering_keys.add(key)
    centerings.push(wrapped)
  }

  // Cache rotation-dependent analysis: supercell inputs can have thousands of ops but
  // share at most 48 distinct rotation matrices
  const info_cache = new Map<string, RotationInfo | null>()
  const seen = new Map<string, SymmetryElement>()
  for (const { rotation, translation } of operations) {
    const rot_key = rotation.join(`,`)
    let info = info_cache.get(rot_key)
    if (info === undefined) {
      info = build_rotation_info(rotation, centerings)
      info_cache.set(rot_key, info)
    }
    if (info === null) continue // identity / pure translation
    // Family members are the offsets modulo (I − W)ℤ³ and lattice vectors along the element, a
    // finite group: closing under +eⱼ visits each, where a fixed t ∈ {0,1}³ misses sheared ones
    const [w_x, w_y, w_z] = translation
    const shifts: Vec3[] = [[0, 0, 0]]
    for (const [s_x, s_y, s_z] of shifts) {
      const elem = classify_with_rotation_info(info, [w_x + s_x, w_y + s_y, w_z + s_z])
      // A rotoinversion fixes a center, not every point along its axis line.
      const center = elem.kind === `rotoinversion` ? elem.point.map(locus_coord).join(`,`) : ``
      const key = `${elem.kind}|${elem.label}|${elem.locus}|${center}`
      if (seen.has(key)) continue
      seen.set(key, elem)
      shifts.push([s_x + 1, s_y, s_z], [s_x, s_y + 1, s_z], [s_x, s_y, s_z + 1])
    }
  }
  // Stable order: by kind (SYM_ELEM_KINDS sequence), then descending order, label, point
  return [...seen.values()].toSorted(
    (el1, el2) =>
      SYM_ELEM_KINDS.indexOf(el1.kind) - SYM_ELEM_KINDS.indexOf(el2.kind) ||
      el2.order - el1.order ||
      el1.label.localeCompare(el2.label) ||
      el1.point.join(`,`).localeCompare(el2.point.join(`,`)),
  )
}

// Evenly-spaced dash layout along a segment of given length (Å): returns dash centers
// (distance from the segment start) and lengths. Dashes touch both segment ends so
// dashed axes still visually span the full cell; the gap stretches as needed. Used to
// render screw axes dashed (vs solid pure rotations) — translation-carrying elements
// are dashed, echoing the ITA plane-group convention.
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

// Convert a fractional direction or point to Cartesian coordinates (lattice rows are
// basis vectors). Valid for axis directions AND plane normals (eigenvectors of the
// fractional operator map to eigenvectors of the orthogonal Cartesian operator).
export const frac_to_cart_direction = (frac: Vec3, lattice: Matrix3x3): Vec3 =>
  math.create_frac_to_cart(lattice)(frac)

// Clip the line (point + t·direction, fractional) to the unit cell [0,1]³ using the
// slab method, returning the Cartesian segment endpoints (or null if the line misses
// the cell). Used to draw rotation/screw axes spanning the rendered cell.
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
  if (t_min >= t_max - eps || !Number.isFinite(t_min) || !Number.isFinite(t_max)) {
    return null
  }
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

// Deduplicate translations along planes/axes, but retain every translated center marker.
// A plane moves by the integer plane_normal · offset and a line by offset × axis (parallelism
// is affine), so both keys are exact and independent of the metric. Identity keeps different
// operations sharing a locus distinct.
const tiled_element_key = (element: SymmetryElement) => {
  const identity = `${element.kind}|${element.label}|${element.order}|${element.locus}`
  const { axis, kind, plane_normal } = element
  let key = (offset: Vec3): string =>
    (kind === `rotoinversion` ? math.add(element.point, offset) : offset).join(`,`)
  let changes = [true, true, true]
  if (plane_normal) {
    key = (offset) => String(math.dot(plane_normal, offset))
    changes = plane_normal.map((component) => component !== 0)
  } else if (axis && (kind === `rotation` || kind === `screw`)) {
    key = (offset) => math.cross_3d(offset, axis).join(`,`)
    changes = axis.map((_, idx) =>
      axis.some((component, other) => other !== idx && component !== 0),
    )
  }
  return { identity, key, changes }
}

// Translate elements through the block, then divide coordinates/directions by tile counts
// to express them in the block basis. Deduplicate after each axis to avoid walking every tile.
// Refusal returns a visible reason, never a partial overlay or a render-time exception.
function symmetry_tiling(
  elements: SymmetryElement[],
  tiling: Vec3,
  collect_elements: boolean,
): { elements: SymmetryElement[]; unavailable_reason: string | null } {
  const counts = tiling.map((count) => Math.max(1, Math.floor(count))) as Vec3
  const n_tiles = counts[0] * counts[1] * counts[2]
  const unavailable = (reason: string) => ({
    elements: [],
    unavailable_reason: `Symmetry overlay for tiling ${counts.join(`x`)} ${reason}. Reduce the supercell or hide element kinds.`,
  })
  if (!counts.every(Number.isFinite)) return unavailable(`needs finite repeat counts`)
  if (!elements.length || (n_tiles === 1 && elements.length <= MAX_TILED_SYM_ELEMENTS))
    return { elements, unavailable_reason: null }
  // Below this upper bound, neither the element cap nor the traversal cap can be hit.
  if (!collect_elements && elements.length * n_tiles <= MAX_TILED_SYM_ELEMENTS)
    return { elements: [], unavailable_reason: null }
  const shrink = (vec: Vec3): Vec3 => [
    vec[0] / counts[0],
    vec[1] / counts[1],
    vec[2] / counts[2],
  ]
  // Directions stay primitive integer vectors in the block basis, as the family clippers need:
  // axis_i / counts_i times the lcm of its nonzero components' counts; plane indices × counts
  const block_axis = (axis: Vec3): Vec3 => {
    const lcm = axis.reduce(
      (acc, val, idx) => (val === 0 ? acc : (acc / math.gcd(acc, counts[idx])) * counts[idx]),
      1,
    )
    return math.reduce_miller_indices(
      axis.map((val, idx) => (val * lcm) / counts[idx]) as Vec3,
    )
  }
  const block_normal = (normal: Vec3): Vec3 =>
    math.reduce_miller_indices(normal.map((val, idx) => val * counts[idx]) as Vec3)
  const tiled: SymmetryElement[] = []
  const seen = new Set<string>()
  let visits = 0
  for (const element of elements) {
    const { identity, key, changes } = tiled_element_key(element)
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
          if (unique.size > MAX_TILED_SYM_ELEMENTS)
            return unavailable(`exceeds ${MAX_TILED_SYM_ELEMENTS} unique elements`)
        }
      }
      offsets = [...unique.values()]
    }
    for (const offset of offsets) {
      const locus = `${identity}|${key(offset)}`
      if (seen.has(locus)) continue
      if (seen.size >= MAX_TILED_SYM_ELEMENTS)
        return unavailable(`exceeds ${MAX_TILED_SYM_ELEMENTS} unique elements`)
      seen.add(locus)
      if (collect_elements)
        tiled.push({
          ...element,
          point: shrink(element.point.map((coord, axis) => coord + offset[axis]) as Vec3),
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
  tiling: Vec3,
): string | null => symmetry_tiling(elements, tiling, false).unavailable_reason

export const tile_symmetry_elements = (
  elements: SymmetryElement[],
  tiling: Vec3,
): { elements: SymmetryElement[]; unavailable_reason: string | null } =>
  symmetry_tiling(elements, tiling, true)
