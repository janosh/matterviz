import {
  contour_segments,
  resolve_contour_thresholds,
  resolve_slice_color_range,
  slice_to_rgba,
} from '#lib/isosurface/slice-rendering.js'
import { contours } from 'd3-contour'
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
  // Asymmetric fixtures so the three symmetric modes give distinguishable answers
  test.each([
    [`auto`, [-1, 3], [-3, 3]], // signed data: centred on zero
    [`auto`, [1, 3], [1, 3]], // positive-only data: left alone
    [false, [-1, 3], [-1, 3]],
    [true, [1, 3], [-3, 3]],
  ] as const)(`symmetric=%s resolves %j to %j`, (symmetric, [min, max], expected) => {
    expect(resolve_slice_color_range({ min, max }, undefined, symmetric)).toEqual(expected)
  })

  test(`honors an explicit color range`, () => {
    expect(resolve_slice_color_range(make_slice(), [3, -1], `auto`)).toEqual([3, -1])
  })

  test(`maps finite values to opaque sRGB, masked values to transparency, flipping rows into a reused buffer`, () => {
    const slice = make_slice()
    const output = new Uint8ClampedArray(slice.data.length * 4)
    const pixels = slice_to_rgba(slice, `interpolateViridis`, [-2, 2], output)
    expect(pixels).toBe(output)
    // rows are flipped: source row 0 lands in target row 1, so its masked pixel is at byte 8
    expect(pixels[8 + 3]).toBe(0)
    expect([pixels[3], pixels[7], pixels[15]]).toEqual([255, 255, 255])
    expect(pixels.slice(0, 3)).not.toEqual(pixels.slice(4, 7))
    // a wrongly sized buffer is replaced rather than written out of bounds
    expect(
      slice_to_rgba(slice, `interpolateViridis`, [-2, 2], new Uint8ClampedArray(4)),
    ).not.toBe(output)
  })

  test.each([
    { levels: 0, expected: [] },
    { levels: 3, expected: [-1, 0, 1] },
    { levels: [1, Number.NaN, -1], expected: [-1, 1] },
    { levels: Number.POSITIVE_INFINITY, expected: [] },
  ])(`resolves contour levels $levels`, ({ levels, expected }) => {
    expect(resolve_contour_thresholds([-2, 2], levels)).toEqual(expected)
  })

  test.each([
    { levels: 1_000_000, range: [2, -2] as const },
    { levels: Array.from({ length: 300 }, (_, idx) => idx), range: [-1, 1] as const },
  ])(`caps contour counts at 256 for $levels`, ({ levels, range }) => {
    const thresholds = resolve_contour_thresholds([...range], levels)
    expect(thresholds).toHaveLength(256)
    expect(thresholds).toEqual([...thresholds].toSorted((left, right) => left - right))
  })
})

// The slice view strokes contour_segments instead of d3-contour's stitched rings; both must
// draw the same lines. Segments are compared as exact, direction-free coordinate quadruples.
describe(`contour_segments`, () => {
  const canonical = (x0: number, y0: number, x1: number, y1: number): string =>
    x0 < x1 || (x0 === x1 && y0 <= y1) ? `${x0},${y0},${x1},${y1}` : `${x1},${y1},${x0},${y0}`
  const d3_segments = (
    values: Float64Array,
    width: number,
    height: number,
    levels: number[],
  ) =>
    contours()
      .size([width, height])
      .thresholds(levels)(values as unknown as number[])
      .flatMap((shape) =>
        shape.coordinates.flat().flatMap((ring) =>
          ring
            .slice(1)
            .map(([x1, y1], idx) => [ring[idx][0], ring[idx][1], x1, y1])
            // a ring passing through a corner on the threshold repeats that point
            .filter(([x0, y0, x1, y1]) => x0 !== x1 || y0 !== y1)
            .map(([x0, y0, x1, y1]) => canonical(x0, y0, x1, y1)),
        ),
      )
      .toSorted()
  const own_segments = (
    values: Float64Array,
    width: number,
    height: number,
    levels: number[],
  ) => {
    const out: string[] = []
    contour_segments(values, width, height, levels, (x0, y0, x1, y1) =>
      out.push(canonical(x0, y0, x1, y1)),
    )
    return out.toSorted()
  }
  // seeded LCG so failures reproduce
  const make_rng = (seed: number) => () =>
    (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32

  test.each([
    { width: 1, height: 1, field: `random` },
    { width: 7, height: 5, field: `random` },
    { width: 40, height: 31, field: `smooth` },
    { width: 64, height: 64, field: `masked` },
  ])(`matches d3-contour on a $width x $height $field field`, ({ width, height, field }) => {
    const rng = make_rng(width * 31 + height)
    const values = Float64Array.from({ length: width * height }, (_, idx) => {
      const [col, row] = [idx % width, Math.floor(idx / width)]
      if (field === `random`) return rng() * 2 - 1
      if (field === `steps`) return Math.round(rng() * 4) / 4 - 0.5
      const wave = Math.sin(col / 4) * Math.cos(row / 5) + 0.3 * Math.sin((col + row) / 3)
      // masked pixels carry a below-every-level stand-in, as VolumeSlice fills them
      return field === `masked` && (col - 32) ** 2 + (row - 32) ** 2 > 28 ** 2 ? -9 : wave
    })
    const levels = [-0.75, -0.5, -0.1, 0, 0.05, 0.5, 0.75] // uneven: band guesses walk
    const expected = d3_segments(values, width, height, levels)
    expect(expected.length).toBeGreaterThan(0)
    expect(own_segments(values, width, height, levels)).toEqual(expected)
  })

  // Values exactly on a threshold: d3 drops zero-area rings outside any polygon. Every line d3
  // draws is still drawn, and the only extras are such out-and-back traces (each segment twice).
  test(`values on a threshold draw every d3 line plus only zero-area traces`, () => {
    const [width, height] = [23, 17]
    const rng = make_rng(7)
    const values = Float64Array.from(
      { length: width * height },
      () => Math.round(rng() * 4) / 4,
    )
    const levels = [0.25, 0.5, 0.75]
    const extras = new Map<string, number>()
    for (const segment of own_segments(values, width, height, levels))
      extras.set(segment, (extras.get(segment) ?? 0) + 1)
    for (const segment of d3_segments(values, width, height, levels)) {
      const count = extras.get(segment) ?? 0
      expect(count, segment).toBeGreaterThan(0)
      if (count === 1) extras.delete(segment)
      else extras.set(segment, count - 1)
    }
    expect(extras.size).toBeGreaterThan(0) // the field does produce ties
    for (const [segment, count] of extras) expect(count % 2, segment).toBe(0)
  })

  test(`no thresholds or no crossings emit nothing`, () => {
    const values = new Float64Array([1, 2, 3, 4])
    expect(own_segments(values, 2, 2, [])).toEqual([])
    expect(own_segments(values, 2, 2, [10])).toEqual([])
  })
})
