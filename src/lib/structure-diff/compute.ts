// Site-by-site comparison of two geometries of the same material (before/after relaxation,
// ML vs DFT): site mapping, minimum-image displacements, RMSD and lattice changes.
import { get_alphabetical_formula } from '#lib/composition/format.js'
import { display_idx } from '#lib/labels.js'
import {
  compute_lattice_params,
  create_cart_to_frac,
  create_frac_to_cart,
  create_lattice_converters,
  cross_3d,
  dot,
  type Matrix3x3,
  min_image_displacement_into,
  subtract,
  transpose_3x3,
  type Vec3,
} from '#lib/math.js'
import { characteristic_atom_spacing } from '#lib/structure/density.js'
import type { AnyStructure, Site } from '#lib/structure/index.js'
import { symmetric_eigen_3x3 } from '#lib/structure/thermal-ellipsoids.js'
import { is_crystal } from '#lib/structure/validation.js'
import { format_num } from 'svelte-widgets/format'

// `index` pairs site i with site i. `nearest` pairs each target site with a reference site of
// the same species, minimizing the summed squared minimum-image distances (for files listing
// the same atoms in a different order), at O(n^2) cost per species, so at most
// MAX_NEAREST_GROUP sites of one species. `auto` uses `nearest` when the species sequences
// differ. When they line up it keeps the file order unless a site moved more than half the
// characteristic atom spacing and the nearest pairing at least halves the RMSD (two
// same-species atoms listed swapped); large motions (MD, diffusion) stay index-paired.
export type SiteMatching = `auto` | `index` | `nearest`

// one per target site, at its index
export type SiteDisplacement = {
  reference_idx: number // index of the matched site in the reference structure
  species: string // e.g. `Fe` or `Fe0.5Ni0.5` for a disordered site
  vector: Vec3 // reference -> target, Cartesian Å in the target cell
  magnitude: number // |vector| in Å
}

type LatticeState = ReturnType<typeof compute_lattice_params>
export type LatticeKey = keyof LatticeState

export type LatticeChange = {
  reference: LatticeState
  target: LatticeState
  percent: LatticeState // (target - reference) / reference * 100
}

// Rigid motion subtracted from the displacements (see remove_rigid_motion)
export type RigidDrift = {
  shift: Vec3 // mean displacement in Å
  rotation_deg: number | null // Kabsch rotation angle, null when not fitted
}

// e.g. `drift 0.012 Å, 1.5° removed`
export const format_drift = ({ shift, rotation_deg }: RigidDrift): string =>
  `drift ${format_num(Math.hypot(...shift), `.3~f`)} Å${
    rotation_deg === null ? `` : `, ${format_num(rotation_deg, `.2~f`)}°`
  } removed`

export type StructureDiffResult = {
  displacements: SiteDisplacement[] // one per target site, in target order
  drift: RigidDrift | null // null unless remove_drift
  rmsd: number // Å
  max_displacement: number // Å
  max_site_idx: number // target index of the largest displacement
  reordered: boolean // true when some target site maps to a different reference index
  lattice: LatticeChange | null // null for molecules
}

// oxfmt-ignore
export const LATTICE_KEYS: readonly LatticeKey[] = [`a`, `b`, `c`, `alpha`, `beta`, `gamma`, `volume`]

// Largest species group nearest matching takes: its O(n^2) distance scan and, when nearest
// picks collide, O(n^3) assignment run on the UI thread (~0.5 s at this size)
export const MAX_NEAREST_GROUP = 2000

// Species and occupancies of a site, order-independent. Oxidation states are left out so a
// POSCAR (none) and a CIF (with) of the same material still compare.
const species_label = ({ species }: Site): string =>
  species
    .toSorted((sp_a, sp_b) => sp_a.element.localeCompare(sp_b.element))
    .map(({ element, occu }) => (occu === 1 ? element : `${element}${occu}`))
    .join(``)

