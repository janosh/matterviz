import type { Vec3 } from '$lib/math'
import type { BondOrder, BondPair } from '$lib/structure'
import {
  count_bond_instances,
  bond_neighbors,
  instance_count_for_order,
  BondFrame,
  pack_bonds,
  prepare_bond_placements,
  write_bond_transform,
} from '$lib/structure/bond-rendering'
import {
  arrow_axis_geometry,
  cylinder_between,
  quaternion_from_direction,
  rotation_from_direction,
} from '$lib/structure/geometry'
import { Euler, Matrix4, Vector3 } from 'three/webgpu'
import { SvelteSet } from 'svelte/reactivity'
import { describe, expect, test, vi } from 'vitest'
import { create_numeric_md_frame, FrameView } from '$lib/trajectory/frame'
import { BondMesh } from '$lib/structure/bond-mesh'

const RADIAL_MATRIX_COMPONENTS = [0, 2, 8, 9, 10] as const

test.each([
  [0, [1, 1, 0]],
  [1, [0, 0, 2]],
  [2, [1]],
  [3, []],
] as const)(
  `reads atom %i's neighbors without expanding packed bonds`,
  (site_idx, expected) => {
    const bonds: BondPair[] = [
      [0, 1],
      [1, 0],
      [0, 0],
      [1, 2],
    ].map(([first, second]) => ({
      site_idx_1: first,
      site_idx_2: second,
      pos_1: [0, 0, 0],
      pos_2: [1, 0, 0],
      bond_length: 1,
    }))
    const packed = new BondFrame({ sites: [] }, pack_bonds(bonds))
    const materialize = vi.spyOn(packed, `materialize`)
    expect(bond_neighbors(bonds, site_idx)).toEqual(expected)
    expect(bond_neighbors(packed, site_idx)).toEqual(expected)
    expect(materialize).not.toHaveBeenCalled()
  },
)

const scale_and_offset_matrix = (
  matrix_buffer: Float32Array,
  instance_idx: number,
  offset: number,
  radius_scale: number,
): void => {
  const matrix_offset = instance_idx * 16
  for (const component_idx of RADIAL_MATRIX_COMPONENTS) {
    matrix_buffer[matrix_offset + component_idx] *= radius_scale
  }

  const right_x = matrix_buffer[matrix_offset]
  const right_z = matrix_buffer[matrix_offset + 2]
  const right_length = Math.hypot(right_x, right_z) || 1
  matrix_buffer[matrix_offset + 12] += (right_x / right_length) * offset
  matrix_buffer[matrix_offset + 14] += (right_z / right_length) * offset
}

// Reference placement from the previous matrix renderer, including multiple-bond offsets.
function write_reference_bonds(
  matrix_buffer: Float32Array,
  bonds: readonly BondPair[],
  bond_thickness: number,
  required_count: number,
): void {
  if (matrix_buffer.length < required_count * 16) {
    throw new RangeError(
      `Bond matrix buffer has ${matrix_buffer.length} floats, needs ${required_count * 16}`,
    )
  }

  let instance_idx = 0
  const gap = bond_thickness * 1.8
  for (const { pos_1, pos_2, bond_order } of bonds) {
    write_bond_transform(matrix_buffer, instance_idx, pos_1, pos_2, bond_thickness)
    const instance_count = instance_count_for_order(bond_order)
    const source_offset = instance_idx * 16
    for (let copy_idx = 1; copy_idx < instance_count; copy_idx++) {
      matrix_buffer.copyWithin(
        (instance_idx + copy_idx) * 16,
        source_offset,
        source_offset + 16,
      )
    }

    if (bond_order === 2) {
      scale_and_offset_matrix(matrix_buffer, instance_idx, -gap / 2, 0.65)
      scale_and_offset_matrix(matrix_buffer, instance_idx + 1, gap / 2, 0.65)
    } else if (bond_order === 3) {
      scale_and_offset_matrix(matrix_buffer, instance_idx, -gap, 0.55)
      scale_and_offset_matrix(matrix_buffer, instance_idx + 1, 0, 0.55)
      scale_and_offset_matrix(matrix_buffer, instance_idx + 2, gap, 0.55)
    } else if (bond_order === 1.5 || bond_order === `aromatic`) {
      scale_and_offset_matrix(matrix_buffer, instance_idx, -gap / 2, 0.75)
      scale_and_offset_matrix(matrix_buffer, instance_idx + 1, gap / 2, 0.4)
    }
    instance_idx += instance_count
  }
}

