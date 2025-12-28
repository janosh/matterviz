import type { PhaseDiagramData, PhaseRegion } from '$lib/phase-diagram/types'
import {
  calculate_lever_rule,
  calculate_polygon_bounds,
  calculate_polygon_centroid,
  compute_label_properties,
  find_phase_at_point,
  format_composition,
  format_temperature,
  generate_boundary_path,
  generate_region_path,
  get_default_phase_color,
  is_two_phase_region,
  merge_phase_diagram_config,
  PHASE_COLORS,
  PHASE_DIAGRAM_DEFAULTS,
  point_in_polygon,
  transform_vertices,
} from '$lib/phase-diagram/utils'
import { describe, expect, test } from 'vitest'

describe(`point_in_polygon`, () => {
  const square: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]

  test.each([
    { point_x: 0.5, point_y: 0.5, expected: true, desc: `center point` },
    { point_x: 0.1, point_y: 0.1, expected: true, desc: `near corner` },
    { point_x: 0.9, point_y: 0.9, expected: true, desc: `near opposite corner` },
    { point_x: 2, point_y: 2, expected: false, desc: `outside point` },
    { point_x: -1, point_y: 0.5, expected: false, desc: `left of polygon` },
    { point_x: 0.5, point_y: -1, expected: false, desc: `below polygon` },
  ])(
    `$desc: point ($point_x, $point_y) returns $expected`,
    ({ point_x, point_y, expected }) => {
      expect(point_in_polygon(point_x, point_y, square)).toBe(expected)
    },
  )

  test(`returns false for polygon with fewer than 3 vertices`, () => {
    expect(point_in_polygon(0.5, 0.5, [[0, 0], [1, 1]])).toBe(false)
    expect(point_in_polygon(0.5, 0.5, [[0, 0]])).toBe(false)
    expect(point_in_polygon(0.5, 0.5, [])).toBe(false)
  })

  test(`handles triangle correctly`, () => {
    const triangle: [number, number][] = [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ]
    expect(point_in_polygon(0.5, 0.3, triangle)).toBe(true)
    expect(point_in_polygon(0.9, 0.9, triangle)).toBe(false)
  })
})

describe(`find_phase_at_point`, () => {
  const test_data: PhaseDiagramData = {
    components: [`A`, `B`],
    temperature_range: [300, 900],
    regions: [
      {
        id: `liquid`,
        name: `Liquid`,
        vertices: [
          [0, 700],
          [1, 700],
          [1, 900],
          [0, 900],
        ],
      },
      {
        id: `solid`,
        name: `Solid`,
        vertices: [
          [0, 300],
          [1, 300],
          [1, 700],
          [0, 700],
        ],
      },
    ],
    boundaries: [],
  }

  test(`finds liquid phase at high temperature`, () => {
    const result = find_phase_at_point(0.5, 800, test_data)
    expect(result).not.toBeNull()
    expect(result?.name).toBe(`Liquid`)
  })

  test(`finds solid phase at low temperature`, () => {
    const result = find_phase_at_point(0.5, 500, test_data)
    expect(result).not.toBeNull()
    expect(result?.name).toBe(`Solid`)
  })

  test(`returns null for point outside all regions`, () => {
    const result = find_phase_at_point(0.5, 1000, test_data)
    expect(result).toBeNull()
  })

  test(`later-defined regions take precedence (overlapping)`, () => {
    const overlapping_data: PhaseDiagramData = {
      ...test_data,
      regions: [
        {
          id: `first`,
          name: `First`,
          vertices: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
        {
          id: `second`,
          name: `Second`,
          vertices: [
            [0.25, 0.25],
            [0.75, 0.25],
            [0.75, 0.75],
            [0.25, 0.75],
          ],
        },
      ],
    }
    const result = find_phase_at_point(0.5, 0.5, overlapping_data)
    expect(result?.name).toBe(`Second`)
  })
})

describe(`generate_region_path`, () => {
  test(`generates correct SVG path for square`, () => {
    const vertices: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]
    expect(generate_region_path(vertices)).toBe(`M 0 0 L 100 0 L 100 100 L 0 100 Z`)
  })

  test(`returns empty string for fewer than 3 vertices`, () => {
    expect(generate_region_path([[0, 0], [1, 1]])).toBe(``)
    expect(generate_region_path([[0, 0]])).toBe(``)
    expect(generate_region_path([])).toBe(``)
  })
})