const FORMULA_OPTS = { plain_text: true, delim: `` }

// Finite coordinates and equal multisets of site species, else a message naming the site or
// both formulas
function check_inputs(
  reference: AnyStructure,
  target: AnyStructure,
  ref_species: string[],
  target_species: string[],
): void {
  const n_ref = reference.sites.length
  const n_target = target.sites.length
  if (n_ref === 0 || n_target === 0) {
    throw new Error(
      `Cannot compare empty structures (reference ${n_ref}, target ${n_target} sites)`,
    )
  }
  for (const [role, { sites }] of Object.entries({ reference, target })) {
    const idx = sites.findIndex(({ xyz }) => !xyz.every(Number.isFinite))
    if (idx !== -1) {
      throw new Error(
        `${role} site ${display_idx(idx)} has non-finite xyz [${sites[idx].xyz}]`,
      )
    }
  }
  const counts = new Map<string, number>()
  for (const key of ref_species) counts.set(key, (counts.get(key) ?? 0) + 1)
  for (const key of target_species) counts.set(key, (counts.get(key) ?? 0) - 1)
  const mismatched = [...counts].filter(([, count]) => count !== 0)
  if (mismatched.length > 0) {
    const detail = mismatched
      .map(([key, count]) => `${key} ${count > 0 ? `+` : ``}${count}`)
      .join(`, `)
    throw new Error(
      `Cannot compare structures with different compositions: reference ` +
        `${get_alphabetical_formula(reference, FORMULA_OPTS)} (${n_ref} sites) vs target ` +
        `${get_alphabetical_formula(target, FORMULA_OPTS)} (${n_target} sites); reference minus target: ${detail}`,
    )
  }
}

// Minimum-cost perfect matching of a square cost matrix (Hungarian algorithm with row/column
// potentials, O(n^3)). Returns col_of_row: the column assigned to each row.
export function solve_assignment(costs: Float64Array, size: number): Int32Array {
  if (costs.length !== size * size) {
    throw new Error(`Cost matrix has ${costs.length} entries, expected ${size}x${size}`)
  }
  // 1-based with a virtual row/column 0, as in the textbook formulation
  const row_pot = new Float64Array(size + 1)
  const col_pot = new Float64Array(size + 1)
  const row_of_col = new Int32Array(size + 1) // 0 = unassigned
  const way = new Int32Array(size + 1)
  const min_slack = new Float64Array(size + 1)
  const used = new Uint8Array(size + 1)
  for (let row = 1; row <= size; row++) {
    row_of_col[0] = row
    let col_0 = 0
    min_slack.fill(Infinity)
    used.fill(0)
    do {
      used[col_0] = 1
      const row_0 = row_of_col[col_0]
      let delta = Infinity
      let col_1 = 0
      for (let col = 1; col <= size; col++) {
        if (used[col]) continue
        const slack = costs[(row_0 - 1) * size + col - 1] - row_pot[row_0] - col_pot[col]
        if (slack < min_slack[col]) {
          min_slack[col] = slack
          way[col] = col_0
        }
        if (min_slack[col] < delta) {
          delta = min_slack[col]
          col_1 = col
        }
      }
      for (let col = 0; col <= size; col++) {
        if (used[col]) {
          row_pot[row_of_col[col]] += delta
          col_pot[col] -= delta
        } else min_slack[col] -= delta
      }
      col_0 = col_1
    } while (row_of_col[col_0] !== 0)
    do {
      const prev_col = way[col_0]
      row_of_col[col_0] = row_of_col[prev_col]
      col_0 = prev_col
    } while (col_0 !== 0)
  }
  const col_of_row = new Int32Array(size)
  for (let col = 1; col <= size; col++) col_of_row[row_of_col[col] - 1] = col - 1
  return col_of_row
}

