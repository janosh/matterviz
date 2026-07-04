import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Camera } from 'three'
import { Matrix4 } from 'three'

export const LABEL_OFFSET_EPS = 1e-9

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

const label_direction_score = (
  direction: Vec3,
  bond_directions: Vec3[],
  preferred_direction: Vec3,
): number => {
  let max_bond_alignment = 0
  for (const bond_direction of bond_directions) {
    max_bond_alignment = Math.max(
      max_bond_alignment,
      Math.max(0, math.dot(direction, bond_direction)),
    )
  }
  const preferred_bonus = Math.max(0, math.dot(direction, preferred_direction)) * 0.05
  const screen_plane_bonus = Math.abs(direction[2]) < LABEL_OFFSET_EPS ? 0.02 : 0
  return -max_bond_alignment + preferred_bonus + screen_plane_bonus
}

export const choose_site_label_offset = (bond_directions: Vec3[], base_offset: Vec3): Vec3 => {
  const offset_length = Math.hypot(...base_offset)
  if (offset_length < LABEL_OFFSET_EPS || bond_directions.length === 0) {
    return base_offset
  }

  const preferred_direction = math.normalize_vec(base_offset, [0, 1, 0])
  const repulsion_direction = math.normalize_vec(
    bond_directions.reduce<Vec3>(
      (offset_sum, bond_direction) => math.subtract(offset_sum, bond_direction),
      [0, 0, 0],
    ),
    preferred_direction,
  )
  let best_direction = preferred_direction
  let best_score = -Infinity

  for (const candidate_direction of [
    preferred_direction,
    repulsion_direction,
    ...LABEL_OFFSET_DIRECTIONS,
  ]) {
    const direction = math.normalize_vec(candidate_direction, preferred_direction)
    const score = label_direction_score(direction, bond_directions, preferred_direction)
    if (score <= best_score + LABEL_OFFSET_EPS) continue
    best_score = score
    best_direction = direction
  }
  return math.scale(best_direction, offset_length)
}

export type LabelPlacement = {
  x: number
  y: number
  visible: boolean // false when the label anchor is behind the camera
}

// Per-frame screen projector for label overlays. `update()` precomputes the
// combined model-view-projection once per frame; `place()` then resolves each
// label with a single clip-space transform and zero allocations (labels run
// per site per frame, so the old 3-projections-per-label path with fresh
// Vector3s dominated frame time on large supercells).
//
// Placement semantics match the previous label_screen_position helper: the
// label sits `atom_screen_radius + margin` px from the atom center along the
// screen direction of its offset. The projected radius is measured along the
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
    // offsets with a depth component, matching the pre-projector behavior.
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
    // Offsets along the view axis have no screen direction; nudge upward like
    // the previous implementation (screen y grows downward)
    const dir_x = dir_len > LABEL_OFFSET_EPS ? delta_x / dir_len : 0
    const dir_y = dir_len > LABEL_OFFSET_EPS ? delta_y / dir_len : off_y >= 0 ? -1 : 1

    const atom_screen_radius = (visual_radius * this.#radius_scale) / clip_w
    const screen_gap = Math.abs(atom_screen_radius) + this.#margin

    out.x = screen_x + dir_x * screen_gap
    out.y = screen_y + dir_y * screen_gap
    out.visible = true
  }
}
