import { plot_color } from '#lib/colors/index.js'
import {
  convert_pressure,
  parse_pt_data,
  pressure_log_floor,
  pt_data_extent,
  pt_phase_colors,
} from '#lib/phase-diagram/pressure-temperature/data.js'
import type {
  PtBoundary,
  PtPhaseDiagramData,
} from '#lib/phase-diagram/pressure-temperature/types.js'
import { named_phase_color } from '#lib/phase-diagram/utils.js'
import {
  iron_pt_diagram,
  water_pt_diagram,
} from '#site/phase-diagrams/pressure-temperature.js'
import { describe, expect, test } from 'vitest'

// Two phases split by one line, valid as given; cases below break one field at a time
const melting: PtBoundary = {
  id: `melting`,
  phases: [`solid`, `liquid`],
  // oxfmt-ignore
  points: [[0, 1000], [10, 1200]],
}
const base: PtPhaseDiagramData = {
  phases: [{ id: `solid` }, { id: `liquid` }],
  boundaries: [melting],
}
const with_boundary = (patch: Record<string, unknown>) => ({
  ...base,
  boundaries: [{ ...melting, ...patch }],
})
const with_region = (patch: Record<string, unknown>) => ({
  ...base,
  // oxfmt-ignore
  regions: [{ phase: `solid`, vertices: [[0, 0], [1, 0], [1, 1]], ...patch }],
})
const with_special = (...special_points: Record<string, unknown>[]) => ({
  ...base,
  special_points,
})
const critical = { id: `cp`, type: `critical`, position: [1, 1] }

