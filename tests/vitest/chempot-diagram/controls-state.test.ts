import { rescale_zoom_to_fit } from '#lib/chempot-diagram/camera.js'
import ChemPotControls from '#lib/chempot-diagram/ChemPotControls.svelte'
import diagram_source from '#lib/chempot-diagram/ChemPotDiagram3D.svelte?raw'
import scene_source from '#lib/chempot-diagram/ChemPotScene3D.svelte?raw'
import ChemPotSlices from '#lib/chempot-diagram/ChemPotSlices.svelte'
import {
  create_chempot_overrides,
  sticky_range,
} from '#lib/chempot-diagram/controls-state.svelte.js'
import type { ChemPotDiagramConfig } from '#lib/chempot-diagram/types.js'
import { CHEMPOT_DEFAULTS } from '#lib/chempot-diagram/types.js'
import type { Vec2 } from '#lib/math.js'
import { mount, tick, unmount } from 'svelte'
import { describe, expect, onTestFinished, test, vi } from 'vite-plus/test'
import { clip_rect, doc_query, fire, mouse, plot_svg, resize_element } from '../setup'

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

test(`ChemPotSlices clamps typed values, ignores unparsable ones, jumps to a clicked curve point, toggles slices and plots only the drawn formulas`, async () => {
  const set_slice = vi.fn()
  const line: Vec2[] = [
    [-5, 0],
    [-2.5, 2],
    [0, 1],
  ]
  const props = {
    elements: [`F`, `Rb`],
    slices: { F: -1 },
    ranges: { F: [-5, 0] as Vec2, Rb: [-4, 0] as Vec2 },
    curves: {
      F: new Map([
        [`LaO`, line],
        [`NiO`, line],
      ]),
    },
    set_slice,
    measure_label: `Area (eV²)`,
    formal_chempots: true,
    colors: (formula: string) => (formula === `NiO` ? `#123456` : undefined),
    formulas: [`NiO`],
  }
  const component = mount(ChemPotSlices, { target: document.body, props })
  onTestFinished(() => unmount(component))
  await tick()
  const [f_box, rb_box] = document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)
  expect([f_box.checked, rb_box.checked]).toEqual([true, false])
  const number = doc_query<HTMLInputElement>(`input[type="number"]`)
  for (const value of [`7`, `-9`, ``, `-2.5`]) {
    number.value = value
    await fire(number, new Event(`change`, { bubbles: true }))
  }
  // a click on the measure plot jumps to the mu of the curve point it lands on: here the
  // plot area's bottom-left corner, (mu, area) = (-5, 0)
  await resize_element(doc_query(`.chempot-slice .scatter`), 400, 200)
  const svg = plot_svg()
  svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 400, height: 200 })
  const plot_area = clip_rect()
  svg.dispatchEvent(
    mouse(`click`, {
      detail: 1,
      clientX: plot_area.x,
      clientY: plot_area.y + plot_area.height,
    }),
  )
  // toggling on starts at the element-rich (upper) end, off returns to projection
  await fire(rb_box, new Event(`change`, { bubbles: true }))
  await fire(f_box, new Event(`change`, { bubbles: true }))
  expect(set_slice.mock.calls).toEqual([
    [`F`, 0],
    [`F`, -5],
    [`F`, -2.5],
    [`F`, -5],
    [`Rb`, 0],
    [`F`, undefined],
  ])
  // only formulas_to_draw are plotted, in their domain colors
  const strokes = [...document.querySelectorAll(`g[data-series-id] > path[stroke]`)].map(
    (path) => path.getAttribute(`stroke`),
  )
  expect(strokes).toEqual([`#123456`])
})

test(`ChemPotDiagram3D sanitizes its only raw-HTML sink`, () => {
  const source = `${diagram_source}\n${scene_source}`
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

// The 2D slice view frames its axes on the unsliced projection; a range the user typed in since
// the last framing must survive the next one (padding, limit or temperature changes)
// oxfmt-ignore
test.each([
  [`untouched axis follows`, [-5, 0], [-5, 0], [-6, 0], false],
  [`user range stays`, [-2, -1], [-5, 0], [-6, 0], true],
  [`first framing`, undefined, undefined, [-6, 0], false],
  [`slicing off resets`, [-6, 0], [-6, 0], undefined, false],
  [`user range survives slicing off`, [-2, -1], [-6, 0], undefined, true],
] as const)(`sticky_range: %s`, (_label, current, applied, next, kept) => {
  expect(sticky_range(current, applied, next)).toEqual(kept ? current : next)
})
