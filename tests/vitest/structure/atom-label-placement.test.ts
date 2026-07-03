import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  choose_site_label_offset,
  type LabelPlacement,
  LabelProjector,
} from '$lib/structure/atom-label-placement'
import type { Camera } from 'three'
import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, test } from 'vitest'

const expectVecClose = (actual: Vec3, expected: Vec3): void => {
  for (const [idx, val] of actual.entries()) {
    expect(val).toBeCloseTo(expected[idx])
  }
}

describe(`label placement`, () => {
  test(`keeps configured label offset when site has no bonds`, () => {
    const base_offset: Vec3 = [0, 0.5, 0]

    expect(choose_site_label_offset([], base_offset)).toBe(base_offset)
  })

  test(`moves label away from a bond aligned with the default upward offset`, () => {
    const base_offset: Vec3 = [0, 0.5, 0]
    const bond_directions: Vec3[] = [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]

    const offset = choose_site_label_offset(bond_directions, base_offset)

    expectVecClose(offset, [0, -0.5, 0])
  })

  test(`preserves label offset length when choosing another direction`, () => {
    const base_offset: Vec3 = [0, 0.5, 0]
    const bond_directions: Vec3[] = [[0, 1, 0]]

    const offset = choose_site_label_offset(bond_directions, base_offset)

    expect(Math.hypot(...offset)).toBeCloseTo(Math.hypot(...base_offset))
    expect(math.dot(math.normalize_vec(offset), [0, 1, 0])).toBeLessThan(0.5)
  })

  const make_ortho_camera = (): OrthographicCamera => {
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    return camera
  }
  const size = { width: 100, height: 100 }
  const place = (
    projector: LabelProjector,
    position: Vec3,
    offset: Vec3,
    radius: number,
  ): LabelPlacement => {
    const placement: LabelPlacement = { x: 0, y: 0, visible: false }
    projector.place(position, offset, radius, placement)
    return placement
  }

  test(`view-axis label offsets keep full screen clearance from the atom`, () => {
    const projector = new LabelProjector()
    projector.update(make_ortho_camera(), new Matrix4(), size, 4)
    // camera frustum spans 2 world units over 100 px, so radius 0.5 projects to 25 px
    const projected_radius = 25

    // in-plane offset: clearance = projected radius + margin
    const above = place(projector, [0, 0, 0], [0, 0.5, 0], 0.5)
    expect(above.visible).toBe(true)
    expect(above.x).toBeCloseTo(50)
    expect(Math.abs(above.y - 50)).toBeCloseTo(projected_radius + 4)

    // offset along the view axis must yield the SAME clearance (regression: the radius
    // used to be measured along the 3D offset, collapsing to ~0 for view-axis offsets)
    const view_axis = place(projector, [0, 0, 0], [0, 0, 0.5], 0.5)
    expect(Math.abs(view_axis.y - 50)).toBeCloseTo(projected_radius + 4)
  })

  test(`labels behind the camera are hidden`, () => {
    const projector = new LabelProjector()
    projector.update(make_ortho_camera(), new Matrix4(), size, 0)
    expect(place(projector, [0, 0, 10], [0, 0.5, 0], 0.5).visible).toBe(false)
    expect(place(projector, [0, 0, 0], [0, 0.5, 0], 0.5).visible).toBe(true)
  })

  test(`perspective projection places labels at projected screen position`, () => {
    const camera = new PerspectiveCamera(90, 1, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    const projector = new LabelProjector()
    projector.update(camera, new Matrix4(), size, 0)

    // fov 90 at distance 5 spans 10 world units over 100 px => 10 px per unit.
    // Atom at x=1 projects to 50 + 10 = 60 px; radius 0.5 projects to 5 px.
    const placement = place(projector, [1, 0, 0], [1, 0, 0], 0.5)
    expect(placement.visible).toBe(true)
    expect(placement.x).toBeCloseTo(60 + 5)
    expect(placement.y).toBeCloseTo(50)
  })

  // Straightforward Vector3.project implementation of the same placement
  // semantics, used as ground truth for the optimized single-MVP fast path
  const reference_place = (
    camera: Camera,
    anchor: Matrix4,
    view_size: { width: number; height: number },
    margin: number,
    position: Vec3,
    offset: Vec3,
    radius: number,
  ): LabelPlacement => {
    const to_screen = (local: Vec3): [number, number] => {
      const projected = new Vector3(...local).applyMatrix4(anchor).project(camera)
      return [
        (projected.x * view_size.width) / 2 + view_size.width / 2,
        (-projected.y * view_size.height) / 2 + view_size.height / 2,
      ]
    }
    const world = new Vector3(...position).applyMatrix4(anchor)
    const cam_pos = new Vector3().setFromMatrixPosition(camera.matrixWorld)
    const cam_dir = camera.getWorldDirection(new Vector3())
    if (world.clone().sub(cam_pos).dot(cam_dir) <= 0) return { x: 0, y: 0, visible: false }

    const atom = to_screen(position)
    const end = to_screen(math.add(position, offset))
    const [delta_x, delta_y] = [end[0] - atom[0], end[1] - atom[1]]
    const delta_len = Math.hypot(delta_x, delta_y)
    const [dir_x, dir_y] =
      delta_len > 1e-9
        ? [delta_x / delta_len, delta_y / delta_len]
        : [0, offset[1] >= 0 ? -1 : 1]
    // projected atom radius, measured along the camera's right axis in world space
    const right = new Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize()
      .multiplyScalar(radius)
      .add(world)
      .project(camera)
    const edge_x = (right.x * view_size.width) / 2 + view_size.width / 2
    const edge_y = (-right.y * view_size.height) / 2 + view_size.height / 2
    const screen_radius = Math.hypot(edge_x - atom[0], edge_y - atom[1])
    return {
      x: atom[0] + dir_x * (screen_radius + margin),
      y: atom[1] + dir_y * (screen_radius + margin),
      visible: true,
    }
  }

  const make_rotated_perspective = (): PerspectiveCamera => {
    const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 100)
    camera.position.set(7, 5, 9)
    camera.lookAt(1, -1, 0)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    return camera
  }
  const make_rotated_ortho = (): OrthographicCamera => {
    const aspect = 800 / 600
    const camera = new OrthographicCamera(-6 * aspect, 6 * aspect, 6, -6, 0.1, 100)
    camera.position.set(7, 5, 9)
    camera.lookAt(1, -1, 0)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    return camera
  }
  // rotation + translation anchor (matches the scene's nested rotation groups)
  const rotated_anchor = new Matrix4()
    .makeRotationY(0.7)
    .multiply(new Matrix4().makeRotationX(-0.3))
    .setPosition(1, 2, 3)

  test.each([
    [`perspective`, make_rotated_perspective],
    [`orthographic`, make_rotated_ortho],
  ] as const)(
    `%s fast path matches Vector3.project reference for rotated camera + anchor`,
    (_kind, make_camera) => {
      const camera = make_camera()
      const view_size = { width: 800, height: 600 }
      const projector = new LabelProjector()
      projector.update(camera, rotated_anchor, view_size, 14)

      const cases: { position: Vec3; offset: Vec3; radius: number }[] = [
        { position: [0, 0, 0], offset: [0, 0.5, 0], radius: 0.5 },
        // depth-component offsets exercise perspective foreshortening of the direction
        { position: [2, -1, 1.5], offset: [0.4, 0, 0.3], radius: 0.8 },
        { position: [-1.5, 2, -2], offset: [-0.3, 0.2, -0.4], radius: 0.3 },
        { position: [1, 1, 1], offset: [0, 0, 0.5], radius: 0.6 },
      ]
      for (const { position, offset, radius } of cases) {
        const actual = place(projector, position, offset, radius)
        const expected = reference_place(
          camera,
          rotated_anchor,
          view_size,
          14,
          position,
          offset,
          radius,
        )
        expect(actual.visible, `visible for ${position}`).toBe(expected.visible)
        expect(actual.x, `x for ${position}/${offset}`).toBeCloseTo(expected.x, 3)
        expect(actual.y, `y for ${position}/${offset}`).toBeCloseTo(expected.y, 3)
      }
    },
  )
})
