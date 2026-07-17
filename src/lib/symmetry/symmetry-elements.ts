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
import type { MoyoDataset } from '@spglib/moyo-wasm'

export type SymmetryElementKind =
  | `rotation`
  | `screw`
  | `mirror`
  | `glide`
  | `inversion`
  | `rotoinversion`

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
  // A fractional point on the element (on the axis / in the plane / the center),
  // wrapped into [0, 1)
  point: Vec3
  // Intrinsic screw/glide translation in fractional coordinates (null if none)
  translation: Vec3 | null
}

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
] as const satisfies readonly SymmetryElementKind[]

// Per-kind overlay visibility. Kinds absent from the record are hidden.
export type ShowSymmetryKinds = Partial<Record<SymmetryElementKind, boolean>>

// Default overlay visibility: a SINGLE kind (proper rotation axes). High-symmetry
// structures easily have 100+ distinct elements which, drawn all at once, bury the
// structure entirely. Users opt into additional kinds individually via
// SymmetryElementControls (or the show_kinds prop).
export const DEFAULT_SHOW_SYM_KINDS: ShowSymmetryKinds = { rotation: true }

// Human-readable labels + representative legend colors per kind. mirror/glide/
// rotoinversion/inversion match the SymmetryElements.svelte render colors exactly;
// rotation/screw axes are colored by rotation order in-scene, so their swatch uses the
// 2-fold color as representative.
export const SYM_ELEM_KIND_INFO: Record<
  SymmetryElementKind,
  { label: string; color: string }
> = {
  rotation: { label: `rotation axes`, color: `#e63946` },
  screw: { label: `screw axes`, color: `#e76f51` },
  mirror: { label: `mirror planes`, color: `#ffb703` },
  glide: { label: `glide planes`, color: `#8ecae6` },
  rotoinversion: { label: `rotoinversion axes`, color: `#9c27b0` },
  inversion: { label: `inversion centers`, color: `#555555` },
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

// The 12 edges of the unit cube [0,1]³ (corner pairs differing in exactly one coord)
const UNIT_CUBE_EDGES: readonly (readonly [Vec3, Vec3])[] = (() => {
  const corners: Vec3[] = []
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) for (let z = 0; z <= 1; z++) corners.push([x, y, z])
  }
  const edges: [Vec3, Vec3][] = []
  for (let idx_a = 0; idx_a < corners.length; idx_a++) {
    for (let idx_b = idx_a + 1; idx_b < corners.length; idx_b++) {
      const manhattan = corners[idx_a].reduce(
        (sum, val, dim) => sum + Math.abs(val - corners[idx_b][dim]),
        0,
      )
      if (manhattan === 1) edges.push([corners[idx_a], corners[idx_b]])
    }
  }
  return edges
})()

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

const IDENTITY: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

const is_identity = (mat: Matrix3x3): boolean =>
  mat.every((row, idx) => row.every((val, jdx) => val === (idx === jdx ? 1 : 0)))

const trace = (mat: Matrix3x3): number => mat[0][0] + mat[1][1] + mat[2][2]

// Projection onto the invariant (+1 eigenvalue) subspace P = (1/n) Σₖ Wᵏ, plus the
// matrix order n (crystallographic: 1, 2, 3, 4 or 6)
function invariant_projector(mat: Matrix3x3): { proj: Matrix3x3; order: number } {
  let sum = IDENTITY
  let power = mat
  for (let order = 1; order <= 6; order++) {
    if (is_identity(power)) return { proj: mat_scale(sum, 1 / order), order }
    sum = mat_add(sum, power)
    power = mat_round(math.dot(power, mat))
  }
  throw new Error(`Matrix is not of finite crystallographic order`)
}

const gcd = (val_a: number, val_b: number): number =>
  val_b === 0 ? val_a : gcd(val_b, val_a % val_b)

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
  const divisor = best.reduce((acc, val) => gcd(acc, Math.abs(val)), 0)
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

// NOTE on epsilon: 1e-8 is the loosest of three intentionally different wrap
// helpers (vs wrap_frac_coord @1e-10 [[src/lib/structure/pbc.ts:26]] for parsed
// coords and wrap_frac @1e-9 [[src/lib/symmetry/index.ts:80]] for standardized
// Wyckoff positions). Inputs here are fixed points / intercepts obtained by
// solving linear systems and averaging over operation order, so float error is
// largest; the result feeds toFixed()-based dedup keys for symmetry elements,
// which need both near-0 and near-1 snapped onto exactly 0 to stay stable near
// cell boundaries. Do not unify: tightening this epsilon breaks element dedup.
const wrap_point = (pos: Vec3): Vec3 =>
  pos.map((coord) => {
    const wrapped = coord - Math.floor(coord) // always in [0, 1)
    // snap near-0 and near-1 (which wraps to near-0) onto exactly 0
    return wrapped < 1e-8 || wrapped > 1 - 1e-8 ? 0 : wrapped
  }) as Vec3

