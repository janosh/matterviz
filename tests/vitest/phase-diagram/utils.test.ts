import { point_in_polygon, polygon_centroid, type Vec2 } from '$lib/math'
import type { PhaseDiagramData, PhaseRegion, TempUnit } from '$lib/phase-diagram'
import {
  calculate_lever_rule,
  calculate_vertical_lever_rule,
  compute_label_properties,
  convert_temp,
  find_phase_at_point,
  format_composition,
  format_formula_html,
  format_formula_svg,
  format_label_html,
  format_label_svg,
  format_temperature,
  generate_boundary_path,
  generate_region_path,
  get_multi_phase_gradient,
  get_phase_color,
  get_phase_color_key,
  is_compound,
  merge_phase_diagram_config,
  PHASE_COLOR_HEX,
  PHASE_COLORS,
  PHASE_DIAGRAM_DEFAULTS,
  tokenize_formula,
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
    // Special phases and prefixes
    [`Liquid`, `liquid`],
    [`L`, `liquid`],
    [`FCC`, `alpha`],
    [`BCC`, `beta`],
    [`HCP`, `gamma`],
    [`fcc`, `alpha`],
    [`bcc`, `beta`],
    [`hcp`, `gamma`],
    [`FCC_A1`, `alpha`],
    [`BCC_A2`, `beta`],
    [`HCP_A3`, `gamma`],
    // Case insensitivity
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

  test(`handles all extended phase colors (δ through λ)`, () => {
    expect(get_multi_phase_gradient(`δ + ε + ζ + η + θ`)).toEqual([
      { offset: 0, color: PHASE_COLOR_HEX.delta },
      { offset: 0.25, color: PHASE_COLOR_HEX.epsilon },
      { offset: 0.5, color: PHASE_COLOR_HEX.zeta },
      { offset: 0.75, color: PHASE_COLOR_HEX.eta },
      { offset: 1, color: PHASE_COLOR_HEX.theta },
    ])
    expect(get_multi_phase_gradient(`ι + κ + λ`)).toEqual([
      { offset: 0, color: PHASE_COLOR_HEX.iota },
      { offset: 0.5, color: PHASE_COLOR_HEX.kappa },
      { offset: 1, color: PHASE_COLOR_HEX.lambda },
    ])
  })

  test(`handles whitespace and empty phase names`, () => {
    expect(get_multi_phase_gradient(`  α   +   β   +   γ  `)?.map((s) => s.color))
      .toEqual([PHASE_COLOR_HEX.alpha, PHASE_COLOR_HEX.beta, PHASE_COLOR_HEX.gamma])
    // "α + + β" filters the empty middle, leaving 2 phases
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
  test.each<[number, TempUnit, string]>([
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

// Shared test fixtures for lever rule tests
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

describe(`calculate_lever_rule`, () => {
  test.each([
    { region: single_phase_region, comp: 0.5, temp: 800, desc: `single-phase region` },
    { region: two_phase_region, comp: 0.5, temp: 300, desc: `temp outside region` },
    { region: two_phase_region, comp: 0.1, temp: 500, desc: `comp outside region` },
    { region: three_phase_region, comp: 0.5, temp: 500, desc: `3+ phase region` },
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

  test(`parses complex phase names like "Liquid + FCC_A1"`, () => {
    const region: PhaseRegion = {
      id: `test`,
      name: `Liquid + FCC_A1`,
      vertices: [[0.2, 400], [0.8, 400], [0.7, 600], [0.3, 600]],
    }
    const result = calculate_lever_rule(region, 0.5, 500)
    expect(result?.left_phase).toBe(`Liquid`)
    expect(result?.right_phase).toBe(`FCC_A1`)
  })
})

describe(`calculate_vertical_lever_rule`, () => {
  test.each([
    { region: single_phase_region, comp: 0.5, temp: 800, desc: `single-phase region` },
    { region: two_phase_region, comp: 0.5, temp: 300, desc: `temp outside region` },
    { region: two_phase_region, comp: 0.1, temp: 500, desc: `comp outside region` },
    { region: three_phase_region, comp: 0.5, temp: 500, desc: `3+ phase region` },
  ])(`returns null for $desc`, ({ region, comp, temp }) => {
    expect(calculate_vertical_lever_rule(region, comp, temp)).toBeNull()
  })

  test(`parses phase names and calculates fractions correctly at midpoint`, () => {
    const result = calculate_vertical_lever_rule(two_phase_region, 0.5, 500)
    expect(result).not.toBeNull()
    expect(result?.bottom_phase).toBe(`α`)
    expect(result?.top_phase).toBe(`β`)
    expect(result?.fraction_bottom).toBeCloseTo(0.5, 1)
    expect(result?.fraction_top).toBeCloseTo(0.5, 1)
    expect(result?.bottom_temperature).toBeLessThan(result?.top_temperature ?? Infinity)
  })

  test(`fractions sum to 1 across multiple temperatures`, () => {
    for (const temp of [420, 450, 500, 550, 580]) {
      const result = calculate_vertical_lever_rule(two_phase_region, 0.5, temp)
      expect(result).not.toBeNull()
      expect((result?.fraction_bottom ?? 0) + (result?.fraction_top ?? 0)).toBeCloseTo(
        1,
        5,
      )
    }
  })

  test.each([
    { temp: 410, bottom_dominant: true, desc: `near bottom boundary` },
    { temp: 590, bottom_dominant: false, desc: `near top boundary` },
  ])(`$desc: dominant phase has >90% fraction`, ({ temp, bottom_dominant }) => {
    const result = calculate_vertical_lever_rule(two_phase_region, 0.5, temp)
    expect(result).not.toBeNull()
    const dominant = bottom_dominant ? result?.fraction_bottom : result?.fraction_top
    const minor = bottom_dominant ? result?.fraction_top : result?.fraction_bottom
    expect(dominant).toBeGreaterThan(0.9)
    expect(minor).toBeLessThan(0.1)
  })

  test(`returns null for "+" (empty phase names)`, () => {
    const region: PhaseRegion = {
      id: `test`,
      name: `+`,
      vertices: [[0.2, 400], [0.8, 400], [0.7, 600], [0.3, 600]],
    }
    expect(calculate_vertical_lever_rule(region, 0.5, 500)).toBeNull()
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

  test(`wrapped labels join words with spaces, not underscores`, () => {
    // Bounds force chars_per_line=3 so "α" and "+" join on one line
    const result = compute_label_properties(`α + β`, { width: 30, height: 40 }, 12)
    expect(result.lines.length).toBeGreaterThan(1)
    expect(result.lines[0]).toBe(`α +`)
    for (const line of result.lines) {
      expect(line).not.toContain(`_`)
    }
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

  test(`merges partial overrides while keeping other defaults`, () => {
    const merged = merge_phase_diagram_config({
      font_size: 16,
      margin: { t: 50 },
      tie_line: { stroke_width: 3 },
      colors: { background: `#ff0000` },
    })
    expect(merged.font_size).toBe(16)
    expect(merged.margin.t).toBe(50)
    expect(merged.margin.r).toBe(PHASE_DIAGRAM_DEFAULTS.margin.r)
    expect(merged.tie_line.stroke_width).toBe(3)
    expect(merged.colors.background).toBe(`#ff0000`)
  })
})

// === Chemical Formula Parsing ===

describe(`is_compound`, () => {
  test.each([
    // Elements → false
    [`C`, false],
    [`Fe`, false],
    [`Si`, false],
    [`He`, false],
    // Compounds with digits → true
    [`Fe3C`, true],
    [`SiO2`, true],
    [`Al2O3`, true],
    [`H2O`, true],
    // Multi-element without digits → true
    [`MgO`, true],
    [`NaCl`, true],
    [`FeO`, true],
    // Edge cases → false
    [``, false],
    [`α`, false],
    [`α-Fe`, false],
  ])(`%s → %s`, (name, expected) => {
    expect(is_compound(name)).toBe(expected)
  })
})

describe(`tokenize_formula`, () => {
  test.each([
    { formula: `Fe`, expected: [{ text: `Fe` }], desc: `simple element` },
    {
      formula: `Fe3C`,
      expected: [{ text: `Fe` }, { sub: `3` }, { text: `C` }],
      desc: `compound`,
    },
    {
      formula: `SiO2`,
      expected: [{ text: `Si` }, { text: `O` }, { sub: `2` }],
      desc: `oxide`,
    },
    {
      formula: `Al2O3`,
      expected: [{ text: `Al` }, { sub: `2` }, { text: `O` }, { sub: `3` }],
      desc: `complex oxide`,
    },
    {
      formula: `C12H22O11`,
      expected: [{ text: `C` }, { sub: `12` }, { text: `H` }, { sub: `22` }, {
        text: `O`,
      }, { sub: `11` }],
      desc: `multi-digit subscripts`,
    },
    { formula: `MgO`, expected: [{ text: `Mg` }, { text: `O` }], desc: `no subscripts` },
    {
      formula: `O2-`,
      expected: [{ text: `O` }, { sub: `2` }, { sup: `-` }],
      desc: `charge notation`,
    },
    { formula: `α`, expected: [{ text: `α` }], desc: `Greek letter` },
    { formula: `α + β`, expected: [{ text: `α + β` }], desc: `Greek multi-phase` },
    { formula: ``, expected: [], desc: `empty string` },
  ])(`$desc: "$formula"`, ({ formula, expected }) => {
    expect(tokenize_formula(formula)).toEqual(expected)
  })
})

describe(`format_formula_html`, () => {
  test.each([
    [`Fe`, `Fe`],
    [`Fe3C`, `Fe<sub>3</sub>C`],
    [`SiO2`, `SiO<sub>2</sub>`],
    [`Al2O3`, `Al<sub>2</sub>O<sub>3</sub>`],
    [`α`, `α`],
    [``, ``],
  ])(`"%s" → "%s"`, (formula, expected) => {
    expect(format_formula_html(formula)).toBe(expected)
  })

  test(`respects use_subscripts=false`, () => {
    expect(format_formula_html(`Fe3C`, false)).toBe(`Fe3C`)
  })
})

describe(`format_formula_svg`, () => {
  test(`returns simple element unchanged`, () => {
    expect(format_formula_svg(`Fe`)).toBe(`Fe`)
  })

  test(`formats compound with tspan subscripts`, () => {
    const result = format_formula_svg(`Fe3C`)
    expect(result).toContain(`Fe`)
    expect(result).toContain(`<tspan`)
    expect(result).toContain(`>3</tspan>`)
    expect(result).toContain(`C`)
  })

  test(`formats oxide correctly`, () => {
    const result = format_formula_svg(`SiO2`)
    expect(result).toContain(`Si`)
    expect(result).toContain(`O`)
    expect(result).toContain(`>2</tspan>`)
  })

  test(`adds trailing baseline reset when formula ends with subscript`, () => {
    expect(format_formula_svg(`SiO2`)).toMatch(/<tspan dy="-0\.25em"><\/tspan>$/)
  })

  test(`no trailing reset when formula ends with text`, () => {
    expect(format_formula_svg(`Fe3C`)).not.toMatch(/<tspan dy="[^"]+"><\/tspan>$/)
  })

  test(`cumulative offset for consecutive sub/superscripts`, () => {
    // O2- has subscript (0.25em) then superscript (-0.4em), reset ≈ 0.15em
    expect(format_formula_svg(`O2-`)).toMatch(/<tspan dy="0\.15\d*em"><\/tspan>$/)
  })

  test(`respects use_subscripts=false`, () => {
    expect(format_formula_svg(`Fe3C`, false)).toBe(`Fe3C`)
  })

  test(`returns Greek letters unchanged`, () => {
    expect(format_formula_svg(`α`)).toBe(`α`)
    expect(format_formula_svg(`α + β`)).toBe(`α + β`)
  })
})

// === format_label_svg / format_label_html ===

describe(`format_label_svg`, () => {
  test(`formats compound and preserves + separator`, () => {
    const result = format_label_svg(`Fe3C + NiO`)
    expect(result).toContain(`>3</tspan>`)
    expect(result).toContain(` + `)
    expect(result).toContain(`Ni`)
  })

  test(`passes through Greek letters unchanged`, () => {
    expect(format_label_svg(`α + β`)).toBe(`α + β`)
  })

  test(`handles space-delimited + from wrapped text`, () => {
    // After wrap_text fix, wrapped lines use spaces: "α +" not "α_+"
    const result = format_label_svg(`α +`)
    expect(result).not.toContain(`_`)
    expect(result).toContain(`α`)
  })

  test(`respects use_subscripts=false`, () => {
    expect(format_label_svg(`Fe3C + NiO`, false)).toBe(`Fe3C + NiO`)
  })
})

describe(`format_label_html`, () => {
  test(`formats compound and preserves + separator`, () => {
    const result = format_label_html(`Fe3C + NiO`)
    expect(result).toContain(`Fe<sub>3</sub>C`)
    expect(result).toContain(` + `)
  })

  test(`passes through Greek letters unchanged`, () => {
    expect(format_label_html(`α + β`)).toBe(`α + β`)
  })

  test(`respects use_subscripts=false`, () => {
    expect(format_label_html(`Fe3C + NiO`, false)).toBe(`Fe3C + NiO`)
  })
})

// === convert_temp ===

describe(`convert_temp`, () => {
  test.each(
    [
      { value: 273.15, from: `K`, to: `°C`, expected: 0 },
      { value: 373.15, from: `K`, to: `°C`, expected: 100 },
      { value: 0, from: `°C`, to: `K`, expected: 273.15 },
      { value: 100, from: `°C`, to: `K`, expected: 373.15 },
      { value: 273.15, from: `K`, to: `°F`, expected: 32 },
      { value: 373.15, from: `K`, to: `°F`, expected: 212 },
      { value: 32, from: `°F`, to: `K`, expected: 273.15 },
      { value: 212, from: `°F`, to: `K`, expected: 373.15 },
      { value: 0, from: `°C`, to: `°F`, expected: 32 },
      { value: 100, from: `°C`, to: `°F`, expected: 212 },
      { value: 32, from: `°F`, to: `°C`, expected: 0 },
      { value: 212, from: `°F`, to: `°C`, expected: 100 },
    ] as const,
  )(`$value $from → $expected $to`, ({ value, from, to, expected }) => {
    expect(convert_temp(value, from, to)).toBeCloseTo(expected, 5)
  })

  test.each([`K`, `°C`, `°F`] as const)(
    `identity: same unit (%s) returns input unchanged`,
    (unit) => {
      expect(convert_temp(500, unit, unit)).toBe(500)
    },
  )
})

// === x_domain word boundary regex pattern ===

describe(`x_domain component name matching (word boundary regex)`, () => {
  // Tests the regex pattern used in IsobaricBinaryPhaseDiagram's x_domain
  function matches_component(region_name: string, component: string): boolean {
    const escaped = component.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
    return new RegExp(`\\b${escaped}\\b`).test(region_name)
  }

  test.each([
    // Pure component names — should match
    { region: `Fe`, component: `Fe`, expected: true, desc: `exact match` },
    { region: `α(Fe)`, component: `Fe`, expected: true, desc: `in parentheses` },
    { region: `Liquid + Fe`, component: `Fe`, expected: true, desc: `multi-phase` },
    { region: `Fe + Fe3C`, component: `Fe`, expected: true, desc: `pure + compound` },
    { region: `C`, component: `C`, expected: true, desc: `single-letter exact` },
    { region: `α(C)`, component: `C`, expected: true, desc: `single-letter in parens` },
    // Compound names — should NOT match the element substring
    { region: `Fe3C`, component: `Fe`, expected: false, desc: `Fe3C ≠ Fe` },
    { region: `FeO`, component: `Fe`, expected: false, desc: `FeO ≠ Fe` },
    { region: `Fe2O3`, component: `Fe`, expected: false, desc: `Fe2O3 ≠ Fe` },
    { region: `NiFe2O4`, component: `Fe`, expected: false, desc: `NiFe2O4 ≠ Fe` },
    { region: `Fe3C`, component: `C`, expected: false, desc: `Fe3C ≠ C` },
    { region: `SiC`, component: `C`, expected: false, desc: `SiC ≠ C` },
    // Compound components in pseudo-binary diagrams
    { region: `Fe3C`, component: `Fe3C`, expected: true, desc: `compound exact` },
    {
      region: `Liquid + Fe3C`,
      component: `Fe3C`,
      expected: true,
      desc: `compound in multi-phase`,
    },
    { region: `Fe3C2`, component: `Fe3C`, expected: false, desc: `Fe3C2 ≠ Fe3C` },
    // Cu edge cases
    { region: `Cu`, component: `Cu`, expected: true, desc: `Cu exact` },
    { region: `Cu3Au`, component: `Cu`, expected: false, desc: `Cu3Au ≠ Cu` },
    { region: `CuO`, component: `Cu`, expected: false, desc: `CuO ≠ Cu` },
  ])(
    `$desc: "$region" vs "$component" → $expected`,
    ({ region, component, expected }) => {
      expect(matches_component(region, component)).toBe(expected)
    },
  )
})