describe(`generate_boundary_path`, () => {
  test(`generates correct SVG path for line`, () => {
    const points: [number, number][] = [
      [0, 0],
      [50, 50],
      [100, 100],
    ]
    expect(generate_boundary_path(points)).toBe(`M 0 0 L 50 50 L 100 100`)
  })

  test(`returns empty string for fewer than 2 points`, () => {
    expect(generate_boundary_path([[0, 0]])).toBe(``)
    expect(generate_boundary_path([])).toBe(``)
  })
})

describe(`calculate_polygon_centroid`, () => {
  test.each(
    [
      { vertices: [[0, 0], [2, 0], [2, 2], [0, 2]], expected: [1, 1], desc: `square` },
      { vertices: [[0, 0], [3, 0], [0, 3]], expected: [1, 1], desc: `triangle` },
      { vertices: [[0, 0], [4, 0], [4, 2], [0, 2]], expected: [2, 1], desc: `rectangle` },
      { vertices: [[5, 10]], expected: [5, 10], desc: `single vertex` },
      { vertices: [[0, 0], [10, 10]], expected: [5, 5], desc: `two vertices (midpoint)` },
      {
        vertices: [[0, 0], [1, 1], [2, 2]],
        expected: [1, 1],
        desc: `collinear (degenerate)`,
      },
      { vertices: [], expected: [0, 0], desc: `empty array` },
    ] as const,
  )(`$desc → ($expected)`, ({ vertices, expected }) => {
    const [cx, cy] = calculate_polygon_centroid([...vertices] as [number, number][])
    expect(cx).toBeCloseTo(expected[0], 5)
    expect(cy).toBeCloseTo(expected[1], 5)
  })
})

describe(`get_default_phase_color`, () => {
  test.each([
    [`Liquid`, PHASE_COLORS.liquid],
    [`L`, PHASE_COLORS.liquid],
    [`α`, PHASE_COLORS.alpha],
    [`alpha`, PHASE_COLORS.alpha],
    [`β`, PHASE_COLORS.beta],
    [`beta`, PHASE_COLORS.beta],
    [`γ`, PHASE_COLORS.gamma],
    [`gamma`, PHASE_COLORS.gamma],
    [`α + β`, PHASE_COLORS.two_phase],
    [`Unknown`, PHASE_COLORS.default],
  ])(`returns correct color for %s`, (phase_name, expected_color) => {
    expect(get_default_phase_color(phase_name)).toBe(expected_color)
  })
})

describe(`format_composition`, () => {
  test.each([
    [0.5, `at%`, `50.0 at%`],
    [0.25, `wt%`, `25.0 wt%`],
    [0.333, `fraction`, `0.333`],
    [0, `at%`, `0.0 at%`],
    [1, `at%`, `100.0 at%`],
  ])(`formats %d with unit %s as %s`, (value, unit, expected) => {
    expect(format_composition(value, unit)).toBe(expected)
  })
})

describe(`format_temperature`, () => {
  test.each([
    [500, `K`, `500 K`],
    [25, `°C`, `25 °C`],
    [77, `°F`, `77 °F`],
  ])(`formats %d with unit %s as %s`, (value, unit, expected) => {
    expect(format_temperature(value, unit)).toBe(expected)
  })
})

describe(`transform_vertices`, () => {
  test(`applies scale functions to vertices`, () => {
    const vertices: [number, number][] = [
      [0, 0],
      [1, 100],
      [0.5, 50],
    ]
    const x_scale = (val: number) => val * 200
    const y_scale = (val: number) => 100 - val

    const result = transform_vertices(vertices, x_scale, y_scale)

    expect(result).toEqual([
      [0, 100],
      [200, 0],
      [100, 50],
    ])
  })

  test(`returns empty array for empty input`, () => {
    const result = transform_vertices([], (val) => val, (val) => val)
    expect(result).toEqual([])
  })
})

describe(`is_two_phase_region`, () => {
  test.each([
    { name: `α + β`, expected: true },
    { name: `L + α`, expected: true },
    { name: `Liquid + Solid`, expected: true },
    { name: `Liquid`, expected: false },
    { name: `α`, expected: false },
    { name: `FCC_A1`, expected: false },
  ])(`returns $expected for region named "$name"`, ({ name, expected }) => {
    const region: PhaseRegion = { id: `test`, name, vertices: [] }
    expect(is_two_phase_region(region)).toBe(expected)
  })
})

