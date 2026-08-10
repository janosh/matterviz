import {
  CHEMPOT_COLOR_MODE_OPTIONS,
  CHEMPOT_COLOR_SCALE_OPTIONS,
  create_chempot_overrides,
} from '$lib/chempot-diagram/controls-state.svelte'
import type { ChemPotDiagramConfig } from '$lib/chempot-diagram/types'
import { CHEMPOT_DEFAULTS } from '$lib/chempot-diagram/types'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const read_component_source = (component: string): string =>
  readFileSync(
    `${import.meta.dirname}/../../../src/lib/chempot-diagram/${component}.svelte`,
    `utf8`,
  )

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

  test(`throws for keys without a default, accepts custom_defaults`, () => {
    // `elements` is in ChemPotDiagramConfig but neither in CHEMPOT_DEFAULTS nor custom_defaults
    expect(() => create_chempot_overrides(() => ({}), [`elements`])).toThrow(
      /key 'elements' is missing from both/,
    )
    // same key is fine when a custom default covers it
    expect(() =>
      create_chempot_overrides(() => ({}), [`elements`], { elements: [] }),
    ).not.toThrow()
  })
})

test.each([
  [
    `color mode`,
    CHEMPOT_COLOR_MODE_OPTIONS,
    [`none`, `energy`, `formation_energy`, `arity`, `entries`],
  ],
  [
    `color scale`,
    CHEMPOT_COLOR_SCALE_OPTIONS,
    [
      `interpolateViridis`,
      `interpolatePlasma`,
      `interpolateInferno`,
      `interpolateMagma`,
      `interpolateCividis`,
      `interpolateTurbo`,
      `interpolateRdYlBu`,
      `interpolateSpectral`,
    ],
  ],
] as const)(`%s option values match pane selects`, (_label, options, values) => {
  expect(options.map(([value]) => value)).toEqual([...values])
})

test(`ChemPotDiagram3D sanitizes its only raw-HTML sink`, () => {
  const source = [`ChemPotDiagram3D`, `ChemPotScene3D`].map(read_component_source).join(`\n`)
  const sinks = [...source.matchAll(/\{@html\s+(?<expr>[^}]+)\}/g)].map((match) =>
    (match.groups?.expr ?? ``).trim(),
  )
  expect(sinks).toEqual([`sanitize_html(gc.label)`])
})

test(`ChemPotScene3D derives backside placement from current ranges`, () => {
  const source = read_component_source(`ChemPotScene3D`)
  expect(source).toContain(
    `niced_range.map((range, axis_idx) => range[backside_indices[axis_idx]])`,
  )
  const effects = source.match(/\$effect\(\(\) => \{[\s\S]*?\n  \}\)/g) ?? []
  const backside_effect = effects.find((effect) =>
    effect.includes(`update_backside_indices(center)`),
  )
  expect(backside_effect).toContain(`const center = data_center`)
})
