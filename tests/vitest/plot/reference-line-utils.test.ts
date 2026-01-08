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
} from '$lib/plot/reference-line-utils'
import type { IndexedRefLine } from '$lib/plot/reference-line-utils'
import type { RefLine } from '$lib/plot/types'
import { describe, expect, test, vi } from 'vitest'

describe(`normalize_value`, () => {
  test(`returns number as-is`, () => {
    expect(normalize_value(42)).toBe(42)
    expect(normalize_value(-3.14)).toBe(-3.14)
    expect(normalize_value(0)).toBe(0)
  })

  test(`converts Date to timestamp`, () => {
    const date = new Date(`2024-01-01T00:00:00Z`)
    expect(normalize_value(date)).toBe(date.getTime())
  })

  test(`parses ISO date string`, () => {
    const date_str = `2024-06-15`
    const expected = Date.parse(date_str)
    expect(normalize_value(date_str)).toBe(expected)
  })

  test(`parses numeric string`, () => {
    expect(normalize_value(`42.5`)).toBe(42.5)
    expect(normalize_value(`-100`)).toBe(-100)
  })

  test(`returns 0 for invalid string with warning`, () => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    expect(normalize_value(`invalid`)).toBe(0)
    expect(warn_spy).toHaveBeenCalledWith(expect.stringContaining(`Invalid RefLineValue`))
    warn_spy.mockRestore()
  })
})

describe(`normalize_point`, () => {
  test(`normalizes tuple of numbers`, () => {
    expect(normalize_point([10, 20])).toEqual([10, 20])
  })

  test(`normalizes tuple with Date`, () => {
    const date = new Date(`2024-01-01`)
    const result = normalize_point([date, 100])
    expect(result[0]).toBe(date.getTime())
    expect(result[1]).toBe(100)
  })
})

describe(`span_or`, () => {
  test(`returns range when span is undefined`, () => {
    expect(span_or(undefined, [0, 100])).toEqual([0, 100])
  })

  test(`applies span constraints when both values provided`, () => {
    expect(span_or([20, 80], [0, 100])).toEqual([20, 80])
  })

  test(`uses range start when span[0] is null`, () => {
    expect(span_or([null, 80], [0, 100])).toEqual([0, 80])
  })

  test(`uses range end when span[1] is null`, () => {
    expect(span_or([20, null], [0, 100])).toEqual([20, 100])
  })

  test(`returns range when both span values are null`, () => {
    expect(span_or([null, null], [10, 50])).toEqual([10, 50])
  })
})

describe(`2D helper functions`, () => {
  test(`horizontal_line creates correct RefLine`, () => {
    const line = horizontal_line(50)
    expect(line.type).toBe(`horizontal`)
    if (line.type === `horizontal`) expect(line.y).toBe(50)
  })

  test(`horizontal_line with options`, () => {
    const line = horizontal_line(50, { style: { color: `red` }, label: `Test` })
    expect(line.type).toBe(`horizontal`)
    if (line.type === `horizontal`) expect(line.y).toBe(50)
    expect(line.style?.color).toBe(`red`)
    expect(line.label).toBe(`Test`)
  })

  test(`vertical_line creates correct RefLine`, () => {
    const line = vertical_line(100)
    expect(line.type).toBe(`vertical`)
    if (line.type === `vertical`) expect(line.x).toBe(100)
  })

  test(`diagonal_line creates correct RefLine`, () => {
    const line = diagonal_line(2, 10)
    expect(line.type).toBe(`diagonal`)
    if (line.type === `diagonal`) {
      expect(line.slope).toBe(2)
      expect(line.intercept).toBe(10)
    }
  })

  test(`line_segment creates correct RefLine`, () => {
    const line = line_segment([0, 0], [100, 100])
    expect(line.type).toBe(`segment`)
    if (line.type === `segment`) {
      expect(line.p1).toEqual([0, 0])
      expect(line.p2).toEqual([100, 100])
    }
  })

  test(`line_through creates correct RefLine`, () => {
    const line = line_through([0, 0], [50, 100])
    expect(line.type).toBe(`line`)
    if (line.type === `line`) {
      expect(line.p1).toEqual([0, 0])
      expect(line.p2).toEqual([50, 100])
    }
  })

  test(`horizontal_lines creates array of RefLines`, () => {
    const lines = horizontal_lines([10, 20, 30])
    expect(lines).toHaveLength(3)
    expect(lines[0].type).toBe(`horizontal`)
    expect((lines[0] as { type: `horizontal`; y: number }).y).toBe(10)
    expect((lines[1] as { type: `horizontal`; y: number }).y).toBe(20)
    expect((lines[2] as { type: `horizontal`; y: number }).y).toBe(30)
  })

  test(`vertical_lines creates array of RefLines`, () => {
    const lines = vertical_lines([5, 15], { style: { dash: `4 2` } })
    expect(lines).toHaveLength(2)
    expect(lines[0].type).toBe(`vertical`)
    expect(lines[0].style?.dash).toBe(`4 2`)
  })
})

