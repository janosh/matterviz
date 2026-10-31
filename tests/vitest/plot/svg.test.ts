import { line_curve_factory } from '#lib/plot/core/fill-utils.js'
import { bar_path, line_path, violin_path } from '#lib/plot/core/svg.js'
import type { LineCurve } from '#lib/plot/core/types.js'
import { line } from 'd3-shape'
import { describe, expect, it } from 'vitest'
import { make_rng } from '../numeric-helpers'

describe(`bar_path`, () => {
  it.each([
    [0, 0, 10, 20, 0, true, `M0,0h10v20h-10Z`],
    [5, 10, 20, 30, 0, false, `M5,10h20v30h-20Z`],
    [0, 0, 10, 20, -5, true, `M0,0h10v20h-10Z`],
    [0, 0, 10, 20, NaN, true, `M0,0h10v20h-10Z`],
    // zero-extent bars never get arcs, whatever the radius
    [0, 0, 10, 0, 5, true, `M0,0h10v0h-10Z`],
  ])(
    `returns simple rect path when radius is 0, negative, NaN or the bar is flat (x=%d, y=%d, w=%d, h=%d, r=%d, vertical=%s)`,
    (coord_x, coord_y, width_value, height_value, radius, vertical, expected) => {
      expect(bar_path(coord_x, coord_y, width_value, height_value, radius, vertical)).toBe(
        expected,
      )
    },
  )

  it.each([
    [`vertical default`, undefined, false, `M10,80V25A5,5 0 0 1 15,20H45A5,5 0 0 1 50,25V80Z`],
    [`vertical top`, true, false, `M10,80V25A5,5 0 0 1 15,20H45A5,5 0 0 1 50,25V80Z`],
    [`horizontal right`, false, false, `M10,20H45A5,5 0 0 1 50,25V75A5,5 0 0 1 45,80H10Z`],
    [`vertical bottom`, true, true, `M10,20V75A5,5 0 0 0 15,80H45A5,5 0 0 0 50,75V20Z`],
    [`horizontal left`, false, true, `M50,20H15A5,5 0 0 0 10,25V75A5,5 0 0 0 15,80H50Z`],
  ])(`rounds the %s corners`, (_name, vertical, flip, expected) => {
    expect(bar_path(10, 20, 40, 60, 5, vertical, flip)).toBe(expected)
  })

  // Callers pass the configured radius unclamped; the path clamps it to half the narrower side.
  it.each([
    [`width`, 4, 60, `M10,80V22A2,2 0 0 1 12,20H12A2,2 0 0 1 14,22V80Z`],
    [`height`, 40, 3, `M10,23V21.5A1.5,1.5 0 0 1 11.5,20H48.5A1.5,1.5 0 0 1 50,21.5V23Z`],
  ])(`clamps the radius to half the bar %s`, (_side, width_value, height_value, expected) => {
    expect(bar_path(10, 20, width_value, height_value, 5, true)).toBe(expected)
  })
})

describe(`violin_path`, () => {
  const orient = (cross: number, val: number): [number, number] => [cross, val]
  it.each([
    [`both`, `M50,0L54,10L50,20L50,20L46,10L50,0Z`],
    [`positive`, `M50,0L54,10L50,20L50,20L50,0Z`],
    [`negative`, `M50,0L46,10L50,20L50,20L50,0Z`],
  ] as const)(`draws side=%s around the center and closes the path`, (side, expected) => {
    expect(violin_path([0, 10, 20], [0, 4, 0], 50, side, orient)).toBe(expected)
  })
  it(`returns an empty path for an empty grid`, () => {
    expect(violin_path([], [], 0, `both`, orient)).toBe(``)
  })
})

describe(`line_path`, () => {
  type Pt = [number, number]
  const is_finite_pt = ([x, y]: Pt) => Number.isFinite(x) && Number.isFinite(y)
  const d3_path = (points: Pt[], curve: LineCurve) =>
    line().defined(is_finite_pt).curve(line_curve_factory(curve))(points) ?? ``
  const ours = (points: Pt[], curve: LineCurve) =>
    line_path(
      points,
      line_curve_factory(curve),
      (pt) => pt[0],
      (pt) => pt[1],
      is_finite_pt,
    )
  // ties at half a thousandth, -0, values rounding to -0, past int32 thousandths, gaps
  const edge_values = [0, -0, -0.0004, 0.0005, -0.0005, 1.0005, 2.5e-7, 999.9995, 123.4565]
  const edge_values_big = [2_147_483.647, -2_147_483.648, 3e6, -7.5e9, 1e21, 0.1 + 0.2]
  const rng = make_rng(4)
  const random_points = (n_points: number, scale: number): Pt[] =>
    Array.from({ length: n_points }, (_, idx) => [
      idx * scale * 0.37 - scale,
      (rng() - 0.5) * scale,
    ])
  const cases: [string, Pt[]][] = [
    [`small px`, random_points(500, 800)],
    [`large`, random_points(200, 3e7)],
    [`edges`, edge_values.map((val, idx) => [idx + val, val])],
    [`beyond int32`, edge_values_big.map((val, idx) => [idx, val])],
    [
      `gaps`,
      [
        [0, 1],
        [1, NaN],
        [2, 3],
        [Infinity, 4],
        [4, 5],
        [5, 6.0004],
      ],
    ],
    [`single point`, [[1.23456, 7.8901]]],
    [`empty`, []],
  ]
  const curves: LineCurve[] = [`monotone`, `linear`, `step`, `natural`, `basis`, `catmull-rom`]
  it.each(
    cases.flatMap(([name, points]) => curves.map((curve) => [name, curve, points] as const)),
  )(`writes d3's path text exactly (%s, %s)`, (_name, curve, points) => {
    expect(ours(points, curve)).toBe(d3_path(points, curve))
  })
})