// Reference index for every target site: per species, each target site takes its nearest
// reference site when those picks are all distinct (then they already minimize the summed
// squared distance), else the optimal assignment decides. A species group past
// MAX_NEAREST_GROUP throws when `strict`, else gives null.
function match_nearest(
  ref_species: string[],
  target_species: string[],
  sq_dist: (ref_idx: number, target_idx: number) => number,
  strict: boolean,
): number[] | null {
  const by_species = (keys: string[]) => Map.groupBy(keys.keys(), (idx) => keys[idx])
  const ref_groups = by_species(ref_species)
  const target_groups = by_species(target_species)
  for (const [key, { length }] of ref_groups) {
    if (length <= MAX_NEAREST_GROUP) continue
    if (!strict) return null
    throw new Error(
      `Nearest-site matching of ${length} ${key} sites exceeds the limit of ` +
        `${MAX_NEAREST_GROUP}. List both structures in the same site order and use index ` +
        `matching instead.`,
    )
  }
  const mapping: number[] = []
  for (const [key, ref] of ref_groups) {
    const target = target_groups.get(key) ?? [] // same species counts, checked upfront
    // indexed loops: this O(n^2) scan is the hot path, entries() destructuring allocates
    const size = ref.length
    const costs = new Float64Array(size * size)
    const nearest = new Int32Array(size)
    for (let row = 0; row < size; row++) {
      let best = Infinity
      for (let col = 0; col < size; col++) {
        const cost = sq_dist(ref[col], target[row])
        costs[row * size + col] = cost
        if (cost < best) [best, nearest[row]] = [cost, col]
      }
    }
    const col_of_row = new Set(nearest).size === size ? nearest : solve_assignment(costs, size)
    target.forEach((target_idx, row) => (mapping[target_idx] = ref[col_of_row[row]]))
  }
  return mapping
}

// Reference positions as the displacements see them, plus the displacement function. In a
// crystal each reference site keeps its fractional coordinates along the periodic axes but
// sits in the target cell, so a uniform strain contributes no displacement; along
// non-periodic axes (slab vacuum, wire) the Cartesian offset counts as is.
function displacement_frame(reference: AnyStructure, target: AnyStructure) {
  const ref_is_crystal = is_crystal(reference)
  const target_is_crystal = is_crystal(target)
  if (ref_is_crystal !== target_is_crystal) {
    throw new Error(
      `Cannot compare a ${ref_is_crystal ? `crystal` : `molecule`} reference with a ` +
        `${target_is_crystal ? `crystal` : `molecule`} target`,
    )
  }
  if (!ref_is_crystal || !target_is_crystal) {
    const displace = (from: Vec3, to: Vec3, _out: Vec3): Vec3 => subtract(to, from)
    return { ref_positions: reference.sites.map(({ xyz }) => xyz), displace, lattice: null }
  }
  const { pbc } = target.lattice
  if (reference.lattice.pbc.some((periodic, axis) => periodic !== pbc[axis])) {
    throw new Error(
      `Cannot compare structures with different periodicity: reference pbc ` +
        `[${reference.lattice.pbc}] vs target pbc [${pbc}]`,
    )
  }
  const ref_matrix = reference.lattice.matrix
  const target_matrix = target.lattice.matrix
  const converters = create_lattice_converters(target_matrix)
  // Fractional coordinates re-expressed with the target's periodic lattice vectors (the
  // reference's along non-periodic axes). An unchanged cell skips the round trip, so identical
  // inputs give exactly zero (number-to-string round-trips: equal strings, equal values).
  const same_cell = `${ref_matrix}` === `${target_matrix}`
  const to_frac = create_cart_to_frac(ref_matrix)
  const to_cart = create_frac_to_cart(
    target_matrix.map((row, axis) => (pbc[axis] ? row : ref_matrix[axis])) as Matrix3x3,
  )
  const ref_positions = reference.sites.map(({ xyz }) =>
    same_cell ? xyz : to_cart(to_frac(xyz)),
  )
  const displace = (from: Vec3, to: Vec3, out: Vec3): Vec3 =>
    min_image_displacement_into(from, to, target_matrix, converters, pbc, out)
  const lattice_ref = compute_lattice_params(ref_matrix)
  const lattice_target = compute_lattice_params(target_matrix)
  const percent = Object.fromEntries(
    LATTICE_KEYS.map((key) => [
      key,
      ((lattice_target[key] - lattice_ref[key]) / lattice_ref[key]) * 100,
    ]),
  ) as LatticeState
  return {
    ref_positions,
    displace,
    lattice: { reference: lattice_ref, target: lattice_target, percent },
  }
}

