import TdbInfoPanel from '$site/phase-diagrams/TdbInfoPanel.svelte'
import type { TdbParseResult } from '$site/phase-diagrams/tdb-parse'
import { type ComponentProps, mount } from 'svelte'
import { describe, expect, test } from 'vitest'

const create_tdb_result = (
  overrides: Partial<TdbParseResult[`data`]> = {},
): TdbParseResult => ({
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
    parameters: [
      {
        type: `G`,
        phase: `LIQUID`,
        constituents: [`AL`],
        order: 0,
        expression: ``,
      },
    ],
    comments: [],
    ...overrides,
  },
  binary_system: [`AL`, `ZN`],
  temperature_range: [300, 1000],
})
const mount_panel = (
  props: Partial<ComponentProps<typeof TdbInfoPanel>> = {},
  data: Partial<TdbParseResult[`data`]> = {},
) =>
  mount(TdbInfoPanel, {
    target: document.body,
    props: { result: create_tdb_result(data), ...props },
  })
const panel_text = () => document.querySelector(`.tdb-info-panel`)?.textContent

describe(`TdbInfoPanel`, () => {
  test(`displays system name, phases, and temperature range`, () => {
    mount_panel({ system_name: `Al-Zn` })
    expect(panel_text()).toContain(`Al-Zn`)
    expect(panel_text()).toMatch(/300\s*–\s*1000\s*K/)

    const phases = document.querySelector(`.phases`)
    expect(phases?.textContent).toContain(`LIQUID`)
    expect(phases?.textContent).toContain(`FCC_A1`)
  })

  test(`displays functions/parameters count and model summary`, () => {
    mount_panel(
      {},
      {
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
      },
    )
    for (const part of [`3 / 2`, `1×1-SL`, `2×2-SL`]) expect(panel_text()).toContain(part)
  })

  test.each([
    [
      [`$ Database: COST 507 thermochemical database for light metal alloys`],
      true,
      `COST 507`,
    ],
    [[`$ Simple comment without reference keywords`], false, `Ref:`],
  ])(`reference display: comments=%j → shown=%s`, (comments, should_show, text) => {
    mount_panel({}, { comments })
    if (should_show) expect(document.querySelector(`.ref`)?.textContent).toContain(text)
    else expect(panel_text()).not.toContain(text)
  })

  describe(`precomputed diagram states`, () => {
    test(`loaded → shows success message`, () => {
      mount_panel({ system_name: `Al-Zn`, has_precomputed: true, is_precomputed_loaded: true })
      const notice = document.querySelector(`.notice.success`)
      expect(notice?.textContent).toContain(`Phase diagram loaded`)
      expect(notice?.textContent).toContain(`pycalphad`)
    })

    test(`available → shows load button that works`, () => {
      let load_called = false
      mount_panel({
        has_precomputed: true,
        is_precomputed_loaded: false,
        on_load_precomputed: () => (load_called = true),
      })
      const btn = document.querySelector(`.load-btn`) as HTMLButtonElement
      expect(btn).not.toBeNull()
      btn?.click()
      expect(load_called).toBe(true)
    })

    test(`not available → shows pycalphad code snippet`, () => {
      mount_panel({ has_precomputed: false })
      const code = document.querySelector(`code`)
      expect(code?.textContent).toContain(`from pycalphad import Database, binplot`)
      expect(code?.textContent).toMatch(/\['AL', 'ZN', 'VA'\]/)
    })
  })

  test(`falls back to binary_system when no system_name provided`, () => {
    mount_panel()
    expect(panel_text()).toContain(`AL-ZN`)
  })
})