describe(`3D plane helper functions`, () => {
  test(`plane_xy creates horizontal plane`, () => {
    const plane = plane_xy(5)
    expect(plane.type).toBe(`xy`)
    if (plane.type === `xy`) expect(plane.z).toBe(5)
  })

  test(`plane_xz creates vertical plane at y`, () => {
    const plane = plane_xz(10)
    expect(plane.type).toBe(`xz`)
    if (plane.type === `xz`) expect(plane.y).toBe(10)
  })

  test(`plane_yz creates vertical plane at x`, () => {
    const plane = plane_yz(-5, { style: { opacity: 0.5 } })
    expect(plane.type).toBe(`yz`)
    if (plane.type === `yz`) expect(plane.x).toBe(-5)
    expect(plane.style?.opacity).toBe(0.5)
  })

  test(`plane_normal creates plane from normal and point`, () => {
    const plane = plane_normal([0, 0, 1], [0, 0, 5])
    expect(plane.type).toBe(`normal`)
    if (plane.type === `normal`) {
      expect(plane.normal).toEqual([0, 0, 1])
      expect(plane.point).toEqual([0, 0, 5])
    }
  })

  test(`plane_through_points creates plane from 3 points`, () => {
    const plane = plane_through_points([0, 0, 0], [1, 0, 0], [0, 1, 0])
    expect(plane.type).toBe(`points`)
    if (plane.type === `points`) {
      expect(plane.p1).toEqual([0, 0, 0])
      expect(plane.p2).toEqual([1, 0, 0])
      expect(plane.p3).toEqual([0, 1, 0])
    }
  })
})

describe(`3D line helper functions`, () => {
  test(`line_x_axis creates line parallel to x`, () => {
    const line = line_x_axis(5, 10)
    expect(line.type).toBe(`x-axis`)
    if (line.type === `x-axis`) {
      expect(line.y).toBe(5)
      expect(line.z).toBe(10)
    }
  })

  test(`line_y_axis creates line parallel to y`, () => {
    const line = line_y_axis(5, 10)
    expect(line.type).toBe(`y-axis`)
    if (line.type === `y-axis`) {
      expect(line.x).toBe(5)
      expect(line.z).toBe(10)
    }
  })

  test(`line_z_axis creates line parallel to z`, () => {
    const line = line_z_axis(5, 10)
    expect(line.type).toBe(`z-axis`)
    if (line.type === `z-axis`) {
      expect(line.x).toBe(5)
      expect(line.y).toBe(10)
    }
  })

  test(`line_segment_3d creates 3D segment`, () => {
    const line = line_segment_3d([0, 0, 0], [1, 1, 1])
    expect(line.type).toBe(`segment`)
    if (line.type === `segment`) {
      expect(line.p1).toEqual([0, 0, 0])
      expect(line.p2).toEqual([1, 1, 1])
    }
  })

  test(`line_through_3d creates extended 3D line`, () => {
    const line = line_through_3d([0, 0, 0], [1, 2, 3])
    expect(line.type).toBe(`line`)
    if (line.type === `line`) {
      expect(line.p1).toEqual([0, 0, 0])
      expect(line.p2).toEqual([1, 2, 3])
    }
  })
})

