import {
  convert_atomic_numbers,
  create_structure,
  parse_float_token,
  read_ndarray_from_view,
} from '$lib/trajectory/helpers'
import { trajectory_from_frames } from '$lib/trajectory'
import type { ElementSymbol } from '$lib/element'
import type { Matrix3x3 } from '$lib/math'
import { describe, expect, it } from 'vitest'

describe(`trajectory helpers`, () => {
  it(`throws clear error for invalid position vectors`, () => {
    expect(() =>
      create_structure(
        [
          [0, 0],
          [1, 2, 3],
        ],
        [`H`, `He`],
      ),
    ).toThrow(/Invalid position at index 0/)
  })

  it(`throws clear out-of-bounds error for ndarray reads`, () => {
    const view = new DataView(new ArrayBuffer(8))
    const ref = {
      ndarray: [[2, 2], `float64`, 0],
    }

    expect(() => read_ndarray_from_view(view, ref)).toThrow(/Out-of-bounds read/)
  })

  it(`creates structure for valid 3D positions`, () => {
    const positions = [
      [0, 0, 0],
      [1, 1, 1],
    ]
    const elements: ElementSymbol[] = [`H`, `He`]
    const structure = create_structure(positions, elements)

    expect(structure.sites).toHaveLength(2)
    expect(structure.sites[0]?.xyz).toEqual([0, 0, 0])
    expect(structure.sites[1]?.xyz).toEqual([1, 1, 1])
    expect(structure.sites[0]?.species[0]?.element).toBe(`H`)
    expect(structure.sites[1]?.species[0]?.element).toBe(`He`)
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
      `Singular lattice [[4,0,0],[0,4,0],[0,0,0]]; fractional coordinates use the axis-length approximation`,
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

  it.each([
    {
      dtype: `float64`,
      set_values: (view: DataView) => {
        view.setFloat64(0, 1, true)
        view.setFloat64(8, 2, true)
        view.setFloat64(16, 3, true)
        view.setFloat64(24, 4, true)
      },
    },
    {
      dtype: `int32`,
      set_values: (view: DataView) => {
        view.setInt32(0, 1, true)
        view.setInt32(4, 2, true)
        view.setInt32(8, 3, true)
        view.setInt32(12, 4, true)
      },
    },
  ])(`reads valid ndarray for $dtype`, ({ dtype, set_values }) => {
    const bytes_per_element = dtype === `float64` ? 8 : 4
    const view = new DataView(new ArrayBuffer(4 * bytes_per_element))
    set_values(view)
    const ref = { ndarray: [[2, 2], dtype, 0] as unknown[] }

    expect(read_ndarray_from_view(view, ref)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it(`allows boundary ndarray read that exactly fits buffer`, () => {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, 42.5, true)
    const ref = {
      ndarray: [[1], `float64`, 0],
    }

    expect(read_ndarray_from_view(view, ref)).toEqual([[42.5]])
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

  it.each([
    {
      signal: { sample_shape: [0], values: new Float64Array(), steps: [0] },
      error: `sample_shape must be scalar`,
    },
    {
      signal: { sample_shape: [3], values: new Float64Array(5), steps: [0, 1] },
      error: `needs a Float64Array of 6 values`,
    },
  ])(`rejects a packed signal with $error`, ({ signal, error }) => {
    const structure = create_structure([[0, 0, 0]], [`H`])
    expect(() =>
      trajectory_from_frames(
        [
          { structure, step: 0, metadata: {} },
          { structure, step: 1, metadata: {} },
        ],
        { signals: { dipole: signal } },
      ),
    ).toThrow(error)
  })
})
