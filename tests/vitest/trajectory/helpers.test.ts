import { create_structure, read_ndarray_from_view } from '$lib/trajectory/helpers'
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
})
