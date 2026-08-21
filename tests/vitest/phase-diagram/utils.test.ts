import { polygon_centroid, type Vec2 } from '$lib/math'
import type { CompUnit, PhaseDiagramData, PhaseRegion, TempUnit } from '$lib/phase-diagram'
import {
  calculate_lever_rule,
  calculate_vertical_lever_rule,
  compute_label_properties,
  compute_x_domain,
  convert_temp,
  extract_tdb_reference,
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
  get_phase_stability_range,
  is_compound,
  merge_phase_diagram_config,
  PHASE_DIAGRAM_DEFAULTS,
  summarize_models,
  tokenize_formula,
  transform_vertices,
} from '$lib/phase-diagram/utils'
import { describe, expect, test } from 'vitest'

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
    expect(find_phase_at_point(0.5, 0.5, overlapping_data)?.name).toBe(`Second`)
  })
})

describe(`generate_region_path`, () => {
  test.each([
    {
      vertices: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      expected: `M0,0L100,0L100,100L0,100 Z`,
    },
    {
      vertices: [
        [0, 0],
        [1, 1],
      ],
      expected: ``,
    },
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
    {
      points: [
        [0, 0],
        [50, 50],
        [100, 100],
      ],
      expected: `M0,0L50,50L100,100`,
    },
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
  test.each([
    {
      vertices: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      expected: [1, 1],
      desc: `square`,
    },
    {
      vertices: [
        [0, 0],
        [3, 0],
        [0, 3],
      ],
      expected: [1, 1],
      desc: `triangle`,
    },
    {
      vertices: [
        [0, 0],
        [4, 0],
        [4, 2],
        [0, 2],
      ],
      expected: [2, 1],
      desc: `rectangle`,
    },
    { vertices: [[5, 10]], expected: [5, 10], desc: `single vertex` },
    {
      vertices: [
        [0, 0],
        [10, 10],
      ],
      expected: [5, 5],
      desc: `two vertices`,
    },
    { vertices: [], expected: [0, 0], desc: `empty array` },
  ] as const)(`$desc → ($expected)`, ({ vertices, expected }) => {
    const [cx, cy] = polygon_centroid([...vertices] as Vec2[])
    expect(cx).toBeCloseTo(expected[0], 5)
    expect(cy).toBeCloseTo(expected[1], 5)
  })
})

// Palette by key (hex); get_phase_color returns these opaque (`hex`) or with alpha (`rgba`)
const HEX = {
  liquid: `#87cefc`,
  alpha: `#90ee90`,
  beta: `#ffb6c1`,
  gamma: `#ffdab9`,
  delta: `#dda0dd`,
  epsilon: `#f0e68c`,
  zeta: `#fa8072`,
  eta: `#e6e6fa`,
  theta: `#f5deb3`,
  iota: `#20b2aa`,
  kappa: `#deb887`,
  lambda: `#bc8f8f`,
  two_phase: `#c8c8c8`,
  default: `#b4b4b4`,
}

describe(`get_phase_color`, () => {
  test.each([
    // Greek letters and Latin names map to the same key, case-insensitively
    [`α`, HEX.alpha],
    [`alpha`, HEX.alpha],
    [`ALPHA`, HEX.alpha],
    [`β`, HEX.beta],
    [`beta`, HEX.beta],
    [`γ`, HEX.gamma],
    [`gamma`, HEX.gamma],
    [`δ`, HEX.delta],
    [`ε`, HEX.epsilon],
    [`ζ`, HEX.zeta],
    [`η`, HEX.eta],
    [`ETA`, HEX.eta],
    // "theta" contains "eta": must win over the eta rule
    [`θ`, HEX.theta],
    [`THETA`, HEX.theta],
    [`ι`, HEX.iota],
    [`κ`, HEX.kappa],
    [`λ`, HEX.lambda],
    // Liquid + shorthand, and structure prefixes map to alpha/beta/gamma
    [`Liquid`, HEX.liquid],
    [`L`, HEX.liquid],
    [`FCC_A1`, HEX.alpha],
    [`bcc`, HEX.beta],
    [`HCP_A3`, HEX.gamma],
    // multi-phase and unknown
    [`α + β`, HEX.two_phase],
    [`Liquid + FCC`, HEX.two_phase],
    [`Unknown`, HEX.default],
    [``, HEX.default],
  ] as [string, string][])(`%s → %s`, (phase_name, hex) => {
    expect(get_phase_color(phase_name, `hex`)).toBe(hex)
  })

  test.each([
    // single phases: alpha 0.6; two-phase and unknown: 0.5
    [`Liquid`, `rgba(135, 206, 252, 0.6)`],
    [`α`, `rgba(144, 238, 144, 0.6)`],
    [`α + β`, `rgba(200, 200, 200, 0.5)`],
    [`Unknown`, `rgba(180, 180, 180, 0.5)`],
  ])(`rgba fill for %s is %s`, (phase_name, rgba) => {
    expect(get_phase_color(phase_name)).toBe(rgba)
  })
})

describe(`get_multi_phase_gradient`, () => {
  test.each([`Liquid`, `α`, `Unknown`, ``, `FCC`, `+`, ` + `])(
    `returns null without two phases: %j`,
    (name) => {
      expect(get_multi_phase_gradient(name)).toBeNull()
    },
  )

  test.each([
    [`α + β`, [HEX.alpha, HEX.beta]],
    [`α + β + γ`, [HEX.alpha, HEX.beta, HEX.gamma]],
    [`α + β + γ + δ`, [HEX.alpha, HEX.beta, HEX.gamma, HEX.delta]],
    [`δ + ε + ζ + η + θ`, [HEX.delta, HEX.epsilon, HEX.zeta, HEX.eta, HEX.theta]],
    [`ι + κ + λ`, [HEX.iota, HEX.kappa, HEX.lambda]],
    [`  α   +   β   +   γ  `, [HEX.alpha, HEX.beta, HEX.gamma]],
    // empty middle phase is dropped
    [`α + + β`, [HEX.alpha, HEX.beta]],
    [`Unknown1 + Unknown2 + α`, [HEX.default, HEX.default, HEX.alpha]],
    [`Liquid + FCC + BCC`, [HEX.liquid, HEX.alpha, HEX.beta]],
  ])(`%s → evenly spaced stops`, (name, colors) => {
    const n_stops = colors.length
    expect(get_multi_phase_gradient(name)).toEqual(
      colors.map((color, idx) => ({ offset: idx / (n_stops - 1), color })),
    )
  })
})

describe(`format_composition`, () => {
  test.each([
    [0.5, `at%`, `50 at%`],
    [0.25, `wt%`, `25 wt%`],
    [0.333, `fraction`, `0.333`],
    [0, `at%`, `0 at%`],
    [1, `at%`, `100 at%`],
    // Trailing zeros stripped
    [0.35, `at%`, `35 at%`],
    [0.123, `at%`, `12.3 at%`],
    [0.001, `at%`, `0.1 at%`],
    [0.1005, `at%`, `10.1 at%`],
  ])(`%d with %s → %s`, (value, unit, expected) => {
    expect(format_composition(value, unit as CompUnit)).toBe(expected)
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
    {
      input: [
        [0, 0],
        [1, 100],
        [0.5, 50],
      ],
      expected: [
        [0, 100],
        [200, 0],
        [100, 50],
      ],
    },
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
  vertices: [
    [0.2, 400],
    [0.8, 400],
    [0.7, 600],
    [0.3, 600],
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
const three_phase_region: PhaseRegion = {
  id: `alpha-beta-gamma`,
  name: `α + β + γ`,
  vertices: [
    [0.2, 400],
    [0.8, 400],
    [0.7, 600],
    [0.3, 600],
  ],
}
const empty_plus_region: PhaseRegion = {
  id: `test`,
  name: `+`,
  vertices: [
    [0.2, 400],
    [0.8, 400],
    [0.7, 600],
    [0.3, 600],
  ],
}
const split_region_horizontal: PhaseRegion = {
  id: `alpha-beta-split`,
  name: `α + β`,
  vertices: [
    [0.1, 400],
    [0.9, 400],
    [0.9, 600],
    [0.6, 600],
    [0.6, 450],
    [0.4, 450],
    [0.4, 600],
    [0.1, 600],
  ],
}
const split_region_vertical: PhaseRegion = {
  id: `alpha-beta-split-vertical`,
  name: `α + β`,
  vertices: [
    [0.4, 0.1],
    [0.4, 0.9],
    [0.6, 0.9],
    [0.6, 0.6],
    [0.45, 0.6],
    [0.45, 0.4],
    [0.6, 0.4],
    [0.6, 0.1],
  ],
}
const split_region_boundary_cases = [
  { position: 0.35, expected_bounds: [0.1, 0.4] as Vec2 },
  { position: 0.65, expected_bounds: [0.6, 0.9] as Vec2 },
]

// Shared null-case inputs for both lever rule functions
const lever_null_cases = [
  { region: single_phase_region, comp: 0.5, temp: 800, desc: `single-phase region` },
  { region: two_phase_region, comp: 0.5, temp: 300, desc: `temp outside region` },
  { region: two_phase_region, comp: 0.1, temp: 500, desc: `comp outside region` },
  { region: three_phase_region, comp: 0.5, temp: 500, desc: `3+ phase region` },
  { region: empty_plus_region, comp: 0.5, temp: 500, desc: `"+" (empty phases)` },
]

function expect_non_null<T>(value: T | null): T {
  expect(value).not.toBeNull()
  return value as T
}

// two_phase_region is the trapezoid (0.2,400)-(0.8,400)-(0.7,600)-(0.3,600): at T the
// boundaries sit at x = 0.2 + (T-400)/2000 and 0.8 - (T-400)/2000
const x_left_at = (temp: number) => 0.2 + (temp - 400) / 2000
const x_right_at = (temp: number) => 0.8 - (temp - 400) / 2000

describe(`calculate_lever_rule`, () => {
  test.each(lever_null_cases)(`returns null for $desc`, ({ region, comp, temp }) => {
    expect(calculate_lever_rule(region, comp, temp)).toBeNull()
  })

  test.each([
    // [comp, temp]: fractions follow the lever rule f_right = (x - x_l) / (x_r - x_l)
    [0.5, 500],
    [0.26, 500],
    [0.74, 500],
    [0.3, 420],
    [0.65, 580],
  ])(`tie line and fractions at x=%f, T=%d`, (comp, temp) => {
    const result = expect_non_null(calculate_lever_rule(two_phase_region, comp, temp))
    const [x_left, x_right] = [x_left_at(temp), x_right_at(temp)]
    const fraction_right = (comp - x_left) / (x_right - x_left)
    expect(result).toEqual({
      left_phase: `α`,
      right_phase: `β`,
      left_composition: expect.closeTo(x_left, 9),
      right_composition: expect.closeTo(x_right, 9),
      fraction_left: expect.closeTo(1 - fraction_right, 9),
      fraction_right: expect.closeTo(fraction_right, 9),
    })
  })

  test(`parses complex phase names like "Liquid + FCC_A1"`, () => {
    const region: PhaseRegion = { ...two_phase_region, name: `Liquid + FCC_A1` }
    const result = calculate_lever_rule(region, 0.5, 500)
    expect(result?.left_phase).toBe(`Liquid`)
    expect(result?.right_phase).toBe(`FCC_A1`)
  })

  test.each(split_region_boundary_cases)(
    `uses the nearest two-phase bounds at composition=$position when multiple intersections exist`,
    ({ position, expected_bounds }) => {
      const result = expect_non_null(
        calculate_lever_rule(split_region_horizontal, position, 500),
      )
      expect(result.left_composition).toBeCloseTo(expected_bounds[0], 9)
      expect(result.right_composition).toBeCloseTo(expected_bounds[1], 9)
    },
  )
})

describe(`calculate_vertical_lever_rule`, () => {
  test.each(lever_null_cases)(`returns null for $desc`, ({ region, comp, temp }) => {
    expect(calculate_vertical_lever_rule(region, comp, temp)).toBeNull()
  })

  // A vertical scan at x in [0.3, 0.7] crosses only the horizontal edges at 400 K and 600 K
  test.each([
    [0.5, 500],
    [0.5, 410],
    [0.5, 590],
    [0.35, 450],
    [0.7, 560],
  ])(`tie line and fractions at x=%f, T=%d`, (comp, temp) => {
    const result = expect_non_null(calculate_vertical_lever_rule(two_phase_region, comp, temp))
    const fraction_top = (temp - 400) / 200
    expect(result).toEqual({
      bottom_phase: `α`,
      top_phase: `β`,
      bottom_temperature: expect.closeTo(400, 9),
      top_temperature: expect.closeTo(600, 9),
      fraction_bottom: expect.closeTo(1 - fraction_top, 9),
      fraction_top: expect.closeTo(fraction_top, 9),
    })
  })

  test(`scan through a slanted edge interpolates the crossing temperature`, () => {
    // at x = 0.25 the left edge (0.2,400)-(0.3,600) is crossed at T = 500
    const result = expect_non_null(calculate_vertical_lever_rule(two_phase_region, 0.25, 450))
    expect(result.bottom_temperature).toBeCloseTo(400, 9)
    expect(result.top_temperature).toBeCloseTo(500, 9)
    expect(result.fraction_top).toBeCloseTo(0.5, 9)
  })

  test.each(split_region_boundary_cases)(
    `uses nearest temperature bounds at temperature=$position when multiple intersections exist`,
    ({ position, expected_bounds }) => {
      const result = expect_non_null(
        calculate_vertical_lever_rule(split_region_vertical, 0.5, position),
      )
      expect(result.bottom_temperature).toBeCloseTo(expected_bounds[0], 9)
      expect(result.top_temperature).toBeCloseTo(expected_bounds[1], 9)
    },
  )
})

describe(`compute_label_properties`, () => {
  test(`returns valid result for normal bounds`, () => {
    const result = compute_label_properties(`Liquid`, { width: 100, height: 80 }, 12)
    expect(result).toEqual({ rotation: 0, lines: [`Liquid`], scale: 1 })
  })

  test.each([
    { width: 0, height: 100, desc: `zero width` },
    { width: -10, height: 50, desc: `negative width` },
    { width: 100, height: 0, desc: `zero height` },
    { width: 50, height: -5, desc: `negative height` },
  ])(`handles degenerate bounds: $desc`, ({ width, height }) => {
    expect(compute_label_properties(`Test`, { width, height }, 12)).toEqual({
      rotation: 0,
      lines: [`Test`],
      scale: 1,
    })
  })

  test(`empty label returns no lines`, () => {
    expect(compute_label_properties(``, { width: 100, height: 80 }, 12)).toEqual({
      rotation: 0,
      lines: [],
      scale: 1,
    })
  })

  test(`zero font_size returns scale=1`, () => {
    expect(compute_label_properties(`Test`, { width: 100, height: 80 }, 0)).toEqual({
      rotation: 0,
      lines: [`Test`],
      scale: 1,
    })
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
      expected: [
        { text: `C` },
        { sub: `12` },
        { text: `H` },
        { sub: `22` },
        { text: `O` },
        { sub: `11` },
      ],
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
  test.each([`Fe`, `α`, `α + β`])(`returns %s unchanged`, (input) => {
    expect(format_formula_svg(input)).toBe(input)
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
    // Uses zero-width space \u200B to ensure dy is applied in all SVG renderers
    expect(format_formula_svg(`SiO2`)).toMatch(/<tspan dy="-0\.25em">\u200B<\/tspan>$/)
  })

  test(`no trailing reset when formula ends with text`, () => {
    // Fe3C ends with "C" in a baseline-reset tspan, not a zero-width-space reset
    const result = format_formula_svg(`Fe3C`)
    expect(result).toMatch(/C<\/tspan>$/)
    expect(result).not.toContain(`\u200B`)
  })

  test(`cumulative offset for consecutive sub/superscripts`, () => {
    // O2- has subscript (0.25em) then superscript (-0.4em), reset ≈ 0.15em
    expect(format_formula_svg(`O2-`)).toMatch(/<tspan dy="0\.15\d*em">\u200B<\/tspan>$/)
  })

  test(`respects use_subscripts=false`, () => {
    expect(format_formula_svg(`Fe3C`, false)).toBe(`Fe3C`)
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
})

describe(`format_label_html`, () => {
  test(`formats compound and preserves + separator`, () => {
    const result = format_label_html(`Fe3C + NiO`)
    expect(result).toContain(`Fe<sub>3</sub>C`)
    expect(result).toContain(` + `)
  })
})

// Shared behavior for both format_label_* functions
describe.each([
  [`format_label_svg`, format_label_svg],
  [`format_label_html`, format_label_html],
])(`%s`, (_name, format_fn) => {
  test(`passes through Greek letters unchanged`, () => {
    expect(format_fn(`α + β`)).toBe(`α + β`)
  })

  test(`respects use_subscripts=false`, () => {
    expect(format_fn(`Fe3C + NiO`, false)).toBe(`Fe3C + NiO`)
  })
})

// === convert_temp ===

describe(`convert_temp`, () => {
  test.each([
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
    // absolute zero and a round trip through all three units
    { value: 0, from: `K`, to: `°C`, expected: -273.15 },
    { value: 0, from: `K`, to: `°F`, expected: -459.67 },
    { value: 1234.5, from: `°C`, to: `°F`, expected: 2254.1 },
  ] as const)(`$value $from → $expected $to`, ({ value, from, to, expected }) => {
    expect(convert_temp(value, from, to)).toBeCloseTo(expected, 9)
  })

  test.each([`K`, `°C`, `°F`] as const)(`°F → %s → °F round-trips to 1e-9`, (unit) => {
    expect(convert_temp(convert_temp(451, `°F`, unit), unit, `°F`)).toBeCloseTo(451, 9)
  })

  test.each([`K`, `°C`, `°F`] as const)(
    `identity: same unit (%s) returns input unchanged`,
    (unit) => {
      expect(convert_temp(500, unit, unit)).toBe(500)
    },
  )
})

// === x_domain word boundary regex pattern ===

describe(`word boundary regex for component matching`, () => {
  // Tests the \b regex pattern used in IsobaricBinaryPhaseDiagram's x_domain
  function matches_component(region_name: string, component: string): boolean {
    const escaped = component.replaceAll(/[.*+?^${}()|[\]\\]/g, `\\$&`)
    return new RegExp(`\\b${escaped}\\b`).test(region_name)
  }

  // [region_name, component, should_match]
  test.each([
    // Should match: pure component names
    [`Fe`, `Fe`, true],
    [`α(Fe)`, `Fe`, true],
    [`Liquid + Fe`, `Fe`, true],
    [`Fe + Fe3C`, `Fe`, true],
    [`C`, `C`, true],
    [`α(C)`, `C`, true],
    [`Fe3C`, `Fe3C`, true],
    [`Liquid + Fe3C`, `Fe3C`, true],
    [`Cu`, `Cu`, true],
    // Should NOT match: element as substring of compound
    [`Fe3C`, `Fe`, false],
    [`FeO`, `Fe`, false],
    [`Fe2O3`, `Fe`, false],
    [`NiFe2O4`, `Fe`, false],
    [`Fe3C`, `C`, false],
    [`SiC`, `C`, false],
    [`Fe3C2`, `Fe3C`, false],
    [`Cu3Au`, `Cu`, false],
    [`CuO`, `Cu`, false],
  ])(`"%s" contains "%s" → %s`, (region, component, expected) => {
    expect(matches_component(region, component)).toBe(expected)
  })
})

// === get_phase_stability_range ===

describe(`get_phase_stability_range`, () => {
  test.each([
    {
      vertices: [
        [0, 400],
        [1, 400],
        [1, 800],
        [0, 800],
      ] as Vec2[],
      expected: { t_min: 400, t_max: 800 },
      desc: `rectangle`,
    },
    {
      vertices: [[0.5, 600]] as Vec2[],
      expected: { t_min: 600, t_max: 600 },
      desc: `single vertex`,
    },
    {
      vertices: [
        [0.2, 400],
        [0.8, 450],
        [0.7, 650],
        [0.3, 600],
      ] as Vec2[],
      expected: { t_min: 400, t_max: 650 },
      desc: `irregular polygon`,
    },
  ])(`$desc → t_min=$expected.t_min, t_max=$expected.t_max`, ({ vertices, expected }) => {
    expect(get_phase_stability_range({ id: `test`, name: `α`, vertices })).toEqual(expected)
  })

  test(`returns null for empty vertices`, () => {
    expect(get_phase_stability_range({ id: `test`, name: `α`, vertices: [] })).toBeNull()
  })
})

// format_hover_info_text is covered in IsobaricBinaryPhaseDiagram.test.ts

// === extract_tdb_reference ===

describe(`extract_tdb_reference`, () => {
  test(`extracts reference containing keyword`, () => {
    const ref = extract_tdb_reference([
      `$ Some comment`,
      `$ Reference: A. Author, Journal of Alloys, Vol 100, 2020, pp 1-10`,
    ])
    expect(ref).toContain(`Author`)
    expect(ref).toContain(`Journal`)
  })

  test.each([`reference`, `citation`, `database`, `assessed by`])(
    `matches keyword "%s" case-insensitively`,
    (keyword) => {
      const comment = `$ This ${keyword} was from X. Author, Some Long Journal Name, Vol 42, 2019`
      expect(extract_tdb_reference([comment])).not.toBeNull()
    },
  )

  test(`returns null for empty comments`, () => {
    expect(extract_tdb_reference([])).toBeNull()
  })

  test(`returns null when no keywords match`, () => {
    expect(extract_tdb_reference([`$ Just a regular comment`, `$ Another one`])).toBeNull()
  })

  test(`skips short references (<=30 chars)`, () => {
    expect(extract_tdb_reference([`$ Reference: short`])).toBeNull()
  })

  test(`skips references ending with "from"`, () => {
    expect(extract_tdb_reference([`$ Reference data was extracted from`])).toBeNull()
  })

  test(`strips leading $ from reference text`, () => {
    const ref = extract_tdb_reference([
      `$ Database entry: Thermodynamic data assessed by J. Author et al. 2021`,
    ])
    expect(ref).not.toMatch(/^\$/)
  })
})

// === summarize_models ===

describe(`summarize_models`, () => {
  test(`summarizes single sublattice type`, () => {
    expect(
      summarize_models([
        { sublattice_count: 2, sublattice_sites: [1, 1] },
        { sublattice_count: 2, sublattice_sites: [1, 3] },
      ]),
    ).toBe(`2×2-SL`)
  })

  test(`summarizes multiple sublattice types sorted by count`, () => {
    expect(
      summarize_models([
        { sublattice_count: 3, sublattice_sites: [1, 1, 1] },
        { sublattice_count: 2, sublattice_sites: [1, 1] },
        { sublattice_count: 2, sublattice_sites: [1, 3] },
      ]),
    ).toBe(`2×2-SL, 1×3-SL`)
  })

  test(`returns empty string for no phases`, () => {
    expect(summarize_models([])).toBe(``)
  })

  test(`handles single phase`, () => {
    expect(summarize_models([{ sublattice_count: 4, sublattice_sites: [1, 1, 1, 1] }])).toBe(
      `1×4-SL`,
    )
  })
})

describe(`compute_x_domain`, () => {
  const make_region = (name: string, x_lo: number, x_hi: number): PhaseRegion => ({
    id: name,
    name,
    vertices: [
      [x_lo, 300],
      [x_hi, 300],
      [x_hi, 600],
      [x_lo, 600],
    ],
  })

  const make_data = (regions: PhaseRegion[]): PhaseDiagramData => ({
    components: [`Al`, `Cu`],
    temperature_range: [300, 1200],
    regions,
    boundaries: [],
  })

  // Al near 0 boundary, Cu near 1 boundary — triggers auto-extend
  const edge_data = make_data([make_region(`Al`, 0.02, 0.3), make_region(`Cu`, 0.7, 0.98)])

  test.each([
    {
      range: [0.2, 0.8] as Vec2,
      data: null,
      expected: [0.2, 0.8],
      desc: `explicit range returned as-is`,
    },
    {
      range: undefined,
      data: null,
      expected: [0, 1],
      desc: `no range + no data defaults to [0, 1]`,
    },
    {
      range: undefined,
      data: edge_data,
      expected: [0, 1],
      desc: `undefined range auto-extends both edges`,
    },
    {
      range: [null, null] as [null, null],
      data: edge_data,
      expected: [0, 1],
      desc: `null range auto-extends both edges`,
    },
    {
      range: [0.1, null] as [number, null],
      data: edge_data,
      expected: [0.1, 1],
      desc: `explicit lo preserved, hi auto-extends`,
    },
    {
      range: [null, 0.9] as [null, number],
      data: edge_data,
      expected: [0, 0.9],
      desc: `lo auto-extends, explicit hi preserved`,
    },
  ])(`$desc`, ({ range, data, expected }) => {
    expect(compute_x_domain(range, data)).toEqual(expected)
  })

  test(`does not auto-extend when data is far from boundary (section diagram)`, () => {
    const section = make_data([make_region(`Al`, 0.3, 0.5), make_region(`Cu`, 0.5, 0.7)])
    expect(compute_x_domain(undefined, section)).toEqual([0.3, 0.7])
  })

  test(`uses data extent when region names don't match component names`, () => {
    const non_matching = make_data([make_region(`Liquid`, 0.1, 0.9)])
    expect(compute_x_domain(undefined, non_matching)).toEqual([0.1, 0.9])
  })
})