// Proper rotation R minimizing sum |R from_i - to_i|^2 over centered point sets (Kabsch):
// the polar factor of M = sum to_i from_i^T, sum_k left_k right_k^T over its singular vector
// pairs, with right_k the eigenvectors of M^T M (a proper rotation). The smallest pair's left
// vector is a cross product, which keeps det R = +1 and covers planar sets. A linear or
// single-point set has no unique rotation: null.
function kabsch(from: Vec3[], to: Vec3[]): Matrix3x3 | null {
  const mat = [0, 1, 2].map((row) =>
    [0, 1, 2].map((col) => to.reduce((sum, vec, idx) => sum + vec[row] * from[idx][col], 0)),
  ) as Matrix3x3
  const { values, vectors } = symmetric_eigen_3x3(dot(transpose_3x3(mat), mat))
  if (!(values[1] > 1e-12 * values[2])) return null
  const right = transpose_3x3(vectors) // rows: eigenvectors, ascending
  const [left_1, left_2] = [1, 2].map((idx) =>
    dot(mat, right[idx]).map((val) => val / Math.sqrt(values[idx])),
  )
  return dot(transpose_3x3([cross_3d(left_1, left_2), left_1, left_2] as Matrix3x3), right)
}

// Subtracts the least-squares rigid motion of the reference onto the target from `vectors`
// in place: their mean (a uniform translation, the only rigid motion compatible with periodic
// axes) and, with `rotate`, the Kabsch rotation about the centroids. Works on the
// minimum-image vectors, so atoms crossing a cell face still count by their short image.
function remove_rigid_motion(
  vectors: Vec3[],
  target_xyz: Vec3[],
  rotate: boolean,
): RigidDrift {
  const mean = (vecs: Vec3[]) =>
    [0, 1, 2].map(
      (axis) => vecs.reduce((sum, vec) => sum + vec[axis], 0) / vecs.length,
    ) as Vec3
  const shift = mean(vectors)
  for (const vec of vectors) for (const axis of [0, 1, 2]) vec[axis] -= shift[axis]
  if (!rotate) return { shift, rotation_deg: null }
  const centroid = mean(target_xyz)
  const centered = target_xyz.map((xyz) => subtract(xyz, centroid))
  // reference positions about their centroid: centered target minus the translation-free vector
  const ref_centered = centered.map((xyz, idx) => subtract(xyz, vectors[idx]))
  const rotation = kabsch(ref_centered, centered)
  if (!rotation) return { shift, rotation_deg: null }
  for (const [idx, vec] of vectors.entries()) {
    const fitted = dot(rotation, ref_centered[idx])
    for (const axis of [0, 1, 2]) vec[axis] = centered[idx][axis] - fitted[axis]
  }
  const cos_angle = (rotation[0][0] + rotation[1][1] + rotation[2][2] - 1) / 2
  return {
    shift,
    rotation_deg: (Math.acos(Math.min(1, Math.max(-1, cos_angle))) * 180) / Math.PI,
  }
}

