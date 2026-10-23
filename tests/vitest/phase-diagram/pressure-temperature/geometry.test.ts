import { point_in_polygon, polygon_signed_area, type Vec2 } from '#lib/math.js'
import type { PixelSigma } from '#lib/phase-diagram/pressure-temperature/geometry.js'
import {
  clip_polygon_to_rect,
  closest_on_segment,
  derive_regions,
  interpolate_at,
  nearest_on_polylines,
  SNAP_TOL,
  uncertainty_band,
} from '#lib/phase-diagram/pressure-temperature/geometry.js'
import type {
  PtBoundary,
  PtPhaseDiagramData,
  PtRegion,
} from '#lib/phase-diagram/pressure-temperature/types.js'
import {
  iron_pt_diagram,
  water_pt_diagram,
} from '#site/phase-diagrams/pressure-temperature.js'
import { describe, expect, test } from 'vitest'

const total_area = (regions: PtRegion[]): number =>
  regions.reduce((sum, region) => sum + Math.abs(polygon_signed_area(region.vertices)), 0)
const boundary = (
  id: string,
  phases: [string, string],
  points: Vec2[],
  metastable = false,
): PtBoundary => ({ id, phases, points, metastable })
// Phase of the topmost (last painted) region containing a point
const phase_at = (regions: PtRegion[], [pressure, temp]: Vec2): string | null =>
  regions.findLast((region) => point_in_polygon(pressure, temp, region.vertices))?.phase ??
  null

// 10 x 10 window (SNAP_TOL = 0.01 of it is 0.1 data units) with phases a (lower left),
// b (lower right) and c (top) meeting at a triple point near (5, 5). Each arg is the rest of
// a line after its start on the window edge; `extra` lines are appended.
const window_10 = { pressure_range: [0, 10] as Vec2, temperature_range: [0, 10] as Vec2 }
const triple = (
  ab_tail: Vec2[],
  ac_tail: Vec2[],
  bc_tail: Vec2[],
  ...extra: PtBoundary[]
): PtPhaseDiagramData => ({
  ...window_10,
  phases: [{ id: `a` }, { id: `b` }, { id: `c` }, { id: `d` }],
  boundaries: [
    boundary(`ab`, [`a`, `b`], [[5, 0], ...ab_tail]),
    boundary(`ac`, [`a`, `c`], [[0, 6], ...ac_tail]),
    boundary(`bc`, [`b`, `c`], [[10, 6], ...bc_tail]),
    ...extra,
  ],
})
const at_center: Vec2[] = [[5, 5]]
const exact_triple = triple(at_center, at_center, at_center)
// All three lines run on past (5, 5) by `overshoot` data units along their own direction
const ac_dir: Vec2 = [5 / Math.hypot(5, 1), -1 / Math.hypot(5, 1)]
const overshoot_triple = (overshoot: number): PtPhaseDiagramData =>
  triple(
    [[5, 5 + overshoot]],
    [[5 + overshoot * ac_dir[0], 5 + overshoot * ac_dir[1]]],
    [[5 - overshoot * ac_dir[0], 5 + overshoot * ac_dir[1]]],
  )
// Interior points of each phase's field, well clear of the lines
const triple_probes: [Vec2, string | null][] = [
  [[2, 2], `a`],
  [[8, 2], `b`],
  [[5, 8], `c`],
]
const { regions: _water_regions, ...water_lines } = water_pt_diagram
const iron_phases = [`alpha`, `delta`, `epsilon`, `gamma`, `liquid`]

