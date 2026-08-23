import type { Vec2 } from '$lib/math'
import { place_reference_annotation, solve_decorations } from '$lib/plot/core/decorations'
import {
  calculate_annotation_position,
  create_reference_annotation_candidates,
  estimate_reference_annotation_metrics,
  index_ref_lines,
  normalize_point,
  normalize_value,
  reference_annotation_text_rect,
  resolve_line_endpoints,
  solve_reference_annotations,
  span_or,
} from '$lib/plot/core/reference-line'
import type { RefLine } from '$lib/plot/core/types'
import { clear_text_metrics_cache } from '$lib/plot/core/text-metrics'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mock_canvas_context } from '../setup'

describe(`normalize_value`, () => {
  test.each([
    [42, 42],
    [-3.14, -3.14],
    [0, 0],
    [`42.5`, 42.5],
    [`-100`, -100],
    [new Date(`2024-01-01T00:00:00Z`), Date.parse(`2024-01-01T00:00:00Z`)],
    [`2024-06-15`, Date.parse(`2024-06-15`)],
  ])(`returns %s as %s`, (input, expected) => {
    expect(normalize_value(input)).toBe(expected)
  })

  test.each([
    `invalid`,
    `Infinity`,
    Infinity,
    -Infinity,
    Number.NaN,
    new Date(`invalid`),
    ``,
    ` `,
  ])(`throws for invalid value %j`, (input) => {
    expect(() => normalize_value(input)).toThrow(`Invalid reference line value`)
  })
})

test(`adding reference annotations preserves resolved base geometry`, () => {
  const base_solution = solve_decorations({
    base_pad: { t: 10, r: 10, b: 10, l: 10 },
    width: 400,
    height: 300,
    obstacles_norm: [],
    items: [{ id: `legend`, kind: `legend`, footprint: { width: 30, height: 40 } }],
  })
  base_solution.pad = { t: 30, r: 40, b: 20, l: 25 }
  base_solution.plot_bounds = { x: 25, y: 30, width: 335, height: 250 }
  const base_placement = base_solution.placements[0]
  const solution = solve_reference_annotations({
    base_solution,
    base_pad: base_solution.base_pad,
    width: 400,
    height: 300,
    obstacles_norm: [],
    lines: [{ idx: 0, type: `horizontal`, y: 5, annotation: { text: `Threshold` } }],
    ranges: { x: [0, 10], y: [0, 10] },
    scales: { x: (value) => 25 + value * 33.5, y: (value) => 280 - value * 25 },
  })

  expect(solution.pad).toBe(base_solution.pad)
  expect(solution.plot_bounds).toBe(base_solution.plot_bounds)
  expect(solution.placements[0]).toBe(base_placement)
  expect(solution.placements).toHaveLength(2)
})

test(`normalize_point normalizes numeric and Date tuples`, () => {
  expect(normalize_point([10, 20])).toEqual([10, 20])
  const date = new Date(`2024-01-01`)
  expect(normalize_point([date, 100])).toEqual([date.getTime(), 100])
})

test(`span_or fills nullish span bounds from the range`, () => {
  const range: Vec2 = [0, 100]
  expect(span_or(undefined, range)).toEqual(range)
  expect(span_or([20, 80], range)).toEqual([20, 80])
  expect(span_or([null, 80], range)).toEqual([0, 80])
  expect(span_or([20, null], range)).toEqual([20, 100])
  expect(span_or([null, null], [10, 50])).toEqual([10, 50])
})