describe(`quaternion_from_direction`, () => {
  test.each([
    [`+Y axis`, [0, 1, 0]],
    [`zero-length → identity`, [0, 0, 0]],
    [`non-unit +Y → normalized to identity`, [0, 5, 0]],
  ] as [string, Vec3][])(`%s`, (_desc, dir) => {
    const quat = quaternion_from_direction(dir)
    expect([quat.x, quat.y, quat.z, quat.w]).toEqual([0, 0, 0, 1])
  })

  test.each([[[1, 0, 0]], [[0, 0, 1]], [[1, 1, 1]], [[-2, 3, -1]]] as [Vec3][])(
    `rotates +Y onto the (normalized) direction %j`,
    (dir) => {
      const rotated = new Vector3(0, 1, 0).applyQuaternion(quaternion_from_direction(dir))
      expect(rotated.distanceTo(new Vector3(...dir).normalize())).toBeCloseTo(0, 10)
    },
  )
})

describe(`rotation_from_direction`, () => {
  test.each([
    [`+Y`, [0, 1, 0]],
    [`zero-length`, [0, 0, 0]],
  ] as [string, Vec3][])(`%s → no rotation`, (_desc, dir) => {
    rotation_from_direction(dir).forEach((val) => expect(val).toBeCloseTo(0, 12))
  })

  test(`euler aligns a +Y vector with the direction`, () => {
    const dir: Vec3 = [1, 2, -2]
    const aligned = new Vector3(0, 1, 0).applyEuler(new Euler(...rotation_from_direction(dir)))
    expect(aligned.distanceTo(new Vector3(...dir).normalize())).toBeCloseTo(0, 10)
  })
})

test.each([
  [[1, 1, 1], 0.5, 0.8],
  [[0, 3, 4], 2, -0.1],
] as [Vec3, number, number][])(
  `arrow shaft and head meet for vector $0`,
  (vector, scale, arrow_head_length) => {
    const { head_center, head_length, shaft_length } = arrow_axis_geometry(
      vector,
      scale,
      arrow_head_length,
    )
    expect(head_center - head_length * 0.5).toBe(shaft_length)
  },
)

test.each([
  [`zero vector`, [0, 0, 0], 1],
  [`zero scale`, [1, 2, 3], 0],
  [`non-finite vector`, [Number.NaN, 0, 0], 1],
  [`non-finite scale`, [1, 2, 3], Number.NaN],
] as [string, Vec3, number][])(`collapses arrow geometry for %s`, (_name, vector, scale) => {
  expect(arrow_axis_geometry(vector, scale, 0.8)).toEqual({
    head_length: 0,
    shaft_length: 0,
    shaft_center: 0,
    head_center: 0,
    rotation: [0, 0, 0],
  })
})

describe(`cylinder_between`, () => {
  test.each([
    [[0, 0, 0], [0, 4, 0], [0, 2, 0], 4],
    [[0, 0, 0], [3, 4, 0], [1.5, 2, 0], 5], // 3-4-5 triangle
    [[1, 2, 3], [1, 2, 3], [1, 2, 3], 0], // coincident → zero length
  ] as [Vec3, Vec3, Vec3, number][])(
    `%j → %j: midpoint %j, length %d`,
    (from, target, mid, len) => {
      const { position, rotation, length } = cylinder_between(from, target)
      position.forEach((val, idx) => expect(val).toBeCloseTo(mid[idx], 10))
      expect(length).toBeCloseTo(len, 10)
      const half = new Vector3(0, length / 2, 0).applyEuler(new Euler(...rotation))
      const center = new Vector3(...position)
      expect(
        center
          .clone()
          .sub(half)
          .distanceTo(new Vector3(...from)),
      ).toBeCloseTo(0, 10)
      expect(
        center
          .clone()
          .add(half)
          .distanceTo(new Vector3(...target)),
      ).toBeCloseTo(0, 10)
    },
  )

  test(`coincident endpoints yield identity rotation (no NaN)`, () => {
    cylinder_between([1, 2, 3], [1, 2, 3]).rotation.forEach((val) =>
      expect(val).toBeCloseTo(0, 12),
    )
  })
})

