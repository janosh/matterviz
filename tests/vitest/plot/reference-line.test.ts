import type { IndexedRefLine } from '$lib/plot/reference-line'
import {
  calculate_annotation_position,
  group_ref_lines_by_z,
  index_ref_lines,
  normalize_point,
  normalize_value,
  resolve_line_endpoints,
  span_or,
} from '$lib/plot/reference-line'
import type { RefLine } from '$lib/plot/types'
import { describe, expect, test, vi } from 'vitest'

describe(`normalize_value`, () => {
  test.each([
    [42, 42, `number`],
    [-3.14, -3.14, `negative number`],
    [0, 0, `zero`],
    [`42.5`, 42.5, `numeric string`],
    [`-100`, -100, `negative numeric string`],
  ])(`returns %s as %s`, (input, expected, _desc) => {
    expect(normalize_value(input)).toBe(expected)
  })

  test(`converts Date to timestamp`, () => {
    const date = new Date(`2024-01-01T00:00:00Z`)
    expect(normalize_value(date)).toBe(date.getTime())
  })

  test(`parses ISO date string`, () => {
    const date_str = `2024-06-15`
    expect(normalize_value(date_str)).toBe(Date.parse(date_str))
  })

  test(`returns 0 for invalid string with warning`, () => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    expect(normalize_value(`invalid`)).toBe(0)
    expect(warn_spy).toHaveBeenCalledWith(expect.stringContaining(`Invalid RefLineValue`))
    warn_spy.mockRestore()
  })

  test.each([[``], [` `], [`  \t  `]])(
    `returns 0 for empty/whitespace string %j`,
    (input) => {
      const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
      expect(normalize_value(input)).toBe(0)
      expect(warn_spy).toHaveBeenCalledWith(expect.stringContaining(`empty string`))
      warn_spy.mockRestore()
    },
  )
})

describe(`normalize_point`, () => {
  test(`normalizes tuple of numbers`, () => {
    expect(normalize_point([10, 20])).toEqual([10, 20])
  })

  test(`normalizes tuple with Date`, () => {
    const date = new Date(`2024-01-01`)
    expect(normalize_point([date, 100])).toEqual([date.getTime(), 100])
  })
})

describe(`span_or`, () => {
  test.each<
    [[number | null, number | null] | undefined, [number, number], [number, number]]
  >([
    [undefined, [0, 100], [0, 100]],
    [[20, 80], [0, 100], [20, 80]],
    [[null, 80], [0, 100], [0, 80]],
    [[20, null], [0, 100], [20, 100]],
    [[null, null], [10, 50], [10, 50]],
  ])(`span_or(%j, %j) = %j`, (span, range, expected) => {
    expect(span_or(span, range)).toEqual(expected)
  })
})