describe(`resolve_line_endpoints`, () => {
  const bounds = {
    x_min: 0,
    x_max: 100,
    y_min: 0,
    y_max: 100,
    pad: { l: 10, r: 10, t: 10, b: 10 },
    width: 200,
    height: 200,
  }
  const scales = {
    x_scale: (val: number) => 10 + val * 1.8, // maps 0-100 to 10-190
    y_scale: (val: number) => 190 - val * 1.8, // maps 0-100 to 190-10 (inverted)
  }

  test(`horizontal line returns correct endpoints`, () => {
    const line: RefLine = { type: `horizontal`, y: 50 }
    const result = resolve_line_endpoints(line, bounds, scales)
    expect(result).not.toBeNull()
    if (result) {
      expect(result[1]).toBe(result[3]) // y1 === y2 for horizontal
      expect(result[0]).toBe(scales.x_scale(0)) // x1 at x_min
      expect(result[2]).toBe(scales.x_scale(100)) // x2 at x_max
    }
  })

  test(`vertical line returns correct endpoints`, () => {
    const line: RefLine = { type: `vertical`, x: 50 }
    const result = resolve_line_endpoints(line, bounds, scales)
    expect(result).not.toBeNull()
    if (result) {
      expect(result[0]).toBe(result[2]) // x1 === x2 for vertical
    }
  })

  test(`line outside visible range returns null`, () => {
    const line: RefLine = { type: `horizontal`, y: 150 } // outside y_max
    const result = resolve_line_endpoints(line, bounds, scales)
    expect(result).toBeNull()
  })

  test(`x_span constrains horizontal line`, () => {
    const line: RefLine = { type: `horizontal`, y: 50, x_span: [20, 80] }
    const result = resolve_line_endpoints(line, bounds, scales)
    expect(result).not.toBeNull()
    if (result) {
      expect(result[0]).toBe(scales.x_scale(20))
      expect(result[2]).toBe(scales.x_scale(80))
    }
  })

  test(`y_span constrains vertical line`, () => {
    const line: RefLine = { type: `vertical`, x: 50, y_span: [10, 90] }
    const result = resolve_line_endpoints(line, bounds, scales)
    expect(result).not.toBeNull()
    if (result) {
      // In SVG, y-axis is inverted: y=0 is at top, increasing downward
      // So y_scale(10) gives a larger pixel value (lower on screen) than y_scale(90)
      // result[1] is y1 (start), result[3] is y2 (end)
      expect(result[1]).toBe(scales.y_scale(10))
      expect(result[3]).toBe(scales.y_scale(90))
    }
  })

  test(`segment returns correct endpoints`, () => {
    const line: RefLine = { type: `segment`, p1: [10, 10], p2: [90, 90] }
    const result = resolve_line_endpoints(line, bounds, scales)
    expect(result).not.toBeNull()
  })

  test(`diagonal line clips to bounds`, () => {
    const line: RefLine = { type: `diagonal`, slope: 1, intercept: 0 }
    const result = resolve_line_endpoints(line, bounds, scales)
    expect(result).not.toBeNull()
  })

  test(`diagonal line with slope 0 within bounds returns endpoints`, () => {
    // Horizontal diagonal line (slope = 0) at y = 50
    const line: RefLine = { type: `diagonal`, slope: 0, intercept: 50 }
    const result = resolve_line_endpoints(line, bounds, scales)
    expect(result).not.toBeNull()
    if (result) {
      // Should span the full x range at y = 50
      expect(result[0]).toBe(scales.x_scale(0))
      expect(result[2]).toBe(scales.x_scale(100))
      expect(result[1]).toBe(scales.y_scale(50))
      expect(result[3]).toBe(scales.y_scale(50))
    }
  })

  test(`diagonal line with slope 0 outside bounds returns null`, () => {
    // Horizontal diagonal line outside y bounds - should return null, not divide by zero
    const line: RefLine = { type: `diagonal`, slope: 0, intercept: 150 }
    const result = resolve_line_endpoints(line, bounds, scales)
    expect(result).toBeNull()
  })
})

