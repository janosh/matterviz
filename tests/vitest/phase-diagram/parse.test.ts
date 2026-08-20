// Unit tests for TDB (Thermodynamic Database) parser
import type { TdbData } from '$lib/phase-diagram/parse'
import {
  get_system_name,
  is_binary_system,
  normalize_system_name,
  parse_tdb,
} from '$lib/phase-diagram/parse'
import { describe, expect, test } from 'vitest'
import { SAMPLE_TDB_CONTENT } from './fixtures/test-data'

describe(`parse_tdb`, () => {
  const sample = parse_tdb(SAMPLE_TDB_CONTENT)

  test.each([``, `$ only a comment\n$ and another`, `{"not": "a tdb"}`])(
    `throws for content without TDB statements: %j`,
    (content) => {
      expect(() => parse_tdb(content)).toThrow(`Not a TDB file`)
    },
  )

  test(`parses the Al-Zn sample: counts, elements, binary system, T range`, () => {
    const { data, binary_system, temperature_range } = sample
    expect(data.comments).toEqual([
      `Al-Zn binary system test database`,
      `Comment line should be captured`,
    ])
    expect(data.elements.map((el) => el.symbol)).toEqual([`/-`, `VA`, `AL`, `ZN`])
    expect(data.elements[2]).toEqual({
      symbol: `AL`,
      reference_phase: `FCC_A1`,
      mass: 0.026982,
      enthalpy: 4577.3,
      entropy: 28.322,
    })
    expect(data.phases.map((phase) => phase.name)).toEqual([`LIQUID`, `FCC_A1`, `HCP_ZN`])
    expect(data.functions.map((func) => func.name)).toEqual([`GHSERAL`, `GHSERZN`])
    expect(data.parameters).toHaveLength(3)
    expect(binary_system).toEqual([`AL`, `ZN`])
    // min over all FUNCTION ranges (298.15) and max (GHSERAL's last breakpoint, 2900 K)
    expect(temperature_range).toEqual([298.15, 2900])
  })

  test(`multi-line FUNCTION bodies become consecutive temperature ranges`, () => {
    const ghseral = sample.data.functions[0]
    expect(ghseral.temperature_ranges.map(({ min, max }) => [min, max])).toEqual([
      [298.15, 700],
      [700, 933.47],
      [933.47, 2900],
    ])
    expect(ghseral.temperature_ranges[0].expr).toMatch(/^-7976\.15\+137\.093038\*T/)
    expect(ghseral.temperature_ranges[2].expr).not.toMatch(/\sN$/)
  })

  test(`PHASE sublattices and CONSTITUENT lists`, () => {
    const [liquid, fcc] = sample.data.phases
    expect(liquid).toMatchObject({ sublattice_count: 1, sublattice_sites: [1] })
    expect(liquid.constituents).toEqual([[`AL`, `ZN`]])
    expect(fcc).toMatchObject({
      model_hints: `%A`,
      sublattice_count: 2,
      sublattice_sites: [1, 1],
    })
    expect(fcc.constituents).toEqual([[`AL`, `ZN`], [`VA`]])
  })

  test(`PARAMETER spec splits into type, phase, constituents and order`, () => {
    expect(sample.data.parameters[2]).toEqual({
      type: `L`,
      phase: `LIQUID`,
      constituents: [`AL`, `ZN`],
      order: 0,
      expression: `298.15 +10465.55-3.39259*T; 6000 N `,
    })
  })

  test(`uses default temperature range when no functions`, () => {
    const result = parse_tdb(`ELEMENT AL FCC_A1 0.02698 4577.3 28.32!`)
    expect(result.temperature_range).toEqual([298.15, 3000])
    expect(result.binary_system).toBeUndefined()
  })

  test(`handles Windows line endings`, () => {
    const content = `ELEMENT AL FCC_A1 0.02698 4577.3 28.32!\r\nELEMENT ZN HCP_ZN 0.06538 5656.8 41.63!`
    expect(parse_tdb(content).data.elements.map((el) => el.symbol)).toEqual([`AL`, `ZN`])
  })

  test(`joins continuation lines until the closing !`, () => {
    const content = `FUNCTION TEST 298.15 +100\n+200\n+300; 1000 N !`
    expect(parse_tdb(content).data.functions[0].temperature_ranges).toEqual([
      { min: 298.15, max: 1000, expr: `+100 +200 +300` },
    ])
  })

  test(`is case-insensitive for keywords`, () => {
    const content = `element al fcc_a1 0.02698 4577.3 28.32!\nPHASE liquid % 1 1.0 !`
    const { data } = parse_tdb(content)
    expect(data.elements[0].symbol).toBe(`AL`)
    expect(data.phases[0].name).toBe(`liquid`)
  })
})

