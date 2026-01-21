// Unit tests for plot interaction utilities
import { describe, expect, it } from 'vitest'
import { pan_range, pixels_to_data_delta } from '$lib/plot/interactions'

describe(`pan_range`, () => {
  it.each([
    { range: [0, 10], delta: 5, expected: [5, 15], desc: `positive delta` },
    { range: [0, 10], delta: -5, expected: [-5, 5], desc: `negative delta` },
    { range: [-10, -5], delta: 3, expected: [-7, -2], desc: `negative range` },
    { range: [0, 100], delta: 0.5, expected: [0.5, 100.5], desc: `fractional delta` },
  ])(`$desc: pan_range($range, $delta) = $expected`, ({ range, delta, expected }) => {
    expect(pan_range(range as [number, number], delta)).toEqual(expected)
  })

  it(`returns a new array (immutable)`, () => {
    const original: [number, number] = [0, 10]
    const result = pan_range(original, 5)
    expect(result).not.toBe(original)
    expect(original).toEqual([0, 10])
  })
})

describe(`pixels_to_data_delta`, () => {
  it.each([
    { px: 100, data: [0, 100], size: 200, expected: 50, desc: `positive delta` },
    { px: -100, data: [0, 100], size: 200, expected: -50, desc: `negative delta` },
    { px: 0, data: [0, 100], size: 200, expected: 0, desc: `zero delta` },
    { px: 100, data: [-50, 50], size: 200, expected: 50, desc: `negative data range` },
    { px: 100, data: [100, 200], size: 200, expected: 50, desc: `non-zero-based range` },
    { px: 10, data: [0, 50], size: 100, expected: 5, desc: `fractional result` },
    { px: 0.5, data: [0, 100], size: 1, expected: 50, desc: `small pixel range` },
    { px: 100, data: [0, 1e12], size: 200, expected: 5e11, desc: `large data range` },
    { px: 100, data: [50, 50], size: 200, expected: 0, desc: `zero-span range` },
    { px: 60, data: [0, 1000], size: 600, expected: 100, desc: `typical plot` },
    { px: 100, data: [0, 100], size: 0, expected: 0, desc: `zero pixel range` },
  ])(`$desc`, ({ px, data, size, expected }) => {
    expect(pixels_to_data_delta(px, data as [number, number], size)).toBe(expected)
  })

  it(`handles high-precision data ranges`, () => {
    expect(pixels_to_data_delta(100, [0.001, 0.002], 200)).toBeCloseTo(0.0005)
  })

  it(`scales correctly with different pixel ranges`, () => {
    expect(pixels_to_data_delta(50, [0, 100], 100)).toBe(50)
    expect(pixels_to_data_delta(50, [0, 100], 200)).toBe(25)
  })
})

describe(`pan_range and pixels_to_data_delta integration`, () => {
  it(`combined usage produces correct pan behavior`, () => {
    // Simulate a pan: 50px drag on a 200px wide plot with [0, 100] range
    const current_range: [number, number] = [0, 100]
    const pixel_delta = 50
    const pixel_range = 200

    const data_delta = pixels_to_data_delta(pixel_delta, current_range, pixel_range)
    const new_range = pan_range(current_range, data_delta)

    // 50px = 25% of 200px = 25 data units
    expect(data_delta).toBe(25)
    expect(new_range).toEqual([25, 125])
  })

  it(`pan preserves range size after multiple operations`, () => {
    let range: [number, number] = [0, 100]
    const pixel_range = 200

    // Pan right
    range = pan_range(range, pixels_to_data_delta(50, range, pixel_range))
    // Pan left
    range = pan_range(range, pixels_to_data_delta(-30, range, pixel_range))
    // Pan down (inverted Y)
    range = pan_range(range, pixels_to_data_delta(20, range, pixel_range))

    // Range span should be preserved (100 units)
    expect(range[1] - range[0]).toBe(100)
  })

  it(`handles zoomed-in state correctly`, () => {
    // After zooming in, data range is smaller but pixel range stays same
    const zoomed_range: [number, number] = [40, 60] // Zoomed to center 20%
    const pixel_range = 200

    // 100px pan should now move 10 data units (20/200 * 100 = 10)
    const data_delta = pixels_to_data_delta(100, zoomed_range, pixel_range)
    expect(data_delta).toBe(10)

    const new_range = pan_range(zoomed_range, data_delta)
    expect(new_range).toEqual([50, 70])
  })
})