// Compare `target` against `reference` (see displacement_frame for the cell convention). An
// atom crossing a cell face moves by its short image vector, not a lattice vector.
// `remove_drift` subtracts the rigid motion after pairing (see remove_rigid_motion), rotation
// included when no axis is periodic, so MD or relaxation drift doesn't inflate the RMSD.
// Throws when compositions, site counts or periodicity differ, or when one is a crystal and the
// other a molecule.
export function compute_structure_diff(
  reference: AnyStructure,
  target: AnyStructure,
  {
    matching = `auto`,
    remove_drift = false,
  }: { matching?: SiteMatching; remove_drift?: boolean } = {},
): StructureDiffResult {
  const ref_species = reference.sites.map(species_label)
  const target_species = target.sites.map(species_label)
  check_inputs(reference, target, ref_species, target_species)
  const { ref_positions, displace, lattice } = displacement_frame(reference, target)
  const scratch: Vec3 = [0, 0, 0]
  const sq_dist = (ref_idx: number, target_idx: number): number => {
    const [dx, dy, dz] = displace(
      ref_positions[ref_idx],
      target.sites[target_idx].xyz,
      scratch,
    )
    return dx * dx + dy * dy + dz * dz
  }
  const pairing_cost = (pairs: number[]): number =>
    pairs.reduce((sum, ref_idx, target_idx) => sum + sq_dist(ref_idx, target_idx), 0)

  const species_aligned = ref_species.every((key, idx) => key === target_species[idx])
  if (matching === `index` && !species_aligned) {
    const idx = ref_species.findIndex((key, site_idx) => key !== target_species[site_idx])
    throw new Error(
      `Index matching needs the same species order, but site ${display_idx(idx)} is ` +
        `${ref_species[idx]} in the reference and ${target_species[idx]} in the target. ` +
        `Use nearest matching for reordered sites.`,
    )
  }
  const identity = target.sites.map((_, idx) => idx)
  let mapping = identity
  const aligned_auto = matching === `auto` && species_aligned
  const half_spacing_sq = aligned_auto ? (0.5 * characteristic_atom_spacing(target)) ** 2 : 0
  const keep_index =
    matching === `index` ||
    (aligned_auto && identity.every((idx) => sq_dist(idx, idx) < half_spacing_sq))
  // An oversized aligned auto pair keeps its file order (valid, just not provably shortest).
  // Aligned auto re-pairs only when that at least halves the RMSD.
  const nearest = keep_index
    ? null
    : match_nearest(ref_species, target_species, sq_dist, !aligned_auto)
  if (nearest && (!aligned_auto || 4 * pairing_cost(nearest) <= pairing_cost(identity))) {
    mapping = nearest
  }

  const target_xyz = target.sites.map(({ xyz }) => xyz)
  const vectors = target_xyz.map((xyz, idx) =>
    displace(ref_positions[mapping[idx]], xyz, [0, 0, 0]),
  )
  const periodic = is_crystal(target) && target.lattice.pbc.some(Boolean)
  const drift = remove_drift ? remove_rigid_motion(vectors, target_xyz, !periodic) : null
  let [sum_sq, max_displacement, max_site_idx] = [0, -1, 0]
  const displacements = vectors.map((vector, site_idx): SiteDisplacement => {
    const magnitude = Math.hypot(...vector)
    sum_sq += magnitude ** 2
    if (magnitude > max_displacement) [max_displacement, max_site_idx] = [magnitude, site_idx]
    const reference_idx = mapping[site_idx]
    return { reference_idx, species: target_species[site_idx], vector, magnitude }
  })
  return {
    displacements,
    drift,
    rmsd: Math.sqrt(sum_sq / displacements.length),
    max_displacement,
    max_site_idx,
    reordered: mapping.some((ref_idx, idx) => ref_idx !== idx),
    lattice,
  }
}

// Reference ghost per target site: the target atom minus `scale` times its displacement, so
// the arrow from ghost to atom runs reference -> target (true length at scale 1)
export const ghost_positions = (
  diff: StructureDiffResult,
  target: AnyStructure,
  scale: number,
): Vec3[] =>
  diff.displacements.map(
    ({ vector }, idx) =>
      target.sites[idx].xyz.map((coord, axis) => coord - scale * vector[axis]) as Vec3,
  )
