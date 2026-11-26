import GibbsEnergyPlot from '#lib/phase-diagram/GibbsEnergyPlot.svelte'
import type {
  BinaryPhaseDiagram,
  DiagramCursor,
  DiagramXFrame,
} from '#lib/phase-diagram/types'
import { binary_diagrams } from '#site/phase-diagrams'
import { tick } from 'svelte'
import { describe, expect, test } from 'vite-plus/test'
import { mount_sized } from '../setup'
import { eutectic } from './fixtures/test-data'

const model = binary_diagrams[`Ag-Cu-model`]
const [width, height] = [400, 220]
const pad = { l: 52, r: 12 } // the plot's own padding
const x_px = (comp: number) => pad.l + comp * (width - pad.l - pad.r)
const mount_plot = (props: {
  data: BinaryPhaseDiagram
  temperature?: number | null
  cursor?: DiagramCursor | null
  x_frame?: DiagramXFrame | null
}) => mount_sized(GibbsEnergyPlot, props, { selector: `.gibbs-energy-plot`, width, height })

const grid = model.gibbs_energy
if (!grid) throw new Error(`Expected the demo model to carry Gibbs energies`)
const without_edge: BinaryPhaseDiagram = {
  ...model,
  gibbs_energy: {
    ...grid,
    phases: grid.phases.map((phase) => ({
      ...phase,
      values: phase.values.map(([, ...rest]) => [null, ...rest]),
    })),
  },
}

// numbers as the plot prints them, with a typographic minus
const num_text = (text: string | null | undefined) =>
  Number(text?.replace(`−`, `-`).replace(`+`, ``).trim())
const num = (el: Element | null) => num_text(el?.textContent)
// kJ/mol at a pixel y, from the first and last y-axis tick labels
const g_at_px = (wrapper: HTMLElement) => {
  const ticks = [...wrapper.querySelectorAll(`.axis text[dominant-baseline]`)].map(
    (el) => [Number(el.getAttribute(`y`)), num(el)] as const,
  )
  const [[y_0, g_0], [y_1, g_1]] = [ticks[0], ticks[ticks.length - 1]]
  return (y_px: number) => g_0 + ((g_1 - g_0) * (y_px - y_0)) / (y_1 - y_0)
}

