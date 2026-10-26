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

// A q-mesh α²F is a comb of mode peaks: dense ones are broadened for display (by 1% of their
// span, or a2f_sigma) keeping their integral, while a coarse grid or a2f_sigma 0 draws as given
// peaks every 0.5 THz from 5 to 45 THz on a 0 to 50 THz grid, clear of its ends so no
// broadened peak spills past them
const comb_freqs = Array.from({ length: 1001 }, (_, idx) => idx * 0.05)
const comb: PhononDos = {
  type: `phonon`,
  frequencies: comb_freqs,
  densities: comb_freqs.map((_, idx) => (idx % 10 === 5 && idx > 100 && idx < 900 ? 1 : 0)),
}
const trapezoid = (xs: readonly number[], ys: readonly number[]) =>
  ys
    .slice(1)
    .reduce((sum, y_val, idx) => sum + ((y_val + ys[idx]) * (xs[idx + 1] - xs[idx])) / 2, 0)
test.each([
  [`a dense comb is broadened by default`, comb, undefined, true],
  [`a dense comb with a2f_sigma 0 is drawn as given`, comb, 0, false],
  [`a dense comb is broadened by a2f_sigma 1 THz`, comb, 1, true],
  [`a coarse grid is drawn as given`, a2f, undefined, false],
])(`α²F of %s`, (_desc, curve, a2f_sigma, broadened) => {
  const component = mount(Dos, {
    target: document.body,
    props: { doses: { 'phonon DOS': phonon_dos }, a2f: { 'α²F': curve }, a2f_sigma },
  })
  onTestFinished(() => void unmount(component))
  flushSync()
  const series: readonly DataSeries[] = plot.props?.series ?? []
  const drawn = series.find(({ label }) => label === `α²F`)
  if (!drawn) throw new Error(`no α²F curve`)
  const ys = drawn.y as number[]
  expect(ys).toHaveLength(curve.densities.length)
  if (!broadened) expect(ys).toEqual(curve.densities)
  else {
    // the peaks melt into a smooth curve, its area (so λ) kept to 0.1%
    expect(Math.max(...ys)).toBeLessThan(0.5 * Math.max(...curve.densities))
    const area = trapezoid(curve.frequencies, curve.densities)
    expect(trapezoid(curve.frequencies, ys)).toBeCloseTo(area, 2)
  }
})

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
