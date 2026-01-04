import { TdbInfoPanel } from '$lib/phase-diagram'
import type { TdbParseResult } from '$lib/phase-diagram/parse'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'

// Create a successful TDB parse result for testing.
function create_tdb_result(
  overrides: Partial<NonNullable<TdbParseResult[`data`]>> = {},
): TdbParseResult {
  return {
    success: true,
    data: {
      elements: [
        { symbol: `AL`, reference_phase: `FCC_A1`, mass: 26.98, enthalpy: 0, entropy: 0 },
        { symbol: `ZN`, reference_phase: `HCP_ZN`, mass: 65.38, enthalpy: 0, entropy: 0 },
      ],
      phases: [
        { name: `LIQUID`, model_hints: ``, sublattice_count: 1, sublattice_sites: [1] },
        {
          name: `FCC_A1`,
          model_hints: `%A`,
          sublattice_count: 2,
          sublattice_sites: [1, 1],
        },
      ],
      functions: [
        {
          name: `GHSERAL`,
          expression: ``,
          temperature_ranges: [{ min: 298, max: 933, expr: `` }],
        },
        {
          name: `GHSERZN`,
          expression: ``,
          temperature_ranges: [{ min: 298, max: 693, expr: `` }],
        },
      ],
      parameters: [{
        type: `G`,
        phase: `LIQUID`,
        constituents: [`AL`],
        order: 0,
        expression: ``,
      }],
      comments: [],
      raw_content: ``,
      ...overrides,
    },
    binary_system: [`AL`, `ZN`],
    temperature_range: [300, 1000],
  }
}

describe(`TdbInfoPanel`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  test(`displays system name, phases, and temperature range`, () => {
    const result = create_tdb_result()
    mount(TdbInfoPanel, {
      target: document.body,
      props: { result, system_name: `Al-Zn` },
    })

    const panel = document.querySelector(`.tdb-info-panel`)
    expect(panel?.textContent).toContain(`Al-Zn`)
    expect(panel?.textContent).toMatch(/300\s*–\s*1000\s*K/)

    const phases = document.querySelector(`.phases`)
    expect(phases?.textContent).toContain(`LIQUID`)
    expect(phases?.textContent).toContain(`FCC_A1`)
  })

  test(`displays functions/parameters count and model summary`, () => {
    const result = create_tdb_result({
      functions: [
        { name: `F1`, expression: ``, temperature_ranges: [] },
        { name: `F2`, expression: ``, temperature_ranges: [] },
        { name: `F3`, expression: ``, temperature_ranges: [] },
      ],
      parameters: [
        { type: `G`, phase: `L`, constituents: [], order: 0, expression: `` },
        { type: `L`, phase: `L`, constituents: [], order: 0, expression: `` },
      ],
      phases: [
        { name: `LIQUID`, model_hints: ``, sublattice_count: 1, sublattice_sites: [1] },
        {
          name: `FCC_A1`,
          model_hints: `%A`,
          sublattice_count: 2,
          sublattice_sites: [1, 1],
        },
        {
          name: `HCP`,
          model_hints: `%A`,
          sublattice_count: 2,
          sublattice_sites: [1, 0.5],
        },
      ],
    })
    mount(TdbInfoPanel, { target: document.body, props: { result } })

    const panel = document.querySelector(`.tdb-info-panel`)
    expect(panel?.textContent).toContain(`3 / 2`)
    expect(panel?.textContent).toContain(`1×1-SL`)
    expect(panel?.textContent).toContain(`2×2-SL`)
  })

  test.each([
    [
      [`$ Database: COST 507 thermochemical database for light metal alloys`],
      true,
      `COST 507`,
    ],
    [[`$ Simple comment without reference keywords`], false, `Ref:`],
  ])(`reference display: comments=%j → shown=%s`, (comments, should_show, text) => {
    const result = create_tdb_result({ comments })
    mount(TdbInfoPanel, { target: document.body, props: { result } })

    const panel = document.querySelector(`.tdb-info-panel`)
    if (should_show) {
      expect(document.querySelector(`.ref`)?.textContent).toContain(text)
    } else {
      expect(panel?.textContent).not.toContain(text)
    }
  })

  describe(`precomputed diagram states`, () => {
    test(`loaded → shows success message`, () => {
      const result = create_tdb_result()
      mount(TdbInfoPanel, {
        target: document.body,
        props: {
          result,
          system_name: `Al-Zn`,
          has_precomputed: true,
          is_precomputed_loaded: true,
        },
      })

      const notice = document.querySelector(`.notice.success`)
      expect(notice?.textContent).toContain(`Phase diagram loaded`)
      expect(notice?.textContent).toContain(`pycalphad`)
    })

    test(`available → shows load button that works`, () => {
      const result = create_tdb_result()
      let load_called = false
      mount(TdbInfoPanel, {
        target: document.body,
        props: {
          result,
          has_precomputed: true,
          is_precomputed_loaded: false,
          on_load_precomputed: () => (load_called = true),
        },
      })

      const btn = document.querySelector(`.load-btn`) as HTMLButtonElement
      expect(btn).not.toBeNull()
      btn?.click()
      expect(load_called).toBe(true)
    })

    test(`not available → shows pycalphad code snippet`, () => {
      const result = create_tdb_result()
      mount(TdbInfoPanel, {
        target: document.body,
        props: { result, has_precomputed: false },
      })

      const code = document.querySelector(`code`)
      expect(code?.textContent).toContain(`from pycalphad import Database, binplot`)
      expect(code?.textContent).toMatch(/\['AL', 'ZN', 'VA'\]/)
    })
  })

  test(`displays error message on parse failure`, () => {
    const result: TdbParseResult = {
      success: false,
      data: null,
      error: `Invalid TDB syntax at line 42`,
    }
    mount(TdbInfoPanel, { target: document.body, props: { result } })

    expect(document.querySelector(`.error`)?.textContent).toContain(
      `Invalid TDB syntax at line 42`,
    )
  })

  test(`falls back to binary_system when no system_name provided`, () => {
    const result = create_tdb_result()
    mount(TdbInfoPanel, { target: document.body, props: { result } })

    expect(document.querySelector(`.tdb-info-panel`)?.textContent).toContain(`AL-ZN`)
  })
})
