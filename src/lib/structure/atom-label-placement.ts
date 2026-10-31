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

// Unit candidate directions for a label offset as flat xyz triples: the preferred direction
// (base_offset's), a slot for each site's repulsion direction, then LABEL_OFFSET_DIRECTIONS
const offset_candidates = (base_offset: Vec3): number[] => {
  const preferred = math.normalize_vec(base_offset, [0, 1, 0])
  const others = LABEL_OFFSET_DIRECTIONS.map((direction) => math.normalize_vec(direction))
  return [preferred, preferred, ...others].flat()
}

// Label offset for one site from its unit bond directions (flat xyz triples): among the
// candidates, the one least aligned with any bond (small bonuses for the preferred direction
// and the screen plane). Scalar math on flat arrays: this runs for every bonded site of a
// structure whose labels are shown.
function choose_offset(
  directions: readonly number[],
  base_offset: Vec3,
  candidates = offset_candidates(base_offset),
): Vec3 {
  const offset_length = Math.hypot(...base_offset)
  if (offset_length < LABEL_OFFSET_EPS || directions.length === 0) return base_offset
  const [pref_x, pref_y, pref_z] = candidates
  // repulsion: minus the sum of the bond directions (the preferred one where they cancel)
  let [sum_x, sum_y, sum_z] = [0, 0, 0]
  for (let idx = 0; idx < directions.length; idx += 3) {
    sum_x -= directions[idx]
    sum_y -= directions[idx + 1]
    sum_z -= directions[idx + 2]
  }
  // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- hypot is slower
  const sum_len = Math.sqrt(sum_x * sum_x + sum_y * sum_y + sum_z * sum_z)
  const short = sum_len < math.EPS
  candidates[3] = short ? pref_x : sum_x / sum_len
  candidates[4] = short ? pref_y : sum_y / sum_len
  candidates[5] = short ? pref_z : sum_z / sum_len
  let [best_x, best_y, best_z, best_score] = [pref_x, pref_y, pref_z, -Infinity]
  for (let cand = 0; cand < candidates.length; cand += 3) {
    const [dir_x, dir_y, dir_z] = [
      candidates[cand],
      candidates[cand + 1],
      candidates[cand + 2],
    ]
    let max_bond_alignment = 0
    for (let idx = 0; idx < directions.length; idx += 3) {
      const alignment =
        dir_x * directions[idx] + dir_y * directions[idx + 1] + dir_z * directions[idx + 2]
      max_bond_alignment = Math.max(max_bond_alignment, alignment)
    }
    const preferred_bonus = Math.max(0, dir_x * pref_x + dir_y * pref_y + dir_z * pref_z)
    const screen_plane_bonus = Math.abs(dir_z) < LABEL_OFFSET_EPS ? 0.02 : 0
    const score = -max_bond_alignment + preferred_bonus * 0.05 + screen_plane_bonus
    if (score <= best_score + LABEL_OFFSET_EPS) continue
    ;[best_x, best_y, best_z, best_score] = [dir_x, dir_y, dir_z, score]
  }
  return [best_x * offset_length, best_y * offset_length, best_z * offset_length]
}

export const choose_site_label_offset = (bond_directions: Vec3[], base_offset: Vec3): Vec3 =>
  choose_offset(bond_directions.flat(), base_offset)

// Per-site label offsets turned away from each site's bonds (both ends of every bond). Sites
// without bonds are absent and keep base_offset. Plain Map: built and consumed inside
// deriveds, so per-entry reactivity would only add signal overhead for thousands of sites.
// Reads packed bond columns directly, without expanding a BondFrame into records.
export function site_label_offsets(bonds: BondData, base_offset: Vec3): Map<number, Vec3> {
  // unit directions away from each bonded site, flat xyz triples in bond order
  const directions = new Map<number, number[]>()
  const add = (site_idx: number, x_val: number, y_val: number, z_val: number): void => {
    const site_dirs = directions.get(site_idx)
    if (site_dirs) site_dirs.push(x_val, y_val, z_val)
    else directions.set(site_idx, [x_val, y_val, z_val])
  }
  const [start, end]: [Vec3, Vec3] = [
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let idx = 0; idx < bonds.length; idx++) {
    let [pos_1, pos_2] = [start, end]
    if (bonds instanceof BondFrame) bonds.write_endpoints(idx, start, end)
    else [pos_1, pos_2] = [bonds[idx].pos_1, bonds[idx].pos_2]
    const [delta_x, delta_y, delta_z] = [
      pos_2[0] - pos_1[0],
      pos_2[1] - pos_1[1],
      pos_2[2] - pos_1[2],
    ]
    // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- hypot is slower
    const len = Math.sqrt(delta_x * delta_x + delta_y * delta_y + delta_z * delta_z)
    if (len < math.EPS) continue // a zero-length bond points nowhere
    const [dir_x, dir_y, dir_z] = [delta_x / len, delta_y / len, delta_z / len]
    add(bond_site_1(bonds, idx), dir_x, dir_y, dir_z)
    add(bond_site_2(bonds, idx), -dir_x, -dir_y, -dir_z)
  }
  const candidates = offset_candidates(base_offset)
  const offsets = new Map<number, Vec3>()
  for (const [site_idx, site_dirs] of directions)
    offsets.set(site_idx, choose_offset(site_dirs, base_offset, candidates))
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