describe(`calculate_lever_rule`, () => {
  // Two-phase region shaped like a trapezoid
  const two_phase_region: PhaseRegion = {
    id: `alpha-beta`,
    name: `α + β`,
    vertices: [
      [0.2, 400], // bottom-left
      [0.8, 400], // bottom-right
      [0.7, 600], // top-right
      [0.3, 600], // top-left
    ],
  }

  const single_phase_region: PhaseRegion = {
    id: `liquid`,
    name: `Liquid`,
    vertices: [
      [0, 700],
      [1, 700],
      [1, 900],
      [0, 900],
    ],
  }

  test(`returns null for single-phase regions`, () => {
    const result = calculate_lever_rule(single_phase_region, 0.5, 800)
    expect(result).toBeNull()
  })

  test(`parses phase names correctly`, () => {
    const result = calculate_lever_rule(two_phase_region, 0.5, 500)
    expect(result).not.toBeNull()
    expect(result?.left_phase).toBe(`α`)
    expect(result?.right_phase).toBe(`β`)
  })

  test(`calculates fractions at tie-line midpoint`, () => {
    // At temperature 500, the region spans from ~0.25 to ~0.75 (interpolated)
    const result = calculate_lever_rule(two_phase_region, 0.5, 500)
    expect(result).not.toBeNull()
    if (!result) return
    // At midpoint, fractions should be ~50% each
    expect(result.fraction_left).toBeCloseTo(0.5, 1)
    expect(result.fraction_right).toBeCloseTo(0.5, 1)
  })

  test(`calculates fractions near left boundary`, () => {
    const result = calculate_lever_rule(two_phase_region, 0.26, 500)
    expect(result).not.toBeNull()
    if (!result) return
    // Near left boundary: mostly left phase
    expect(result.fraction_left).toBeGreaterThan(0.9)
    expect(result.fraction_right).toBeLessThan(0.1)
  })

  test(`calculates fractions near right boundary`, () => {
    const result = calculate_lever_rule(two_phase_region, 0.74, 500)
    expect(result).not.toBeNull()
    if (!result) return
    // Near right boundary: mostly right phase
    expect(result.fraction_right).toBeGreaterThan(0.9)
    expect(result.fraction_left).toBeLessThan(0.1)
  })

  test(`fractions sum to 1`, () => {
    const compositions = [0.3, 0.4, 0.5, 0.6, 0.7]
    for (const comp of compositions) {
      const result = calculate_lever_rule(two_phase_region, comp, 500)
      expect(result).not.toBeNull()
      if (!result) continue
      expect(result.fraction_left + result.fraction_right).toBeCloseTo(1)
    }
  })

  test(`returns tie-line endpoints`, () => {
    const result = calculate_lever_rule(two_phase_region, 0.5, 500)
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.left_composition).toBeLessThan(result.right_composition)
    // At temp 500, left boundary should be between 0.2 and 0.3
    expect(result.left_composition).toBeGreaterThanOrEqual(0.2)
    expect(result.left_composition).toBeLessThanOrEqual(0.35)
  })

  test(`returns null for temperature outside region`, () => {
    // Temperature 300 is below the region (min temp is 400)
    const result = calculate_lever_rule(two_phase_region, 0.5, 300)
    expect(result).toBeNull()
  })

  test(`returns null for composition outside region`, () => {
    // Composition 0.1 is to the left of the region
    const result = calculate_lever_rule(two_phase_region, 0.1, 500)
    expect(result).toBeNull()
  })

  test(`handles edge case with just plus sign as region name`, () => {
    // Region with '+' but empty parts after split
    const unusual_region: PhaseRegion = {
      id: `unusual`,
      name: `+`, // Edge case: just a plus sign
      vertices: [
        [0.2, 400],
        [0.8, 400],
        [0.7, 600],
        [0.3, 600],
      ],
    }
    const result = calculate_lever_rule(unusual_region, 0.5, 500)
    expect(result).not.toBeNull()
    // With just '+', split gives ['', ''] - both empty strings
    expect(result?.left_phase).toBe(``)
    expect(result?.right_phase).toBe(``)
  })

  test(`parses complex phase names with spaces`, () => {
    const complex_region: PhaseRegion = {
      id: `complex`,
      name: `Liquid + FCC_A1`,
      vertices: [
        [0.2, 400],
        [0.8, 400],
        [0.7, 600],
        [0.3, 600],
      ],
    }
    const result = calculate_lever_rule(complex_region, 0.5, 500)
    expect(result).not.toBeNull()
    expect(result?.left_phase).toBe(`Liquid`)
    expect(result?.right_phase).toBe(`FCC_A1`)
  })
})

