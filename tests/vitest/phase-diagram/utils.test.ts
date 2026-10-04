import type { Vec2 } from '#lib/math.js'
import type {
  CompUnit,
  PhaseDiagramData,
  PhaseRegion,
  TempUnit,
} from '#lib/phase-diagram/index.js'
import {
  calculate_lever_rule,
  compute_label_properties,
  compute_x_domain,
  convert_temp,
  find_phase_at_point,
  format_composition,
  format_temperature,
  generate_boundary_path,
  generate_region_path,
  get_multi_phase_gradient,
  get_phase_color,
  get_phase_stability_range,
  merge_phase_diagram_config,
  PHASE_DIAGRAM_DEFAULTS,
  transform_vertices,
} from '#lib/phase-diagram/utils.js'
import { describe, expect, test } from 'vitest'
import { pts, rect } from './fixtures/test-data'

describe(`find_phase_at_point`, () => {
  const test_data: PhaseDiagramData = {
    components: [`A`, `B`],
    temperature_range: [300, 900],
    regions: [
      { id: `liquid`, name: `Liquid`, vertices: rect(0, 700, 1, 900) },
      { id: `solid`, name: `Solid`, vertices: rect(0, 300, 1, 700) },
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
        { id: `first`, name: `First`, vertices: rect(0, 0, 1, 1) },
        { id: `second`, name: `Second`, vertices: rect(0.25, 0.25, 0.75, 0.75) },
      ],
    }
    expect(find_phase_at_point(0.5, 0.5, overlapping_data)?.name).toBe(`Second`)
  })
})

test.each([
  [rect(0, 0, 100, 100), `M0,0L100,0L100,100L0,100 Z`],
  [pts(0, 0, 1, 1), ``],
  [pts(0, 0), ``],
  [[], ``],
] as [Vec2[], string][])(`generate_region_path: %j → "%s"`, (vertices, expected) => {
  expect(generate_region_path(vertices)).toBe(expected)
})

