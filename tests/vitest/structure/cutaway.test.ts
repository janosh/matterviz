import type { Matrix3x3, Vec3 } from '#lib/math.js'
import { cell_to_fractional, resolve_cutaway } from '#lib/structure/cutaway.js'
import { Matrix4, Vector3 } from 'three/webgpu'
import { describe, expect, test } from 'vitest'

// Triclinic cell rows (lattice vectors a, b, c)
const cell: Matrix3x3 = [
  [4, 0, 0],
  [1, 5, 0],
  [0.5, 0.5, 6],
]
const fractional = (matrix: Matrix4, point: Vec3) =>
  new Vector3(...point).applyMatrix4(matrix).toArray()

test(`cell_to_fractional maps each lattice vector, offset by the origin, to its unit axis`, () => {
  const origin: Vec3 = [1, -2, 0.5]
  const matrix = cell_to_fractional(cell, origin)
  for (const [axis, vector] of cell.entries()) {
    const unit = [0, 0, 0]
    unit[axis] = 1
    const point = vector.map((val, idx) => val + origin[idx]) as Vec3
    for (const [idx, val] of fractional(matrix, point).entries()) {
      expect(val).toBeCloseTo(unit[idx], 12)
    }
  }
  for (const val of fractional(matrix, origin)) expect(val).toBeCloseTo(0, 12)
})

describe(`resolve_cutaway`, () => {
  const slab = { mode: `slab` as const, axis: 2 as const, position: 0.5, thickness: 0.2 }

  test(`a supplied transform passes through`, () => {
    const transform = new Matrix4().makeScale(2, 2, 2)
    expect(resolve_cutaway({ ...slab, cartesian_to_fractional: transform }, cell)).toEqual({
      ...slab,
      cartesian_to_fractional: transform,
    })
  })

  // Movie configs pass plain JSON settings: they slice the displayed structure's own cell
  test(`JSON settings without a transform slice the structure's cell`, () => {
    const resolved = resolve_cutaway({ ...slab, whole_atoms: true }, cell)
    expect(resolved).toMatchObject({ ...slab, whole_atoms: true })
    if (!resolved) throw new Error(`no cutaway resolved`)
    expect(resolved.cartesian_to_fractional.elements).toEqual(
      cell_to_fractional(cell).elements,
    )
  })

  test.each([
    [`no cutaway`, undefined, cell, undefined],
    [
      `an inactive one without a cell`,
      { ...slab, mode: `off` as const },
      undefined,
      undefined,
    ],
  ])(`%s resolves to nothing`, (_name, cutaway, lattice_cell, expected) => {
    expect(resolve_cutaway(cutaway, lattice_cell)).toEqual(expected)
  })

  test(`an active one without a transform or cell fails fast`, () => {
    expect(() => resolve_cutaway(slab, undefined)).toThrow(
      `A slab cutaway needs cartesian_to_fractional or a structure with a lattice`,
    )
  })
})
