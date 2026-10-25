// Dos' α²F curves: their own density axis over the DOS frequencies, never rescaled or stacked
import type { DataSeries } from '#lib/plot/index.js'
import type ScatterPlot from '#lib/plot/scatter/ScatterPlot.svelte'
import Dos from '#lib/spectral/Dos.svelte'
import type { PhononDos } from '#lib/spectral/types.js'
import { type ComponentProps, flushSync, mount, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'

// the plot's props as Dos builds them
const plot = vi.hoisted(() => ({
  props: null as Partial<ComponentProps<typeof ScatterPlot>> | null,
}))
vi.mock(`#lib/plot/scatter/ScatterPlot.svelte`, () => ({
  default: (_anchor: Node, props: Partial<ComponentProps<typeof ScatterPlot>>) => {
    plot.props = props
    return {}
  },
}))

const phonon_dos: PhononDos = { type: `phonon`, frequencies: [0, 3, 6], densities: [0, 2, 0] }
const a2f: PhononDos = { ...phonon_dos, densities: [0, 0.3, 0] }

test.each([
  [`vertical`, `y`, `y2`],
  [`horizontal`, `x`, `x2`],
] as const)(
  `%s, α²F keeps its own axis and values through unit changes and stacking`,
  (orientation, density_axis, a2f_axis) => {
    const props = $state<ComponentProps<typeof Dos>>({
      doses: { 'phonon DOS': phonon_dos, other: phonon_dos },
      a2f: { 'α²F': a2f },
      orientation,
      stack: true,
      units: `THz`,
    })
    const component = mount(Dos, { target: document.body, props })
    onTestFinished(() => void unmount(component))
    flushSync()
    const read = () => {
      const series: readonly DataSeries[] = plot.props?.series ?? []
      const curve = series.find(({ label }) => label === `α²F`)
      const dos_curve = series.find(({ label }) => label === `phonon DOS`)
      if (!curve || !dos_curve) throw new Error(`no α²F or DOS curve`)
      return { curve, dos_curve, axis: plot.props?.[`${a2f_axis}_axis`] }
    }
    const thz = read()
    expect(thz.curve[`${density_axis}_axis`]).toBe(a2f_axis)
    expect(Math.max(...thz.curve[density_axis])).toBe(0.3) // not stacked on the two DOS
    expect(thz.axis).toMatchObject({ label: `α²F(ω)`, range: [0, 0.3] })
    props.units = `meV`
    flushSync()
    const mev = read()
    expect(Math.max(...mev.curve[density_axis])).toBe(0.3) // dimensionless: no unit factor
    expect(mev.axis?.range).toEqual([0, 0.3])
    // the DOS is per meV now (÷ 4.136 meV/THz), on the frequency axis α²F shares
    const freq_axis = density_axis === `y` ? `x` : `y`
    expect(Math.max(...mev.dos_curve[density_axis])).toBeCloseTo(2 / 4.135667696, 6)
    expect(mev.curve[freq_axis]).toEqual(mev.dos_curve[freq_axis])
  },
)
