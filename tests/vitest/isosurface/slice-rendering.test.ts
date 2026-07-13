import {
  resolve_contour_thresholds,
  resolve_slice_color_range,
  slice_to_rgba,
} from '$lib/isosurface/slice-rendering'
import { describe, expect, test } from 'vitest'

const make_slice = () => ({
  data: new Float64Array([Number.NaN, -2, 0, 2]),
  mask: new Uint8Array([0, 1, 1, 1]),
  width: 2,
  height: 2,
  min: -2,
  max: 2,
})

describe(`slice rendering helpers`, () => {
  test(`resolves auto/symmetric bounds from slice min/max`, () => {
    expect(resolve_slice_color_range(make_slice(), undefined, `auto`)).toEqual([-2, 2])
  })

  test(`honors an explicit color range`, () => {
    expect(resolve_slice_color_range(make_slice(), [3, -1], `auto`)).toEqual([3, -1])
  })

  test(`maps finite values to opaque sRGB and masked values to transparency`, () => {
    const slice = make_slice()
    const pixels = slice_to_rgba(slice, `interpolateViridis`, [-2, 2])

    // flip_y moves source row 0 to target row 1, so its masked pixel is at byte 8.
    expect(pixels[8 + 3]).toBe(0)
    expect([pixels[3], pixels[7], pixels[15]]).toEqual([255, 255, 255])
    expect(pixels.slice(0, 3)).not.toEqual(pixels.slice(4, 7))
  })

  test(`reuses a correctly sized output buffer and supports unflipped rows`, () => {
    const slice = make_slice()
    const output = new Uint8ClampedArray(slice.data.length * 4)
    const pixels = slice_to_rgba(slice, `interpolatePlasma`, [-2, 2], {
      flip_y: false,
      out: output,
    })

    expect(pixels).toBe(output)
    expect(pixels[3]).toBe(0)
    expect(pixels[7]).toBe(255)
  })

  test.each([
    { levels: 0, expected: [] },
    { levels: 3, expected: [-1, 0, 1] },
    { levels: [1, Number.NaN, -1], expected: [-1, 1] },
  ])(`resolves contour levels $levels`, ({ levels, expected }) => {
    expect(resolve_contour_thresholds([-2, 2], levels)).toEqual(expected)
  })
})