test.each([
  [pts(0, 0, 50, 50, 100, 100), `M0,0L50,50L100,100`],
  [pts(0, 0), ``],
  [[], ``],
] as [Vec2[], string][])(`generate_boundary_path: %j → "%s"`, (points, expected) => {
  expect(generate_boundary_path(points)).toBe(expected)
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

test(`transform_vertices maps every vertex through the x and y scales`, () => {
  const x_scale = (val: number) => val * 200
  const y_scale = (val: number) => 100 - val
  expect(transform_vertices(pts(0, 0, 1, 100, 0.5, 50), x_scale, y_scale)).toEqual(
    pts(0, 100, 200, 0, 100, 50),
  )
  expect(transform_vertices([], x_scale, y_scale)).toEqual([])
})

// Shared test fixtures for lever rule tests
const trapezoid = pts(0.2, 400, 0.8, 400, 0.7, 600, 0.3, 600)
const two_phase_region: PhaseRegion = { id: `alpha-beta`, name: `α + β`, vertices: trapezoid }
const single_phase_region: PhaseRegion = {
  id: `liquid`,
  name: `Liquid`,
  vertices: rect(0, 700, 1, 900),
}
const three_phase_region: PhaseRegion = { ...two_phase_region, name: `α + β + γ` }
const empty_plus_region: PhaseRegion = { ...two_phase_region, name: `+` }
const split_region_horizontal: PhaseRegion = {
  id: `alpha-beta-split`,
  name: `α + β`,
  vertices: pts(
    0.1,
    400,
    0.9,
    400,
    0.9,
    600,
    0.6,
    600,
    0.6,
    450,
    0.4,
    450,
    0.4,
    600,
    0.1,
    600,
  ),
}
const split_region_boundary_cases = [
  { position: 0.35, expected_bounds: [0.1, 0.4] as Vec2 },
  { position: 0.65, expected_bounds: [0.6, 0.9] as Vec2 },
]

const lever_null_cases = [
  {
    region: split_region_horizontal,
    comp: 0.5,
    temp: 500,
    desc: `gap between disjoint intervals`,
  },
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

  // The name lists β first but β's single-phase field sits on the right, so the tie-line ends
  // must be assigned from the neighbouring regions, not from the name order
  const misordered_region: PhaseRegion = { ...two_phase_region, name: `β + α` }
  const alpha_field: PhaseRegion = {
    id: `alpha`,
    name: `α`,
    vertices: pts(0, 400, 0.2, 400, 0.3, 600, 0, 600),
  }
  const beta_field: PhaseRegion = {
    id: `beta`,
    name: `β`,
    vertices: pts(0.8, 400, 1, 400, 1, 600, 0.7, 600),
  }

  test.each([
    { desc: `no neighbours: name order stands`, regions: [], left: `β`, right: `α` },
    {
      desc: `neighbouring single-phase fields override name order`,
      regions: [misordered_region, alpha_field, beta_field],
      left: `α`,
      right: `β`,
    },
    {
      desc: `left neighbour alone is enough`,
      regions: [misordered_region, alpha_field],
      left: `α`,
      right: `β`,
    },
    {
      desc: `right neighbour alone is enough`,
      regions: [misordered_region, beta_field],
      left: `α`,
      right: `β`,
    },
  ])(`$desc`, ({ regions, left, right }) => {
    const result = expect_non_null(calculate_lever_rule(misordered_region, 0.5, 500, regions))
    expect([result.left_phase, result.right_phase]).toEqual([left, right])
    // fractions follow the geometry either way
    expect(result.fraction_right).toBeCloseTo(0.5, 9)
  })
})

describe(`compute_label_properties`, () => {
  // Unwrapped single-line labels: degenerate bounds, empty labels and a zero font size all
  // fall back to rotation 0 / scale 1
  test.each([
    { label: `Liquid`, width: 100, height: 80, font_size: 12, desc: `normal bounds` },
    { label: `Test`, width: 0, height: 100, font_size: 12, desc: `zero width` },
    { label: `Test`, width: -10, height: 50, font_size: 12, desc: `negative width` },
    { label: `Test`, width: 100, height: 0, font_size: 12, desc: `zero height` },
    { label: `Test`, width: 50, height: -5, font_size: 12, desc: `negative height` },
    { label: ``, width: 100, height: 80, font_size: 12, desc: `empty label → no lines` },
    { label: `Test`, width: 100, height: 80, font_size: 0, desc: `zero font_size` },
  ])(`$desc`, ({ label, width, height, font_size }) => {
    expect(compute_label_properties(label, { width, height }, font_size)).toEqual({
      rotation: 0,
      lines: label ? [label] : [],
      scale: 1,
    })
  })

  test(`wrapped labels join words with spaces, not underscores`, () => {
    // Bounds force chars_per_line=3 so "α" and "+" join on one line
    const result = compute_label_properties(`α + β`, { width: 30, height: 40 }, 12)
    expect(result.lines).toEqual([`α +`, `β`])
  })
})

test(`merge_phase_diagram_config returns defaults for {} and merges partial overrides`, () => {
  const defaults = merge_phase_diagram_config({})
  expect(defaults.font_size).toBe(PHASE_DIAGRAM_DEFAULTS.font_size)
  expect(defaults.margin).toEqual(PHASE_DIAGRAM_DEFAULTS.margin)
  expect(defaults.tie_line).toEqual(PHASE_DIAGRAM_DEFAULTS.tie_line)
  expect(defaults.colors).toEqual(PHASE_DIAGRAM_DEFAULTS.colors)

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
  ] as const)(`$value $from → $expected $to`, ({ value, from, to: target, expected }) => {
    expect(convert_temp(value, from, target)).toBeCloseTo(expected, 9)
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

test.each([
  [`rectangle`, rect(0, 400, 1, 800), { t_min: 400, t_max: 800 }],
  [`single vertex`, pts(0.5, 600), { t_min: 600, t_max: 600 }],
  [
    `irregular polygon`,
    pts(0.2, 400, 0.8, 450, 0.7, 650, 0.3, 600),
    { t_min: 400, t_max: 650 },
  ],
  [`no vertices`, [], null],
] as [string, Vec2[], { t_min: number; t_max: number } | null][])(
  `get_phase_stability_range: %s → %o`,
  (_desc, vertices, expected) => {
    expect(get_phase_stability_range({ id: `test`, name: `α`, vertices })).toEqual(expected)
  },
)

// format_hover_info_text is covered in IsobaricBinaryPhaseDiagram.test.ts

describe(`compute_x_domain`, () => {
  const make_region = (name: string, x_lo: number, x_hi: number): PhaseRegion => ({
    id: name,
    name,
    vertices: rect(x_lo, 300, x_hi, 600),
  })

  const make_data = (regions: PhaseRegion[]): PhaseDiagramData => ({
    components: [`Al`, `Cu`],
    temperature_range: [300, 1200],
    regions,
    boundaries: [],
  })

  // Al near 0 boundary, Cu near 1 boundary — triggers auto-extend
  const edge_data = make_data([make_region(`Al`, 0.02, 0.3), make_region(`Cu`, 0.7, 0.98)])

  // section: data far from both boundaries; non-matching: region names aren't components
  const section = make_data([make_region(`Al`, 0.3, 0.5), make_region(`Cu`, 0.5, 0.7)])
  const non_matching = make_data([make_region(`Liquid`, 0.1, 0.9)])
  test.each([
    [`explicit range returned as-is`, [0.2, 0.8], null, [0.2, 0.8]],
    [`no range + no data defaults to [0, 1]`, undefined, null, [0, 1]],
    [`undefined range auto-extends both edges`, undefined, edge_data, [0, 1]],
    [`null range auto-extends both edges`, [null, null], edge_data, [0, 1]],
    [`explicit lo preserved, hi auto-extends`, [0.1, null], edge_data, [0.1, 1]],
    [`lo auto-extends, explicit hi preserved`, [null, 0.9], edge_data, [0, 0.9]],
    [
      `no auto-extend far from the boundaries (section diagram)`,
      undefined,
      section,
      [0.3, 0.7],
    ],
    [
      `data extent when region names don't match components`,
      undefined,
      non_matching,
      [0.1, 0.9],
    ],
  ] as [string, Parameters<typeof compute_x_domain>[0], PhaseDiagramData | null, Vec2][])(
    `%s`,
    (_desc, range, data, expected) => {
      expect(compute_x_domain(range, data)).toEqual(expected)
    },
  )

  // components must match as whole words: Fe3C/SiC are compounds, α(Fe) and "Liquid + C" are
  // the pure components
  test.each([
    [`Fe3C`, `SiC`, [0.02, 0.98]],
    [`α(Fe)`, `Liquid + C`, [0, 1]],
  ])(`edge regions %s / %s in the Fe-C system → %j`, (left, right, expected) => {
    const regions = [make_region(left, 0.02, 0.3), make_region(right, 0.7, 0.98)]
    const data = { ...make_data(regions), components: [`Fe`, `C`] as [string, string] }
    expect(compute_x_domain(undefined, data)).toEqual(expected)
  })
})