describe(`resolve_line_endpoints`, () => {
  const bounds = { x_min: 0, x_max: 100, y_min: 0, y_max: 100 }
  const scales = {
    x_scale: (val: number) => 10 + val * 1.8,
    y_scale: (val: number) => 190 - val * 1.8,
  }

  test(`horizontal line returns correct endpoints`, () => {
    const result = resolve_line_endpoints({ type: `horizontal`, y: 50 }, bounds, scales)
    expect(result).not.toBeNull()
    expect(result?.[1]).toBe(result?.[3]) // y1 === y2
    expect(result?.[0]).toBe(scales.x_scale(0))
    expect(result?.[2]).toBe(scales.x_scale(100))
  })

  test(`vertical line returns correct endpoints`, () => {
    const result = resolve_line_endpoints({ type: `vertical`, x: 50 }, bounds, scales)
    expect(result).not.toBeNull()
    expect(result?.[0]).toBe(result?.[2]) // x1 === x2
  })

  test(`x_span constrains horizontal line`, () => {
    const result = resolve_line_endpoints(
      { type: `horizontal`, y: 50, x_span: [20, 80] },
      bounds,
      scales,
    )
    expect(result).not.toBeNull()
    expect(result?.[0]).toBe(scales.x_scale(20))
    expect(result?.[2]).toBe(scales.x_scale(80))
  })

  test(`y_span constrains vertical line`, () => {
    const result = resolve_line_endpoints(
      { type: `vertical`, x: 50, y_span: [10, 90] },
      bounds,
      scales,
    )
    expect(result).not.toBeNull()
    expect(result?.[1]).toBe(scales.y_scale(10))
    expect(result?.[3]).toBe(scales.y_scale(90))
  })

  test(`diagonal slope=0 within bounds returns endpoints`, () => {
    const result = resolve_line_endpoints(
      { type: `diagonal`, slope: 0, intercept: 50 },
      bounds,
      scales,
    )
    expect(result).toEqual([
      scales.x_scale(0),
      scales.y_scale(50),
      scales.x_scale(100),
      scales.y_scale(50),
    ])
  })

  test(`negative slope diagonal with x_span normalizes endpoint order`, () => {
    const result = resolve_line_endpoints(
      { type: `diagonal`, slope: -1, intercept: 100, x_span: [20, 80] },
      bounds,
      scales,
    )
    expect(result?.[0]).toBe(scales.x_scale(20))
    expect(result?.[2]).toBe(scales.x_scale(80))
  })

  // Liang-Barsky segment clipping: preserves angle by computing true intersections
  test.each([
    {
      desc: `horizontal crossing x bounds`,
      p1: [-50, 50] as [number, number],
      p2: [150, 50] as [number, number],
      expected: [0, 50, 100, 50],
    },
    {
      desc: `diagonal crossing x bound (angle preserved)`,
      p1: [-10, 0] as [number, number],
      p2: [50, 100] as [number, number],
      expected: [0, 50 / 3, 50, 100],
    },
    {
      desc: `diagonal crossing all 4 bounds`,
      p1: [-50, -50] as [number, number],
      p2: [150, 150] as [number, number],
      expected: [0, 0, 100, 100],
    },
    {
      desc: `crossing only y bounds`,
      p1: [25, -25] as [number, number],
      p2: [75, 125] as [number, number],
      expected: [25 + 25 / 3, 0, 25 + 125 / 3, 100],
    },
  ])(`segment clipping: $desc`, ({ p1, p2, expected }) => {
    const result = resolve_line_endpoints({ type: `segment`, p1, p2 }, bounds, scales)
    expect(result?.[0]).toBeCloseTo(scales.x_scale(expected[0]))
    expect(result?.[1]).toBeCloseTo(scales.y_scale(expected[1]))
    expect(result?.[2]).toBeCloseTo(scales.x_scale(expected[2]))
    expect(result?.[3]).toBeCloseTo(scales.y_scale(expected[3]))
  })

  test(`segment with x_span and y_span clips to span bounds`, () => {
    // 45° line clipped to [20,80] x [30,70]; y_span is tighter so dominates
    const result = resolve_line_endpoints(
      {
        type: `segment`,
        p1: [-10, -10],
        p2: [110, 110],
        x_span: [20, 80],
        y_span: [30, 70],
      },
      bounds,
      scales,
    )
    expect(result?.[0]).toBeCloseTo(scales.x_scale(30))
    expect(result?.[1]).toBeCloseTo(scales.y_scale(30))
    expect(result?.[2]).toBeCloseTo(scales.x_scale(70))
    expect(result?.[3]).toBeCloseTo(scales.y_scale(70))
  })

  // Lines inside bounds should return endpoints
  test.each(
    [
      [{ type: `segment`, p1: [10, 10], p2: [90, 90] }, `segment inside bounds`],
      [{ type: `diagonal`, slope: 1, intercept: 0 }, `diagonal clipped to bounds`],
    ] as const,
  )(`%s returns endpoints`, (line, _desc) => {
    expect(resolve_line_endpoints(line as RefLine, bounds, scales)).not.toBeNull()
  })

  // Lines outside bounds should return null
  test.each(
    [
      [{ type: `horizontal`, y: 150 }, `horizontal outside y_max`],
      [{ type: `diagonal`, slope: 0, intercept: 150 }, `diagonal slope=0 outside bounds`],
      [{ type: `diagonal`, slope: 1, intercept: 200 }, `diagonal entirely above y_max`],
      [{ type: `diagonal`, slope: 1, intercept: -200 }, `diagonal entirely below y_min`],
      [{ type: `diagonal`, slope: -1, intercept: 300 }, `negative slope above y_max`],
      [{ type: `diagonal`, slope: -1, intercept: -200 }, `negative slope below y_min`],
      [{ type: `line`, p1: [0, 200], p2: [100, 300] }, `line entirely above y_max`],
      [{ type: `line`, p1: [0, -200], p2: [100, -100] }, `line entirely below y_min`],
      [{ type: `line`, p1: [150, 0], p2: [150, 100] }, `nearly vertical outside x_max`],
      [{ type: `line`, p1: [-50, 0], p2: [-50, 100] }, `nearly vertical outside x_min`],
      [{ type: `segment`, p1: [150, 150], p2: [200, 200] }, `segment outside top-right`],
      [
        { type: `segment`, p1: [-50, -50], p2: [-10, -10] },
        `segment outside bottom-left`,
      ],
      [{ type: `segment`, p1: [150, 50], p2: [200, 50] }, `segment outside x_max`],
      [{ type: `segment`, p1: [50, 150], p2: [50, 200] }, `segment outside y_max`],
    ] as const,
  )(`%s returns null`, (line, _desc) => {
    expect(resolve_line_endpoints(line as RefLine, bounds, scales)).toBeNull()
  })
})