describe(`parse_pt_data`, () => {
  test.each([
    [`iron demo`, iron_pt_diagram],
    [`water demo`, water_pt_diagram],
    [`minimal`, base],
  ])(`%s validates clean`, (_label, data) => {
    expect(parse_pt_data(data)).toEqual({ data, errors: [] })
  })

  // Every problem is reported, never thrown (a throw would crash the component's $derived),
  // including JSON from another runtime with wrong container types or missing ids
  // oxfmt-ignore
  test.each([
    [`not an object`, [], [`data must be an object`]],
    [`regions object`, { ...base, regions: {} }, [`regions must be an array`]],
    [`boundaries missing`, { phases: base.phases }, [`boundaries must be an array`]],
    [`special_points object`, { ...base, special_points: {} }, [`special_points must be an array`]],
    [`null phase entry`, { ...base, phases: [null, ...base.phases] }, [`phases[0] must be an object`]],
    [`phase without id`, { ...base, phases: [{ name: `x` }, ...base.phases] }, [`phases[0] needs a non-empty string id`]],
    [`sigma_t string`, with_boundary({ sigma_t: `ab` }), [`boundary 'melting' sigma_t must be an array`]],
    [`numeric phase name`, { ...base, phases: [{ id: `solid`, name: 7 }, { id: `liquid` }] }, [`phase 'solid' name must be a string`]],
    [`special point phases string`, with_special({ id: `tp`, type: `triple`, position: [1, 1], phases: `liquid` }), [`special point 'tp' phases must be an array`]],
    [`empty phases`, { ...base, phases: [] }, [`phases must be non-empty`]],
    [`duplicate phase id`, { ...base, phases: [...base.phases, { id: `solid` }] }, [`duplicate phase id 'solid'`]],
    [`duplicate boundary id`, { ...base, boundaries: [melting, melting] }, [`duplicate boundary id 'melting'`]],
    [`unknown boundary phase`, with_boundary({ phases: [`solid`, `gas`] }), [`boundary 'melting' references unknown phase 'gas'`]],
    [`same-phase pair`, with_boundary({ phases: [`solid`, `solid`] }), [`boundary 'melting' needs two distinct phases, got ["solid","solid"]`]],
    [`single point`, with_boundary({ points: [[0, 1000]] }), [`boundary 'melting' needs at least 2 points`]],
    [`non-finite point`, with_boundary({ points: [[0, 1000], [Number.NaN, 1200]] }), [`boundary 'melting' point 1 is not a finite [P, T] pair`]],
    [`sigma length mismatch`, with_boundary({ sigma_t: [5] }), [`boundary 'melting' sigma_t has 1 entries for 2 points`]],
    [`negative sigma`, with_boundary({ sigma_p: [0.1, -0.1] }), [`boundary 'melting' sigma_p must be finite and non-negative`]],
    [`region with unknown phase`, with_region({ phase: `gas` }), [`region 0 (gas) references unknown phase 'gas'`]],
    [`region with 2 vertices`, with_region({ vertices: [[0, 0], [1, 0]] }), [`region 0 (solid) needs at least 3 vertices`]],
    [`region with non-finite vertex`, with_region({ vertices: [[0, 0], [1, Infinity], [1, 1]] }), [`region 0 (solid) has a non-finite vertex`]],
    [`non-finite label_position`, with_region({ label_position: [1, Number.NaN] }), [`region 0 (solid) label_position is not a finite [P, T] pair`]],
    [`duplicate special point id`, with_special(critical, { ...critical, type: `triple` }), [`duplicate special point id 'cp'`]],
    [`special point bad position`, with_special({ ...critical, position: [1, Number.NaN] }), [`special point 'cp' position is not a finite [P, T] pair`]],
    [`special point unknown phase`, with_special({ ...critical, phases: [`gas`] }), [`special point 'cp' references unknown phase 'gas'`]],
    [`special point negative sigma`, with_special({ ...critical, sigma_t: -1 }), [`special point 'cp' sigma must be finite and non-negative`]],
    [`special point non-finite sigma_p`, with_special({ ...critical, sigma_p: Infinity }), [`special point 'cp' sigma must be finite and non-negative`]],
    [`unknown special point type`, with_special({ ...critical, type: `eutectic` }), [`special point 'cp' has unknown type 'eutectic' (triple, critical, custom)`]],
    [`inverted pressure range`, { ...base, pressure_range: [10, 0] }, [`pressure_range must be [min, max] with min < max, got [10,0]`]],
    [`empty temperature range`, { ...base, temperature_range: [500, 500] }, [`temperature_range must be [min, max] with min < max, got [500,500]`]],
    [`unknown pressure unit`, { ...base, pressure_unit: `psi` }, [`unknown pressure_unit 'psi'`]],
    [`prototype key as unit`, { ...base, pressure_unit: `toString` }, [`unknown pressure_unit 'toString'`]],
    [`unknown temperature unit`, { ...base, temperature_unit: `R` }, [`unknown temperature_unit 'R'`]],
    // kinds that would render as nonsense: a truthy string, "31.5" px strokes, [object Object]
    [`string metastable`, with_boundary({ metastable: `no` }), [`boundary 'melting' metastable must be a boolean`]],
    [`string style`, with_boundary({ style: `red` }), [`boundary 'melting' style must be an object`]],
    [`string style.width`, with_boundary({ style: { width: `3` } }), [`boundary 'melting' style.width must be a finite number`]],
    [`object system`, { ...base, system: {} }, [`system must be a string`]],
    [`numeric title`, { ...base, title: 5 }, [`title must be a string`]],
    [`several problems at once`, { ...with_boundary({ phases: [`solid`, `gas`], sigma_t: [1] }), pressure_unit: `psi` }, [`boundary 'melting' references unknown phase 'gas'`, `boundary 'melting' sigma_t has 1 entries for 2 points`, `unknown pressure_unit 'psi'`]],
  ] satisfies [string, unknown, string[]][])(`%s is reported`, (_label, data, errors) => {
    expect(parse_pt_data(data)).toEqual({ data: null, errors })
  })

  // Python's None serializes to null: optional keys set to null mean "not set", never a throw
  test(`null optional fields count as omitted`, () => {
    const from_python = {
      ...with_boundary({ sigma_t: null, sigma_p: null, label: null }),
      ...Object.fromEntries(
        [
          `regions`,
          `special_points`,
          `pressure_range`,
          `temperature_range`,
          `pressure_unit`,
          `temperature_unit`,
          `title`,
        ].map((key) => [key, null]),
      ),
    }
    const { data, errors } = parse_pt_data(from_python)
    expect(errors).toEqual([])
    expect(data).toEqual(base)
    expect(data && `regions` in data).toBe(false)
  })
})

