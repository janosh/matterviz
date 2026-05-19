import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Camera, Object3D } from 'three'
import { Vector3 } from 'three'

export const LABEL_OFFSET_EPS = 1e-9
type LabelOffsetSource = Vec3 | (() => Vec3)

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

  const preferred_direction = math.normalize_vec3(base_offset, [0, 1, 0])
  const repulsion_direction = math.normalize_vec3(
    bond_directions.reduce(
      (offset_sum, bond_direction) => math.subtract(offset_sum, bond_direction),
      [0, 0, 0] as Vec3,
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
    const direction = math.normalize_vec3(candidate_direction, preferred_direction)
    const score = label_direction_score(direction, bond_directions, preferred_direction)
    if (score <= best_score + LABEL_OFFSET_EPS) continue
    best_score = score
    best_direction = direction
  }
  return math.scale(best_direction, offset_length)
}

const project_to_screen = (
  position: Vec3,
  label_camera: Camera,
  size: { width: number; height: number },
): [number, number] => {
  const projected = new Vector3(...position).project(label_camera)
  return [
    (projected.x * size.width) / 2 + size.width / 2,
    (-projected.y * size.height) / 2 + size.height / 2,
  ]
}

export const label_screen_position = (
  atom_position: Vec3,
  label_offset: Vec3,
  visual_radius: number,
  label_screen_margin: number,
  label_camera: Camera,
  size: { width: number; height: number },
): [number, number] => {
  const atom_screen = project_to_screen(atom_position, label_camera, size)
  const offset_screen = project_to_screen(
    math.add(atom_position, label_offset),
    label_camera,
    size,
  )
  const offset_x = offset_screen[0] - atom_screen[0]
  const offset_y = offset_screen[1] - atom_screen[1]
  const offset_length = Math.hypot(offset_x, offset_y)
  const direction_x = offset_length > LABEL_OFFSET_EPS ? offset_x / offset_length : 0
  const direction_y =
    offset_length > LABEL_OFFSET_EPS ? offset_y / offset_length : label_offset[1] >= 0 ? -1 : 1
  const radius_direction = math.normalize_vec3(label_offset, [0, 1, 0])
  const radius_edge = math.add(atom_position, math.scale(radius_direction, visual_radius))
  const radius_screen = project_to_screen(radius_edge, label_camera, size)
  const atom_screen_radius = Math.hypot(
    radius_screen[0] - atom_screen[0],
    radius_screen[1] - atom_screen[1],
  )
  const screen_gap = atom_screen_radius + label_screen_margin

  return [atom_screen[0] + direction_x * screen_gap, atom_screen[1] + direction_y * screen_gap]
}

export const make_label_position_calculator =
  (
    _atom_position: Vec3,
    label_offset: LabelOffsetSource,
    visual_radius: number,
    label_screen_margin: number,
  ) =>
  (object: Object3D, label_camera: Camera, size: { width: number; height: number }) => {
    const world_position = object.getWorldPosition(new Vector3())
    return label_screen_position(
      [world_position.x, world_position.y, world_position.z],
      typeof label_offset === `function` ? label_offset() : label_offset,
      visual_radius,
      label_screen_margin,
      label_camera,
      size,
    )
  }