describe(`get_system_name`, () => {
  test.each([
    { elements: [`AL`, `ZN`], expected: `AL-ZN` },
    { elements: [`ZN`, `AL`], expected: `AL-ZN` },
    { elements: [`al`, `zn`], expected: `AL-ZN` },
    { elements: [`FE`, `C`, `VA`], expected: `C-FE` },
    { elements: [], expected: `` },
  ])(`$elements returns $expected`, ({ elements, expected }) => {
    expect(get_system_name(elements)).toBe(expected)
  })
})

describe(`is_binary_system`, () => {
  const make_data = (elements: string[]): TdbData => ({
    elements: elements.map((sym) => ({
      symbol: sym,
      reference_phase: ``,
      mass: 0,
      enthalpy: 0,
      entropy: 0,
    })),
    phases: [],
    functions: [],
    parameters: [],
    comments: [],
  })

  test.each([
    { elements: [`AL`, `ZN`], expected: true },
    { elements: [`AL`, `ZN`, `VA`], expected: true },
    { elements: [`AL`], expected: false },
    { elements: [`AL`, `ZN`, `CU`], expected: false },
  ])(`$elements returns $expected`, ({ elements, expected }) => {
    expect(is_binary_system(make_data(elements))).toBe(expected)
  })
})

describe(`normalize_system_name`, () => {
  test.each([
    { input: `Al-Zn`, expected: `AL-ZN` },
    { input: `al_zn`, expected: `AL-ZN` },
    { input: `AL_ZN`, expected: `AL-ZN` },
    { input: `zn-al`, expected: `AL-ZN` },
    { input: `Cu-Mg`, expected: `CU-MG` },
    { input: `cumg`, expected: `CU-MG` },
    { input: `CUMG`, expected: `CU-MG` },
    { input: `cu_mg`, expected: `CU-MG` },
    { input: `mgcu`, expected: `CU-MG` },
    { input: `Fe-Ni`, expected: `FE-NI` },
    { input: `feni`, expected: `FE-NI` },
    { input: `PbSn`, expected: `PB-SN` },
    { input: `pbsn`, expected: `PB-SN` },
    { input: `snpb`, expected: `PB-SN` },
    { input: ``, expected: `` },
    { input: `INVALID`, expected: `INVALID` },
    { input: `Al-Fe-Cu`, expected: `AL-CU-FE` },
    // Backtracking cases: greedy two-letter match fails, single-letter works
    { input: `NBr`, expected: `BR-N` }, // NB (niobium) + R fails, N + BR works
    { input: `ScI`, expected: `I-SC` }, // SC (scandium) + I works (greedy succeeds)
    { input: `SiC`, expected: `C-SI` }, // SI (silicon) + C works (greedy succeeds)
  ])(`normalizes "$input" to "$expected"`, ({ input, expected }) => {
    expect(normalize_system_name(input)).toBe(expected)
  })
})

