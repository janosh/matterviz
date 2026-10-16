import { rescale_zoom_to_fit } from '#lib/chempot-diagram/camera.js'
import ChemPotControls from '#lib/chempot-diagram/ChemPotControls.svelte'
import { create_chempot_overrides } from '#lib/chempot-diagram/controls-state.svelte.js'
import type { ChemPotDiagramConfig } from '#lib/chempot-diagram/types.js'
import { CHEMPOT_DEFAULTS } from '#lib/chempot-diagram/types.js'
import { readFileSync } from 'node:fs'
import { mount, tick, unmount } from 'svelte'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { doc_query, fire, mouse } from '../setup'

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
    expect(overrides.changed_keys).toEqual([])

    // user override layer beats config
    overrides.set(`formal_chempots`, true)
    overrides.set(`element_padding`, 2.5)
    expect(overrides.resolve(`formal_chempots`)).toBe(true)
    expect(overrides.resolve(`element_padding`)).toBe(2.5)
    expect(overrides.changed_keys).toEqual([`formal_chempots`, `element_padding`])

    // reset clears all overrides at once, falling back to config
    overrides.reset()
    expect(overrides.resolve(`formal_chempots`)).toBe(false)
    expect(overrides.resolve(`element_padding`)).toBe(0)
    expect(overrides.changed_keys).toEqual([])
    overrides.set(`element_padding`, 0)
    expect(overrides.changed_keys).toEqual([`element_padding`])
    config = { element_padding: 1 }
    overrides.reset()
    expect(overrides.resolve(`element_padding`)).toBe(1)
    expect(overrides.changed_keys).toEqual([])
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

test(`color scale picker and reversal both edit the shared color_scale config`, async () => {
  const set = vi.fn()
  const component = mount(ChemPotControls, {
    target: document.body,
    props: { values: CHEMPOT_DEFAULTS, set },
  })
  onTestFinished(() => unmount(component))
  await tick()
  await fire(doc_query(`.multiselect`), mouse(`mouseup`))
  const options = [...document.querySelectorAll(`[role="option"]`)]
  await fire(options.find((option) => option.textContent?.trim() === `Viridis`) ?? options[0])
  const reverse = [...document.querySelectorAll(`label`)].find((label) =>
    label.textContent?.trim().startsWith(`Reverse:`),
  )
  reverse?.control?.dispatchEvent(new Event(`change`, { bubbles: true }))
  // the scheme swaps in, keeping palette_range; reversal flips palette_range
  expect(set.mock.calls).toEqual([
    [`color_scale`, { scheme: `interpolateViridis`, palette_range: [1, 0] }],
    [`color_scale`, { scheme: `interpolateSpectral`, palette_range: [0, 1] }],
  ])
})

test(`ChemPotDiagram3D sanitizes its only raw-HTML sink`, () => {
  const source = [`ChemPotDiagram3D`, `ChemPotScene3D`].map(read_component_source).join(`\n`)
  const sinks = [...source.matchAll(/\{@html\s+(?<expr>[^}]+)\}/g)].map((match) =>
    (match.groups?.expr ?? ``).trim(),
  )
  expect(sinks).toEqual([`sanitize_html(grid_item.label)`])
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
