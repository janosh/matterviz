import type { Vec2 } from '#lib/math.js'
import { diagram_hit, diagram_points, phase_colors } from '#lib/phase-diagram/diagram.js'
import type {
  BinaryPhaseDiagram,
  BoundaryKind,
  CompUnit,
  PhaseHoverInfo,
  TempUnit,
} from '#lib/phase-diagram/index.js'
import PhaseDiagramTooltip from '#lib/phase-diagram/PhaseDiagramTooltip.svelte'
import { binary_diagrams } from '#site/phase-diagrams.js'
import { rgb } from 'd3-color'
import type { ComponentProps } from 'svelte'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import {
  create_hover_info,
  eutectic,
  eutectic_regions,
  lever_rule,
  observations,
  pts,
  shifted_eutectic,
} from './fixtures/test-data'

// swatch colors default to the diagram's own phase colors, as the parent passes them
const color_lookup = (colors: Map<string, string>) => (id: string) => colors.get(id) ?? ``
const mount_tooltip = ({
  data = eutectic,
  ...props
}: Omit<ComponentProps<typeof PhaseDiagramTooltip>, `data` | `color_of`> & {
  data?: BinaryPhaseDiagram
  color_of?: (id: string) => string
}) =>
  mount(PhaseDiagramTooltip, {
    target: document.body,
    props: { data, color_of: color_lookup(phase_colors(data.phases)), ...props },
  })
