import type { Vec2 } from '#lib/math.js'
import type {
  CompUnit,
  PhaseBoundary,
  PhaseHoverInfo,
  TempUnit,
} from '#lib/phase-diagram/index.js'
import PhaseDiagramTooltip from '#lib/phase-diagram/PhaseDiagramTooltip.svelte'
import type { ComponentProps, Snippet } from 'svelte'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { create_hover_info, lever_rule, pts } from './fixtures/test-data'

const mount_tooltip = (props: ComponentProps<typeof PhaseDiagramTooltip>) =>
  mount(PhaseDiagramTooltip, { target: document.body, props })
const tooltip_text = () => document.querySelector(`.phase-diagram-tooltip`)?.textContent
const lever_text = () =>
  document.querySelector(`.phase-info`)?.textContent?.replaceAll(/\s+/g, ` `)
// [left bar width, right bar width, marker position]
const lever_bars = () => [
  ...Array.from(
    document.querySelectorAll<HTMLElement>(`.bar > div`),
    (bar) => bar.style.width,
  ),
  document.querySelector<HTMLElement>(`.bar > i`)?.style.left,
]

describe(`PhaseDiagramTooltip`, () => {
  test(`header names the region, stability range spans its vertices, no lever rule for one phase`, () => {
    const hover_info = create_hover_info({
      region: { id: `alpha`, name: `α (FCC)`, vertices: pts(0, 500, 0.3, 800, 0.2, 600) },
    })
    mount_tooltip({ hover_info, temperature_unit: `K` })
    expect(document.querySelector(`header strong`)?.textContent).toBe(`α (FCC)`)
    expect(tooltip_text()).toContain(`Stable`)
    expect(tooltip_text()).toMatch(/500.*800/)
    expect(document.querySelector(`.lever`)).toBeNull()
  })

  test.each<[number, TempUnit, string]>([
    [500, `K`, `500 K`],
    [25, `°C`, `25 °C`],
    [1000, `°F`, `1000 °F`],
  ])(`displays temperature %d %s correctly`, (temperature, unit, expected) => {
    const hover_info = create_hover_info({ temperature })
    mount_tooltip({ hover_info, temperature_unit: unit })

    expect(tooltip_text()).toContain(expected)
    expect(document.querySelector(`dd small`)?.textContent).toBe(unit)
  })

  // Weight percentages need real elements (Al-Cu), unknown components (A-B) get none
  test.each<{
    composition: number
    unit?: CompUnit
    components: string[]
    contains?: string[]
    absent?: string[]
    matches?: RegExp
  }>([
    {
      composition: 0.3,
      components: [`Al`, `Cu`],
      contains: [`30 at%`, `Cu`, `70 at%`, `Al`, `Weight`],
      matches: /50\.\d % Cu/,
    },
    { composition: 0.5, components: [`A`, `B`], absent: [`Weight`] },
    {
      composition: 0.456,
      unit: `fraction`,
      components: [`A`, `Zn`],
      contains: [`0.456`, `Zn`],
    },
    { composition: 0.25, unit: `mol%`, components: [`A`, `Fe`], contains: [`25 mol%`, `Fe`] },
  ])(
    `composition $composition $unit of $components shows $contains`,
    ({ composition, unit = `at%`, components: [component_a, component_b], ...expected }) => {
      const { contains, absent, matches } = expected
      mount_tooltip({
        hover_info: create_hover_info({ composition }),
        composition_unit: unit,
        component_a,
        component_b,
      })
      for (const part of contains ?? []) expect(tooltip_text()).toContain(part)
      for (const part of absent ?? []) expect(tooltip_text()).not.toContain(part)
      if (matches) expect(tooltip_text()).toMatch(matches)
    },
  )

  // oxfmt-ignore
  test.each([
    // edge melting/congruent points name the pure component; other types get a generic badge
    { type: `melting_point`, x: 0, badge: `Melting Point`, desc: `Al melts at 933 K` },
    { type: `congruent`, x: 1, badge: `Melting Point`, desc: `Cu melts at 933 K` },
    { type: `congruent`, x: 0.5, badge: `Congruent`, desc: `Congruent phase change at 933 K` },
    { type: `eutectic`, x: 0.3, badge: `Eutectic`, desc: `Liquid → two solid phases at 933 K` },
    { type: `melting_point`, x: 0.5, badge: `Melting point`, desc: null },
    { type: `custom`, x: 0.5, badge: `Custom`, desc: null },
  ] as const)(
    `special point $type at x=$x → "$badge"`,
    ({ type, x: coord_x, badge, desc }) => {
      const hover_info = create_hover_info({
        special_point: { id: `sp`, type, position: [coord_x, 933] },
      })
      mount_tooltip({ hover_info, component_a: `Al`, component_b: `Cu` })
      expect(document.querySelector(`.special-point-badge`)?.textContent).toBe(badge)
      expect(document.querySelector(`.special-point-description`)?.textContent ?? null).toBe(
        desc,
      )
    },
  )

  test(`lever rule displays phase fractions and bars sized by fraction`, () => {
    const region = { id: `two_phase`, name: `α + L`, vertices: [] }
    mount_tooltip({
      hover_info: create_hover_info({ region, lever_rule }),
      composition_unit: `at%`,
    })
    expect(document.querySelector(`.lever > span`)?.textContent).toBe(`Lever Rule`)
    for (const part of [`α: 60 %`, `at 20 at%`, `β: 40 %`, `at 80 at%`]) {
      expect(lever_text()).toContain(part)
    }
    expect(lever_bars()).toEqual([`60%`, `40%`, `60%`])
  })

  describe(`boundary distance`, () => {
    // Boundary temperatures interpolate on the segment spanning the composition: at x = 0.19
    // the Cu-like liquidus sits at 1112.9 K, not at its 1100 K sample at x = 0.2
    const liquidus = pts(0, 1358, 0.2, 1100, 0.4, 900)
    test.each<[number, number, PhaseBoundary[`type`], Vec2[], TempUnit, string, number]>([
      [0.5, 1050, `liquidus`, pts(0, 1000, 1, 1000), `K`, `above`, 50], // temp > boundary
      [0.5, 750, `solidus`, pts(0, 800, 1, 800), `°C`, `below`, 50], // temp < boundary
      [0.5, 900, `solvus`, pts(0, 1100, 1, 900), `K`, `below`, 100],
      [0.1, 1300, `liquidus`, liquidus, `K`, `above`, 71],
      [0.19, 1200, `liquidus`, liquidus, `K`, `above`, 87],
    ])(
      `at x=%s, %s K vs a %s %o in %s shows "%s" by %s`,
      (composition, temperature, type, points, unit, direction, delta) => {
        const hover_info = create_hover_info({ composition, temperature })
        mount_tooltip({
          hover_info,
          boundaries: [{ id: `b1`, type, points }],
          temperature_unit: unit,
        })
        const text = document.querySelector(`.boundary-info`)?.textContent ?? ``
        expect(text.replaceAll(/\s+/g, ` `).trim()).toBe(
          `${delta} ${unit} ${direction} ${type}`,
        )
      },
    )

    // Between two boundary vertices the boundary is read off the segment at the cursor's
    // composition: vertices 0.5 apart used to give no reading (none within 2 at%) or the
    // nearest vertex's temperature
    test.each([
      { composition: 0.5, expected: `150 K above liquidus` }, // boundary at 750 K
      { composition: 0.1, expected: `50 K below liquidus` }, // boundary at 950 K, not 1000 K
    ])(
      `interpolates along a boundary segment at x = $composition`,
      ({ composition, expected }) => {
        const hover_info = create_hover_info({ composition, temperature: 900 })
        const boundaries: PhaseBoundary[] = [
          { id: `liq`, type: `liquidus`, points: pts(0, 1000, 1, 500) },
        ]
        mount_tooltip({ hover_info, boundaries })
        const text = document.querySelector(`.boundary-info`)?.textContent ?? ``
        expect(text.replaceAll(/\s+/g, ` `).trim()).toBe(expected)
      },
    )

    test.each([
      [`no boundaries`, []],
      [`a non-relevant boundary type`, [{ id: `t1`, type: `tie-line`, points: [[0.5, 900]] }]],
    ] as [string, PhaseBoundary[]][])(`not shown for %s`, (_desc, boundaries) => {
      const hover_info = create_hover_info({ composition: 0.5, temperature: 900 })
      mount_tooltip({ hover_info, boundaries })
      expect(document.querySelector(`.boundary-info`)).toBeNull()
    })
  })

  describe(`tooltip customization`, () => {
    test(`snippet function hides default tooltip`, () => {
      const hover_info = create_hover_info()
      const mock_snippet = (() => {}) as unknown as Snippet<[PhaseHoverInfo]>
      mount_tooltip({ hover_info, tooltip: mock_snippet })
      expect(document.querySelector(`.phase-diagram-tooltip`)).toBeNull()
    })

    // static HTML strings and functions of the hover info both render into their slot
    test.each([
      [`prefix`, `<strong>Header</strong>`, `<strong>Header</strong>`],
      [`suffix`, `<em>Footer</em>`, `<em>Footer</em>`],
      [`prefix`, (info: PhaseHoverInfo) => `T=${info.temperature}`, `T=850`],
      [`suffix`, (info: PhaseHoverInfo) => `x=${info.composition}`, `x=0.5`],
    ] as const)(`renders %s %s`, (key, value, expected) => {
      mount_tooltip({ hover_info: create_hover_info(), tooltip: { [key]: value } })
      expect(document.querySelector(`.tooltip-${key}`)?.innerHTML).toBe(expected)
      expect(document.querySelector(`.phase-diagram-tooltip`)).not.toBeNull()
    })

    test.each([
      [`no tooltip prop`, undefined],
      [`empty config`, {}],
      [`an empty string from a function`, { suffix: () => `` }],
    ])(`no prefix/suffix rendered with %s`, (_, tooltip) => {
      const hover_info = create_hover_info()
      mount_tooltip({ hover_info, tooltip })
      expect(document.querySelector(`.tooltip-prefix`)).toBeNull()
      expect(document.querySelector(`.tooltip-suffix`)).toBeNull()
      expect(document.querySelector(`.phase-diagram-tooltip`)).not.toBeNull()
    })
  })
})
