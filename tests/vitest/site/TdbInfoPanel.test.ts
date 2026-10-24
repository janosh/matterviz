import TdbInfoPanel from '#site/phase-diagrams/TdbInfoPanel.svelte'
import type { TdbParseResult } from '#site/phase-diagrams/tdb-parse.js'
import { type ComponentProps, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

// only their counts are shown: 2 functions / 1 parameter by default
const tdb_function = (name: string) => ({ name, expression: ``, temperature_ranges: [] })
const tdb_parameter = (type: string) => ({
  type,
  phase: `LIQUID`,
  constituents: [],
  order: 0,
  expression: ``,
})
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
      { name: `FCC_A1`, model_hints: `%A`, sublattice_count: 2, sublattice_sites: [1, 1] },
    ],
    functions: [`GHSERAL`, `GHSERZN`].map(tdb_function),
    parameters: [tdb_parameter(`G`)],
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
  // without system_name the title falls back to binary_system
  test.each([
    [`Al-Zn`, `Al-Zn`],
    [undefined, `AL-ZN`],
  ])(`system_name=%s shows %s, phases, and temperature range`, (system_name, title) => {
    mount_panel({ system_name })
    expect(panel_text()).toContain(title)
    expect(panel_text()).toMatch(/300\s*–\s*1000\s*K/)

    const phases = document.querySelector(`.phases`)
    expect(phases?.textContent).toContain(`LIQUID`)
    expect(phases?.textContent).toContain(`FCC_A1`)
  })

  test(`displays functions/parameters count and model summary`, () => {
    mount_panel(
      {},
      {
        functions: [`F1`, `F2`, `F3`].map(tdb_function),
        parameters: [`G`, `L`].map(tdb_parameter),
        phases: [
          ...create_tdb_result().data.phases,
          { name: `HCP`, model_hints: `%A`, sublattice_count: 2, sublattice_sites: [1, 0.5] },
        ],
      },
    )
    for (const part of [`3 / 2`, `1×1-SL`, `2×2-SL`]) expect(panel_text()).toContain(part)
  })

  // oxfmt-ignore
  test.each([
    [[`$ Database: COST 507 thermochemical database for light metal alloys`], true, `COST 507`],
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
      const on_load_precomputed = vi.fn()
      mount_panel({ has_precomputed: true, is_precomputed_loaded: false, on_load_precomputed })
      const notice = document.querySelector(`.notice.success`)
      expect(notice?.textContent).toContain(`Pre-computed diagram available`)
      expect(notice?.textContent).not.toContain(`Phase diagram loaded`)
      doc_query(`.load-btn`, HTMLButtonElement).click()
      expect(on_load_precomputed).toHaveBeenCalledOnce()
    })

    // a TDB without two real elements gets placeholder components
    test.each([
      [{}, `['AL', 'ZN', 'VA']`],
      [{ elements: [] }, `['EL1', 'EL2', 'VA']`],
    ])(`not available → pycalphad snippet for %j binplots %s`, (data, components) => {
      mount_panel({ has_precomputed: false }, data)
      const code = document.querySelector(`code`)
      expect(code?.textContent).toContain(`from pycalphad import Database, binplot`)
      expect(code?.textContent).toContain(components)
    })
  })
})
