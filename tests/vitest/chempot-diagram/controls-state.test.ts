import { rescale_zoom_to_fit } from '$lib/chempot-diagram/camera'
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

    // `values` snapshots every key at its resolved value (a SettingsSection's current_values)
    expect(overrides.values).toEqual({
      formal_chempots: true,
      element_padding: 2.5,
      color_mode: `arity`,
      formulas_to_draw: [],
    })

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
    // same key is fine when a custom default covers it, and resolves to that default
    expect(
      create_chempot_overrides(() => ({}), [`elements`], { elements: [] }).resolve(`elements`),
    ).toEqual([])
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
  expect(source).not.toMatch(/let (?:back|out_[xy]) = \$state/)
  expect(source).toContain(`const center = data_center`)
  expect(source).toContain(`update_backside_indices(center)`)
})

test(`ChemPotScene3D skips hidden overlay geometry construction`, () => {
  const source = read_component_source(`ChemPotScene3D`)
  expect(source).toContain(
    `if (!show_axes && !show_grid && !display.show_axis_labels) return []`,
  )
  expect(source).toMatch(/line_geom:\s*show_axes\s*\?\s*line_geometry/)
  expect(source).toMatch(/grid_geoms:\s*show_grid/)
  expect(source).toContain(`if (!display.show_bounding_box) return null`)
})

describe(`rescale_zoom_to_fit`, () => {
  test.each([
    [`unpinned zoom stays unpinned`, null, 10, 20, null],
    [`no baseline yet leaves zoom alone`, 40, null, 20, 40],
    [`zero baseline leaves zoom alone`, 40, 0, 20, 40],
    [`zero fit (container mid-layout) leaves zoom alone`, 40, 20, 0, 40],
    // an unchanged fit must short-circuit, not multiply by 1 and write back an ulp of drift
    [`an unchanged fit leaves zoom untouched`, 40, 20, 20, 40],
    [`halving the fit halves the pinned zoom`, 40, 20, 10, 20],
    [`doubling the fit doubles the pinned zoom`, 40, 20, 40, 80],
    // fit = min(width, height) / (extent * 1.6), so halving the viewport while doubling the
    // extent composes into one ratio
    [`extent and viewport compose`, 50, 800 / (10 * 1.6), 400 / (20 * 1.6), 12.5],
  ] as [string, number | null, number | null, number, number | null][])(
    `%s`,
    (_desc, zoom, last_fit, next_fit, expected) => {
      expect(rescale_zoom_to_fit(zoom, last_fit, next_fit)).toBe(expected)
    },
  )

  test(`a resize and its undo return the starting zoom to within an ulp`, () => {
    const [wide_fit, narrow_fit] = [213.33, 160]
    const narrowed = rescale_zoom_to_fit(400, wide_fit, narrow_fit)
    expect(narrowed).toBeLessThan(400)
    expect(rescale_zoom_to_fit(narrowed, narrow_fit, wide_fit)).toBeCloseTo(400, 10)
  })
})