describe(`derive_regions`, () => {
  // [data, options, named phases, unnamed faces, probe points → phase, area the regions tile]
  // Faces tile the window, so their areas sum to it: round-off is < 1e-9 on these O(1e3)
  // shoelace sums (|sum - 555000| measured 0), so 6 digits still catches any missing face
  // oxfmt-ignore
  test.each([
    [`iron demo`, iron_pt_diagram, {}, iron_phases, 0, [[[2, 500], `alpha`], [[2, 1400], `gamma`], [[1, 1790], `delta`], [[2, 2500], `liquid`], [[50, 1000], `epsilon`], [[50, 3500], `liquid`], [[140, 2000], `epsilon`], [[200, 1000], null]], 150 * 3700],
    // traced in log10(P): 0 GPa endpoints are clipped, not clamped onto the window edge
    [`iron demo on a log axis`, iron_pt_diagram, { log_pressure: true }, iron_phases, 0, [[[1, 500], `alpha`], [[2, 1835], `delta`], [[50, 1000], `epsilon`]], null],
    // ends within SNAP_TOL join at one triple point, whether they stop short or overshoot
    [`exact triple point`, exact_triple, {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`ends up to 0.05 apart`, triple([[5, 5.03]], [[4.97, 5]], [[5.04, 4.98]]), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`one line 0.09 past the other two`, triple([[5, 5.09]], at_center, at_center), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`all three 0.05 past`, overshoot_triple(0.05), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`straight 3-point tail 0.09 past`, triple([[5, 5], [5, 5.03], [5.01, 5.06], [5, 5.09]], at_center, at_center), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    // without snapping, overshoot stubs dangle inside every face, which then holds two phases
    [`overshoot with snapping off`, overshoot_triple(0.05), { snap_tol: 1e-6 }, [], 3, [], null],
    [`metastable lines don't split regions`, triple(at_center, at_center, at_center, boundary(`ab-meta`, [`a`, `b`], [[5, 5], [5, 10]], true)), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    // b|c metastable merges b and c into one face touching only a|b and a|c: their shared
    // phase a names it after the phase across both lines, so every boundary must separate its
    // own two phases and neither side of a|b keeps a contradicting name
    [`face named against its boundaries`, { ...exact_triple, boundaries: exact_triple.boundaries.map((line) => ({ ...line, metastable: line.id === `bc` })) }, {}, [], 2, [], null],
    // a b|c line touching nothing traces a zero-area face; the face around it holds two phases
    [`free-floating line`, triple(at_center, at_center, at_center, boundary(`float`, [`b`, `c`], [[7, 8], [8, 9]])), {}, [`a`, `b`], 1, [[[5, 8], null]], null],
    // a closed c|d loop is a clockwise hole cycle the c face doesn't exclude: c would paint
    // over the island and hover report c inside it, so both stay unnamed
    [`island loop`, triple(at_center, at_center, at_center, boundary(`island`, [`c`, `d`], [[4, 7], [6, 7], [6, 9], [4, 9], [4, 7]])), {}, [`a`, `b`], 2, [[[5, 8], null], [[8, 8], null]], null],
    // a lone a|b line: no labeled neighbor says which side is which
    [`lone two-phase line`, { ...window_10, phases: [{ id: `a` }, { id: `b` }], boundaries: [boundary(`ab`, [`a`, `b`], [[0, 5], [10, 5]])] }, {}, [], 2, [], null],
    [`single phase, no boundaries`, { ...window_10, phases: [{ id: `a` }], boundaries: [] }, {}, [`a`], 0, [], 100],
    // liquid and vapor join around the critical point: the fluid face holds two phases
    [`water without regions`, water_lines, { log_pressure: true }, [`ice-ih`], 1, [[[1e5, 250], `ice-ih`], [[1e5, 500], null]], null],
  ] satisfies [string, PtPhaseDiagramData, Parameters<typeof derive_regions>[1], string[], number, [Vec2, string | null][], number | null][])(
    `%s`,
    (_label, data, options, phases, unlabeled, probes, area) => {
      expect(SNAP_TOL).toBe(0.01) // the offsets above are chosen relative to it
      const { regions, unlabeled: n_unlabeled } = derive_regions(data, options)
      expect(n_unlabeled).toBe(unlabeled)
      expect(regions.map((region) => region.phase).toSorted()).toEqual(phases)
      for (const [point, phase] of probes) expect(phase_at(regions, point), `${point}`).toBe(phase)
      // null: faces left unnamed, or a log axis that tiles log10(P) rather than data units
      if (area === null) return
      expect(total_area(regions)).toBeCloseTo(area, 6)
      // sorted largest first (paint order)
      const areas = regions.map((region) => Math.abs(polygon_signed_area(region.vertices)))
      expect(areas).toEqual(areas.toSorted((area_a, area_b) => area_b - area_a))
    },
  )

  // Ends chained within SNAP_TOL (u = 0.500, 0.508, 0.516: neighbors close, outer pair not)
  // join at one point whatever the boundary order; grouping around the first end found used
  // to split the chain and drop one or two phases depending on order
  // oxfmt-ignore
  test.each([[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]])(`chained ends in order %i%i%i`, (...order) => {
    const chained = triple(at_center, [[5.08, 5]], [[5.16, 5]])
    const boundaries = order.map((idx) => chained.boundaries[idx])
    const { regions, unlabeled } = derive_regions({ ...chained, boundaries })
    expect(unlabeled).toBe(0)
    for (const [point, phase] of triple_probes) expect(phase_at(regions, point)).toBe(phase)
  })

  test(`log pressure without any positive pressure throws`, () => {
    const data = { ...window_10, pressure_range: [-1, 0] as Vec2, phases: [], boundaries: [] }
    expect(() => derive_regions(data, { log_pressure: true })).toThrow(/positive pressure/)
  })

  // Known limitation, kept as expected failures so they flip once fixed: overshoots just past
  // SNAP_TOL don't cluster into one triple point (all three 0.07 past are 0.0108 of the window
  // apart), and in a 2-point tail only the last point moves to the cluster mean
  // oxfmt-ignore
  test.fails.each([
    [`all three 0.07 past`, overshoot_triple(0.07)],
    [`curved 2-point tail`, triple([[5, 5], [5.02, 5.04], [5.03, 5.08]], at_center, at_center)],
  ])(`overshooting triple point (%s) gives three labeled regions`, (_label, data) => {
    const phases = derive_regions(data).regions.map((region) => region.phase)
    expect(phases.toSorted()).toEqual([`a`, `b`, `c`])
  })
})

// Pixel deltas as the component builds them: +sigma moves up on screen (negative y)
const sigma = (x_px: number, y_px: number): PixelSigma => ({
  plus: [x_px, -y_px],
  minus: [-x_px, y_px],
})
const diag = 4 / Math.SQRT2
// [line, per-point delta, expected band (upper side, then lower reversed)]: a handful of
// flops on O(10) inputs, so 12 digits sits far above f64 eps
// oxfmt-ignore
test.each([
  // a temperature error widens a horizontal line by delta on each side...
  [`horizontal`, [[0, 0], [10, 0], [20, 0]], sigma(0, 3), [[0, 3], [10, 3], [20, 3], [20, -3], [10, -3], [0, -3]]],
  // ...and leaves a vertical one at zero width
  [`vertical`, [[0, 0], [0, 10], [0, 20]], sigma(0, 3), [[0, 0], [0, 10], [0, 20], [0, 20], [0, 10], [0, 0]]],
  // equal x and y sigma is a circle: half-width sigma along the normal (-1, 1)/√2
  [`45 degree, equal sigmas`, [[0, 0], [10, 10]], sigma(4, 4), [[-diag, diag], [10 - diag, 10 + diag], [10 + diag, 10 - diag], [diag, -diag]]],
  // on a log axis +sigma and -sigma move different distances; the normal points to +y here
  [`asymmetric`, [[0, 0], [10, 0]], { plus: [0, -2], minus: [0, 5] }, [[0, 5], [10, 5], [10, -2], [0, -2]]],
  // repeated points borrow a neighbor's normal (a repeated first point used to collapse it)
  [`trailing repeat`, [[0, 0], [10, 0], [10, 0]], sigma(0, 1), [[0, 1], [10, 1], [10, 1], [10, -1], [10, -1], [0, -1]]],
  [`leading repeat`, [[0, 0], [0, 0], [10, 0]], sigma(0, 1), [[0, 1], [0, 1], [10, 1], [10, -1], [0, -1], [0, -1]]],
] satisfies [string, Vec2[], PixelSigma, Vec2[]][])(`uncertainty_band: %s`, (_label, line, delta, expected) => {
  const band = uncertainty_band(line, line.map(() => delta))
  expect(band).toHaveLength(expected.length)
  band.forEach((point, idx) => {
    expect(point[0]).toBeCloseTo(expected[idx][0], 12)
    expect(point[1]).toBeCloseTo(expected[idx][1], 12)
  })
})

describe(`segment and polygon helpers`, () => {
  // oxfmt-ignore
  test.each([
    [[5, 3], [0, 0], [10, 0], { param: 0.5, dist: 3, foot: [5, 0] }],
    [[-4, 3], [0, 0], [10, 0], { param: 0, dist: 5, foot: [0, 0] }], // clamped to start
    [[13, 4], [0, 0], [10, 0], { param: 1, dist: 5, foot: [10, 0] }], // clamped to end
    [[3, 4], [0, 0], [0, 0], { param: 0, dist: 5, foot: [0, 0] }], // zero-length segment
  ] satisfies [Vec2, Vec2, Vec2, ReturnType<typeof closest_on_segment>][])(`closest_on_segment(%j, %j, %j)`, (point, start, end, expected) => {
    expect(closest_on_segment(point, start, end)).toEqual(expected)
  })

  // oxfmt-ignore
  test(`nearest_on_polylines picks the closest segment across lines`, () => {
    const lines: Vec2[][] = [[[0, 0], [10, 0]], [[0, 5], [10, 5], [10, 15]]]
    expect(nearest_on_polylines([12, 10], lines)).toEqual({ line_idx: 1, seg_idx: 1, param: 0.5, dist: 2, foot: [10, 10] })
    expect(nearest_on_polylines([4, 1], lines)).toEqual({ line_idx: 0, seg_idx: 0, param: 0.4, dist: 1, foot: [4, 0] })
    // no segments: empty input or single-point lines
    expect(nearest_on_polylines([0, 0], [])).toBeNull()
    expect(nearest_on_polylines([0, 0], [[[1, 1]]])).toBeNull()
  })

  test.each([
    [[1, 3, 7], 0, 0.5, 2],
    [[1, 3, 7], 1, 0.25, 4],
    [[1, 3, 7], 1, 1, 7],
    [undefined, 0, 0.5, null],
  ] as const)(`interpolate_at(%j, %d, %d) = %j`, (values, seg_idx, param, expected) => {
    expect(interpolate_at(values, seg_idx, param)).toBe(expected)
  })

  // Axis-aligned clips of small integers are exact
  const square = (min: number, size: number): Vec2[] => [
    [min, min],
    [min + size, min],
    [min + size, min + size],
    [min, min + size],
  ]
  test.each([
    [`partial overlap`, square(0, 10), [5, 5, 15, 15], 25],
    [`fully inside`, square(2, 4), [0, 0, 10, 10], 16],
    [`fully outside`, square(20, 4), [0, 0, 10, 10], 0],
    [`rect inside polygon`, square(0, 10), [2, 3, 6, 5], 8],
  ] satisfies [string, Vec2[], [number, number, number, number], number][])(
    `clip_polygon_to_rect: %s`,
    (_label, polygon, rect, area) => {
      const clipped = clip_polygon_to_rect(polygon, rect)
      expect(Math.abs(polygon_signed_area(clipped))).toBe(area)
      const [x_min, y_min, x_max, y_max] = rect
      for (const [x_px, y_px] of clipped) {
        expect(x_px >= x_min && x_px <= x_max && y_px >= y_min && y_px <= y_max).toBe(true)
      }
    },
  )
})
