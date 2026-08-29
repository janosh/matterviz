import type { Vec3 } from '$lib/math'
import {
  inside_triangle,
  ternary_fractions,
  ternary_grid_lines,
  ternary_layout,
  ternary_to_xy,
  TRIANGLE_HEIGHT,
  xy_to_ternary,
} from '$lib/plot/ternary'
import { describe, expect, test } from 'vitest'

// Rounded to 12 places (+ 0 folds -0 into 0) so whole arrays compare with toEqual
const round = (values: readonly number[]): number[] =>
  values.map((val) => Number(val.toFixed(12)) + 0)

describe(`ternary_fractions`, () => {
  test.each([
    [
      [1, 0, 0],
      [1, 0, 0],
    ],
    [
      [0.2, 0.3, 0.5],
      [0.2, 0.3, 0.5],
    ],
    [
      [2, 3, 5],
      [0.2, 0.3, 0.5],
    ], // raw counts normalize
    [
      [50, 50, 0],
      [0.5, 0.5, 0],
    ],
    // 1 - 0.3 - 0.7 = -1.1e-16: round-off from computing the third fraction clamps to 0
    [
      [0.3, 0.7, 1 - 0.3 - 0.7],
      [0.3, 0.7, 0],
    ],
    [
      [30, 70, -1e-8],
      [0.3, 0.7, 0],
    ], // tolerance scales with the total
  ] as [Vec3, Vec3][])(`%j -> %j`, (triple, expected) => {
    const fractions = ternary_fractions(triple)
    expect(round(fractions)).toEqual(round(expected))
    expect(fractions.every((frac) => frac >= 0)).toBe(true) // never -0 or below
  })

  test.each([
    [[1, NaN, 0], `three finite numbers`],
    [[1, Infinity, 0], `three finite numbers`],
    [[1, -0.1, 0], `negative amount`],
    [[0.3, 0.7, -1e-8], `negative amount`], // past the round-off tolerance
    [[0, 0, 0], `has no amounts`],
  ] as [Vec3, string][])(`rejects %j (%s)`, (triple, message) => {
    expect(() => ternary_fractions(triple, `Si-O-C point 3`)).toThrow(message)
    expect(() => ternary_fractions(triple, `Si-O-C point 3`)).toThrow(`Si-O-C point 3`)
  })
})

describe(`ternary_to_xy / xy_to_ternary`, () => {
  test.each([
    [
      [1, 0, 0],
      [1, 0],
    ], // first component: right corner
    [
      [0, 1, 0],
      [0.5, TRIANGLE_HEIGHT],
    ], // second: apex
    [
      [0, 0, 1],
      [0, 0],
    ], // third: left corner
    [
      [1 / 3, 1 / 3, 1 / 3],
      [0.5, TRIANGLE_HEIGHT / 3],
    ], // centroid
  ] as [Vec3, [number, number]][])(`%j sits at %j`, (fractions, xy) => {
    expect(round(ternary_to_xy(fractions))).toEqual(round(xy))
  })

  test.each([[[0.2, 0.3, 0.5]], [[1, 0, 0]], [[0.05, 0.9, 0.05]], [[1 / 3, 1 / 3, 1 / 3]]] as [
    Vec3,
  ][])(`round-trips %j`, (fractions) => {
    const round_trip = xy_to_ternary(ternary_to_xy(fractions))
    expect(round(round_trip)).toEqual(round(fractions))
    expect(inside_triangle(fractions)).toBe(true)
  })

  test(`points outside the triangle get a negative fraction`, () => {
    const outside = xy_to_ternary([0.5, -0.1]) // below the base
    expect(outside[1]).toBeLessThan(0)
    expect(inside_triangle(outside)).toBe(false)
    expect(outside[0] + outside[1] + outside[2]).toBeCloseTo(1, 12)
  })
})

describe(`ternary_grid_lines`, () => {
  test.each([
    [0.1, 9],
    [0.2, 4],
    [0.25, 3],
    [0.3, 3], // 0.3, 0.6, 0.9
    [0.5, 1],
  ])(`step %d gives %d lines per component`, (step, n_per_component) => {
    const lines = ternary_grid_lines(step)
    expect(lines).toHaveLength(3 * n_per_component)
    for (const component of [0, 1, 2] as const) {
      const values = lines.filter((line) => line.component === component).map((ln) => ln.value)
      expect(values).toHaveLength(n_per_component)
      expect(values.every((val) => val > 0 && val < 1)).toBe(true)
    }
  })

  test.each([0, -0.1, 1, 2, NaN])(`step %d yields no lines`, (step) => {
    expect(ternary_grid_lines(step)).toEqual([])
  })

  test(`each line is the locus of its component and ticks on the next component's zero edge`, () => {
    for (const line of ternary_grid_lines(0.2)) {
      const from = xy_to_ternary(line.from)
      const to = xy_to_ternary(line.to)
      expect(from[line.component]).toBeCloseTo(line.value, 12)
      expect(to[line.component]).toBeCloseTo(line.value, 12)
      // the tick end is where the cyclically next component vanishes
      const next = (line.component + 1) % 3
      expect(from[next]).toBeCloseTo(0, 12)
      // outward is a unit vector pointing away from the centroid
      expect(Math.hypot(...line.outward)).toBeCloseTo(1, 12)
      const [centroid_x, centroid_y] = ternary_to_xy([1 / 3, 1 / 3, 1 / 3])
      const away =
        (line.from[0] - centroid_x) * line.outward[0] +
        (line.from[1] - centroid_y) * line.outward[1]
      expect(away).toBeGreaterThan(0)
    }
  })

  test(`first-component ticks read left to right along the base`, () => {
    const base_ticks = ternary_grid_lines(0.25).filter((line) => line.component === 0)
    expect(base_ticks.map((line) => line.from)).toEqual([
      [0.25, 0],
      [0.5, 0],
      [0.75, 0],
    ])
  })
})

describe(`ternary_layout`, () => {
  test.each([
    [400, 300, 300 / TRIANGLE_HEIGHT], // height-bound
    [200, 300, 200], // width-bound
    [0, 300, 0],
  ])(`fits a %dx%d box with side %f`, (width, height, side) => {
    const { scale, to_px } = ternary_layout(width, height)
    expect(scale).toBeCloseTo(side, 9)
    // centered: corners are symmetric about the box center
    const [left_x, base_y] = to_px([0, 0])
    const [right_x] = to_px([1, 0])
    const [apex_x, apex_y] = to_px([0.5, TRIANGLE_HEIGHT])
    expect((left_x + right_x) / 2).toBeCloseTo(width / 2, 9)
    expect(apex_x).toBeCloseTo(width / 2, 9)
    expect(right_x - left_x).toBeCloseTo(side, 9)
    // y flips: the apex is above the base in pixel space, both inside the box
    expect(apex_y).toBeLessThanOrEqual(base_y)
    expect(base_y).toBeLessThanOrEqual(height + 1e-9)
    expect(apex_y).toBeGreaterThanOrEqual(-1e-9)
    expect(base_y - apex_y).toBeCloseTo(side * TRIANGLE_HEIGHT, 9)
  })

  test(`from_px inverts to_px`, () => {
    const { to_px, from_px } = ternary_layout(640, 480)
    for (const xy of [
      [0, 0],
      [1, 0],
      [0.5, TRIANGLE_HEIGHT],
      [0.3, 0.2],
    ] as const) {
      const round_trip = from_px(to_px(xy))
      expect(round(round_trip)).toEqual(round(xy))
    }
  })
})
