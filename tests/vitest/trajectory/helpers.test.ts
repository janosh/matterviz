import {
  convert_atomic_numbers,
  create_structure,
  parse_float_token,
  read_ndarray_from_view,
} from '$lib/trajectory/helpers'
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3 } from '$lib/math'
import { describe, expect, it } from 'vitest'

describe(`trajectory helpers`, () => {
  it(`create_structure keeps positions and species, rejects non-3D positions`, () => {
    const elements: ElementSymbol[] = [`H`, `He`]
    const structure = create_structure(
      [
        [0, 0, 0],
        [1, 1, 1],
      ],
      elements,
    )
    expect(structure.sites.map((site) => site.xyz)).toEqual([
      [0, 0, 0],
      [1, 1, 1],
    ])
    expect(structure.sites.map((site) => site.species[0].element)).toEqual(elements)
    expect(() =>
      create_structure(
        [
          [0, 0],
          [1, 2, 3],
        ],
        elements,
      ),
    ).toThrow(/Invalid position at index 0/)
  })

  // Number(``) is 0 and parseFloat(`1.0abc`) is 1: both would turn corruption into a coordinate
  it.each([
    [`1.5`, 1.5],
    [`-2e-3`, -0.002],
    [`1.0D-3`, 0.001],
    [`2.5d2`, 250],
    [`1.0abc`, NaN],
    [`1,5`, NaN],
    [``, NaN],
    [undefined, NaN],
  ])(`parse_float_token(%j) is %d`, (token, expected) => {
    expect(parse_float_token(token)).toBe(expected)
  })

  it(`falls back to axis lengths for a singular lattice and warns once per structure`, () => {
    const warnings: string[] = []
    const slab: Matrix3x3 = [
      [4, 0, 0],
      [0, 4, 0],
      [0, 0, 0],
    ]
    const structure = create_structure(
      [
        [1, 2, 0],
        [3, 1, 0],
      ],
      [`H`, `H`],
      slab,
      undefined,
      undefined,
      (message) => warnings.push(message),
    )
    expect(structure.sites.map((site) => site.abc)).toEqual([
      [0.25, 0.5, 0],
      [0.75, 0.25, 0],
    ])
    expect(warnings).toEqual([
      `Singular lattice [[4,0,0],[0,4,0],[0,0,0]], using axis-length fallback for cart→frac`,
    ])
  })

  it(`computes fractional coordinates correctly for non-orthogonal lattices`, () => {
    const lattice: Matrix3x3 = [
      [2, 1, 0],
      [0, 2, 0],
      [0, 0, 2],
    ]
    const structure = create_structure([[2, 1, 0]], [`H`], lattice)

    expect(`lattice` in structure).toBe(true)
    expect(structure.sites[0]?.abc).toEqual([1, 0, 0])
  })

  // oxfmt-ignore
  it.each<[string, number, (view: DataView, offset: number, value: number) => void]>([
    [`float64`, 8, (view, offset, value) => view.setFloat64(offset, value, true)],
    [`int32`, 4, (view, offset, value) => view.setInt32(offset, value, true)],
  ])(`reads a 2x2 %s ndarray that exactly fits its buffer`, (dtype, bytes_per_element, set_value) => {
    const view = new DataView(new ArrayBuffer(4 * bytes_per_element))
    for (const idx of [0, 1, 2, 3]) set_value(view, idx * bytes_per_element, idx + 1)
    expect(read_ndarray_from_view(view, { ndarray: [[2, 2], dtype, 0] })).toEqual([[1, 2], [3, 4]])
    expect(() => read_ndarray_from_view(view, { ndarray: [[2, 3], dtype, 0] })).toThrow(
      /Out-of-bounds read/,
    )
  })

  it.each([
    { atomic_numbers: [1, 2, 8], expected_symbols: [`H`, `He`, `O`] },
    { atomic_numbers: [26], expected_symbols: [`Fe`] },
  ])(`converts known atomic numbers to symbols`, ({ atomic_numbers, expected_symbols }) => {
    expect(convert_atomic_numbers(atomic_numbers)).toEqual(expected_symbols)
  })

  it.each([999, 0, -1, 1.5, NaN])(`throws for atomic number %s`, (atomic_number) => {
    expect(() => convert_atomic_numbers([atomic_number])).toThrow(
      `Unknown atomic number in trajectory data: ${atomic_number}`,
    )
  })
})
