import type { Vec2 } from '#lib/math.js'
import type { CompUnit, DiagramRegion, TempUnit } from '#lib/phase-diagram/index.js'
import {
  calculate_lever_rule,
  compute_label_properties,
  convert_temp,
  find_region_at,
  format_composition,
  format_temperature,
  generate_boundary_path,
  generate_region_path,
  get_phase_stability_range,
  merge_phase_diagram_config,
  named_phase_color,
  PHASE_DIAGRAM_DEFAULTS,
  transform_vertices,
} from '#lib/phase-diagram/utils.js'
import { describe, expect, test } from 'vitest'
import { pts, rect } from './fixtures/test-data'

describe(`find_region_at`, () => {
  const regions: DiagramRegion[] = [
    { phases: [`LIQUID`], vertices: rect(0, 700, 1, 900) },
    { phases: [`FCC`], vertices: rect(0, 300, 1, 700) },
  ]
  test.each([
    { comp: 0.5, temp: 800, expected: `LIQUID`, desc: `high temp → liquid` },
    { comp: 0.5, temp: 500, expected: `FCC`, desc: `low temp → solid` },
    { comp: 0.5, temp: 1000, expected: null, desc: `outside regions → null` },
  ])(`$desc`, ({ comp, temp, expected }) => {
    expect(find_region_at(regions, comp, temp)?.phases[0] ?? null).toBe(expected)
  })

  test(`later regions take precedence (overlapping)`, () => {
    const overlapping = [
      { phases: [`first`], vertices: rect(0, 0, 1, 1) },
      { phases: [`second`], vertices: rect(0.25, 0.25, 0.75, 0.75) },
    ]
    expect(find_region_at(overlapping, 0.5, 0.5)?.phases).toEqual([`second`])
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

// named_phase_color serves the pressure-temperature diagram's phase palette
describe(`named_phase_color`, () => {
  test.each([
    // Greek letters and Latin names map to the same color, case-insensitively
    [`α`, `#90ee90`],
    [`ALPHA`, `#90ee90`],
    [`β`, `#ffb6c1`],
    [`γ`, `#ffdab9`],
    // "theta" contains "eta": must win over the eta rule
    [`θ`, `#f5deb3`],
    [`THETA`, `#f5deb3`],
    [`ETA`, `#e6e6fa`],
    [`Liquid`, `#87cefc`],
    [`L`, `#87cefc`],
    // structure prefixes map to alpha/beta/gamma
    [`FCC_A1`, `#90ee90`],
    [`bcc`, `#ffb6c1`],
    [`HCP_A3`, `#ffdab9`],
    [`Unknown`, null],
    [``, null],
  ])(`%s → %s`, (name, hex) => {
    expect(named_phase_color(name)).toBe(hex)
  })
})

describe(`format_composition`, () => {
  test.each([
    [0.5, `at%`, `50 at%`],
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

// temperatures are K, converted to the display unit
describe(`format_temperature`, () => {
  test.each<[number, TempUnit, string]>([
    [499.6, `K`, `500 K`], // rounds to whole degrees
    [298.15, `°C`, `25 °C`],
    [298.15, `°F`, `77 °F`],
  ])(`%d K in %s → %s`, (value, unit, expected) => {
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
const two_phase_region: DiagramRegion = { phases: [`A`, `B`], vertices: trapezoid }
const single_phase_region: DiagramRegion = { phases: [`L`], vertices: rect(0, 700, 1, 900) }
const three_phase_region: DiagramRegion = { ...two_phase_region, phases: [`A`, `B`, `C`] }
const no_phase_region: DiagramRegion = { ...two_phase_region, phases: [] }
const split_region_horizontal: DiagramRegion = {
  phases: [`A`, `B`],
  vertices: [
    ...pts(0.1, 400, 0.9, 400, 0.9, 600, 0.6, 600),
    ...pts(0.6, 450, 0.4, 450, 0.4, 600, 0.1, 600),
  ],
}

function expect_non_null<T>(value: T | null): T {
  expect(value).not.toBeNull()
  return value as T
}

// two_phase_region is the trapezoid (0.2,400)-(0.8,400)-(0.7,600)-(0.3,600): at T the
// boundaries sit at x = 0.2 + (T-400)/2000 and 0.8 - (T-400)/2000
const x_left_at = (temp: number) => 0.2 + (temp - 400) / 2000
const x_right_at = (temp: number) => 0.8 - (temp - 400) / 2000

describe(`calculate_lever_rule`, () => {
  test.each([
    { region: split_region_horizontal, comp: 0.5, temp: 500, desc: `gap between intervals` },
    { region: single_phase_region, comp: 0.5, temp: 800, desc: `single-phase region` },
    { region: two_phase_region, comp: 0.5, temp: 300, desc: `temp outside region` },
    { region: two_phase_region, comp: 0.1, temp: 500, desc: `comp outside region` },
    { region: three_phase_region, comp: 0.5, temp: 500, desc: `3+ phase region` },
    { region: no_phase_region, comp: 0.5, temp: 500, desc: `no phases` },
  ])(`returns null for $desc`, ({ region, comp, temp }) => {
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
      left_phase: `A`,
      right_phase: `B`,
      left_composition: expect.closeTo(x_left, 9),
      right_composition: expect.closeTo(x_right, 9),
      fraction_left: expect.closeTo(1 - fraction_right, 9),
      fraction_right: expect.closeTo(fraction_right, 9),
    })
  })

  // V-notch whose tip (0.5, 450) touches the isotherm: two crossings at one point, which a
  // dedup merged into one, shifting the pairing to [0.1, 0.5] and leaving 0.7 unbracketed
  const notched_region: DiagramRegion = {
    ...two_phase_region,
    vertices: pts(0.1, 400, 0.9, 400, 0.9, 600, 0.5, 450, 0.1, 600),
  }
  // oxfmt-ignore
  test.each([
    { region: split_region_horizontal, position: 0.35, temp: 500, expected_bounds: [0.1, 0.4] },
    { region: split_region_horizontal, position: 0.65, temp: 500, expected_bounds: [0.6, 0.9] },
    { region: notched_region, position: 0.3, temp: 450, expected_bounds: [0.1, 0.5] },
    { region: notched_region, position: 0.7, temp: 450, expected_bounds: [0.5, 0.9] },
  ])(
    `uses the nearest two-phase bounds at composition=$position when multiple intersections exist`,
    ({ region, position, temp, expected_bounds }) => {
      const result = expect_non_null(calculate_lever_rule(region, position, temp))
      expect(result.left_composition).toBeCloseTo(expected_bounds[0], 9)
      expect(result.right_composition).toBeCloseTo(expected_bounds[1], 9)
    },
  )

  // the format lists a two-phase region's phases left to right: phases[0] is the low-x end
  test(`tie-line ends follow the region's phase order`, () => {
    const result = expect_non_null(
      calculate_lever_rule({ ...two_phase_region, phases: [`B`, `A`] }, 0.5, 500),
    )
    expect([result.left_phase, result.right_phase]).toEqual([`B`, `A`])
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

  // A shrunk label rotated in a tall region runs along its height, so the height sets the
  // scale (it used the width, as for a flat label, and bottomed out at 0.7)
  test.each([
    { width: 60, height: 100, rotation: -90, scale: 80 / 86.4, desc: `tall, narrow` },
    { width: 95, height: 100, rotation: -90, scale: 80 / 86.4, desc: `tall, nearly square` },
    { width: 100, height: 40, rotation: 0, scale: 80 / 86.4, desc: `wide` },
  ])(`scale fallback: $desc`, ({ width, height, rotation, scale }) => {
    const result = compute_label_properties(`ABCDEFGHIJKL`, { width, height }, 12)
    expect(result.rotation).toBe(rotation)
    expect(result.scale).toBeCloseTo(scale, 12)
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
    // absolute zero and a non-round value
    { value: 0, from: `K`, to: `°C`, expected: -273.15 },
    { value: 0, from: `K`, to: `°F`, expected: -459.67 },
    { value: 1234.5, from: `°C`, to: `°F`, expected: 2254.1 },
  ] as const)(`$value $from → $expected $to`, ({ value, from, to: target, expected }) => {
    expect(convert_temp(value, from, target)).toBeCloseTo(expected, 9)
  })

  test.each([`K`, `°C`, `°F`] as const)(
    `identity: same unit (%s) returns input unchanged`,
    (unit) => {
      expect(convert_temp(500, unit, unit)).toBe(500)
    },
  )
})

// oxfmt-ignore
test.each([
  [`rectangle`, rect(0, 400, 1, 800), { t_min: 400, t_max: 800 }],
  [`single vertex`, pts(0.5, 600), { t_min: 600, t_max: 600 }],
  [`irregular polygon`, pts(0.2, 400, 0.8, 450, 0.7, 650, 0.3, 600), { t_min: 400, t_max: 650 }],
  [`no vertices`, [], null],
] as [string, Vec2[], { t_min: number; t_max: number } | null][])(
  `get_phase_stability_range: %s → %o`,
  (_desc, vertices, expected) => {
    expect(get_phase_stability_range({ phases: [`A`], vertices })).toEqual(expected)
  },
)

// format_hover_info_text is covered in IsobaricBinaryPhaseDiagram.test.ts