// Enumerate lattice translations invariant under W (lying along the axis / in the
// plane), including centering vectors of non-primitive cells (I/F/A/B/C/R): without
// them, e.g. the body-centering (1/2,1/2,1/2) period along ⟨111⟩ axes is missed and
// centering-composed mirrors get mislabeled as glides. Candidates r + c with
// r ∈ {-1,0,1}³ cover all cases for moyo translations, which lie in [0,1)³.
function invariant_translations(mat: Matrix3x3, centerings: readonly Vec3[]): Vec3[] {
  const result: Vec3[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const centering of [[0, 0, 0] as Vec3, ...centerings]) {
          const cand: Vec3 = [dx + centering[0], dy + centering[1], dz + centering[2]]
          if (cand.every((val) => Math.abs(val) < ELEM_TOL)) continue
          const mapped = math.mat3x3_vec3_multiply(mat, cand)
          if (mapped.some((val, idx) => Math.abs(val - cand[idx]) > ELEM_TOL)) continue
          result.push(cand)
        }
      }
    }
  }
  return result
}

// Reduce an intrinsic (in-plane glide) translation modulo invariant lattice translations
function reduce_intrinsic_translation(w_intrinsic: Vec3, candidates: readonly Vec3[]): Vec3 {
  let best = w_intrinsic
  let best_sq = math.dot(w_intrinsic, w_intrinsic)
  for (const cand of candidates) {
    const reduced = math.subtract(w_intrinsic, cand)
    const sq = math.dot(reduced, reduced)
    if (sq < best_sq - ELEM_TOL) {
      best = reduced
      best_sq = sq
    }
  }
  return best
}

const is_zero_vec = (vec: Vec3): boolean => vec.every((val) => Math.abs(val) < ELEM_TOL)

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

export type ClassifiedOperation = Omit<SymmetryElement, `point`> & { point: Vec3 }

// All translation-independent data derived from a rotation matrix W (plus centerings).
// Cached per distinct W in symmetry_elements_from_ops: supercell inputs can carry
// thousands of operations sharing at most 48 distinct rotation matrices, so re-deriving
// projectors/axes/periods per operation dominates runtime without this cache.
type RotationInfo = {
  mat: Matrix3x3
  proj: Matrix3x3
  mat_order: number
  kind: `inversion` | `proper` | `mirror` | `rotoinversion`
  order: number
  axis: Vec3 | null
  axis_sq: number
  // shortest lattice period along the axis (proper rotations; 1 for primitive lattices)
  period: number
  // invariant lattice translations (for glide reduction)
  invariant_candidates: Vec3[]
}

// Translation-independent analysis of a rotation matrix. Returns null for the identity
// (pure translations define no geometric element).
function build_rotation_info(
  rotation: readonly number[],
  centerings: readonly Vec3[],
): RotationInfo | null {
  const mat = mat_round(mat3_from_flat_col_major(rotation))
  const det = Math.round(math.det_3x3(mat))
  const tr = Math.round(trace(mat))

  if (det === 1 && tr === 3) return null // identity or pure translation

  const { proj, order: mat_order } = invariant_projector(mat)

  if (det === -1 && tr === -3) {
    return {
      mat,
      proj,
      mat_order,
      kind: `inversion`,
      order: 1,
      axis: null,
      axis_sq: 0,
      period: 1,
      invariant_candidates: [],
    }
  }

  if (det === 1) {
    // proper rotation (order from trace: −1→2, 0→3, 1→4, 2→6)
    const proper_order_by_trace: Record<number, number> = { [-1]: 2, 0: 3, 1: 4, 2: 6 }
    const order = proper_order_by_trace[tr]
    if (!order) throw new Error(`Invalid proper rotation trace ${tr}`)
    const axis = axis_from_projector(proj, mat_order)
    if (!axis) throw new Error(`Failed to extract rotation axis`)
    // shortest lattice period along the axis (1 for primitive lattices; can be 1/2 via
    // centering vectors, e.g. (1/2,1/2,1/2) along ⟨111⟩ in body-centered cells)
    const axis_sq = math.dot(axis, axis)
    let period = 1
    for (const cand of invariant_translations(mat, centerings)) {
      const lambda_cand = math.dot(cand, axis) / axis_sq
      // candidate must be parallel to the axis and shorter than the current period
      const is_parallel = cand.every(
        (val, idx) => Math.abs(val - lambda_cand * axis[idx]) < ELEM_TOL,
      )
      if (is_parallel && lambda_cand > ELEM_TOL && lambda_cand < period) {
        period = lambda_cand
      }
    }
    return {
      mat,
      proj,
      mat_order,
      kind: `proper`,
      order,
      axis,
      axis_sq,
      period,
      invariant_candidates: [],
    }
  }

  // Improper: mirror/glide (trace 1) or rotoinversion −3/−4/−6. The proper part −W is a
  // rotation about the same axis (the plane normal for mirrors).
  const proper_part = mat_negate(mat)
  const { proj: proper_proj, order: proper_order } = invariant_projector(proper_part)
  const axis = axis_from_projector(proper_proj, proper_order)
  if (!axis) throw new Error(`Failed to extract improper-operation axis`)

  if (tr === 1) {
    return {
      mat,
      proj,
      mat_order,
      kind: `mirror`,
      order: 2,
      axis,
      axis_sq: math.dot(axis, axis),
      period: 1,
      invariant_candidates: invariant_translations(mat, centerings),
    }
  }

  const rotoinv_order_by_trace: Record<number, number> = { 0: 3, [-1]: 4, [-2]: 6 }
  const order = rotoinv_order_by_trace[tr]
  if (!order) throw new Error(`Invalid improper rotation trace ${tr}`)
  return {
    mat,
    proj,
    mat_order,
    kind: `rotoinversion`,
    order,
    axis,
    axis_sq: math.dot(axis, axis),
    period: 1,
    invariant_candidates: [],
  }
}