describe(`calculate_annotation_position`, () => {
  // Horizontal line: (0, 100) -> (200, 100)
  test.each(
    [
      [`start`, 4, `start`],
      [`center`, 100, `middle`],
      [`end`, 196, `end`],
    ] as const,
  )(`position %s on horizontal line`, (position, expected_x, expected_anchor) => {
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

  // Vertical line: (100, 0) -> (100, 200)
  test.each(
    [
      [`left`, 90, 100, `end`],
      [`right`, 110, 100, `start`],
    ] as const,
  )(
    `%s side offset for vertical line`,
    (side, expected_x, expected_y, expected_anchor) => {
      const pos = calculate_annotation_position(100, 0, 100, 200, {
        position: `center`,
        side,
        gap: 10,
      })
      expect(pos.x).toBe(expected_x)
      expect(pos.y).toBe(expected_y)
      expect(pos.text_anchor).toBe(expected_anchor)
    },
  )

  // Diagonal 45° line: (0, 0) -> (100, 100)
  test.each(
    [
      [`left`, 50 - 10 / Math.SQRT2, 50 + 10 / Math.SQRT2, `end`],
      [`right`, 50 + 10 / Math.SQRT2, 50 - 10 / Math.SQRT2, `start`],
    ] as const,
  )(
    `%s side perpendicular offset for diagonal`,
    (side, expected_x, expected_y, expected_anchor) => {
      const pos = calculate_annotation_position(0, 0, 100, 100, {
        position: `center`,
        side,
        gap: 10,
      })
      expect(pos.x).toBeCloseTo(expected_x, 5)
      expect(pos.y).toBeCloseTo(expected_y, 5)
      expect(pos.text_anchor).toBe(expected_anchor)
    },
  )

  // Horizontal line left/right: perpendicular is vertical
  test.each(
    [
      [`left`, 100, 110],
      [`right`, 100, 90],
    ] as const,
  )(`%s perpendicular offset for horizontal line`, (side, expected_x, expected_y) => {
    const pos = calculate_annotation_position(0, 100, 200, 100, {
      position: `center`,
      side,
      gap: 10,
    })
    expect(pos.x).toBe(expected_x)
    expect(pos.y).toBe(expected_y)
  })
})

describe(`index_ref_lines`, () => {
  test.each([[undefined], [[]]])(`returns empty array for %j input`, (input) => {
    expect(index_ref_lines(input as RefLine[] | undefined)).toEqual([])
  })

  test(`adds index and filters invisible lines`, () => {
    const lines: RefLine[] = [
      { type: `horizontal`, y: 10, visible: false },
      { type: `vertical`, x: 20 },
      { type: `horizontal`, y: 30, visible: false },
    ]
    const result = index_ref_lines(lines)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ type: `vertical`, idx: 0 })
  })
})

describe(`group_ref_lines_by_z`, () => {
  test(`returns empty groups for empty input`, () => {
    expect(group_ref_lines_by_z([])).toEqual({
      below_grid: [],
      below_lines: [],
      below_points: [],
      above_all: [],
    })
  })

  test(`groups lines by z_index, defaults to below-lines`, () => {
    const lines: IndexedRefLine[] = [
      { type: `horizontal`, y: 1, z_index: `below-grid`, idx: 0 },
      { type: `horizontal`, y: 2, z_index: `below-lines`, idx: 1 },
      { type: `horizontal`, y: 3, z_index: `below-points`, idx: 2 },
      { type: `horizontal`, y: 4, z_index: `above-all`, idx: 3 },
      { type: `horizontal`, y: 5, idx: 4 }, // no z_index → defaults to below-lines
    ]
    const result = group_ref_lines_by_z(lines)
    expect(result.below_grid).toHaveLength(1)
    expect(result.below_lines).toHaveLength(2) // includes default
    expect(result.below_points).toHaveLength(1)
    expect(result.above_all).toHaveLength(1)
  })
})
