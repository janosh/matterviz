import type { Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type { Camera } from 'three/webgpu'
import { Matrix4 } from 'three/webgpu'
import { BondFrame, bond_site_1, bond_site_2, type BondData } from './bond-rendering'

const LABEL_OFFSET_EPS = 1e-9

const LABEL_OFFSET_DIRECTIONS: Vec3[] = [
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

// Unit vector of (x, y, z) into out[offset..], exactly as math.normalize_vec computes it, or
// `fallback` when shorter than math.EPS
const normalize_into = (
  x: number,
  y: number,
  z: number,
  fallback: ArrayLike<number>,
  out: Float64Array,
  offset: number,
): void => {
  const len = Math.sqrt(0 + x * x + y * y + z * z)
  const short = len < math.EPS
  out[offset] = short ? fallback[0] : x / len
  out[offset + 1] = short ? fallback[1] : y / len
  out[offset + 2] = short ? fallback[2] : z / len
}

const unit_scratch = new Float64Array(3)

// Label offset for one site from its unit bond directions, packed as xyz triples in
// directions[start * 3 .. end * 3): among the preferred direction, the one opposite the
// bonds and LABEL_OFFSET_DIRECTIONS, the one least aligned with any bond (small bonuses
// for the preferred direction and the screen plane). Scalar math on packed directions:
// this runs for every bonded site of a structure whose labels are shown.
function choose_offset(
  directions: Float64Array,
  start: number,
  end: number,
  base_offset: Vec3,
  candidates: Float64Array, // preferred at 0, a free slot at 3, LABEL_OFFSET_DIRECTIONS after
): Vec3 {
  const offset_length = Math.hypot(...base_offset)
  if (offset_length < LABEL_OFFSET_EPS || end === start) return base_offset
  const [pref_x, pref_y, pref_z] = [candidates[0], candidates[1], candidates[2]]
  // repulsion: minus the sum of the bond directions, accumulated in bond order
  let [sum_x, sum_y, sum_z] = [0, 0, 0]
  for (let idx = start * 3; idx < end * 3; idx += 3) {
    sum_x -= directions[idx]
    sum_y -= directions[idx + 1]
    sum_z -= directions[idx + 2]
  }
  normalize_into(sum_x, sum_y, sum_z, candidates, candidates, 3)
  let [best_x, best_y, best_z] = [pref_x, pref_y, pref_z]
  let best_score = -Infinity
  const unit = unit_scratch
  for (let cand = 0; cand < candidates.length; cand += 3) {
    normalize_into(
      candidates[cand],
      candidates[cand + 1],
      candidates[cand + 2],
      candidates,
      unit,
      0,
    )
    const [dir_x, dir_y, dir_z] = unit
    let max_bond_alignment = 0
    for (let idx = start * 3; idx < end * 3; idx += 3) {
      const alignment =
        0 + dir_x * directions[idx] + dir_y * directions[idx + 1] + dir_z * directions[idx + 2]
      max_bond_alignment = Math.max(max_bond_alignment, Math.max(0, alignment))
    }
    const preferred_bonus = Math.max(0, 0 + dir_x * pref_x + dir_y * pref_y + dir_z * pref_z)
    const screen_plane_bonus = Math.abs(dir_z) < LABEL_OFFSET_EPS ? 0.02 : 0
    const score = -max_bond_alignment + preferred_bonus * 0.05 + screen_plane_bonus
    if (score <= best_score + LABEL_OFFSET_EPS) continue
    best_score = score
    ;[best_x, best_y, best_z] = [dir_x, dir_y, dir_z]
  }
  return [best_x * offset_length, best_y * offset_length, best_z * offset_length]
}

// Candidate directions for choose_offset: the normalized preferred direction, a slot for the
// per-site repulsion direction, then LABEL_OFFSET_DIRECTIONS
const offset_candidates = (base_offset: Vec3): Float64Array => {
  const candidates = new Float64Array(3 * (2 + LABEL_OFFSET_DIRECTIONS.length))
  normalize_into(...base_offset, [0, 1, 0], candidates, 0)
  for (const [idx, direction] of LABEL_OFFSET_DIRECTIONS.entries())
    candidates.set(direction, 3 * (idx + 2))
  return candidates
}

export const choose_site_label_offset = (bond_directions: Vec3[], base_offset: Vec3): Vec3 =>
  choose_offset(
    Float64Array.from(bond_directions.flat()),
    0,
    bond_directions.length,
    base_offset,
    offset_candidates(base_offset),
  )

// Per-site label offsets turned away from each site's bonds (both ends of every bond). Sites
// without bonds are absent and keep base_offset. Plain Map: built and consumed inside
// deriveds, so per-entry reactivity would only add signal overhead for thousands of sites.
// Reads packed bond columns directly and groups directions per site in one flat buffer.
export function site_label_offsets(bonds: BondData, base_offset: Vec3): Map<number, Vec3> {
  const n_bonds = bonds.length
  // Unit direction away from each end: slot 2 * bond for site_1, 2 * bond + 1 for site_2
  const end_dirs = new Float64Array(n_bonds * 6)
  const end_site = new Int32Array(n_bonds * 2).fill(-1) // -1: zero-length bond, no direction
  const [start, end]: [Vec3, Vec3] = [
    [0, 0, 0],
    [0, 0, 0],
  ]
  const zero = [0, 0, 0]
  for (let idx = 0; idx < n_bonds; idx++) {
    let [pos_1, pos_2] = [start, end]
    if (bonds instanceof BondFrame) bonds.write_endpoints(idx, start, end)
    else [pos_1, pos_2] = [bonds[idx].pos_1, bonds[idx].pos_2]
    const [delta_x, delta_y, delta_z] = [
      pos_2[0] - pos_1[0],
      pos_2[1] - pos_1[1],
      pos_2[2] - pos_1[2],
    ]
    if (Math.sqrt(0 + delta_x * delta_x + delta_y * delta_y + delta_z * delta_z) < math.EPS)
      continue
    normalize_into(delta_x, delta_y, delta_z, zero, end_dirs, idx * 6)
    normalize_into(-delta_x, -delta_y, -delta_z, zero, end_dirs, idx * 6 + 3)
    end_site[idx * 2] = bond_site_1(bonds, idx)
    end_site[idx * 2 + 1] = bond_site_2(bonds, idx)
  }
  // Group bond ends by site in order of first appearance, each site's ends in bond order
  const site_slot = new Map<number, number>()
  const counts: number[] = []
  for (const site_idx of end_site) {
    if (site_idx < 0) continue
    const slot = site_slot.get(site_idx)
    if (slot === undefined) {
      site_slot.set(site_idx, counts.length)
      counts.push(1)
    } else counts[slot]++
  }
  const starts = new Int32Array(counts.length + 1)
  for (const [slot, count] of counts.entries()) starts[slot + 1] = starts[slot] + count
  const fill = starts.slice(0, -1)
  const grouped = new Float64Array(starts[counts.length] * 3)
  for (const [end_idx, site_idx] of end_site.entries()) {
    if (site_idx < 0) continue
    const target = fill[site_slot.get(site_idx) ?? 0]++ * 3
    for (let axis = 0; axis < 3; axis++) grouped[target + axis] = end_dirs[end_idx * 3 + axis]
  }
  const candidates = offset_candidates(base_offset)
  const offsets = new Map<number, Vec3>()
  for (const [site_idx, slot] of site_slot) {
    offsets.set(
      site_idx,
      choose_offset(grouped, starts[slot], starts[slot + 1], base_offset, candidates),
    )
  }
  return offsets
}

export type LabelPlacement = {
  x: number
  y: number
  visible: boolean // false when the label anchor is behind the camera
}

// Per-frame screen projector for label overlays. `update()` precomputes the combined
// model-view-projection once per frame; `place()` then resolves each label with a single
// clip-space transform and zero allocations, since labels run per site per frame. A label
// sits `atom_screen_radius + margin` px from the atom center along the screen direction
// of its offset. The projected radius is measured along the
// camera's right axis, which for both projections equals
// visual_radius * projection[5] * (height/2) / clip_w.
export class LabelProjector {
  readonly #mvp = new Matrix4() // projection * view * anchor (local -> clip space)
  readonly #view = new Matrix4() // view * anchor (local -> view space, for behind-camera test)
  #half_width = 0
  #half_height = 0
  #radius_scale = 0 // clip-space multiplier for projected atom radius
  #margin = 0

  update(
    camera: Camera,
    anchor_world_matrix: Matrix4,
    size: { width: number; height: number },
    margin: number,
  ): void {
    this.#view.multiplyMatrices(camera.matrixWorldInverse, anchor_world_matrix)
    this.#mvp.multiplyMatrices(camera.projectionMatrix, this.#view)
    this.#half_width = size.width / 2
    this.#half_height = size.height / 2
    // projectionMatrix[5] = cot(fov/2) for perspective, 2/(top-bottom) for ortho
    this.#radius_scale = camera.projectionMatrix.elements[5] * this.#half_height
    this.#margin = margin
  }

  // position + offset: label anchor and preferred direction in anchor-local
  // space; visual_radius: atom radius in the same units
  place(position: Vec3, offset: Vec3, visual_radius: number, out: LabelPlacement): void {
    const [pos_x, pos_y, pos_z] = position
    const mvp = this.#mvp.elements
    const view = this.#view.elements

    // Behind-camera test in view space (camera looks down -z)
    const view_z = view[2] * pos_x + view[6] * pos_y + view[10] * pos_z + view[14]
    if (view_z > 0) {
      out.visible = false
      return
    }

    const clip_x = mvp[0] * pos_x + mvp[4] * pos_y + mvp[8] * pos_z + mvp[12]
    const clip_y = mvp[1] * pos_x + mvp[5] * pos_y + mvp[9] * pos_z + mvp[13]
    const clip_w = mvp[3] * pos_x + mvp[7] * pos_y + mvp[11] * pos_z + mvp[15]
    const screen_x = (clip_x / clip_w) * this.#half_width + this.#half_width
    const screen_y = (-clip_y / clip_w) * this.#half_height + this.#half_height

    // Screen direction of the offset: project position + offset and take the
    // screen-space delta. Projecting the second point (instead of just rotating
    // the offset into view space) keeps perspective foreshortening exact for
    // offsets with a depth component.
    const [off_x, off_y, off_z] = offset
    const end_x = pos_x + off_x
    const end_y = pos_y + off_y
    const end_z = pos_z + off_z
    const end_clip_x = mvp[0] * end_x + mvp[4] * end_y + mvp[8] * end_z + mvp[12]
    const end_clip_y = mvp[1] * end_x + mvp[5] * end_y + mvp[9] * end_z + mvp[13]
    const end_clip_w = mvp[3] * end_x + mvp[7] * end_y + mvp[11] * end_z + mvp[15]
    const delta_x = (end_clip_x / end_clip_w) * this.#half_width + this.#half_width - screen_x
    const delta_y =
      (-end_clip_y / end_clip_w) * this.#half_height + this.#half_height - screen_y
    const dir_len = Math.hypot(delta_x, delta_y)
    // Offsets along the view axis have no screen direction; nudge upward (screen y grows
    // downward)
    const dir_x = dir_len > LABEL_OFFSET_EPS ? delta_x / dir_len : 0
    const dir_y = dir_len > LABEL_OFFSET_EPS ? delta_y / dir_len : off_y >= 0 ? -1 : 1

    const atom_screen_radius = (visual_radius * this.#radius_scale) / clip_w
    const screen_gap = Math.abs(atom_screen_radius) + this.#margin

    out.x = screen_x + dir_x * screen_gap
    out.y = screen_y + dir_y * screen_gap
    out.visible = true
  }
}