const tooltip_text = () =>
  document.querySelector(`.phase-diagram-tooltip`)?.textContent?.replaceAll(/\s+/g, ` `)
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
  test(`header names the region by phase labels, stability spans its vertices, no lever rule for one phase`, () => {
    const hover_info = create_hover_info({
      region: { phases: [`A`], vertices: pts(0, 500, 0.3, 800, 0.2, 600) },
    })
    mount_tooltip({ hover_info, temp_unit: `K` })
    expect(document.querySelector(`header strong`)?.textContent).toBe(`α`)
    expect(tooltip_text()).toContain(`Stable 500 – 800 K`)
    expect(document.querySelector(`.lever`)).toBeNull()
  })

  // hover temperatures are K; per-unit formatting is format_temperature's (utils.test.ts)
  test(`converts the K temperature to temp_unit`, () => {
    mount_tooltip({
      hover_info: create_hover_info({ temperature: 298.15 }),
      temp_unit: `°C`,
    })
    expect(tooltip_text()).toContain(`25 °C`)
    expect(document.querySelector(`dd small`)?.textContent).toBe(`°C`)
  })

  // Weight percentages need real elements (Al-Cu), unknown components (A-B) get none
  test.each<{
    composition: number
    unit?: CompUnit
    components: [string, string]
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
      contains: [`0.456`, `Zn`, `0.544`],
    },
  ])(
    `composition $composition $unit of $components shows $contains`,
    ({ composition, unit = `at%`, components, contains, absent, matches }) => {
      mount_tooltip({
        hover_info: create_hover_info({ composition }),
        data: { ...eutectic, components },
        comp_unit: unit,
      })
      for (const part of contains ?? []) expect(tooltip_text()).toContain(part)
      for (const part of absent ?? []) expect(tooltip_text()).not.toContain(part)
      if (matches) expect(tooltip_text()).toMatch(matches)
    },
  )

  const marked: BinaryPhaseDiagram = {
    ...eutectic,
    congruent_points: [{ temperature: 800, composition: 0.4, phases: [`LIQUID`, `A`] }],
    critical_points: [{ temperature: 400, composition: 0.6, phase: `B` }],
    unary_transitions: [{ component: `Cu`, temperature: 933, above: `LIQUID`, below: `B` }],
  }
  test.each([
    [0, `Eutectic`, `L → α + β at 500 K`],
    [1, `Congruent`, `L ⇌ α without composition change at 800 K`],
    [2, `Critical`, `β miscibility gap closes at 400 K`],
    [3, `Melting point`, `Cu: L → β at 933 K`],
  ])(`marked point %i shows badge %s and "%s"`, (idx, badge, description) => {
    const point = diagram_points(marked)[idx]
    mount_tooltip({ hover_info: create_hover_info({ point }), data: marked })
    expect(document.querySelector(`.badge`)?.textContent).toBe(badge)
    const text = document.querySelector(`.point-description`)?.textContent
    expect(text?.replaceAll(/\s+/g, ` `).trim()).toBe(description)
  })

  test(`lever rule displays labelled phase fractions and bars sized by fraction`, () => {
    mount_tooltip({
      hover_info: create_hover_info({ region: eutectic_regions[1], lever_rule }),
      comp_unit: `at%`,
    })
    expect(document.querySelector(`.lever > span`)?.textContent).toBe(`Lever Rule`)
    for (const part of [`α: 60 %`, `at 20 at%`, `β: 40 %`, `at 80 at%`]) {
      expect(lever_text()).toContain(part)
    }
    expect(lever_bars()).toEqual([`60%`, `40%`, `60%`])
  })

  // Au-Ni wrap rule: the gap's composition sets are labelled and colored as two shades of fcc
  test(`miscibility gap shows its composition sets' labels and shared-key colors`, () => {
    const au_ni = binary_diagrams[`Au-Ni`]
    const colors = phase_colors(au_ni.phases, [`BCC_A2`, `FCC_A1`, `LIQUID`])
    const [composition, temperature] = [0.7, 800]
    mount_tooltip({
      data: au_ni,
      color_of: color_lookup(colors),
      hover_info: create_hover_info({
        ...diagram_hit(au_ni, composition, temperature),
        composition,
        temperature,
      }),
    })
    expect(document.querySelector(`header strong`)?.textContent).toBe(`α₁ + α₂`)
    expect(lever_text()).toMatch(/α₁: \d+ %.*α₂: \d+ %/)
    const swatches = Array.from(document.querySelectorAll<HTMLElement>(`.bar > div`), (bar) =>
      rgb(bar.style.background).formatHex(),
    )
    expect(swatches).toEqual([colors.get(`FCC_A1#1`), colors.get(`FCC_A1#2`)])
  })

  // the parent looks the overlay's phase set up once per move and carries it in the hover; a
  // snapshot taken while the overlay was shown lists nothing once it is hidden
  test.each([
    [shifted_eutectic, `α + β`, `Overlay lever rule: α 80% at 0 at% / β 20% at 100 at%`],
    [null, undefined, undefined],
  ])(`overlay %# phase set and lever rule at the hovered point`, (overlay, phase, lever) => {
    // 550 K: liquid in the main diagram (eutectic 500 K), α + β in the overlay (600 K)
    const hover_info = create_hover_info({
      region: eutectic_regions[0],
      overlay_hits: [diagram_hit(shifted_eutectic, 0.2, 550)],
      composition: 0.2,
      temperature: 550,
    })
    mount_tooltip({ hover_info, overlays: [overlay] })
    expect(document.querySelector(`.overlay-phase`)?.textContent?.trim()).toBe(phase)
    const overlay_lever = document.querySelector(`.overlay-lever`)?.textContent
    expect(overlay_lever?.replaceAll(/\s+/g, ` `).trim()).toBe(lever)
  })

  // each predicted coordinate shows only when predicted; a verdict shows on its own too
  test.each([
    [{ predicted_x: null, predicted_t: null, pass: true }, `pass no predicted value`],
    [{ predicted_x: 0.5, predicted_t: null, pass: null }, `Predicted x = 50 at% (+5 at%)`],
    [{ predicted_x: null, predicted_t: 500, pass: false }, `fail Predicted T = 500 K (−20 K)`],
  ])(`prediction line %#`, (prediction, expected) => {
    const [row] = observations
    const phase = row.phases?.[0] ?? null
    const observation = { row, phase, composition: 0.45, temperature: 520, ...prediction }
    mount_tooltip({ hover_info: create_hover_info({ observation }) })
    const text = document
      .querySelector(`.prediction`)
      ?.textContent?.replaceAll(/\s+/g, ` `)
      .trim()
    expect(text?.replace(`-`, `−`)).toBe(expected)
  })

  test(`observation block cites the source with T and x uncertainties`, () => {
    const [row] = observations
    const phase = row.phases?.[0] ?? null
    const observation = {
      row,
      phase,
      composition: 0.45,
      temperature: 520,
      predicted_x: null,
      predicted_t: null,
      pass: null,
    }
    mount_tooltip({ hover_info: create_hover_info({ observation }) })
    const block = document.querySelector(`.observation`)
    const text = block?.textContent?.replaceAll(/\s+/g, ` `)
    for (const part of [
      `Ok`,
      `L -> (Al) + (Cu)`,
      `T = 520 K ± 10 K`,
      `liquid: x = 45 at% ± 2 at%`,
    ]) {
      expect(text).toContain(part)
    }
    expect(block?.querySelector(`cite`)?.textContent).toContain(`Doe et al.`)
    expect(block?.querySelector(`a`)?.getAttribute(`href`)).toBe(`https://doi.org/10.1/test`)
    // observation rows are unvalidated JSON: one without a source renders without a citation
    document.body.innerHTML = ``
    const { source: _, ...unsourced } = row
    mount_tooltip({
      hover_info: create_hover_info({ observation: { ...observation, row: unsourced } }),
    })
    expect(document.querySelector(`.observation`)?.textContent).toContain(`T = 520 K`)
    expect(document.querySelector(`.observation cite`)).toBeNull()
  })

  describe(`boundary distance`, () => {
    // Boundary temperatures interpolate on the segment spanning the composition: at x = 0.19
    // the Cu-like liquidus sits at 1112.9 K, not at its 1100 K sample at x = 0.2
    const liquidus = pts(0, 1358, 0.2, 1100, 0.4, 900)
    const sloped = pts(0, 1000, 1, 500)
    test.each<[number, number, BoundaryKind, Vec2[], TempUnit, string, number]>([
      [0.5, 1050, `liquidus`, pts(0, 1000, 1, 1000), `K`, `above`, 50], // temp > boundary
      [0.5, 750, `solidus`, pts(0, 800, 1, 800), `°C`, `below`, 50], // temp < boundary
      [0.5, 900, `solvus`, pts(0, 1100, 1, 900), `K`, `below`, 100],
      [0.1, 1300, `liquidus`, liquidus, `K`, `above`, 71],
      [0.19, 1200, `liquidus`, liquidus, `K`, `above`, 87],
      [0.5, 900, `liquidus`, sloped, `K`, `above`, 150], // boundary at 750 K
      [0.1, 900, `liquidus`, sloped, `K`, `below`, 50], // boundary at 950 K, not 1000 K
    ])(
      `at x=%s, %s K vs a %s %o in %s shows "%s" by %s`,
      (composition, temperature, kind, points, unit, direction, delta) => {
        const hover_info = create_hover_info({ composition, temperature })
        const data = { ...eutectic, boundaries: [{ kind, phases: [], points }] }
        mount_tooltip({ hover_info, data, temp_unit: unit })
        const text = document.querySelector(`.boundary-info`)?.textContent ?? ``
        expect(text.replaceAll(/\s+/g, ` `).trim()).toBe(
          `${delta} ${unit} ${direction} ${kind}`,
        )
      },
    )

    // an edge's side names the phase whose composition it traces
    test(`names the side and field of the nearest edge`, () => {
      const edge = {
        kind: `liquidus` as const,
        phases: [`A`, `LIQUID`],
        side: `LIQUID`,
        points: pts(0, 800, 1, 800),
      }
      const hover_info = create_hover_info({ composition: 0.5, temperature: 850 })
      mount_tooltip({ hover_info, data: { ...eutectic, boundaries: [edge] } })
      const text = document
        .querySelector(`.boundary-info`)
        ?.textContent?.replaceAll(/\s+/g, ` `)
      expect(text?.trim()).toBe(`50 K above liquidus (L edge of α + L)`)
    })

    // the fixture's only boundary is an invariant line, which is not a distance reference
    test.each([
      [`no boundaries`, []],
      [`an invariant line`, eutectic.boundaries],
    ])(`not shown for %s`, (_desc, boundaries) => {
      const hover_info = create_hover_info({ composition: 0.5, temperature: 900 })
      mount_tooltip({ hover_info, data: { ...eutectic, boundaries } })
      expect(document.querySelector(`.boundary-info`)).toBeNull()
    })
  })

  // attribution: source, assessment and license of each shown diagram, flagged when not cleared
  test(`footer cites each diagram's provenance`, () => {
    const provenance = {
      kind: `assessment` as const,
      source: `NIST SRD 139`,
      assessment: `Hayes et al. 1986`,
      license: `public domain`,
      redistribution: `not_cleared` as const,
    }
    mount_tooltip({
      hover_info: create_hover_info(),
      data: { ...eutectic, provenance },
      overlays: [shifted_eutectic],
    })
    const footers = [...document.querySelectorAll(`footer.provenance`)].map((el) =>
      el.textContent?.replaceAll(/\s+/g, ` `).trim(),
    )
    expect(footers).toEqual([
      `Main: NIST SRD 139; assessment: Hayes et al. 1986; license: public domain; not cleared for redistribution`,
    ])
  })

  describe(`tooltip customization`, () => {
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