describe(`parse_tdb edge cases`, () => {
  test(`handles PHASE line with special model hints`, () => {
    const content = `PHASE BCC_A2 %& 2 1 3 !\nCONSTITUENT BCC_A2 :AL,FE : VA% : !`
    const result = parse_tdb(content)
    expect(result.data.phases[0]?.model_hints).toBe(`%&`)
    expect(result.data.phases[0]?.sublattice_count).toBe(2)
  })

  test(`handles nested parentheses in PARAMETER expressions`, () => {
    const content = `PARAMETER G(FCC_A1,AL:VA;0) 298.15 +GHSER(AL)+1000*(T-298.15); 6000 N !`
    const result = parse_tdb(content)
    expect(result.data.parameters).toHaveLength(1)
    expect(result.data.parameters[0]?.expression).toContain(`GHSER(AL)`)
  })

  test(`handles multiple comment lines with metadata`, () => {
    const content = `
$ Database: Test TDB v1.0
$ Author: Test Author
$ Date: 2024-01-01
$ Reference: Test Reference
ELEMENT AL FCC_A1 0.02698 4577.3 28.32!
`
    const result = parse_tdb(content)
    expect(result.data.comments.length).toBeGreaterThanOrEqual(4)
    expect(result.data.comments.some((cmt) => cmt.includes(`Author`))).toBe(true)
  })

  test(`handles scientific notation with lowercase e`, () => {
    const content = `ELEMENT AL FCC_A1 2.698e-02 4.577e+03 2.832e+01!`
    const result = parse_tdb(content)
    expect(result.data.elements[0]?.mass).toBeCloseTo(0.02698, 4)
  })

  test(`handles TYPE_DEFINITION and DEFINE_SYSTEM_DEFAULT gracefully`, () => {
    const content = `
TYPE_DEFINITION % SEQ *!
DEFINE_SYSTEM_DEFAULT ELEMENT 2 !
DEFAULT_COMMAND DEF_SYS_ELEMENT VA !
ELEMENT AL FCC_A1 0.02698 4577.3 28.32!
`
    expect(parse_tdb(content).data.elements).toHaveLength(1)
  })

  test(`handles elements with ELECTRON_GAS reference phase`, () => {
    const content = `ELEMENT /-   ELECTRON_GAS 0 0 0!`
    const result = parse_tdb(content)
    expect(result.data.elements[0]?.symbol).toBe(`/-`)
    expect(result.data.elements[0]?.reference_phase).toBe(`ELECTRON_GAS`)
  })

  test(`correctly excludes /- and VA from binary system detection`, () => {
    const content = `
ELEMENT /-   ELECTRON_GAS 0 0 0!
ELEMENT VA   VACUUM 0 0 0!
ELEMENT CU   FCC_A1 0.06355 5004 33.15!
ELEMENT MG   HCP_A3 0.02431 4998 32.67!
`
    const result = parse_tdb(content)
    expect(result.binary_system).toEqual([`CU`, `MG`])
  })

  test(`handles CONSTITUENT with complex sublattice structure`, () => {
    // Note: CONSTITUENT must come after PHASE and on a separate line
    const content = `PHASE CU2MG %  2 2 1 !
CONSTITUENT CU2MG :CU,MG : CU,MG : !`
    const result = parse_tdb(content)
    const phase = result.data.phases.find(
      (candidate_phase) => candidate_phase.name === `CU2MG`,
    )
    expect(phase?.constituents?.[0]).toEqual([`CU`, `MG`])
    expect(phase?.constituents?.[1]).toEqual([`CU`, `MG`])
  })

  test(`handles real-world TDB from NIMS database`, () => {
    const content = `
$ TDB-file for Cu-Mg system
$ Copyright (C) NIMS 2008
ELEMENT /-   ELECTRON_GAS              0.0000E+00  0.0000E+00  0.0000E+00!
ELEMENT VA   VACUUM                    0.0000E+00  0.0000E+00  0.0000E+00!
ELEMENT CU   FCC_A1                    6.3546E+01  5.0041E+03  3.3150E+01!
ELEMENT MG   HCP_A3                    2.4305E+01  4.9980E+03  3.2671E+01!
FUNCTION GHSERCU    298.15  -7770.458+130.485403*T-24.112392*T*LN(T)
                  -.00265684*T**2+1.29223E-07*T**3+52478*T**(-1); 1358.02 Y
        -13542.33+183.804197*T-31.38*T*LN(T)+3.64643E+29*T**(-9);  3200 N !
PHASE LIQUID:L %  1  1.0  !
PHASE FCC_A1  %&  2 1   1 !
PHASE HCP_A3  %  2 1   .5 !
PHASE CU2MG  %  2 2 1 !
`
    const { data, binary_system, temperature_range } = parse_tdb(content)
    expect(binary_system).toEqual([`CU`, `MG`])
    expect(data.phases.map((phase) => phase.name)).toEqual([
      `LIQUID:L`,
      `FCC_A1`,
      `HCP_A3`,
      `CU2MG`,
    ])
    expect(data.functions[0].temperature_ranges.map(({ min, max }) => [min, max])).toEqual([
      [298.15, 1358.02],
      [1358.02, 3200],
    ])
    expect(temperature_range).toEqual([298.15, 3200])
  })
})
