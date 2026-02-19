import {
  convert_atomic_numbers,
  create_structure,
  read_ndarray_from_view,
} from '$lib/trajectory/helpers'
import type { ElementSymbol } from '$lib/element'
import { describe, expect, it } from 'vitest'

describe(`trajectory helpers`, () => {
  it(`throws clear error for invalid position vectors`, () => {
    expect(() =>
      create_structure(
        [[0, 0], [1, 2, 3]],
        [`H`, `He`],
      )
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
    const positions = [[0, 0, 0], [1, 1, 1]]
    const elements: ElementSymbol[] = [`H`, `He`]
    const structure = create_structure(positions, elements)

    expect(structure.sites).toHaveLength(2)
    expect(structure.sites[0]?.xyz).toEqual([0, 0, 0])
    expect(structure.sites[1]?.xyz).toEqual([1, 1, 1])
    expect(structure.sites[0]?.species[0]?.element).toBe(`H`)
    expect(structure.sites[1]?.species[0]?.element).toBe(`He`)
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

    expect(read_ndarray_from_view(view, ref)).toEqual([[1, 2], [3, 4]])
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
  ])(
    `converts known atomic numbers to symbols`,
    ({ atomic_numbers, expected_symbols }) => {
      expect(convert_atomic_numbers(atomic_numbers)).toEqual(expected_symbols)
    },
  )

  it(`throws for unknown atomic numbers`, () => {
    expect(() => convert_atomic_numbers([999])).toThrow(/Unknown atomic number/)
  })
})
