import { point_in_polygon, polygon_signed_area, type Vec2 } from '#lib/math.js'
import type { PixelSigma } from '#lib/phase-diagram/pressure-temperature/geometry.js'
import {
  clip_polygon_to_rect,
  closest_on_segment,
  derive_regions,
  interpolate_at,
  nearest_on_polylines,
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

// 10 x 10 window with phases a (lower left), b (lower right) and c (top) meeting at a triple
// point near (5, 5). Each arg is the rest of a line after its start on the window edge; `extra`
// lines are appended.
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
const iron_probes: [Vec2, string][] = [
  [[2, 500], `alpha`],
  [[2, 1400], `gamma`],
  [[1, 1790], `delta`],
  [[2, 2500], `liquid`],
  [[50, 1000], `epsilon`],
  [[50, 3500], `liquid`],
  [[140, 2000], `epsilon`],
]
// Liquid and vapor meeting at a critical point inside the window, where their line just ends
// oxfmt-ignore
const critical_end = (special_points: PtPhaseDiagramData[`special_points`]): PtPhaseDiagramData => ({
  ...window_10,
  phases: [{ id: `s` }, { id: `l` }, { id: `g` }],
  boundaries: [boundary(`sl`, [`s`, `l`], [[3, 3], [3, 10]]), boundary(`sg`, [`s`, `g`], [[0, 0], [3, 3]]), boundary(`lg`, [`l`, `g`], [[3, 3], [8, 7]])],
  special_points,
})

describe(`derive_regions`, () => {
  // [data, options, named phases, unnamed faces, probe points → phase, area the regions tile]
  // Faces tile the window, so their areas sum to it: round-off is < 1e-9 on these O(1e3)
  // shoelace sums (|sum - 555000| measured 0), so 6 digits still catches any missing face
  // oxfmt-ignore
  test.each([
    [`iron demo`, iron_pt_diagram, {}, iron_phases, 0, [...iron_probes, [[200, 1000], null]], 150 * 3700],
    // traced in log10(P): 0 GPa endpoints are clipped, not clamped onto the window edge
    [`iron demo on a log axis`, iron_pt_diagram, { log_pressure: true }, iron_phases, 0, [[[1, 500], `alpha`], [[2, 1835], `delta`], [[50, 1000], `epsilon`]], null],
    // a window wider than the lines: ends short of its edge run on to it, on every side
    [`iron, window below the data`, { ...iron_pt_diagram, temperature_range: [250, 4000] }, {}, iron_phases, 0, [...iron_probes, [[12, 260], `alpha`], [[14, 260], `epsilon`]], 150 * 3750],
    [`iron, window right of the data`, { ...iron_pt_diagram, pressure_range: [0, 200] }, {}, iron_phases, 0, [...iron_probes, [[190, 3000], `epsilon`], [[170, 3900], `liquid`]], 200 * 3700],
    [`iron, custom point widening the window`, { ...iron_pt_diagram, temperature_range: undefined, special_points: [...(iron_pt_diagram.special_points ?? []), { id: `x`, type: `custom`, position: [50, 200] }] }, {}, iron_phases, 0, [...iron_probes, [[12, 210], `alpha`]], null],
    // α-γ and γ-δ run on left of 0 GPa and cross: both stop where they meet, so γ stays one
    // field, and α and δ, with no α|δ line between them out there, merge into an unnamed one
    [`iron, window left of the data`, { ...iron_pt_diagram, pressure_range: [-5, 150] }, {}, [`epsilon`, `gamma`, `liquid`], 1, [[[2, 1400], `gamma`], [[-4.9, 1300], null], [[-4.9, 1500], null]], null],
    [`triple point, window wider on every side`, { ...exact_triple, pressure_range: [-2, 12], temperature_range: [-3, 12] }, {}, [`a`, `b`, `c`], 0, [...triple_probes, [[-1, -2], `a`], [[11, -2], `b`], [[-1, 11], `c`]], 14 * 15],
    // without a tolerance, ends join at one triple point however far they stop short or overshoot
    [`exact triple point`, exact_triple, {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`ends up to 0.05 apart`, triple([[5, 5.03]], [[4.97, 5]], [[5.04, 4.98]]), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`one line 0.09 past the other two`, triple([[5, 5.09]], at_center, at_center), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`one line 0.15 short of the other two`, triple([[5, 4.85]], at_center, at_center), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`all three 0.05 past`, overshoot_triple(0.05), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`all three 0.07 past`, overshoot_triple(0.07), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`all three 1 past`, overshoot_triple(1), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`all three 0.5 short`, overshoot_triple(-0.5), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`straight 3-point tail 0.09 past`, triple([[5, 5], [5, 5.03], [5.01, 5.06], [5, 5.09]], at_center, at_center), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`curved 2-point tail`, triple([[5, 5], [5.02, 5.04], [5.03, 5.08]], at_center, at_center), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    [`metastable lines don't split regions`, triple(at_center, at_center, at_center, boundary(`ab-meta`, [`a`, `b`], [[5, 5], [5, 10]], true)), {}, [`a`, `b`, `c`], 0, triple_probes, 100],
    // b|c metastable merges b and c into one face touching only a|b and a|c: their shared
    // phase a names it after the phase across both lines, so every boundary must separate its
    // own two phases and neither side of a|b keeps a contradicting name
    [`face named against its boundaries`, { ...exact_triple, boundaries: exact_triple.boundaries.map((line) => ({ ...line, metastable: line.id === `bc` })) }, {}, [], 2, [], null],
    // a b|c line touching nothing runs on both ways, to a|c and the window edge: the c field
    // then lies on both sides of it, so neither side keeps a name
    [`free-floating line`, triple(at_center, at_center, at_center, boundary(`float`, [`b`, `c`], [[7, 8], [8, 9]])), {}, [`a`, `b`], 2, [[[5, 8], null]], null],
    // a closed c|d loop is a clockwise hole cycle the c face doesn't exclude: c would paint
    // over the island and hover report c inside it, so both stay unnamed
    [`island loop`, triple(at_center, at_center, at_center, boundary(`island`, [`c`, `d`], [[4, 7], [6, 7], [6, 9], [4, 9], [4, 7]])), {}, [`a`, `b`], 2, [[[5, 8], null], [[8, 8], null]], null],
    // a lone a|b line: no labeled neighbor says which side is which
    [`lone two-phase line`, { ...window_10, phases: [{ id: `a` }, { id: `b` }], boundaries: [boundary(`ab`, [`a`, `b`], [[0, 5], [10, 5]])] }, {}, [], 2, [], null],
    [`single phase, no boundaries`, { ...window_10, phases: [{ id: `a` }], boundaries: [] }, {}, [`a`], 0, [], 100],
    // an end at a critical point stays: liquid and gas share the face around it, which holds
    // two phases; without the critical point the l|g end runs on to the window edge
    [`line ending at a critical point`, critical_end([{ id: `cp`, type: `critical`, position: [8, 7] }]), {}, [`s`], 1, [[[1, 8], `s`], [[5, 8], null], [[8, 2], null]], null],
    [`same line, no critical point`, critical_end([]), {}, [`g`, `l`, `s`], 0, [[[1, 8], `s`], [[5, 8], `l`], [[8, 2], `g`]], 100],
    [`water without regions`, water_lines, { log_pressure: true }, [`ice-ih`], 1, [[[1e5, 250], `ice-ih`], [[1e5, 500], null]], null],
  ] satisfies [string, PtPhaseDiagramData, Parameters<typeof derive_regions>[1], string[], number, [Vec2, string | null][], number | null][])(
    `%s`,
    (_label, data, options, phases, unlabeled, probes, area) => {
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

  // Joining, trimming and extending never depend on the boundary order. Chained ends
  // (u = 0.500, 0.508, 0.516: neighbors close, outer pair not) used to split by order when
  // grouped around the first end found.
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]
  // oxfmt-ignore
  test.each([
    [`chained ends`, triple(at_center, [[5.08, 5]], [[5.16, 5]])],
    [`all three 0.3 past`, overshoot_triple(0.3)],
    [`one line short, window below`, { ...triple([[5, 4.8]], at_center, at_center), temperature_range: [-1, 10] as Vec2 }],
  ])(`%s in every boundary order`, (_label, data) => {
    // faces trace from a different start vertex per order, so compare phases and areas: the
    // same few flops on O(10) values, 12 digits sit far above f64 eps
    const summary = (boundaries: PtBoundary[]) => {
      const { regions, unlabeled } = derive_regions({ ...data, boundaries })
      expect(unlabeled).toBe(0)
      return regions.map((region): [string, number] => [
        region.phase,
        Math.abs(polygon_signed_area(region.vertices)),
      ])
    }
    const reference = summary(data.boundaries)
    const phases = reference.map(([phase]) => phase)
    expect(phases.toSorted((left, right) => left.localeCompare(right))).toEqual([`a`, `b`, `c`])
    for (const order of permutations) {
      const regions = summary(order.map((idx) => data.boundaries[idx]))
      expect(regions.map(([phase]) => phase)).toEqual(phases)
      regions.forEach(([, area], idx) => expect(area).toBeCloseTo(reference[idx][1], 12))
    }
  })

  // oxfmt-ignore
  test.each([
    [`no positive pressure`, { ...window_10, pressure_range: [-1, 0] as Vec2, phases: [], boundaries: [] }],
    // the one positive pressure is also the window's top: a log axis would span nothing
    [`zero log span`, { phases: [{ id: `a` }, { id: `b` }], boundaries: [boundary(`ab`, [`a`, `b`], [[0, 100], [5, 200]])] }],
  ] satisfies [string, PtPhaseDiagramData][])(`log pressure with %s throws`, (_label, data) => {
    expect(() => derive_regions(data, { log_pressure: true })).toThrow(/positive pressures spanning a range/)
  })
})

// Pixel deltas as the component builds them: +sigma moves up on screen (negative y)
const sigma = (x_px: number, y_px: number): PixelSigma => ({
  plus: [x_px, -y_px],
  minus: [-x_px, y_px],
})
// [line, per-point delta, expected band (upper side, then lower reversed)]: a handful of
// flops on O(10) inputs, so 12 digits sits far above f64 eps
// oxfmt-ignore
test.each([
  // a temperature error widens a horizontal line by delta on each side...
  [`horizontal`, [[0, 0], [10, 0], [20, 0]], sigma(0, 3), [[0, 3], [10, 3], [20, 3], [20, -3], [10, -3], [0, -3]]],
  // ...and leaves a vertical one at zero width
  [`vertical`, [[0, 0], [0, 10], [0, 20]], sigma(0, 3), [[0, 0], [0, 10], [0, 20], [0, 20], [0, 10], [0, 0]]],
  // on a slope-1 line consistent sigmas (σx / σy = slope) both shift it 4/√2 along the normal
  // (-1, 1)/√2: one error seen twice, so the max, not √2 times that from adding them
  [`slope 1, consistent sigmas`, [[0, 0], [10, 10]], sigma(4, 4), [[-2, 2], [8, 12], [12, 8], [2, -2]]],
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
