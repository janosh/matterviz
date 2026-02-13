import type {
  LeverRuleResult,
  PhaseBoundary,
  PhaseHoverInfo,
  TempUnit,
} from '$lib/phase-diagram'
import { PhaseDiagramTooltip } from '$lib/phase-diagram'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { create_hover_info } from './fixtures/test-data'

describe(`PhaseDiagramTooltip`, () => {
  test(`displays region name in header`, () => {
    const hover_info = create_hover_info({
      region: { id: `alpha`, name: `α (FCC)`, vertices: [] },
    })
    mount(PhaseDiagramTooltip, { target: document.body, props: { hover_info } })

    expect(document.querySelector(`header strong`)?.textContent).toBe(`α (FCC)`)
  })

  test.each<[number, TempUnit, string]>([
    [500, `K`, `500 K`],
    [25, `°C`, `25 °C`],
    [1000, `°F`, `1000 °F`],
  ])(`displays temperature %d %s correctly`, (temperature, unit, expected) => {
    const hover_info = create_hover_info({ temperature })
    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info, temperature_unit: unit },
    })

    expect(document.querySelector(`.phase-diagram-tooltip`)?.textContent).toContain(
      expected,
    )
  })

  test.each([
    [0.35, `at%`, `Cu`, `35 at%`],
    [0.456, `fraction`, `Zn`, `0.456`],
    [0.25, `mol%`, `Fe`, `25 mol%`],
  ])(
    `displays composition %f as %s for component %s`,
    (composition, unit, component_b, expected) => {
      const hover_info = create_hover_info({ composition })
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: { hover_info, composition_unit: unit, component_b },
      })

      const tooltip = document.querySelector(`.phase-diagram-tooltip`)
      expect(tooltip?.textContent).toContain(expected)
      expect(tooltip?.textContent).toContain(component_b)
    },
  )

  test(`displays complementary composition for both components`, () => {
    const hover_info = create_hover_info({ composition: 0.3 })
    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: {
        hover_info,
        composition_unit: `at%`,
        component_a: `Al`,
        component_b: `Cu`,
      },
    })

    const tooltip = document.querySelector(`.phase-diagram-tooltip`)
    expect(tooltip?.textContent).toContain(`30 at%`)
    expect(tooltip?.textContent).toContain(`Cu`)
    expect(tooltip?.textContent).toContain(`70 at%`)
    expect(tooltip?.textContent).toContain(`Al`)
  })

  test(`displays weight percentage for real elements (Al-Cu)`, () => {
    const hover_info = create_hover_info({ composition: 0.3 })
    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info, component_a: `Al`, component_b: `Cu` },
    })

    const tooltip = document.querySelector(`.phase-diagram-tooltip`)
    expect(tooltip?.textContent).toContain(`Weight`)
    expect(tooltip?.textContent).toMatch(/50\.\d% Cu/)
  })

  test(`does not display weight percentage for unknown elements`, () => {
    const hover_info = create_hover_info({ composition: 0.5 })
    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info, component_a: `A`, component_b: `B` },
    })

    expect(document.querySelector(`.phase-diagram-tooltip`)?.textContent).not.toContain(
      `Weight`,
    )
  })

  test(`displays stability range from region vertices`, () => {
    const hover_info = create_hover_info({
      region: { id: `alpha`, name: `α`, vertices: [[0, 500], [0.3, 800], [0.2, 600]] },
    })
    mount(PhaseDiagramTooltip, {
      target: document.body,
      props: { hover_info, temperature_unit: `K` },
    })

    const tooltip = document.querySelector(`.phase-diagram-tooltip`)
    expect(tooltip?.textContent).toContain(`Stable`)
    expect(tooltip?.textContent).toMatch(/500.*800/)
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

    test(`displays section with header and phase fractions`, () => {
      const hover_info = create_hover_info({
        region: { id: `two_phase`, name: `α + β`, vertices: [] },
        lever_rule,
      })
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: { hover_info, composition_unit: `at%` },
      })

      const lever = document.querySelector(`.lever`)
      expect(lever).not.toBeNull()
      expect(lever?.querySelector(`:scope > span`)?.textContent).toBe(`Lever Rule`)

      const phase_info = document.querySelector(`.phase-info`)
      // Normalize whitespace since formatter may introduce line breaks
      const text = phase_info?.textContent?.replace(/\s+/g, ` `)
      expect(text).toContain(`α: 60%`)
      expect(text).toContain(`at 20 at%`)
      expect(text).toContain(`β: 40%`)
      expect(text).toContain(`at 80 at%`)
    })

    test(`bar widths and marker position match fractions`, () => {
      const custom_lr: LeverRuleResult = {
        ...lever_rule,
        fraction_left: 0.75,
        fraction_right: 0.25,
      }
      const hover_info = create_hover_info({
        region: { id: `two_phase`, name: `α + β`, vertices: [] },
        lever_rule: custom_lr,
      })
      mount(PhaseDiagramTooltip, { target: document.body, props: { hover_info } })

      const bars = document.querySelectorAll(`.bar > div`) as NodeListOf<HTMLElement>
      expect(bars[0]?.style.width).toBe(`75%`)
      expect(bars[1]?.style.width).toBe(`25%`)

      const marker = document.querySelector(`.bar > i`) as HTMLElement
      expect(marker?.style.left).toBe(`75%`)
    })

    test(`not displayed when lever_rule is undefined`, () => {
      const hover_info = create_hover_info()
      mount(PhaseDiagramTooltip, { target: document.body, props: { hover_info } })

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
        mount(PhaseDiagramTooltip, {
          target: document.body,
          props: { hover_info, boundaries, temperature_unit: unit },
        })

        const info = document.querySelector(`.boundary-info`)
        expect(info).not.toBeNull()
        expect(info?.textContent).toContain(direction)
        expect(info?.textContent).toContain(boundary_type)
        expect(info?.textContent).toContain(`${Math.abs(temperature - boundary_temp)}`)
      },
    )

    test(`not shown when no boundaries provided`, () => {
      const hover_info = create_hover_info({ composition: 0.5, temperature: 900 })
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: { hover_info, boundaries: [] },
      })
      expect(document.querySelector(`.boundary-info`)).toBeNull()
    })

    test(`not shown for non-relevant boundary types`, () => {
      const hover_info = create_hover_info({ composition: 0.5, temperature: 900 })
      const boundaries: PhaseBoundary[] = [{
        id: `t1`,
        type: `tie-line`,
        points: [[0.5, 900]],
      }]
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: { hover_info, boundaries },
      })
      expect(document.querySelector(`.boundary-info`)).toBeNull()
    })
  })

  describe(`tooltip customization`, () => {
    test(`snippet function hides default tooltip`, () => {
      const hover_info = create_hover_info()
      const mock_snippet = (() => {}) as unknown as import('svelte').Snippet<
        [PhaseHoverInfo]
      >
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: { hover_info, tooltip: mock_snippet },
      })
      expect(document.querySelector(`.phase-diagram-tooltip`)).toBeNull()
    })

    test.each(
      [
        [`prefix`, `<strong>Header</strong>`, `.tooltip-prefix`],
        [`suffix`, `<em>Footer</em>`, `.tooltip-suffix`],
      ] as const,
    )(`renders static %s string`, (key, html, selector) => {
      const hover_info = create_hover_info()
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: { hover_info, tooltip: { [key]: html } },
      })
      expect(document.querySelector(selector)?.innerHTML).toContain(html)
      expect(document.querySelector(`.phase-diagram-tooltip`)).not.toBeNull()
    })

    test.each(
      [
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
      ] as const,
    )(`renders %s from function`, (key, fn, selector, expected) => {
      const hover_info = create_hover_info()
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: { hover_info, tooltip: { [key]: fn } },
      })
      expect(document.querySelector(selector)?.textContent).toBe(expected)
    })

    test(`renders both prefix and suffix together`, () => {
      const hover_info = create_hover_info()
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: { hover_info, tooltip: { prefix: `Header`, suffix: `Footer` } },
      })
      expect(document.querySelector(`.tooltip-prefix`)?.textContent).toBe(`Header`)
      expect(document.querySelector(`.tooltip-suffix`)?.textContent).toBe(`Footer`)
    })

    test.each([
      [`no tooltip prop`, undefined],
      [`empty config`, {}],
    ])(`no prefix/suffix rendered with %s`, (_, tooltip) => {
      const hover_info = create_hover_info()
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: { hover_info, tooltip },
      })
      expect(document.querySelector(`.tooltip-prefix`)).toBeNull()
      expect(document.querySelector(`.tooltip-suffix`)).toBeNull()
      expect(document.querySelector(`.phase-diagram-tooltip`)).not.toBeNull()
    })

    test(`function receives lever_rule in hover_info`, () => {
      const lever_rule: LeverRuleResult = {
        left_phase: `α`,
        right_phase: `β`,
        left_composition: 0.2,
        right_composition: 0.8,
        fraction_left: 0.6,
        fraction_right: 0.4,
      }
      const hover_info = create_hover_info({ lever_rule })
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: {
          hover_info,
          tooltip: {
            prefix: (info) =>
              info.lever_rule
                ? `${info.lever_rule.left_phase}/${info.lever_rule.right_phase}`
                : ``,
          },
        },
      })
      expect(document.querySelector(`.tooltip-prefix`)?.textContent).toBe(`α/β`)
    })

    test(`empty string from function hides element`, () => {
      const hover_info = create_hover_info()
      mount(PhaseDiagramTooltip, {
        target: document.body,
        props: { hover_info, tooltip: { suffix: () => `` } },
      })
      expect(document.querySelector(`.tooltip-suffix`)).toBeNull()
    })
  })
})
