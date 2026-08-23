import type { Vec2 } from '$lib/math'
import type {
  CompUnit,
  LeverRuleResult,
  PhaseBoundary,
  PhaseHoverInfo,
  TempUnit,
  VerticalLeverRuleResult,
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

  test(`displays complementary composition for both components`, () => {
    const hover_info = create_hover_info({ composition: 0.3 })
    mount_tooltip({
      hover_info,
      composition_unit: `at%`,
      component_a: `Al`,
      component_b: `Cu`,
    })

    for (const part of [`30 at%`, `Cu`, `70 at%`, `Al`]) expect(tooltip_text()).toContain(part)
  })

  test(`displays weight percentage for real elements (Al-Cu)`, () => {
    const hover_info = create_hover_info({ composition: 0.3 })
    mount_tooltip({ hover_info, component_a: `Al`, component_b: `Cu` })

    expect(tooltip_text()).toContain(`Weight`)
    expect(tooltip_text()).toMatch(/50\.\d% Cu/)
  })

  test(`does not display weight percentage for unknown elements`, () => {
    const hover_info = create_hover_info({ composition: 0.5 })
    mount_tooltip({ hover_info, component_a: `A`, component_b: `B` })

    expect(tooltip_text()).not.toContain(`Weight`)
  })

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

    test(`displays header, phase fractions and bars sized by fraction`, () => {
      const hover_info = create_hover_info({
        region: { id: `two_phase`, name: `α + β`, vertices: [] },
        lever_rule,
      })
      mount_tooltip({ hover_info, composition_unit: `at%` })

      expect(document.querySelector(`.lever > span`)?.textContent).toBe(`Lever Rule`)
      for (const part of [`α: 60%`, `at 20 at%`, `β: 40%`, `at 80 at%`]) {
        expect(lever_text()).toContain(part)
      }
      expect(lever_bars()).toEqual([`60%`, `40%`, `60%`])
    })

    test(`not displayed when lever_rule is undefined`, () => {
      const hover_info = create_hover_info()
      mount_tooltip({ hover_info })

      expect(document.querySelector(`.lever`)).toBeNull()
    })
  })

  describe(`vertical lever rule`, () => {
    const vertical_lever_rule: VerticalLeverRuleResult = {
      bottom_phase: `α`,
      top_phase: `L`,
      bottom_temperature: 400,
      top_temperature: 900,
      fraction_bottom: 0.6,
      fraction_top: 0.4,
    }
    const horiz_lever_rule: LeverRuleResult = {
      left_phase: `α`,
      right_phase: `L`,
      left_composition: 0.2,
      right_composition: 0.8,
      fraction_left: 0.5,
      fraction_right: 0.5,
    }
    const two_phase = {
      id: `two_phase`,
      name: `α + L`,
      vertices: [] as Vec2[],
    }

    test(`displays vertical label, phase fractions, temperatures and bars`, () => {
      const hover_info = create_hover_info({ region: two_phase, vertical_lever_rule })
      mount_tooltip({ hover_info, lever_rule_mode: `vertical`, temperature_unit: `K` })

      expect(document.querySelector(`.lever > span`)?.textContent).toBe(
        `Lever Rule (vertical)`,
      )
      for (const part of [`α: 60%`, `at 400 K`, `L: 40%`, `at 900 K`]) {
        expect(lever_text()).toContain(part)
      }
      expect(lever_bars()).toEqual([`60%`, `40%`, `60%`])
    })

    test(`not displayed when lever_rule_mode is horizontal`, () => {
      const hover_info = create_hover_info({ region: two_phase, vertical_lever_rule })
      mount_tooltip({ hover_info, lever_rule_mode: `horizontal` })

      // No lever section at all — only vertical data present but mode is horizontal
      expect(document.querySelector(`.lever`)).toBeNull()
    })

    test(`horizontal lever rule hidden when mode is vertical`, () => {
      // Regression: stale horizontal lever_rule must not display in vertical mode
      const hover_info = create_hover_info({
        region: two_phase,
        lever_rule: horiz_lever_rule,
      })
      mount_tooltip({ hover_info, lever_rule_mode: `vertical` })

      expect(document.querySelector(`.lever`)).toBeNull()
    })

    test(`prefers vertical over horizontal when both present`, () => {
      const hover_info = create_hover_info({
        region: two_phase,
        lever_rule: horiz_lever_rule,
        vertical_lever_rule,
      })
      mount_tooltip({ hover_info, lever_rule_mode: `vertical` })

      expect(document.querySelector(`.lever > span`)?.textContent).toBe(
        `Lever Rule (vertical)`,
      )
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

    test.each([
      [`prefix`, `<strong>Header</strong>`, `.tooltip-prefix`],
      [`suffix`, `<em>Footer</em>`, `.tooltip-suffix`],
    ] as const)(`renders static %s string`, (key, html, selector) => {
      const hover_info = create_hover_info()
      mount_tooltip({ hover_info, tooltip: { [key]: html } })
      expect(document.querySelector(selector)?.innerHTML).toContain(html)
      expect(document.querySelector(`.phase-diagram-tooltip`)).not.toBeNull()
    })

    test.each([
      [
        `prefix`,
        (info: PhaseHoverInfo) => `T=${info.temperature}`,
        `.tooltip-prefix`,
        `T=850`,
      ],
      [
        `suffix`,
        (info: PhaseHoverInfo) => `x=${info.composition}`,
        `.tooltip-suffix`,
        `x=0.5`,
      ],
    ] as const)(`renders %s from function`, (key, fn, selector, expected) => {
      const hover_info = create_hover_info()
      mount_tooltip({ hover_info, tooltip: { [key]: fn } })
      expect(document.querySelector(selector)?.textContent).toBe(expected)
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
