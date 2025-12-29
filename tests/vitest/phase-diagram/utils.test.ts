import { point_in_polygon, polygon_centroid, type Vec2 } from '$lib/math'
import type { PhaseDiagramData, PhaseRegion } from '$lib/phase-diagram'
import {
  calculate_lever_rule,
  compute_label_properties,
  find_phase_at_point,
  format_composition,
  format_temperature,
  generate_boundary_path,
  generate_region_path,
  get_multi_phase_gradient,
  get_phase_color,
  get_phase_color_key,
  merge_phase_diagram_config,
  PHASE_COLOR_HEX,
  PHASE_COLORS,
  PHASE_DIAGRAM_DEFAULTS,
  transform_vertices,
} from '$lib/phase-diagram/utils'
import { describe, expect, test } from 'vitest'

describe(`point_in_polygon`, () => {
  const square: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const triangle: Vec2[] = [[0, 0], [1, 0], [0.5, 1]]

  test.each([
    {
      point_x: 0.5,
      point_y: 0.5,
      polygon: square,
      expected: true,
      desc: `center of square`,
    },
    { point_x: 0.1, point_y: 0.1, polygon: square, expected: true, desc: `near corner` },
    { point_x: 2, point_y: 2, polygon: square, expected: false, desc: `outside square` },
    {
      point_x: -1,
      point_y: 0.5,
      polygon: square,
      expected: false,
      desc: `left of square`,
    },
    {
      point_x: 0.5,
      point_y: 0.3,
      polygon: triangle,
      expected: true,
      desc: `inside triangle`,
    },
    {
      point_x: 0.9,
      point_y: 0.9,
      polygon: triangle,
      expected: false,
      desc: `outside triangle`,
    },
    {
      point_x: 0.5,
      point_y: 0.5,
      polygon: [[0, 0], [1, 1]] as Vec2[],
      expected: false,
      desc: `2 vertices`,
    },
    {
      point_x: 0.5,
      point_y: 0.5,
      polygon: [] as Vec2[],
      expected: false,
      desc: `empty polygon`,
    },
  ])(
    `$desc → $expected`,
    ({ point_x, point_y, polygon, expected }) => {
      expect(point_in_polygon(point_x, point_y, polygon)).toBe(expected)
    },
  )
})

describe(`find_phase_at_point`, () => {
  const test_data: PhaseDiagramData = {
    components: [`A`, `B`],
    temperature_range: [300, 900],
    regions: [
      {
        id: `liquid`,
        name: `Liquid`,
        vertices: [[0, 700], [1, 700], [1, 900], [0, 900]],
      },
      { id: `solid`, name: `Solid`, vertices: [[0, 300], [1, 300], [1, 700], [0, 700]] },
    ],
    boundaries: [],
  }

  test.each([
    { comp: 0.5, temp: 800, expected: `Liquid`, desc: `high temp → Liquid` },
    { comp: 0.5, temp: 500, expected: `Solid`, desc: `low temp → Solid` },
    { comp: 0.5, temp: 1000, expected: null, desc: `outside regions → null` },
  ])(`$desc`, ({ comp, temp, expected }) => {
    const result = find_phase_at_point(comp, temp, test_data)
    expect(result?.name ?? null).toBe(expected)
  })

  test(`later-defined regions take precedence (overlapping)`, () => {
    const overlapping_data: PhaseDiagramData = {
      ...test_data,
      regions: [
        { id: `first`, name: `First`, vertices: [[0, 0], [1, 0], [1, 1], [0, 1]] },
        {
          id: `second`,
          name: `Second`,
          vertices: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]],
        },
      ],
    }
    expect(find_phase_at_point(0.5, 0.5, overlapping_data)?.name).toBe(`Second`)
  })
})

describe(`generate_region_path`, () => {
  test.each([
    {
      vertices: [[0, 0], [100, 0], [100, 100], [0, 100]],
      expected: `M0,0L100,0L100,100L0,100 Z`,
    },
    { vertices: [[0, 0], [1, 1]], expected: `` },
    { vertices: [[0, 0]], expected: `` },
    { vertices: [], expected: `` },
  ] as { vertices: Vec2[]; expected: string }[])(
    `vertices.length=$vertices.length → "$expected"`,
    ({ vertices, expected }) => {
      expect(generate_region_path(vertices)).toBe(expected)
    },
  )
})

describe(`generate_boundary_path`, () => {
  test.each([
    { points: [[0, 0], [50, 50], [100, 100]], expected: `M0,0L50,50L100,100` },
    { points: [[0, 0]], expected: `` },
    { points: [], expected: `` },
  ] as { points: Vec2[]; expected: string }[])(
    `points.length=$points.length → "$expected"`,
    ({ points, expected }) => {
      expect(generate_boundary_path(points)).toBe(expected)
    },
  )
})