describe(`units`, () => {
  // Pa per unit are exact decimal powers (and 101325 for atm), so these products are exact or
  // off by at most a couple of ulps: 12 significant digits leaves ample margin above f64 eps
  test.each([
    [1, `GPa`, `kbar`, 10],
    [1, `GPa`, `bar`, 1e4],
    [1, `atm`, `Pa`, 101_325],
    [1, `bar`, `kPa`, 100],
    [22.064e6, `Pa`, `MPa`, 22.064],
    [3.7, `GPa`, `GPa`, 3.7],
  ] as const)(`%d %s = %d %s`, (value, from, to, expected) => {
    expect(convert_pressure(value, from, to) / expected).toBeCloseTo(1, 12)
    expect(convert_pressure(expected, to, from) / value).toBeCloseTo(1, 12)
  })
})

// Explicit color, then the named phase palette, then the plot palette by index. Substring
// matching gives 'α-Ti' and 'α'' the same palette color, so the second falls back to the plot
// palette and two phases never share a fill.
test(`pt_phase_colors`, () => {
  const colors = pt_phase_colors([
    { id: `ice`, color: `#123456` },
    { id: `liq`, name: `Liquid` },
    { id: `solid-x` },
    { id: `a1`, name: `α-Ti` },
    { id: `a2`, name: `α'` },
  ])
  expect([...colors.values()]).toEqual([
    `#123456`,
    named_phase_color(`Liquid`),
    plot_color(2),
    named_phase_color(`α`),
    plot_color(4),
  ])
})

// oxfmt-ignore
test.each([
  [`declared ranges win`, { ...base, pressure_range: [1, 2], temperature_range: [3, 4] }, [[1, 2], [3, 4]]],
  [`boundaries, special points and regions`, { ...with_region({ vertices: [[-1, 1000], [0, 1300], [5, 1000]] }), special_points: [{ ...critical, position: [12, 900] }] }, [[-1, 12], [900, 1300]]],
  // one point: pad the empty span by 1 on each side instead of a zero-width axis
  [`degenerate span`, { ...with_special({ ...critical, position: [5, 300] }), boundaries: [] }, [[4, 6], [299, 301]]],
  [`no points at all`, { ...base, boundaries: [] }, [[0, 1], [0, 1]]],
  [`declared pressure, temperature from the data`, { ...base, pressure_range: [0, 50] }, [[0, 50], [1000, 1200]]],
  [`iron demo`, iron_pt_diagram, [[0, 150], [300, 4000]]],
  [`water demo`, water_pt_diagram, [[1, 2e8], [190, 800]]],
] satisfies [string, unknown, number[][]][])(`pt_data_extent: %s`, (_label, data, expected) => {
  expect(pt_data_extent(data as PtPhaseDiagramData)).toEqual(expected)
})

// oxfmt-ignore
test.each([
  [`positive declared lower bound`, { ...base, pressure_range: [0.5, 10] }, 0.5],
  // a 0 lower bound can't sit on a log axis: fall back to the smallest positive data pressure
  [`zero declared bound`, { ...base, pressure_range: [0, 50] }, 10],
  // the only positive pressure is the window's top, so a log axis would span nothing
  [`zero log span`, { ...base, pressure_range: [0, 10] }, null],
  [`special point below boundaries`, with_special({ ...critical, position: [0.01, 300] }), 0.01],
  [`no positive pressure`, with_boundary({ points: [[0, 1], [-1, 2]] }), null],
  [`iron demo (0 GPa endpoints)`, iron_pt_diagram, 0.7],
  [`water demo`, water_pt_diagram, 1],
] satisfies [string, unknown, number | null][])(`pressure_log_floor: %s`, (_label, data, expected) => {
  expect(pressure_log_floor(data as PtPhaseDiagramData)).toBe(expected)
})
