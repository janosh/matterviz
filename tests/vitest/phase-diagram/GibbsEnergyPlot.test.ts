import GibbsEnergyPlot from '#lib/phase-diagram/GibbsEnergyPlot.svelte'
import type { BinaryPhaseDiagram, DiagramCursor } from '#lib/phase-diagram/types.js'
import { binary_diagrams } from '#site/phase-diagrams.js'
import { describe, expect, test } from 'vitest'
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
    expect(
      [...wrapper.querySelectorAll(`.legend text`)].map((el) => el.textContent?.trim()),
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

  test.each([
    [eutectic, 900, `No Gibbs energies in this diagram`],
    [model, null, `Hover the phase diagram to see G(x)`],
    [model, 1500, `1500 K is outside the Gibbs energy grid`],
    // no phase defined at x = 0: no pure-component reference line for the energy of mixing
    [without_edge, 900, `No Gibbs energies spanning both pure components at this temperature`],
  ])(`empty state %#`, async (data, temperature, message) => {
    const wrapper = await mount_plot({ data, temperature })
    expect(wrapper.textContent?.trim()).toBe(message)
  })
})