describe(`polygon_centroid`, () => {
  test.each(
    [
      { vertices: [[0, 0], [2, 0], [2, 2], [0, 2]], expected: [1, 1], desc: `square` },
      { vertices: [[0, 0], [3, 0], [0, 3]], expected: [1, 1], desc: `triangle` },
      { vertices: [[0, 0], [4, 0], [4, 2], [0, 2]], expected: [2, 1], desc: `rectangle` },
      { vertices: [[5, 10]], expected: [5, 10], desc: `single vertex` },
      { vertices: [[0, 0], [10, 10]], expected: [5, 5], desc: `two vertices` },
      { vertices: [], expected: [0, 0], desc: `empty array` },
    ] as const,
  )(`$desc → ($expected)`, ({ vertices, expected }) => {
    const [cx, cy] = polygon_centroid([...vertices] as Vec2[])
    expect(cx).toBeCloseTo(expected[0], 5)
    expect(cy).toBeCloseTo(expected[1], 5)
  })
})

describe(`get_phase_color`, () => {
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
  ])(`%s → correct color`, (phase_name, expected_color) => {
    expect(get_phase_color(phase_name)).toBe(expected_color)
  })
})

describe(`get_phase_color_key`, () => {
  test.each([
    // Greek letters
    [`α`, `alpha`],
    [`β`, `beta`],
    [`γ`, `gamma`],
    [`δ`, `delta`],
    [`ε`, `epsilon`],
    [`ζ`, `zeta`],
    [`η`, `eta`],
    [`θ`, `theta`],
    [`ι`, `iota`],
    [`κ`, `kappa`],
    [`λ`, `lambda`],
    // Latin names
    [`alpha`, `alpha`],
    [`beta`, `beta`],
    [`gamma`, `gamma`],
    [`delta`, `delta`],
    [`epsilon`, `epsilon`],
    [`zeta`, `zeta`],
    [`eta`, `eta`],
    [`theta`, `theta`],
    [`iota`, `iota`],
    [`kappa`, `kappa`],
    [`lambda`, `lambda`],
    // Special phases
    [`Liquid`, `liquid`],
    [`L`, `liquid`],
    [`FCC`, `alpha`],
    [`BCC`, `beta`],
    [`HCP`, `gamma`],
    // Lowercase prefixes (case insensitivity)
    [`fcc`, `alpha`],
    [`bcc`, `beta`],
    [`hcp`, `gamma`],
    // Prefix with suffix (common TDB notation)
    [`FCC_A1`, `alpha`],
    [`BCC_A2`, `beta`],
    [`HCP_A3`, `gamma`],
    // Case insensitivity for Greek names
    [`THETA`, `theta`],
    [`ETA`, `eta`],
    // Unknown
    [`Unknown`, `default`],
    [``, `default`],
  ])(`%s → %s`, (name, expected_key) => {
    expect(get_phase_color_key(name)).toBe(expected_key)
  })
})

describe(`get_multi_phase_gradient`, () => {
  test.each([`Liquid`, `α`, `Unknown`, ``, `FCC`])(
    `returns null for single-phase: %s`,
    (name) => {
      expect(get_multi_phase_gradient(name)).toBeNull()
    },
  )

  test(`returns 2 stops for two-phase regions`, () => {
    expect(get_multi_phase_gradient(`α + β`)).toEqual([
      { offset: 0, color: PHASE_COLOR_HEX.alpha },
      { offset: 1, color: PHASE_COLOR_HEX.beta },
    ])
  })

  test(`returns 3 evenly-spaced stops for three-phase regions`, () => {
    expect(get_multi_phase_gradient(`α + β + γ`)).toEqual([
      { offset: 0, color: PHASE_COLOR_HEX.alpha },
      { offset: 0.5, color: PHASE_COLOR_HEX.beta },
      { offset: 1, color: PHASE_COLOR_HEX.gamma },
    ])
  })

  test(`returns 4 evenly-spaced stops for four-phase regions`, () => {
    const result = get_multi_phase_gradient(`α + β + γ + δ`)
    expect(result).toHaveLength(4)
    expect(result?.map((s) => s.offset)).toEqual([0, 1 / 3, 2 / 3, 1])
  })

  test(`handles all extended phase colors (δ through θ)`, () => {
    expect(get_multi_phase_gradient(`δ + ε + ζ + η + θ`)).toEqual([
      { offset: 0, color: PHASE_COLOR_HEX.delta },
      { offset: 0.25, color: PHASE_COLOR_HEX.epsilon },
      { offset: 0.5, color: PHASE_COLOR_HEX.zeta },
      { offset: 0.75, color: PHASE_COLOR_HEX.eta },
      { offset: 1, color: PHASE_COLOR_HEX.theta },
    ])
  })

  test(`handles extended Greek letters (ι, κ, λ)`, () => {
    expect(get_multi_phase_gradient(`ι + κ + λ`)).toEqual([
      { offset: 0, color: PHASE_COLOR_HEX.iota },
      { offset: 0.5, color: PHASE_COLOR_HEX.kappa },
      { offset: 1, color: PHASE_COLOR_HEX.lambda },
    ])
  })

  test(`handles whitespace around + separators`, () => {
    expect(get_multi_phase_gradient(`  α   +   β   +   γ  `)?.map((s) => s.color))
      .toEqual([PHASE_COLOR_HEX.alpha, PHASE_COLOR_HEX.beta, PHASE_COLOR_HEX.gamma])
  })

  test(`filters empty phase names from splitting`, () => {
    expect(get_multi_phase_gradient(`α + + β`)).toEqual([
      { offset: 0, color: PHASE_COLOR_HEX.alpha },
      { offset: 1, color: PHASE_COLOR_HEX.beta },
    ])
  })

  test(`uses default color for unknown phases`, () => {
    expect(get_multi_phase_gradient(`Unknown1 + Unknown2 + α`)).toEqual([
      { offset: 0, color: PHASE_COLOR_HEX.default },
      { offset: 0.5, color: PHASE_COLOR_HEX.default },
      { offset: 1, color: PHASE_COLOR_HEX.alpha },
    ])
  })

  test(`Liquid + FCC + BCC → liquid + alpha + beta colors`, () => {
    expect(get_multi_phase_gradient(`Liquid + FCC + BCC`)?.map((s) => s.color))
      .toEqual([PHASE_COLOR_HEX.liquid, PHASE_COLOR_HEX.alpha, PHASE_COLOR_HEX.beta])
  })
})