// Classify the operation (info.mat, w) given precomputed rotation-dependent data
function classify_with_rotation_info(info: RotationInfo, w: Vec3): ClassifiedOperation {
  const { mat, proj, mat_order, kind, order, axis } = info
  const w_intrinsic = math.mat3x3_vec3_multiply(proj, w)
  const w_loc = math.subtract(w, w_intrinsic)
  const point = wrap_point(fixed_point(mat, w_loc, mat_order))

  if (kind === `inversion`) {
    return { kind, order: 1, label: `-1`, axis: null, point, translation: null }
  }

  if (kind === `proper`) {
    // Screw component: w_i = λ·axis, reduced modulo the lattice period along the axis
    const { axis_sq, period } = info
    const lambda_raw = math.dot(w_intrinsic, axis as Vec3) / axis_sq
    let lambda = lambda_raw - period * Math.floor(lambda_raw / period + ELEM_TOL)
    if (Math.abs(lambda) < ELEM_TOL) lambda = 0
    const is_screw = lambda > ELEM_TOL
    const screw_part = Math.round((order * lambda) / period) % order
    return {
      kind: is_screw ? `screw` : `rotation`,
      order,
      label: is_screw ? `${order}_${screw_part}` : `${order}`,
      axis,
      point,
      translation: is_screw ? ((axis as Vec3).map((val) => val * lambda) as Vec3) : null,
    }
  }

  if (kind === `mirror`) {
    const glide_vec = reduce_intrinsic_translation(w_intrinsic, info.invariant_candidates)
    const is_glide = !is_zero_vec(glide_vec)
    return {
      kind: is_glide ? `glide` : `mirror`,
      order: 2,
      label: is_glide ? glide_letter(glide_vec) : `m`,
      axis,
      point,
      translation: is_glide ? glide_vec : null,
    }
  }

  // Rotoinversion −3/−4/−6 (no intrinsic translation: P = 0, so w_i = 0)
  return { kind, order, label: `-${order}`, axis, point, translation: null }
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
): ClassifiedOperation | null {
  const info = build_rotation_info(rotation, centerings)
  return info ? classify_with_rotation_info(info, translation as Vec3) : null
}

// Canonical dedup key for the geometric locus of an element. Elements are identified
// modulo lattice translations:
// - inversion centers: the wrapped center
// - planes: (normal, offset s = x₀·normal mod 1) — lattice translations change s by an
//   integer since the normal is an integer vector
// - axis lines: (direction, line intercept x₀ − λ·u wrapped mod 1) — wrapping merges
//   lattice-equivalent parallel lines
function element_locus_key(elem: ClassifiedOperation): string {
  const fmt = (val: number) => (Math.abs(val) < 1e-4 ? 0 : val).toFixed(4)
  if (elem.axis === null) return `center|${elem.point.map(fmt).join(`,`)}`
  const axis_key = elem.axis.join(`,`)
  if (elem.kind === `mirror` || elem.kind === `glide`) {
    const offset = math.dot(elem.point, elem.axis)
    const wrapped = offset - Math.floor(offset + 1e-6)
    return `plane|${axis_key}|${fmt(wrapped >= 1 - 1e-4 ? 0 : wrapped)}`
  }
  const lambda = math.dot(elem.point, elem.axis) / math.dot(elem.axis, elem.axis)
  const intercept = wrap_point(
    math.subtract(elem.point, elem.axis.map((val) => val * lambda) as Vec3),
  )
  return `line|${axis_key}|${intercept.map(fmt).join(`,`)}`
}

