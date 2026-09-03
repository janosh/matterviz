import type { Vec2 } from '$lib/math'
import type {
  CompUnit,
  LeverRuleResult,
  PhaseBoundary,
  PhaseHoverInfo,
  TempUnit,
} from '$lib/phase-diagram'
import { PhaseDiagramTooltip } from '$lib/phase-diagram'
import type { ComponentProps, Snippet } from 'svelte'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { create_hover_info } from './fixtures/test-data'

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
  test(`displays region name in header`, () => {
    const hover_info = create_hover_info({
      region: { id: `alpha`, name: `α (FCC)`, vertices: [] },
    })
    mount_tooltip({ hover_info })

    expect(document.querySelector(`header strong`)?.textContent).toBe(`α (FCC)`)
  })

  test.each<[number, TempUnit, string]>([
    [500, `K`, `500 K`],
    [25, `°C`, `25 °C`],
    [1000, `°F`, `1000 °F`],
  ])(`displays temperature %d %s correctly`, (temperature, unit, expected) => {
    const hover_info = create_hover_info({ temperature })
    mount_tooltip({ hover_info, temperature_unit: unit })

    expect(tooltip_text()).toContain(expected)
  })

  test.each([
    [0.35, `at%`, `Cu`, `35 at%`],
    [0.456, `fraction`, `Zn`, `0.456`],
    [0.25, `mol%`, `Fe`, `25 mol%`],
  ])(
    `displays composition %f as %s for component %s`,
    (composition, unit, component_b, expected) => {
      const hover_info = create_hover_info({ composition })
      mount_tooltip({ hover_info, composition_unit: unit as CompUnit, component_b })

      expect(tooltip_text()).toContain(expected)
      expect(tooltip_text()).toContain(component_b)
    },
  )

  // Weight percentages need real elements (Al-Cu), unknown components (A-B) get none
  test.each([
    { composition: 0.3, components: [`Al`, `Cu`], contains: [`30 at%`, `Cu`, `70 at%`, `Al`] },
    {
      composition: 0.3,
      components: [`Al`, `Cu`],
      contains: [`Weight`],
      matches: /50\.\d% Cu/,
    },
    { composition: 0.5, components: [`A`, `B`], absent: [`Weight`] },
  ])(
    `composition $composition of $components shows $contains`,
    ({ composition, components: [component_a, component_b], contains, absent, matches }) => {
      mount_tooltip({
        hover_info: create_hover_info({ composition }),
        composition_unit: `at%`,
        component_a,
        component_b,
      })
      for (const part of contains ?? []) expect(tooltip_text()).toContain(part)
      for (const part of absent ?? []) expect(tooltip_text()).not.toContain(part)
      if (matches) expect(tooltip_text()).toMatch(matches)
    },
  )

  test(`displays stability range from region vertices`, () => {
    const hover_info = create_hover_info({
      region: {
        id: `alpha`,
        name: `α`,
        vertices: [
          [0, 500],
          [0.3, 800],
          [0.2, 600],
        ],
      },
    })
    mount_tooltip({ hover_info, temperature_unit: `K` })

    expect(tooltip_text()).toContain(`Stable`)
    expect(tooltip_text()).toMatch(/500.*800/)
  })

  test.each([
    // edge melting/congruent points name the pure component; other types get a generic badge
    { type: `melting_point`, x: 0, badge: `Melting Point`, desc: `Al melts at 933 K` },
    { type: `congruent`, x: 1, badge: `Melting Point`, desc: `Cu melts at 933 K` },
    { type: `congruent`, x: 0.5, badge: `Congruent`, desc: `Congruent phase change at 933 K` },
    {
      type: `eutectic`,
      x: 0.3,
      badge: `Eutectic`,
      desc: `Liquid → two solid phases at 933 K`,
    },
    { type: `melting_point`, x: 0.5, badge: `Melting point`, desc: null },
    { type: `custom`, x: 0.5, badge: `Custom`, desc: null },
  ] as const)(`special point $type at x=$x → "$badge"`, ({ type, x, badge, desc }) => {
    const hover_info = create_hover_info({
      special_point: { id: `sp`, type, position: [x, 933] },
    })
    mount_tooltip({ hover_info, component_a: `Al`, component_b: `Cu` })
    expect(document.querySelector(`.special-point-badge`)?.textContent).toBe(badge)
    expect(document.querySelector(`.special-point-description`)?.textContent ?? null).toBe(
      desc,
    )
  })

  describe(`lever rule`, () => {
    const lever_rule: LeverRuleResult = {
      left_phase: `α`,
      right_phase: `β`,
      left_composition: 0.2,
      right_composition: 0.8,
      fraction_left: 0.6,
      fraction_right: 0.4,
    }
    const two_phase = { id: `two_phase`, name: `α + L`, vertices: [] as Vec2[] }

    test(`displays phase fractions and bars sized by fraction`, () => {
      const hover_info = create_hover_info({ region: two_phase, lever_rule })
      mount_tooltip({ hover_info, composition_unit: `at%` })

      expect(document.querySelector(`.lever > span`)?.textContent).toBe(`Lever Rule`)
      for (const part of [`α: 60%`, `at 20 at%`, `β: 40%`, `at 80 at%`]) {
        expect(lever_text()).toContain(part)
      }
      expect(lever_bars()).toEqual([`60%`, `40%`, `60%`])
    })

    test(`not displayed without a lever rule`, () => {
      mount_tooltip({ hover_info: create_hover_info({ region: two_phase }) })
      expect(document.querySelector(`.lever`)).toBeNull()
    })
  })

  describe(`boundary distance`, () => {
    test.each<[number, number, string, TempUnit, string]>([
      [1050, 1000, `liquidus`, `K`, `above`], // temp > boundary → above
      [750, 800, `solidus`, `°C`, `below`], // temp < boundary → below
      [900, 1000, `solvus`, `K`, `below`],
    ])(
      `shows %dK vs boundary at %dK (%s) as "%s"`,
      (temperature, boundary_temp, boundary_type, unit, direction) => {
        const hover_info = create_hover_info({ composition: 0.5, temperature })
        const boundaries: PhaseBoundary[] = [
          {
            id: `b1`,
            type: boundary_type as PhaseBoundary[`type`],
            points: [[0.5, boundary_temp]],
          },
        ]
        mount_tooltip({ hover_info, boundaries, temperature_unit: unit })

        const info = document.querySelector(`.boundary-info`)
        expect(info).not.toBeNull()
        expect(info?.textContent).toContain(direction)
        expect(info?.textContent).toContain(boundary_type)
        expect(info?.textContent).toContain(`${Math.abs(temperature - boundary_temp)}`)
      },
    )

    test(`not shown when no boundaries provided`, () => {
      const hover_info = create_hover_info({ composition: 0.5, temperature: 900 })
      mount_tooltip({ hover_info, boundaries: [] })
      expect(document.querySelector(`.boundary-info`)).toBeNull()
    })

    test(`not shown for non-relevant boundary types`, () => {
      const hover_info = create_hover_info({ composition: 0.5, temperature: 900 })
      const boundaries: PhaseBoundary[] = [
        {
          id: `t1`,
          type: `tie-line`,
          points: [[0.5, 900]],
        },
      ]
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
    ])(`no prefix/suffix rendered with %s`, (_, tooltip) => {
      const hover_info = create_hover_info()
      mount_tooltip({ hover_info, tooltip })
      expect(document.querySelector(`.tooltip-prefix`)).toBeNull()
      expect(document.querySelector(`.tooltip-suffix`)).toBeNull()
      expect(document.querySelector(`.phase-diagram-tooltip`)).not.toBeNull()
    })

    test(`empty string from function hides element`, () => {
      const hover_info = create_hover_info()
      mount_tooltip({ hover_info, tooltip: { suffix: () => `` } })
      expect(document.querySelector(`.tooltip-suffix`)).toBeNull()
    })
  })
})