describe(`format_composition`, () => {
  test.each([
    [0.5, `at%`, `50 at%`],
    [0.25, `wt%`, `25 wt%`],
    [0.333, `fraction`, `0.333`],
    [0, `at%`, `0 at%`],
    [1, `at%`, `100 at%`],
  ])(`%d with %s → %s`, (value, unit, expected) => {
    expect(format_composition(value, unit)).toBe(expected)
  })
})

describe(`format_temperature`, () => {
  test.each([
    [500, `K`, `500 K`],
    [25, `°C`, `25 °C`],
    [77, `°F`, `77 °F`],
  ])(`%d with %s → %s`, (value, unit, expected) => {
    expect(format_temperature(value, unit)).toBe(expected)
  })
})

describe(`transform_vertices`, () => {
  const x_scale = (val: number) => val * 200
  const y_scale = (val: number) => 100 - val

  test.each([
    { input: [[0, 0], [1, 100], [0.5, 50]], expected: [[0, 100], [200, 0], [100, 50]] },
    { input: [], expected: [] },
  ] as { input: Vec2[]; expected: Vec2[] }[])(
    `transforms $input.length vertices`,
    ({ input, expected }) => {
      expect(transform_vertices(input, x_scale, y_scale)).toEqual(expected)
    },
  )
})

describe(`calculate_lever_rule`, () => {
  const two_phase_region: PhaseRegion = {
    id: `alpha-beta`,
    name: `α + β`,
    vertices: [[0.2, 400], [0.8, 400], [0.7, 600], [0.3, 600]],
  }
  const single_phase_region: PhaseRegion = {
    id: `liquid`,
    name: `Liquid`,
    vertices: [[0, 700], [1, 700], [1, 900], [0, 900]],
  }

  const three_phase_region: PhaseRegion = {
    id: `alpha-beta-gamma`,
    name: `α + β + γ`,
    vertices: [[0.2, 400], [0.8, 400], [0.7, 600], [0.3, 600]],
  }

  test.each([
    { region: single_phase_region, comp: 0.5, temp: 800, desc: `single-phase region` },
    { region: two_phase_region, comp: 0.5, temp: 300, desc: `temp outside region` },
    { region: two_phase_region, comp: 0.1, temp: 500, desc: `comp outside region` },
    {
      region: three_phase_region,
      comp: 0.5,
      temp: 500,
      desc: `3+ phase region (lever rule undefined)`,
    },
  ])(`returns null for $desc`, ({ region, comp, temp }) => {
    expect(calculate_lever_rule(region, comp, temp)).toBeNull()
  })

  test(`parses phase names and calculates fractions correctly`, () => {
    const result = calculate_lever_rule(two_phase_region, 0.5, 500)
    expect(result).not.toBeNull()
    expect(result?.left_phase).toBe(`α`)
    expect(result?.right_phase).toBe(`β`)
    expect(result?.fraction_left).toBeCloseTo(0.5, 1)
    expect(result?.fraction_right).toBeCloseTo(0.5, 1)
    expect(result?.left_composition).toBeLessThan(result?.right_composition ?? Infinity)
  })

  test.each([
    { comp: 0.26, left_dominant: true, desc: `near left boundary` },
    { comp: 0.74, left_dominant: false, desc: `near right boundary` },
  ])(`$desc: dominant phase has >90% fraction`, ({ comp, left_dominant }) => {
    const result = calculate_lever_rule(two_phase_region, comp, 500)
    expect(result).not.toBeNull()
    const dominant = left_dominant ? result?.fraction_left : result?.fraction_right
    const minor = left_dominant ? result?.fraction_right : result?.fraction_left
    expect(dominant).toBeGreaterThan(0.9)
    expect(minor).toBeLessThan(0.1)
  })

  test(`fractions sum to 1 across multiple compositions`, () => {
    for (const comp of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      const result = calculate_lever_rule(two_phase_region, comp, 500)
      expect(result).not.toBeNull()
      expect((result?.fraction_left ?? 0) + (result?.fraction_right ?? 0)).toBeCloseTo(
        1,
        5,
      )
    }
  })

  test(`returns null for "+" (empty phase names)`, () => {
    const region: PhaseRegion = {
      id: `test`,
      name: `+`,
      vertices: [[0.2, 400], [0.8, 400], [0.7, 600], [0.3, 600]],
    }
    expect(calculate_lever_rule(region, 0.5, 500)).toBeNull()
  })

  test.each([
    { name: `Liquid + FCC_A1`, left: `Liquid`, right: `FCC_A1`, desc: `complex names` },
  ])(`parses "$name" → $left, $right`, ({ name, left, right }) => {
    const region: PhaseRegion = {
      id: `test`,
      name,
      vertices: [[0.2, 400], [0.8, 400], [0.7, 600], [0.3, 600]],
    }
    const result = calculate_lever_rule(region, 0.5, 500)
    expect(result?.left_phase).toBe(left)
    expect(result?.right_phase).toBe(right)
  })
})