describe(`resolve_line_endpoints`, () => {
  const bounds = { x_min: 0, x_max: 100, y_min: 0, y_max: 100 }
  const scales = {
    x_scale: (val: number) => 10 + val * 1.8,
    y_scale: (val: number) => 190 - val * 1.8,
  }
  const scaled_endpoints = (expected: readonly number[]) =>
    [
      scales.x_scale(expected[0]),
      scales.y_scale(expected[1]),
      scales.x_scale(expected[2]),
      scales.y_scale(expected[3]),
    ].map((value) => expect.closeTo(value, 8))

  // Expected [x1, y1, x2, y2] in data coords. Diagonal endpoints must stay paired: each
  // must satisfy y = slope·x + intercept, spans recompute the other coordinate instead of
  // clamping one independently
  test.each([
    [{ type: `horizontal`, y: 50 }, [0, 50, 100, 50]],
    [{ type: `horizontal`, y: 50, x_span: [20, 80] }, [20, 50, 80, 50]],
    [{ type: `vertical`, x: 50 }, [50, 0, 50, 100]],
    [{ type: `vertical`, x: 50, y_span: [10, 90] }, [50, 10, 50, 90]],
    [{ type: `diagonal`, slope: 0, intercept: 50 }, [0, 50, 100, 50]],
    [{ type: `diagonal`, slope: -1, intercept: 100, x_span: [20, 80] }, [20, 80, 80, 20]],
    [{ type: `diagonal`, slope: -1, intercept: 100 }, [0, 100, 100, 0]],
    [{ type: `diagonal`, slope: 1, intercept: 0, x_span: [20, 80] }, [20, 20, 80, 80]],
    [{ type: `diagonal`, slope: 1, intercept: 0, y_span: [30, 70] }, [30, 30, 70, 70]],
  ] as const)(`%o resolves expected endpoints`, (line, [x1, y1, x2, y2]) => {
    expect(resolve_line_endpoints(line as RefLine, bounds, scales)).toEqual(
      scaled_endpoints([x1, y1, x2, y2]),
    )
  })

  // Liang-Barsky segment clipping: preserves angle by computing true intersections
  test.each([
    {
      desc: `inside bounds`,
      p1: [10, 10] as Vec2,
      p2: [90, 90] as Vec2,
      expected: [10, 10, 90, 90],
    },
    {
      desc: `horizontal crossing x bounds`,
      p1: [-50, 50] as Vec2,
      p2: [150, 50] as Vec2,
      expected: [0, 50, 100, 50],
    },
    {
      desc: `diagonal crossing x bound (angle preserved)`,
      p1: [-10, 0] as Vec2,
      p2: [50, 100] as Vec2,
      expected: [0, 50 / 3, 50, 100],
    },
    {
      desc: `diagonal crossing all 4 bounds`,
      p1: [-50, -50] as Vec2,
      p2: [150, 150] as Vec2,
      expected: [0, 0, 100, 100],
    },
    {
      desc: `crossing only y bounds`,
      p1: [25, -25] as Vec2,
      p2: [75, 125] as Vec2,
      expected: [25 + 25 / 3, 0, 25 + 125 / 3, 100],
    },
  ])(`segment clipping: $desc`, ({ p1, p2, expected }) => {
    expect(resolve_line_endpoints({ type: `segment`, p1, p2 }, bounds, scales)).toEqual(
      scaled_endpoints(expected),
    )
  })

  test.each([
    // 45° line clipped to [20,80] x [30,70]; y_span is tighter so dominates
    { x_span: [20, 80], y_span: [30, 70], expected: [30, 30, 70, 70] },
    // spans wider than the plot never extend the clip rect past the visible bounds
    { x_span: [-500, 500], y_span: [null, 1000], expected: [0, 0, 100, 100] },
  ] as const)(
    `segment with x_span $x_span and y_span $y_span`,
    ({ x_span, y_span, expected }) => {
      const line: RefLine = {
        type: `segment`,
        p1: [-10, -10],
        p2: [110, 110],
        x_span: [...x_span],
        y_span: [...y_span],
      }
      expect(resolve_line_endpoints(line, bounds, scales)).toEqual(
        scaled_endpoints([...expected]),
      )
    },
  )

  // Lines outside bounds should return null
  test.each([
    { type: `horizontal`, y: 150 },
    { type: `diagonal`, slope: 0, intercept: 150 },
    { type: `diagonal`, slope: 1, intercept: 200 },
    { type: `diagonal`, slope: 1, intercept: -200 },
    { type: `diagonal`, slope: -1, intercept: 300 },
    { type: `diagonal`, slope: -1, intercept: -200 },
    { type: `line`, p1: [0, 200], p2: [100, 300] },
    { type: `line`, p1: [0, -200], p2: [100, -100] },
    { type: `line`, p1: [150, 0], p2: [150, 100] },
    { type: `line`, p1: [-50, 0], p2: [-50, 100] },
    { type: `segment`, p1: [150, 150], p2: [200, 200] },
    { type: `segment`, p1: [-50, -50], p2: [-10, -10] },
    { type: `segment`, p1: [150, 50], p2: [200, 50] },
    { type: `segment`, p1: [50, 150], p2: [50, 200] },
  ] as RefLine[])(`%o returns null`, (line) => {
    expect(resolve_line_endpoints(line, bounds, scales)).toBeNull()
  })
})