// The direct buffer writer is a separate, three.js-object-free "+Y → direction"
// implementation for the instanced-bond hot loop. Guard against convention drift.
describe(`write_bond_transform vs quaternion_from_direction`, () => {
  test(`collapses coincident bonds at their shared position`, () => {
    const matrix_buffer = new Float32Array(16).fill(Number.NaN)
    write_bond_transform(matrix_buffer, 0, [1, 2, 3], [1, 2, 3])
    expect(Array.from(matrix_buffer)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1])
  })

  test.each([
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
    [
      [0, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 0],
    ], // +Y special case
    [
      [0, 0, 0],
      [0, -1, 0],
    ], // -Y special case
    [
      [1, 1, 1],
      [2, 3, -1],
    ],
    [
      [-2, 0, 3],
      [-5, -4, 1],
    ],
  ] as [Vec3, Vec3][])(`uses a right-handed +Y orientation for %j → %j`, (start, end) => {
    // image of +Y under the bond transform (transformDirection strips translation + scale)
    const matrix_buffer = new Float32Array(16).fill(Number.NaN)
    write_bond_transform(matrix_buffer, 0, start, end)
    const mat = new Matrix4().fromArray(matrix_buffer)
    const bond_dir = new Vector3(0, 1, 0).transformDirection(mat)
    const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
    const helper_dir = new Vector3(0, 1, 0).applyQuaternion(quaternion_from_direction(delta))
    expect(bond_dir.distanceTo(helper_dir)).toBeCloseTo(0, 10)
    const expected_determinant = Math.hypot(...delta)
    expect(Math.abs(mat.determinant() / expected_determinant - 1)).toBeLessThan(4 * 2 ** -23)
  })

  test.each([
    { order: undefined, expected_count: 1, expected_radius: 0.1 },
    { order: 1, expected_count: 1, expected_radius: 0.1 },
    { order: 2, expected_count: 2, expected_radius: 0.065 },
    { order: 3, expected_count: 3, expected_radius: 0.055 },
    { order: 1.5, expected_count: 2, expected_radius: 0.075 },
    { order: `aromatic`, expected_count: 2, expected_radius: 0.075 },
  ] satisfies { order?: BondOrder; expected_count: number; expected_radius: number }[])(
    `packs $order bond order as $expected_count cylinder matrices`,
    ({ order, expected_count, expected_radius }) => {
      const bond: BondPair = {
        pos_1: [0, 0, 0],
        pos_2: [1, 0, 0],
        site_idx_1: 0,
        site_idx_2: 1,
        bond_length: 1,
        ...(order === undefined ? {} : { bond_order: order }),
      }
      const matrix_buffer = new Float32Array(3 * 16).fill(Number.NaN)

      expect(count_bond_instances([bond])).toBe(expected_count)
      write_reference_bonds(matrix_buffer, [bond], 0.1, expected_count)
      const structure = new FrameView().update(
        create_numeric_md_frame(
          new Float64Array([...bond.pos_1, ...bond.pos_2]),
          new Uint8Array([6, 6]),
          undefined,
          undefined,
          0,
          {},
          [],
        ),
      ).structure
      for (const cell_shift of [undefined, [1, -2, 3] as Vec3]) {
        const source = cell_shift ? { ...bond, cell_shift, pos_2: [5, 6, 7] as Vec3 } : bond
        const packed = new BondFrame(structure, pack_bonds([source]))
        const materialize = vi.spyOn(packed, `materialize`)
        const expected = new Float32Array(expected_count * 16)
        expect(count_bond_instances(packed)).toBe(expected_count)
        write_reference_bonds(expected, [source], 0.1, expected_count)
        const mesh = new BondMesh(undefined, undefined, expected_count)
        const placements = prepare_bond_placements(packed)
        const prepared = new BondFrame(structure, packed.columns, placements)
        expect(count_bond_instances(prepared)).toBe(expected_count)
        expect(placements.max_site_idx).toBe(1)
        mesh.update(placements)
        mesh.thickness = 0.1
        const matrix = new Matrix4()
        for (let idx = 0; idx < expected_count; idx++) {
          mesh.getMatrixAt(idx, matrix)
          for (let component = 0; component < 16; component++) {
            const reference = expected[idx * 16 + component]
            // f32 center, displacement and radius are rounded before the basis is rebuilt.
            expect(Math.abs(matrix.elements[component] - reference)).toBeLessThanOrEqual(
              8 * 2 ** -23 * Math.max(1, Math.abs(reference)),
            )
          }
        }
        const captured = mesh.clone()
        mesh.centers.setXYZ(0, 99, 99, 99)
        expect(captured.centers.array).not.toEqual(mesh.centers.array)
        captured.dispose()
        mesh.dispose()
        expect(materialize).not.toHaveBeenCalled()
        expect(packed.materialize()).toEqual([source])
      }
      expect(Math.hypot(matrix_buffer[0], matrix_buffer[1], matrix_buffer[2])).toBeCloseTo(
        expected_radius,
        7,
      )
      if (expected_count > 1) {
        const offsets = Array.from(
          { length: expected_count },
          (_, instance_idx) => matrix_buffer[instance_idx * 16 + 14],
        )
        expect(new SvelteSet(offsets).size).toBe(expected_count)
      }
    },
  )

  test(`fails before writing when the instance buffer is undersized`, () => {
    const bond: BondPair = {
      pos_1: [0, 0, 0],
      pos_2: [1, 0, 0],
      site_idx_1: 0,
      site_idx_2: 1,
      bond_length: 1,
      bond_order: 3,
    }
    expect(() =>
      new BondMesh(undefined, undefined, 2).update(prepare_bond_placements([bond])),
    ).toThrow(`Bond capacity 2 cannot hold 3 instances`)
  })
  test.each([
    [0, 0, 0],
    [0, -2, 0],
    [1e-6, 2, 0],
    [1e-4, 2, 0],
    [1, -2, 3],
  ] as Vec3[])(`keeps compact bond basis for displacement %j`, (...delta) => {
    const pos_1: Vec3 = [1024, -2048, 4096]
    const bond: BondPair = {
      pos_1,
      pos_2: delta.map((value, axis) => pos_1[axis] + value) as Vec3,
      site_idx_1: 0,
      site_idx_2: 1,
      bond_length: Math.hypot(...delta),
    }
    for (const order of [undefined, 1, 1.5, 2, 3, `aromatic`] as const) {
      const source = { ...bond, bond_order: order }
      const placements = prepare_bond_placements([source])
      const mesh = new BondMesh(undefined, undefined, placements.instance_count)
      mesh.update(placements)
      const captured_sizes = mesh.sizes.array.slice()
      const expected = new Float32Array(placements.instance_count * 16)
      const matrix = new Matrix4()
      for (const thickness of [-0.1, 0, 0.1]) {
        mesh.thickness = thickness
        write_reference_bonds(expected, [source], thickness, placements.instance_count)
        for (let idx = 0; idx < placements.instance_count; idx++) {
          mesh.getMatrixAt(idx, matrix)
          for (let component = 0; component < 16; component++) {
            const reference = expected[idx * 16 + component]
            // Eight f32 eps cover stored center/delta/unit sizes, uniform scaling and the
            // reconstructed basis; absolute tolerance handles zero/near-zero components.
            expect(Math.abs(matrix.elements[component] - reference)).toBeLessThanOrEqual(
              8 * 2 ** -23 * Math.max(1, Math.abs(reference)),
            )
          }
        }
        expect(mesh.sizes.array).toEqual(captured_sizes)
        const captured = mesh.clone()
        mesh.thickness = 9
        expect(captured.thickness).toBe(thickness)
        captured.dispose()
      }
      expect(Array.from(mesh.deltas.array.slice(0, 3))).toEqual(
        bond.pos_2.map((value, axis) => Math.fround(value - pos_1[axis])),
      )
      mesh.dispose()
    }
  })
})
