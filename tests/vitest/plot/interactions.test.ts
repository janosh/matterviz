// Unit tests for plot interaction utilities
import { describe, expect, it } from 'vitest'
import { pan_range, pixels_to_data_delta } from '$lib/plot/interactions'

describe(`pan_range`, () => {
  it(`shifts range by positive delta`, () => {
    const result = pan_range([0, 10], 5)
    expect(result).toEqual([5, 15])
  })

  it(`shifts range by negative delta`, () => {
    const result = pan_range([0, 10], -5)
    expect(result).toEqual([-5, 5])
  })

  it(`handles negative range values`, () => {
    const result = pan_range([-10, -5], 3)
    expect(result).toEqual([-7, -2])
  })

  it(`handles fractional delta`, () => {
    const result = pan_range([0, 100], 0.5)
    expect(result).toEqual([0.5, 100.5])
  })

  it(`returns a new array (immutable)`, () => {
    const original: [number, number] = [0, 10]
    const result = pan_range(original, 5)
    expect(result).not.toBe(original)
    expect(original).toEqual([0, 10]) // Original unchanged
  })
})

describe(`pixels_to_data_delta`, () => {
  it(`converts positive pixel delta to data delta`, () => {
    // 100px delta in a 200px range representing [0, 100] data range
    const result = pixels_to_data_delta(100, [0, 100], 200)
    expect(result).toBe(50) // 100px = 50 data units
  })

  it(`converts negative pixel delta to data delta`, () => {
    const result = pixels_to_data_delta(-100, [0, 100], 200)
    expect(result).toBe(-50)
  })

  it(`handles zero pixel delta`, () => {
    const result = pixels_to_data_delta(0, [0, 100], 200)
    expect(result).toBe(0)
  })

  it(`handles negative data range`, () => {
    // [−50, 50] is a span of 100, displayed in 200px
    const result = pixels_to_data_delta(100, [-50, 50], 200)
    expect(result).toBe(50)
  })

  it(`handles non-zero-based data range`, () => {
    // [100, 200] is a span of 100, displayed in 200px
    const result = pixels_to_data_delta(100, [100, 200], 200)
    expect(result).toBe(50)
  })

  it(`scales correctly with different pixel ranges`, () => {
    // Same data range, different pixel sizes
    const result_small = pixels_to_data_delta(50, [0, 100], 100)
    const result_large = pixels_to_data_delta(50, [0, 100], 200)
    expect(result_small).toBe(50) // 50px = 50 data in 100px range
    expect(result_large).toBe(25) // 50px = 25 data in 200px range
  })

  it(`handles fractional values`, () => {
    const result = pixels_to_data_delta(10, [0, 50], 100)
    expect(result).toBe(5)
  })

  it(`handles very small pixel ranges`, () => {
    // 1px range with 100 data span
    const result = pixels_to_data_delta(0.5, [0, 100], 1)
    expect(result).toBe(50) // 0.5px = 50 data units
  })

  it(`handles very large data ranges`, () => {
    const result = pixels_to_data_delta(100, [0, 1e12], 200)
    expect(result).toBe(5e11)
  })

  it(`handles single-point range (min === max)`, () => {
    // Zero span means any pixel movement produces zero data delta
    const result = pixels_to_data_delta(100, [50, 50], 200)
    expect(result).toBe(0)
  })

  it(`produces consistent results for typical plot dimensions`, () => {
    // Typical scatter plot: 600px wide, data range 0-1000
    const result = pixels_to_data_delta(60, [0, 1000], 600)
    expect(result).toBe(100) // 60px = 100 data units (10% of range)
  })

  it(`handles high-precision data ranges`, () => {
    // Scientific data with small values
    const result = pixels_to_data_delta(100, [0.001, 0.002], 200)
    expect(result).toBeCloseTo(0.0005)
  })

  it(`returns zero when pixel_range is zero (division by zero guard)`, () => {
    const result = pixels_to_data_delta(100, [0, 100], 0)
    expect(result).toBe(0)
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