describe(`calculate_annotation_position`, () => {
  // Horizontal line: (0, 100) -> (200, 100)
  test.each([
    [`start`, 4, `start`],
    [`center`, 100, `middle`],
    [`end`, 196, `end`],
  ] as const)(`position %s on horizontal line`, (position, expected_x, expected_anchor) => {
    const pos = calculate_annotation_position(0, 100, 200, 100, {
      position,
      side: `above`,
    })
    expect(pos.x).toBe(expected_x)
    expect(pos.text_anchor).toBe(expected_anchor)
  })

  test(`offset is applied`, () => {
    const pos = calculate_annotation_position(0, 100, 200, 100, {
      position: `center`,
      offset: { x: 10, y: -5 },
    })
    expect(pos.x).toBe(110)
    expect(pos.y).toBe(87) // 100 + (-8 perp) + (-5 offset)
  })

  test(`rotation calculated for diagonal line`, () => {
    const pos = calculate_annotation_position(0, 0, 100, 100, {
      position: `center`,
      rotate: true,
    })
    expect(pos.rotation).toBeCloseTo(45, 0)
  })

  // Both vertical directions are regression coverage: bottom-to-top used to invert left/right.
  test.each([
    [`top-to-bottom vertical`, `left`, [100, 0, 100, 200], 90, 100, `end`],
    [`top-to-bottom vertical`, `right`, [100, 0, 100, 200], 110, 100, `start`],
    [`bottom-to-top vertical`, `left`, [100, 200, 100, 0], 90, 100, `end`],
    [`bottom-to-top vertical`, `right`, [100, 200, 100, 0], 110, 100, `start`],
    [`diagonal`, `left`, [0, 0, 100, 100], 50 - 10 / Math.SQRT2, 50 + 10 / Math.SQRT2, `end`],
    [
      `diagonal`,
      `right`,
      [0, 0, 100, 100],
      50 + 10 / Math.SQRT2,
      50 - 10 / Math.SQRT2,
      `start`,
    ],
    [`horizontal`, `left`, [0, 100, 200, 100], 100, 110, `end`],
    [`horizontal`, `right`, [0, 100, 200, 100], 100, 90, `start`],
  ] as const)(
    `%s: %s side offset`,
    (_name, side, line_endpoints, expected_x, expected_y, expected_anchor) => {
      const pos = calculate_annotation_position(
        line_endpoints[0],
        line_endpoints[1],
        line_endpoints[2],
        line_endpoints[3],
        {
          position: `center`,
          side,
          gap: 10,
        },
      )
      expect(pos.x).toBeCloseTo(expected_x, 5)
      expect(pos.y).toBeCloseTo(expected_y, 5)
      expect(pos.text_anchor).toBe(expected_anchor)
    },
  )
})