describe(`calculate_annotation_position`, () => {
  test(`position end on horizontal line`, () => {
    const pos = calculate_annotation_position(0, 100, 200, 100, {
      position: `end`,
      side: `above`,
    })
    // At end, with default edge_padding=4, position is pulled 4px inward
    expect(pos.x).toBe(196) // 200 - 4
    expect(pos.text_anchor).toBe(`end`)
  })

  test(`position center on line`, () => {
    const pos = calculate_annotation_position(0, 100, 200, 100, {
      position: `center`,
    })
    expect(pos.x).toBe(100) // middle of line (no edge_padding for center)
    expect(pos.text_anchor).toBe(`middle`)
  })

  test(`position start on line`, () => {
    const pos = calculate_annotation_position(0, 100, 200, 100, {
      position: `start`,
    })
    // At start, with default edge_padding=4, position is pulled 4px inward
    expect(pos.x).toBe(4) // 0 + 4
    expect(pos.text_anchor).toBe(`start`)
  })

  test(`offset is applied`, () => {
    // For a horizontal line (y1 === y2), the perpendicular direction is vertical
    // x offset moves along the line, y offset moves perpendicular to it
    const pos = calculate_annotation_position(0, 100, 200, 100, {
      position: `center`,
      offset: { x: 10, y: -5 },
    })
    // Center of line is at x=100, with x offset of 10 applied
    expect(pos.x).toBe(110)
    // Default perpendicular offset is 8px (above), plus user offset of -5
    // For horizontal line with side=above (default): base_y=100, perp_y=-8, offset_y=-5
    // final_y = 100 + (-8) + (-5) = 87
    expect(pos.y).toBe(87)
  })

  test(`rotation calculated for diagonal line`, () => {
    const pos = calculate_annotation_position(0, 0, 100, 100, {
      position: `center`,
      rotate: true,
    })
    expect(pos.rotation).toBeDefined()
    expect(pos.rotation).toBeCloseTo(45, 0)
  })
})

describe(`index_ref_lines`, () => {
  test(`returns empty array for undefined input`, () => {
    expect(index_ref_lines(undefined)).toEqual([])
  })

  test(`returns empty array for empty input`, () => {
    expect(index_ref_lines([])).toEqual([])
  })

  test(`adds index to each line`, () => {
    const lines: RefLine[] = [
      { type: `horizontal`, y: 10 },
      { type: `vertical`, x: 20 },
    ]
    const result = index_ref_lines(lines)
    expect(result).toHaveLength(2)
    expect(result[0].idx).toBe(0)
    expect(result[1].idx).toBe(1)
  })

  test(`filters out invisible lines`, () => {
    const lines: RefLine[] = [
      { type: `horizontal`, y: 10, visible: false },
      { type: `vertical`, x: 20 },
      { type: `horizontal`, y: 30, visible: false },
    ]
    const result = index_ref_lines(lines)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe(`vertical`)
    expect(result[0].idx).toBe(0)
  })
})

describe(`group_ref_lines_by_z`, () => {
  test(`returns empty groups for empty input`, () => {
    const result = group_ref_lines_by_z([])
    expect(result.below_grid).toEqual([])
    expect(result.below_lines).toEqual([])
    expect(result.below_points).toEqual([])
    expect(result.above_all).toEqual([])
  })

  test(`groups lines by z_index correctly`, () => {
    const lines: IndexedRefLine[] = [
      { type: `horizontal`, y: 1, z_index: `below-grid`, idx: 0 },
      { type: `horizontal`, y: 2, z_index: `below-lines`, idx: 1 },
      { type: `horizontal`, y: 3, z_index: `below-points`, idx: 2 },
      { type: `horizontal`, y: 4, z_index: `above-all`, idx: 3 },
    ]
    const result = group_ref_lines_by_z(lines)
    expect(result.below_grid).toHaveLength(1)
    expect(result.below_lines).toHaveLength(1)
    expect(result.below_points).toHaveLength(1)
    expect(result.above_all).toHaveLength(1)
  })

  test(`defaults to below-lines when z_index is undefined`, () => {
    const lines: IndexedRefLine[] = [
      { type: `horizontal`, y: 1, idx: 0 },
      { type: `vertical`, x: 2, idx: 1 },
    ]
    const result = group_ref_lines_by_z(lines)
    expect(result.below_lines).toHaveLength(2)
    expect(result.below_grid).toHaveLength(0)
    expect(result.below_points).toHaveLength(0)
    expect(result.above_all).toHaveLength(0)
  })
})
