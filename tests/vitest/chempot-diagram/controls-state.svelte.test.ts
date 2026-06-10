import {
  CHEMPOT_COLOR_MODE_OPTIONS,
  CHEMPOT_COLOR_SCALE_OPTIONS,
  create_chempot_overrides,
} from '$lib/chempot-diagram/controls-state.svelte'
import type { ChemPotDiagramConfig } from '$lib/chempot-diagram/types'
import { CHEMPOT_DEFAULTS } from '$lib/chempot-diagram/types'
import { describe, expect, test } from 'vitest'

describe(`create_chempot_overrides`, () => {
  test(`resolve falls back override > config > custom default > CHEMPOT_DEFAULTS`, () => {
    let config: ChemPotDiagramConfig = {}
    const overrides = create_chempot_overrides(
      () => config,
      [`formal_chempots`, `element_padding`, `color_mode`, `formulas_to_draw`],
      { color_mode: `arity`, formulas_to_draw: [] },
    )

    // global defaults; custom defaults win over CHEMPOT_DEFAULTS (and cover keys absent from it)
    expect(overrides.resolve(`formal_chempots`)).toBe(CHEMPOT_DEFAULTS.formal_chempots)
    expect(overrides.resolve(`element_padding`)).toBe(CHEMPOT_DEFAULTS.element_padding)
    expect(overrides.resolve(`color_mode`)).toBe(`arity`)
    expect(overrides.resolve(`formulas_to_draw`)).toEqual([])

    // config layer beats defaults; falsy config values (false, 0) are respected
    config = { formal_chempots: false, element_padding: 0 }
    expect(overrides.resolve(`formal_chempots`)).toBe(false)
    expect(overrides.resolve(`element_padding`)).toBe(0)

    // user override layer beats config
    overrides.set(`formal_chempots`, true)
    overrides.set(`element_padding`, 2.5)
    expect(overrides.resolve(`formal_chempots`)).toBe(true)
    expect(overrides.resolve(`element_padding`)).toBe(2.5)

    // reset clears all overrides at once, falling back to config
    overrides.reset()
    expect(overrides.resolve(`formal_chempots`)).toBe(false)
    expect(overrides.resolve(`element_padding`)).toBe(0)
  })

  test(`throws upfront for keys without any default`, () => {
    // `elements` is in ChemPotDiagramConfig but neither in CHEMPOT_DEFAULTS nor custom_defaults
    expect(() => create_chempot_overrides(() => ({}), [`elements`])).toThrow(
      /key 'elements' is missing from both/,
    )
    // same key is fine when a custom default covers it
    expect(() =>
      create_chempot_overrides(() => ({}), [`elements`], { elements: [] }),
    ).not.toThrow()
  })

  test(`color mode/scale option values match the original select options`, () => {
    expect(CHEMPOT_COLOR_MODE_OPTIONS.map(([value]) => value)).toEqual([
      `none`,
      `energy`,
      `formation_energy`,
      `arity`,
      `entries`,
    ])
    expect(CHEMPOT_COLOR_SCALE_OPTIONS.map(([value]) => value)).toEqual([
      `interpolateViridis`,
      `interpolatePlasma`,
      `interpolateInferno`,
      `interpolateMagma`,
      `interpolateCividis`,
      `interpolateTurbo`,
      `interpolateRdYlBu`,
      `interpolateSpectral`,
    ])
  })
})