// Derive all distinct symmetry elements (modulo lattice translations) from a list of
// space-group operations. Each operation is classified, then re-anchored with the 8
// lattice offsets t ∈ {0,1}³ to enumerate the distinct in-cell instances of its element
// family (e.g. the inversion centers of P-1 sit at all 8 half-lattice points; 2-fold
// axes recur at quarter positions). Elements sharing the same geometric locus but
// different symbols (e.g. a 2-fold axis inside a 4-fold axis) are kept as separate
// entries — filter by `order`/`label` downstream if desired.
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
    const wrapped = wrap_point(translation)
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
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dz = 0; dz <= 1; dz++) {
          const shifted: Vec3 = [translation[0] + dx, translation[1] + dy, translation[2] + dz]
          const elem = classify_with_rotation_info(info, shifted)
          const key = `${elem.kind}|${elem.label}|${element_locus_key(elem)}`
          if (!seen.has(key)) seen.set(key, elem)
        }
      }
    }
  }
  // Stable order: by kind (SYM_ELEM_KINDS sequence), then descending order, label, point
  return [...seen.values()].sort(
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
  eps = 1e-9,
): [Vec3, Vec3] | null {
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
  const endpoint = (t_param: number): Vec3 =>
    frac_to_cart_direction(
      point.map((coord, idx) => coord + t_param * direction[idx]) as Vec3,
      lattice,
    )
  return [endpoint(t_min), endpoint(t_max)]
}

// Clip the plane through `point` with fractional-direct-space normal `normal_frac` to
// the unit cell, returning the Cartesian polygon vertices in winding order (empty if
// the plane misses the cell). The plane equation in fractional coordinates uses the
// pullback n_eq[i] = lattice[i]·N_cart of the Cartesian normal, which is exact for
// arbitrary (non-orthogonal) cells.
export function clip_plane_to_cell(
  point: Vec3,
  normal_frac: Vec3,
  lattice: Matrix3x3,
): Vec3[] {
  const normal_cart = frac_to_cart_direction(normal_frac, lattice)
  const n_eq: Vec3 = [
    math.dot(lattice[0], normal_cart),
    math.dot(lattice[1], normal_cart),
    math.dot(lattice[2], normal_cart),
  ]
  const signed_dist = (frac: Vec3) =>
    n_eq[0] * (frac[0] - point[0]) +
    n_eq[1] * (frac[1] - point[1]) +
    n_eq[2] * (frac[2] - point[2])

  const frac_points: Vec3[] = []
  const tol = 1e-7
  // Intersect the plane with the 12 unit-cube edges (corners on the plane included)
  for (const [edge_a, edge_b] of UNIT_CUBE_EDGES) {
    const dist_a = signed_dist(edge_a)
    const dist_b = signed_dist(edge_b)
    if (Math.abs(dist_a) < tol) frac_points.push(edge_a)
    if (Math.abs(dist_b) < tol) frac_points.push(edge_b)
    if (dist_a * dist_b < -tol * tol) {
      const frac_t = dist_a / (dist_a - dist_b)
      frac_points.push(edge_a.map((val, dim) => val + frac_t * (edge_b[dim] - val)) as Vec3)
    }
  }

  // Dedup and convert to Cartesian
  const seen = new Set<string>()
  const cart_points: Vec3[] = []
  for (const frac of frac_points) {
    const key = frac.map((val) => val.toFixed(6)).join(`,`)
    if (seen.has(key)) continue
    seen.add(key)
    cart_points.push(frac_to_cart_direction(frac, lattice))
  }
  if (cart_points.length < 3) return []

  // Order vertices by angle around the centroid within the plane
  const centroid = cart_points
    .reduce<Vec3>((acc, vert) => math.add(acc, vert), [0, 0, 0])
    .map((val) => val / cart_points.length) as Vec3
  const normal_unit = math.normalize_vec(normal_cart)
  const ref_vec = math.normalize_vec(math.subtract(cart_points[0], centroid))
  const cross_ref = math.cross_3d(normal_unit, ref_vec)
  return (
    cart_points
      .map((vert) => {
        const rel = math.subtract(vert, centroid)
        return { vert, angle: Math.atan2(math.dot(rel, cross_ref), math.dot(rel, ref_vec)) }
      })
      // map() returns a fresh point array.
      .toSorted((pt_a, pt_b) => pt_a.angle - pt_b.angle)
      .map(({ vert }) => vert)
  )
}