describe(`GibbsEnergyPlot`, () => {
  // the demo model at 900 K: one fcc miscibility-gap tangent between its two wells, at grid
  // nodes next to the diagram's solvus compositions (0.056 and 0.978)
  test(`draws one curve per model phase and the hull's common tangent`, async () => {
    const wrapper = await mount_plot({ data: model, temperature: 900 })
    expect(wrapper.querySelectorAll(`path.curve`)).toHaveLength(2)
    expect(wrapper.querySelector(`path.hull`)).not.toBeNull()
    const tangents = [...wrapper.querySelectorAll(`line.tangent`)]
    expect(tangents).toHaveLength(1)
    const [x_1, x_2] = [`x1`, `x2`].map((attr) => Number(tangents[0].getAttribute(attr)))
    expect(x_1).toBeCloseTo(x_px(0.06), 9)
    expect(x_2).toBeCloseTo(x_px(0.98), 9)
    expect(wrapper.querySelector(`.title`)?.textContent).toContain(`900 K`)
    // one grid line per tick label on each axis, the vertical ones at the x ticks
    const grid_lines = [...wrapper.querySelectorAll(`.grid line`)]
    const tick_labels = wrapper.querySelectorAll(`.axis text:not([transform])`)
    expect(grid_lines).toHaveLength(tick_labels.length)
    const vertical_xs = grid_lines
      .filter((line) => line.getAttribute(`x1`) === line.getAttribute(`x2`))
      .map((line) => Number(line.getAttribute(`x1`)))
    expect(vertical_xs).toHaveLength(6)
    vertical_xs.forEach((x_val, idx) => expect(x_val).toBeCloseTo(x_px(idx / 5), 9))
    expect(
      [...wrapper.querySelectorAll(`.legend > span`)].map((el) => el.textContent?.trim()),
    ).toEqual([
      `L`,
      `FCC_A1`, // two composition sets share the fcc curve: named by model phase
    ])
  })

  test(`follows a bound cursor's temperature and marks its composition`, async () => {
    const cursor = { composition: 0.3, temperature: 1100, source: `diagram` }
    const wrapper = await mount_plot({ data: model, temperature: 900, cursor })
    expect(wrapper.querySelector(`.title`)?.textContent).toContain(`1100 K`)
    expect(Number(wrapper.querySelector(`line.cursor`)?.getAttribute(`x1`))).toBeCloseTo(
      x_px(0.3),
      9,
    )
    // above the eutectic two L + fcc tangents, one on each side of the liquid
    expect(wrapper.querySelectorAll(`line.tangent`)).toHaveLength(2)
  })

  // inside the 900 K miscibility gap the hull's tangent at the cursor is the common tangent,
  // read out per phase with its height above the hull and its ends labelled as Δμ
  test(`reads out the phases and the hull tangent at the cursor`, async () => {
    const cursor = { composition: 0.5, temperature: 900, source: `diagram` }
    const wrapper = await mount_plot({ data: model, cursor })
    const line_of = (selector: string) =>
      [`x1`, `y1`, `x2`, `y2`].map((attr) =>
        Number(wrapper.querySelector(selector)?.getAttribute(attr)),
      )
    const slope = ([x_1, y_1, x_2, y_2]: number[]) => (y_2 - y_1) / (x_2 - x_1)
    const [common, at_cursor] = [line_of(`line.tangent`), line_of(`line.cursor-tangent`)]
    expect(slope(at_cursor)).toBeCloseTo(slope(common), 9)
    // same line: the common tangent's start lies on the cursor tangent
    expect(at_cursor[1] + slope(at_cursor) * (common[0] - at_cursor[0])).toBeCloseTo(
      common[1],
      9,
    )
    expect([at_cursor[0], at_cursor[2]]).toEqual([x_px(0), x_px(1)])
    // both phases sit above the tangent mid-gap: each legend value is its marker's height,
    // and that value minus its height above the hull lands on the cursor tangent
    const g_of = g_at_px(wrapper)
    const legend = [...wrapper.querySelectorAll(`.legend > span`)].map((el) => [
      num(el.querySelector(`b`)),
      num(el.querySelector(`small`)),
    ])
    const markers = [...wrapper.querySelectorAll(`circle.cursor-marker`)]
    expect(markers).toHaveLength(2)
    const tangent_g = g_of(at_cursor[1] + slope(at_cursor) * (x_px(0.5) - at_cursor[0]))
    for (const [idx, [g_val, above]] of legend.entries()) {
      expect(above).toBeGreaterThan(0)
      // legend values print at 2 decimals, so allow half a unit in the last place each
      const marker_g = g_of(Number(markers[idx].getAttribute(`cy`)))
      expect(Math.abs(marker_g - g_val)).toBeLessThan(0.006)
      expect(Math.abs(g_val - above - tangent_g)).toBeLessThan(0.011)
    }
    expect(wrapper.querySelector(`header .at-x`)?.textContent).toMatch(/^50 at%\s*Cu$/)
    const mu_labels = [...wrapper.querySelectorAll(`text.mu`)].map((el) => el.textContent)
    expect(mu_labels).toEqual([
      expect.stringMatching(/^ΔμAg = −?\d+\.\d{2}$/),
      expect.stringMatching(/^ΔμCu = −?\d+\.\d{2}$/),
    ])
  })

  // at a pure end the hull touches its zero reference, so that end's Δμ is 0
  test.each([
    [0, `Ag`],
    [1, `Cu`],
  ])(`cursor at x = %s reads out the edge segment`, async (composition, component) => {
    const cursor = { composition, temperature: 900, source: `diagram` }
    const wrapper = await mount_plot({ data: model, cursor })
    expect(wrapper.querySelectorAll(`circle.cursor-marker`).length).toBeGreaterThan(0)
    const mu_text = [...wrapper.querySelectorAll(`text.mu`)]
      .map((el) => el.textContent ?? ``)
      .find((text) => text.startsWith(`Δμ${component}`))
    const mu_val = num_text(mu_text?.split(`=`)[1])
    expect(Math.abs(mu_val)).toBeLessThan(0.005)
  })

  test(`hovering writes the shared cursor at the shown T and leaving clears it`, async () => {
    const props = $state<{
      data: BinaryPhaseDiagram
      temperature: number
      cursor: DiagramCursor | null
    }>({
      data: model,
      temperature: 900,
      cursor: null,
    })
    const wrapper = await mount_plot(props)
    const svg = wrapper.querySelector(`svg`)
    if (!svg) throw new Error(`no svg`)
    svg.dispatchEvent(new PointerEvent(`pointermove`, { clientX: x_px(0.25), bubbles: true }))
    expect(props.cursor).toMatchObject({ temperature: 900 })
    expect(props.cursor?.composition).toBeCloseTo(0.25, 9)
    svg.dispatchEvent(new PointerEvent(`pointerleave`))
    expect(props.cursor).toBeNull()
    // a diagram-set cursor survives the plot's own leave
    props.cursor = { composition: 0.4, temperature: 1000, source: `diagram` }
    svg.dispatchEvent(new PointerEvent(`pointerleave`))
    expect(props.cursor).toMatchObject({ source: `diagram` })
  })

  // zoomed to [0.2, 0.6], neither pure-component edge is on screen, so no Δμ label shows
  test(`shares a stacked diagram's composition axis`, async () => {
    const x_frame: DiagramXFrame = { range: [100, 300], domain: [0.2, 0.6] }
    const cursor = { composition: 0.4, temperature: 900, source: `diagram` }
    const wrapper = await mount_plot({ data: model, cursor, x_frame })
    const tick_xs = [...wrapper.querySelectorAll(`.grid line`)]
      .filter((line) => line.getAttribute(`x1`) === line.getAttribute(`x2`))
      .map((line) => Number(line.getAttribute(`x1`)))
    expect(tick_xs[0]).toBeCloseTo(100, 9)
    expect(tick_xs.at(-1)).toBeCloseTo(300, 9)
    expect(wrapper.querySelector(`header`)?.getAttribute(`style`)).toContain(`left: 100px`)
    expect(wrapper.querySelector(`line.cursor-tangent`)).not.toBeNull()
    expect(wrapper.querySelectorAll(`text.mu`)).toHaveLength(0)
  })

  // before any cursor: the `temperature` prop, else the grid's middle T; afterwards the last
  // in-grid cursor T stays, while an out-of-grid cursor shows a message at full height and is
  // not remembered
  test(`keeps the last in-grid cursor temperature once the cursor leaves`, async () => {
    const temps = grid.temperatures
    const middle = (temps[0] + temps[temps.length - 1]) / 2
    const props = $state<{ data: BinaryPhaseDiagram; cursor: DiagramCursor | null }>({
      data: model,
      cursor: null,
    })
    const wrapper = await mount_plot(props)
    const title = () => wrapper.querySelector(`.title`)?.textContent
    expect(title()).toContain(`${middle} K`)
    props.cursor = { composition: 0.3, temperature: 1100, source: `diagram` }
    await tick()
    expect(wrapper.querySelector(`line.cursor`)).not.toBeNull()
    props.cursor = { composition: 0.3, temperature: 1500, source: `diagram` }
    await tick()
    expect(wrapper.querySelector(`.empty:not(.no-data)`)?.textContent).toBe(
      `1500 K is outside the Gibbs energy grid`,
    )
    props.cursor = null
    await tick()
    expect(title()).toContain(`1100 K`)
    expect(wrapper.querySelector(`line.cursor`)).toBeNull()
  })

  test.each([
    [eutectic, 900, `No Gibbs energies in this diagram`],
    [model, 1500, `1500 K is outside the Gibbs energy grid`],
    // no phase defined at x = 0: no pure-component reference line for the energy of mixing
    [without_edge, 900, `No Gibbs energies spanning both pure components at this temperature`],
  ])(`empty state %#`, async (data, temperature, message) => {
    const wrapper = await mount_plot({ data, temperature })
    expect(wrapper.textContent?.trim()).toBe(message)
  })
})