describe(`compute_label_properties`, () => {
  test(`returns valid result for normal bounds`, () => {
    const result = compute_label_properties(`Liquid`, { width: 100, height: 80 }, 12)
    expect(result).toEqual({ rotation: 0, lines: [`Liquid`], scale: 1 })
  })

  test.each([
    { width: 0, height: 100, desc: `zero width` },
    { width: 100, height: 0, desc: `zero height` },
    { width: 0, height: 0, desc: `zero dimensions` },
    { width: -10, height: 50, desc: `negative width` },
    { width: 50, height: -10, desc: `negative height` },
  ])(`handles degenerate bounds: $desc`, ({ width, height }) => {
    const result = compute_label_properties(`Test`, { width, height }, 12)
    expect(Number.isFinite(result.rotation)).toBe(true)
    expect(Number.isFinite(result.scale)).toBe(true)
    expect(result.lines).toEqual([`Test`])
  })

  test.each([
    { label: ``, font_size: 12, expected_lines: [], desc: `empty label` },
    { label: `Test`, font_size: 0, expected_lines: [`Test`], desc: `zero font_size` },
  ])(`$desc → valid result`, ({ label, font_size, expected_lines }) => {
    const result = compute_label_properties(label, { width: 100, height: 80 }, font_size)
    expect(result.lines).toEqual(expected_lines)
    expect(Number.isFinite(result.rotation)).toBe(true)
    expect(Number.isFinite(result.scale)).toBe(true)
  })
})

describe(`merge_phase_diagram_config`, () => {
  test(`returns defaults when config is empty`, () => {
    const merged = merge_phase_diagram_config({})
    expect(merged.font_size).toBe(PHASE_DIAGRAM_DEFAULTS.font_size)
    expect(merged.margin).toEqual(PHASE_DIAGRAM_DEFAULTS.margin)
    expect(merged.tie_line).toEqual(PHASE_DIAGRAM_DEFAULTS.tie_line)
    expect(merged.colors).toEqual(PHASE_DIAGRAM_DEFAULTS.colors)
  })

  test.each([
    {
      config: { font_size: 16 },
      check: (m: ReturnType<typeof merge_phase_diagram_config>) => m.font_size === 16,
    },
    {
      config: { margin: { t: 50 } },
      check: (m: ReturnType<typeof merge_phase_diagram_config>) =>
        m.margin.t === 50 && m.margin.r === PHASE_DIAGRAM_DEFAULTS.margin.r,
    },
    {
      config: { tie_line: { stroke_width: 3 } },
      check: (m: ReturnType<typeof merge_phase_diagram_config>) =>
        m.tie_line.stroke_width === 3,
    },
    {
      config: { colors: { background: `#ff0000` } },
      check: (m: ReturnType<typeof merge_phase_diagram_config>) =>
        m.colors.background === `#ff0000`,
    },
  ])(`merges partial config correctly`, ({ config, check }) => {
    expect(check(merge_phase_diagram_config(config))).toBe(true)
  })
})
