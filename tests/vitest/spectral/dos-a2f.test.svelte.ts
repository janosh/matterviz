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

// A q-mesh α²F (and a tetrahedron DOS) is a comb of mode peaks: Dos draws every curve smoothed
// by sigma or, if wider, the display width (1/300 of the span drawn), keeping its area, so
// sigma only ever smooths more; a grid coarser than that width is drawn as given.
// peaks every 0.5 THz from 5 to 45 THz on a 0 to 50 THz grid, clear of its ends
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
const area = trapezoid(comb.frequencies, comb.densities)
// the drawn curve's peak and area, α²F's or the electron DOS's
const drawn = (label: string, horizontal = false) => {
  const series: readonly DataSeries[] = plot.props?.series ?? []
  const curve = series.find((srs) => srs.label === label)
  if (!curve) throw new Error(`no ${label} curve`)
  const [xs, ys] = (horizontal ? [curve.y, curve.x] : [curve.x, curve.y]) as number[][]
  return { peak: Math.max(...ys), area: trapezoid(xs, ys), ys }
}
test.each([
  [`α²F`, undefined, 0.122],
  [`α²F`, 0.01, 0.122], // under the display width, which wins
  [`α²F`, 1, 0.1], // the comb flattened to its mean density
  [`total`, undefined, 0.122],
  [`total`, 1, 0.1],
])(`a dense %s with sigma %s peaks at %d, its area kept`, (label, sigma, peak) => {
  const component = mount(Dos, {
    target: document.body,
    props: {
      ...(label === `α²F`
        ? { doses: { 'phonon DOS': phonon_dos }, a2f: { 'α²F': comb } }
        : {
            doses: {
              total: { type: `electronic`, energies: comb_freqs, densities: comb.densities },
            },
          }),
      ...(sigma !== undefined && { sigma }),
    },
  })
  onTestFinished(() => void unmount(component))
  flushSync()
  const curve = drawn(label)
  expect(curve.peak).toBeCloseTo(peak, 2)
  expect(curve.area).toBeCloseTo(area, 2)
})
// the span drawn is a caller's frequency-axis range where it sets one (BandsAndDos's shared
// energy axis): on the horizontal plot that is y_axis, on the vertical one x_axis. A 10 THz
// range's width (0.033, under the 0.05 sampling) leaves the comb's peaks far sharper.
test.each<[`horizontal` | `vertical`, Partial<ComponentProps<typeof Dos>>, number]>([
  [`horizontal`, { y_axis: { range: [20, 30] } }, 0.6],
  [`horizontal`, { x_axis: { range: [20, 30] } }, 0.122], // the density axis: no effect
  [`vertical`, { x_axis: { range: [20, 30] } }, 0.6],
])(`a %s DOS reads its width off %o`, (orientation, axes, peak) => {
  const component = mount(Dos, {
    target: document.body,
    props: {
      doses: {
        total: { type: `electronic`, energies: comb_freqs, densities: comb.densities },
      },
      orientation,
      ...axes,
    },
  })
  onTestFinished(() => void unmount(component))
  flushSync()
  expect(drawn(`total`, orientation === `horizontal`).peak).toBeCloseTo(peak, 2)
})

test(`a coarse α²F is drawn as given`, () => {
  const component = mount(Dos, {
    target: document.body,
    props: { doses: { 'phonon DOS': phonon_dos }, a2f: { 'α²F': a2f } },
  })
  onTestFinished(() => void unmount(component))
  flushSync()
  drawn(`α²F`).ys.forEach((value, idx) => expect(value).toBeCloseTo(a2f.densities[idx], 9))
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
      a2f_extent: undefined,
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
    // its drawn extent goes out, and a given range (a sweep's held one) replaces the data's
    expect(props.a2f_extent).toEqual([0, 0.3])
    props.a2f_range = [0, 1]
    flushSync()
    expect([read().axis?.range, props.a2f_extent]).toEqual([
      [0, 1],
      [0, 0.3],
    ])
  },
)
