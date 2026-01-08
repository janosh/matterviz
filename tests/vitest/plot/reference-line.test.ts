import type { IndexedRefLine } from '$lib/plot/reference-line'
import {
  calculate_annotation_position,
  diagonal_line,
  group_ref_lines_by_z,
  horizontal_line,
  horizontal_lines,
  index_ref_lines,
  line_segment,
  line_segment_3d,
  line_through,
  line_through_3d,
  line_x_axis,
  line_y_axis,
  line_z_axis,
  normalize_point,
  normalize_value,
  plane_normal,
  plane_through_points,
  plane_xy,
  plane_xz,
  plane_yz,
  resolve_line_endpoints,
  span_or,
  vertical_line,
  vertical_lines,
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

describe(`2D helper functions`, () => {
  test.each(
    [
      [`horizontal_line`, horizontal_line(50), { type: `horizontal`, y: 50 }],
      [`vertical_line`, vertical_line(100), { type: `vertical`, x: 100 }],
      [`diagonal_line`, diagonal_line(2, 10), {
        type: `diagonal`,
        slope: 2,
        intercept: 10,
      }],
      [`line_segment`, line_segment([0, 0], [100, 100]), {
        type: `segment`,
        p1: [0, 0],
        p2: [100, 100],
      }],
      [`line_through`, line_through([0, 0], [50, 100]), {
        type: `line`,
        p1: [0, 0],
        p2: [50, 100],
      }],
    ] as const,
  )(`%s creates correct RefLine`, (_, line, expected) => {
    expect(line).toMatchObject(expected)
  })

  test(`horizontal_line with options`, () => {
    expect(horizontal_line(50, { style: { color: `red` }, label: `Test` })).toMatchObject(
      {
        type: `horizontal`,
        y: 50,
        style: { color: `red` },
        label: `Test`,
      },
    )
  })

  test(`horizontal_lines creates array`, () => {
    const lines = horizontal_lines([10, 20, 30])
    expect(lines).toHaveLength(3)
    expect(lines.map((ln) => (ln as { y: number }).y)).toEqual([10, 20, 30])
  })

  test(`vertical_lines creates array with options`, () => {
    const lines = vertical_lines([5, 15], { style: { dash: `4 2` } })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ type: `vertical`, style: { dash: `4 2` } })
  })
})

describe(`3D helper functions`, () => {
  test.each(
    [
      [`plane_xy`, plane_xy(5), { type: `xy`, z: 5 }],
      [`plane_xz`, plane_xz(10), { type: `xz`, y: 10 }],
      [`plane_yz`, plane_yz(-5), { type: `yz`, x: -5 }],
      [`line_x_axis`, line_x_axis(5, 10), { type: `x-axis`, y: 5, z: 10 }],
      [`line_y_axis`, line_y_axis(5, 10), { type: `y-axis`, x: 5, z: 10 }],
      [`line_z_axis`, line_z_axis(5, 10), { type: `z-axis`, x: 5, y: 10 }],
      [`line_segment_3d`, line_segment_3d([0, 0, 0], [1, 1, 1]), {
        type: `segment`,
        p1: [0, 0, 0],
        p2: [1, 1, 1],
      }],
      [`line_through_3d`, line_through_3d([0, 0, 0], [1, 2, 3]), {
        type: `line`,
        p1: [0, 0, 0],
        p2: [1, 2, 3],
      }],
    ] as const,
  )(`%s creates correct object`, (_, obj, expected) => {
    expect(obj).toMatchObject(expected)
  })

  test(`plane_yz with options`, () => {
    expect(plane_yz(-5, { style: { opacity: 0.5 } })).toMatchObject({
      type: `yz`,
      x: -5,
      style: { opacity: 0.5 },
    })
  })

  test(`plane_normal creates plane from normal and point`, () => {
    expect(plane_normal([0, 0, 1], [0, 0, 5])).toMatchObject({
      type: `normal`,
      normal: [0, 0, 1],
      point: [0, 0, 5],
    })
  })

  test(`plane_through_points creates plane from 3 points`, () => {
    expect(plane_through_points([0, 0, 0], [1, 0, 0], [0, 1, 0])).toMatchObject({
      type: `points`,
      p1: [0, 0, 0],
      p2: [1, 0, 0],
      p3: [0, 1, 0],
    })
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

  test(`segment returns endpoints`, () => {
    expect(
      resolve_line_endpoints(
        { type: `segment`, p1: [10, 10], p2: [90, 90] },
        bounds,
        scales,
      ),
    ).not.toBeNull()
  })

  test(`diagonal line clips to bounds`, () => {
    expect(
      resolve_line_endpoints(
        { type: `diagonal`, slope: 1, intercept: 0 },
        bounds,
        scales,
      ),
    ).not.toBeNull()
  })

  test(`negative slope diagonal with x_span normalizes endpoint order`, () => {
    // Negative slope: y = -x + 100, so at x=0 y=100, at x=100 y=0
    // After y-clipping, endpoints may reverse order (x1 > x2)
    // x_span should still work correctly
    const result = resolve_line_endpoints(
      { type: `diagonal`, slope: -1, intercept: 100, x_span: [20, 80] },
      bounds,
      scales,
    )
    expect(result).not.toBeNull()
    // After normalization and span constraint, x should be [20, 80]
    expect(result?.[0]).toBe(scales.x_scale(20))
    expect(result?.[2]).toBe(scales.x_scale(80))
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

  test(`segment crossing bounds returns clipped endpoints`, () => {
    const result = resolve_line_endpoints(
      { type: `segment`, p1: [-50, 50], p2: [150, 50] },
      bounds,
      scales,
    )
    expect(result).not.toBeNull()
    expect(result?.[0]).toBe(scales.x_scale(0))
    expect(result?.[2]).toBe(scales.x_scale(100))
  })

  // All cases that should return null (line outside bounds)
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