describe(`compute_label_properties`, () => {
  test(`returns valid result for normal bounds`, () => {
    const result = compute_label_properties(`Liquid`, { width: 100, height: 80 }, 12)
    expect(result.rotation).toBe(0)
    expect(result.lines).toEqual([`Liquid`])
    expect(result.scale).toBe(1)
    expect(Number.isNaN(result.rotation)).toBe(false)
    expect(Number.isNaN(result.scale)).toBe(false)
  })

  test.each([
    { width: 0, height: 100, desc: `zero width` },
    { width: 100, height: 0, desc: `zero height` },
    { width: 0, height: 0, desc: `zero width and height` },
    { width: -10, height: 50, desc: `negative width` },
    { width: 50, height: -10, desc: `negative height` },
  ])(`handles degenerate bounds: $desc`, ({ width, height }) => {
    const result = compute_label_properties(`Test`, { width, height }, 12)
    // Should return sensible defaults without NaN/Infinity
    expect(Number.isNaN(result.rotation)).toBe(false)
    expect(Number.isNaN(result.scale)).toBe(false)
    expect(Number.isFinite(result.rotation)).toBe(true)
    expect(Number.isFinite(result.scale)).toBe(true)
    expect(result.lines).toEqual([`Test`])
  })

  test(`handles empty label`, () => {
    const result = compute_label_properties(``, { width: 100, height: 80 }, 12)
    expect(result.lines).toEqual([])
    expect(result.rotation).toBe(0)
    expect(result.scale).toBe(1)
  })

  test(`handles zero font_size`, () => {
    const result = compute_label_properties(`Test`, { width: 100, height: 80 }, 0)
    expect(Number.isNaN(result.rotation)).toBe(false)
    expect(Number.isNaN(result.scale)).toBe(false)
    expect(result.lines).toEqual([`Test`])
  })

  test(`integrates correctly with calculate_polygon_bounds for empty vertices`, () => {
    // Simulate what happens with empty polygon
    const bounds = calculate_polygon_bounds([])
    expect(bounds.width).toBe(0)
    expect(bounds.height).toBe(0)

    // compute_label_properties should handle this gracefully
    const result = compute_label_properties(`Liquid`, bounds, 12)
    expect(Number.isNaN(result.rotation)).toBe(false)
    expect(Number.isNaN(result.scale)).toBe(false)
    expect(result.lines).toEqual([`Liquid`])
  })
})

describe(`merge_phase_diagram_config`, () => {
  test(`returns defaults when config is empty`, () => {
    const merged = merge_phase_diagram_config({})
    expect(merged.font_size).toBe(PHASE_DIAGRAM_DEFAULTS.font_size)
    expect(merged.special_point_radius).toBe(PHASE_DIAGRAM_DEFAULTS.special_point_radius)
    expect(merged.margin).toEqual(PHASE_DIAGRAM_DEFAULTS.margin)
    expect(merged.tie_line).toEqual(PHASE_DIAGRAM_DEFAULTS.tie_line)
    expect(merged.colors).toEqual(PHASE_DIAGRAM_DEFAULTS.colors)
  })

  test(`overrides font_size when provided`, () => {
    const merged = merge_phase_diagram_config({ font_size: 16 })
    expect(merged.font_size).toBe(16)
    expect(merged.special_point_radius).toBe(PHASE_DIAGRAM_DEFAULTS.special_point_radius)
  })

  test(`merges partial margin`, () => {
    const merged = merge_phase_diagram_config({ margin: { t: 50 } })
    expect(merged.margin.t).toBe(50)
    expect(merged.margin.r).toBe(PHASE_DIAGRAM_DEFAULTS.margin.r)
    expect(merged.margin.b).toBe(PHASE_DIAGRAM_DEFAULTS.margin.b)
    expect(merged.margin.l).toBe(PHASE_DIAGRAM_DEFAULTS.margin.l)
  })

  test(`merges partial tie_line`, () => {
    const merged = merge_phase_diagram_config({ tie_line: { stroke_width: 3 } })
    expect(merged.tie_line.stroke_width).toBe(3)
    expect(merged.tie_line.endpoint_radius).toBe(
      PHASE_DIAGRAM_DEFAULTS.tie_line.endpoint_radius,
    )
  })

  test(`merges partial colors`, () => {
    const merged = merge_phase_diagram_config({ colors: { background: `#ff0000` } })
    expect(merged.colors.background).toBe(`#ff0000`)
    expect(merged.colors.grid).toBe(PHASE_DIAGRAM_DEFAULTS.colors.grid)
  })
})