describe(`reference annotation candidates`, () => {
  const endpoints: [number, number, number, number] = [0, 100, 200, 100]
  const metrics = {
    text_width: 40,
    font_size: 12,
    text_ascent: 9,
    text_descent: 3,
    padding: 2,
  }
  beforeEach(clear_text_metrics_cache)
  afterEach(() => vi.restoreAllMocks())

  test(`uses measured glyph width and ascent for annotation footprints`, () => {
    mock_canvas_context({
      measureText: () => ({
        width: 37,
        actualBoundingBoxAscent: 9,
        actualBoundingBoxDescent: 3,
      }),
    })
    const measured = estimate_reference_annotation_metrics({ text: `Wiii`, padding: 3 })
    const candidate = create_reference_annotation_candidates(
      endpoints,
      { text: `Wiii`, padding: 3 },
      measured,
    )[0]
    expect(measured).toMatchObject({ text_width: 37, text_ascent: 9, text_descent: 3 })
    expect([candidate.rect.width, candidate.rect.height]).toEqual([43, 18])
  })

  test(`resolves relative em font-size before measuring annotation text`, () => {
    const context = mock_canvas_context({
      measureText: () => ({
        width: 20,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
      }),
    })
    vi.spyOn(window, `getComputedStyle`).mockReturnValue({
      fontFamily: `serif`,
      fontSize: `20px`,
      fontStyle: `normal`,
      fontVariant: `normal`,
      fontWeight: `400`,
      fontStretch: `normal`,
      lineHeight: `24px`,
    } as CSSStyleDeclaration)
    const measured = estimate_reference_annotation_metrics({
      text: `Em`,
      font_size: `1.5em`,
    })
    expect(measured.font_size).toBe(30)
    expect(context.font).toContain(`30px`)
  })

  test.each([
    [`above`, `auto`, `middle`, 100 - 9 - 2],
    [`below`, `hanging`, `middle`, 100 - 2],
    [`left`, `middle`, `end`, 100 - (9 + 3) / 2 - 2],
    [`right`, `middle`, `start`, 100 - (9 + 3) / 2 - 2],
  ] as const)(
    `baseline rectangle for %s starts from dominant baseline geometry`,
    (side, dominant_baseline, text_anchor, expected_y) => {
      const anchor = {
        x: 100,
        y: 100,
        text_anchor,
        dominant_baseline,
      }
      const rect = reference_annotation_text_rect(anchor, metrics)
      expect(rect.y).toBeCloseTo(expected_y, 10)
      expect([rect.width, rect.height]).toEqual([40 + 2 * 2, 9 + 3 + 2 * 2])
      const candidate = create_reference_annotation_candidates(
        endpoints,
        { text: `Label`, side, position: `center`, gap: 0 },
        metrics,
      )[0]
      expect(candidate.dominant_baseline).toBe(dominant_baseline)
      expect(candidate.rect.y).toBeCloseTo(
        reference_annotation_text_rect(candidate, metrics).y,
        10,
      )
    },
  )

  test(`moves an automatic annotation away from a colliding obstacle`, () => {
    const candidates = create_reference_annotation_candidates(endpoints, { text: `Threshold` })
    const [preferred] = candidates
    const { candidate } = place_reference_annotation({
      item: {
        id: `auto`,
        kind: `reference-annotation`,
        footprint: { width: preferred.rect.width, height: preferred.rect.height },
        candidates,
      },
      obstacles: [{ x: preferred.x, y: preferred.y }],
      exclusion_rects: [],
    })
    expect(candidate.side).toBe(`below`)
    expect(candidate.rect).not.toEqual(preferred.rect)
  })

  test.each([
    [`keeps exclusions costlier than dense obstacles`, [0, 100], true],
    [`prefers fewer obstacle collisions`, [100, 50], false],
  ] as const)(`%s`, (_name, obstacle_counts, exclude_first) => {
    const [first_candidate, second_candidate] = create_reference_annotation_candidates(
      endpoints,
      { text: `Dense obstacles` },
    )
    const points_in = (rect: typeof first_candidate.rect, count: number) =>
      Array.from({ length: count }, () => ({
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      }))
    const { candidate } = place_reference_annotation({
      item: {
        id: `dense-obstacle-order`,
        kind: `reference-annotation`,
        footprint: { width: 10, height: 10 },
        candidates: [first_candidate, second_candidate],
      },
      obstacles: [
        ...points_in(first_candidate.rect, obstacle_counts[0]),
        ...points_in(second_candidate.rect, obstacle_counts[1]),
      ],
      exclusion_rects: exclude_first ? [first_candidate.rect] : [],
    })
    expect(candidate).toBe(second_candidate)
  })

  test.each([
    [`position`, { position: `start` }],
    [`side`, { side: `left` }],
  ] as const)(
    `an explicit %s pins the annotation to a single candidate`,
    (_key, placement) => {
      const candidates = create_reference_annotation_candidates(endpoints, {
        text: `Pinned`,
        ...placement,
      })
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatchObject({ position: `end`, side: `above`, ...placement })
    },
  )

  test(`builds deterministic rotated candidates across positions and sides`, () => {
    const diagonal_endpoints: [number, number, number, number] = [0, 0, 100, 100]
    const candidates = create_reference_annotation_candidates(diagonal_endpoints, {
      text: `Diagonal`,
      rotate: true,
    })
    expect(candidates).toHaveLength(12)
    const candidate_names = [`end`, `center`, `start`].flatMap((position) =>
      [`above`, `below`, `right`, `left`].map((side) => `${position}-${side}`),
    )
    expect(candidates.map(({ position, side }) => `${position}-${side}`)).toEqual(
      candidate_names,
    )
    expect(candidates.every(({ rotation }) => rotation === 45)).toBe(true)
    expect(candidates[0].rect.height).toBeGreaterThan(20)
  })
})

describe(`index_ref_lines`, () => {
  test.each([[undefined], [[]]])(`returns empty array for %j input`, (input) => {
    expect(index_ref_lines(input as RefLine[] | undefined)).toEqual([])
  })

  test.each([
    {
      desc: `filters invisible lines`,
      lines: [
        { type: `horizontal`, y: 10, visible: false },
        { type: `vertical`, x: 20 },
        { type: `horizontal`, y: 30, visible: false },
      ] satisfies RefLine[],
      expected: [{ type: `vertical`, idx: 0 }],
    },
    {
      // `idx` is the keyed-each key, so lines sharing a public `id` must still get distinct keys
      desc: `keeps distinct idx for duplicate public ids`,
      lines: [
        { type: `horizontal`, y: 1, id: `dup` },
        { type: `horizontal`, y: 2, id: `dup` },
      ] satisfies RefLine[],
      expected: [
        { id: `dup`, y: 1, idx: 0 },
        { id: `dup`, y: 2, idx: 1 },
      ],
    },
  ])(`$desc`, ({ lines, expected }) => {
    const result = index_ref_lines(lines)
    // array toMatchObject checks length too
    expect(result).toMatchObject(expected)
    expect(new Set(result.map((line) => line.idx)).size).toBe(result.length)
  })
})
