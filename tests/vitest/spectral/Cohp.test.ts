import Cohp from '#lib/spectral/Cohp.svelte'
import { add_alpha, plot_color } from '#lib/colors/index.js'
import { type CohpData, parse_cohpcar, parse_doscar } from '#lib/spectral/lobster.js'
import type { ElectronicDos } from '#lib/spectral/types.js'
import { lobster_samples } from '#site/electronic/lobster/index.js'
import { type ComponentProps, flushSync } from 'svelte'
import { fromStore, writable } from 'svelte/store'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vite-plus/test'
import { bind_props, fire, mount_sized, mouse, plot_svg, translate_of } from '../setup'

// A COHPCAR with 3 Fe pairs over 5 energies from -2 to 2 eV, values cycling so curves differ
const cohpcar = (n_spins: 1 | 2, efermi = 6.5): string => {
  const n_columns = 4
  const rows = [-2, -1, 0, 1, 2].map((energy) =>
    [
      energy,
      ...Array.from(
        { length: 2 * n_columns * n_spins },
        (_, idx) => ((idx * 7 + energy * 3) % 5) / 10 - 0.2,
      ),
    ].join(` `),
  )
  return [
    `COHPCAR.lobster`,
    `${n_columns} ${n_spins} 5 -2 2 ${efermi}`,
    `Average`,
    `No.1:Fe1->Fe2(2.45085)`,
    `No.2:Fe1->Fe1(2.83000)`,
    `No.3:Fe2->Fe2(2.83000)`,
    ...rows,
  ].join(`\n`)
}
const restricted = parse_cohpcar(cohpcar(1), `COHP`)
const spin = parse_cohpcar(cohpcar(2), `COHP`)
// real orbital-resolved COBI (LaTaN2O demo sample)
const cobi_files = lobster_samples[`LaTaN2O-COBI`].by_kind.get(`COBI`)
if (!cobi_files) throw new Error(`LaTaN2O-COBI sample has no COBICAR`)
const cobi = cobi_files.cohp
// real KF DOSCAR.lobster (pymatgen test file), energies relative to E_F
const kf_dos = parse_doscar(
  readFileSync(`${import.meta.dirname}/../fixtures/lobster/DOSCAR.lobster.spin`, `utf8`),
).total

const mount_plot = (props: Partial<ComponentProps<typeof Cohp>>) =>
  mount_sized(Cohp, props, { selector: `.scatter`, width: 500, height: 400 })
// drawn curves by stroke color, dash and width
const curves = () =>
  [...document.querySelectorAll(`path[fill="none"][stroke-width]`)]
    .filter((path) => path.closest(`.scatter`) && !path.closest(`.legend, .plot-legend`))
    .map((path) => ({
      stroke: path.getAttribute(`stroke`),
      dash: path.getAttribute(`stroke-dasharray`),
      width: Number(path.getAttribute(`stroke-width`)),
    }))
    .filter(({ stroke }) => /^(?:#|rgb)/.test(stroke ?? ``))
const texts = () =>
  [...document.querySelectorAll(`.scatter text`)].map((node) => node.textContent ?? ``)

describe(`Cohp`, () => {
  // spin-restricted: one curve per pair (+ integrated, + average); overlay doubles spin-polarized
  // oxfmt-ignore
  it.each([
    [`restricted`, restricted, {}, 3, 0, 0],
    [`average + integrated`, restricted, { show_average: true, show_integrated: true }, 8, 0, 4],
    [`spin overlay`, spin, {}, 6, 3, 0],
    [`spin overlay + integrated`, spin, { show_integrated: true }, 12, 3, 3],
    [`spin sum`, spin, { spin_mode: `sum` }, 3, 0, 0],
    [`spin down only`, spin, { spin_mode: `down_only` }, 3, 3, 0],
    [`spin up only, two pairs`, spin, { spin_mode: `up_only`, bonds: [`1`, `3`] }, 2, 0, 0],
    [`COBI pair + orbital pairs`, cobi, { bonds: [`1`, `1:2p_y-6s`, `2:2s-6s`] }, 3, 0, 0],
  ] as const)(`%s draws the expected curves`, async (_name, cohp, props, n_curves, n_dashed, n_dotted) => {
    await mount_plot({ cohp, ...props })
    const drawn = curves()
    expect(drawn).toHaveLength(n_curves)
    expect(drawn.filter(({ dash }) => dash === `5,3`)).toHaveLength(n_dashed)
    expect(drawn.filter(({ dash }) => dash === `1,3`)).toHaveLength(n_dotted)
  })

  it(`colors pairs in drawn order and fades non-highlighted ones`, async () => {
    await mount_plot({ cohp: restricted, bonds: [`3`, `2`], highlighted_bonds: [`2`] })
    expect(curves()).toEqual([
      { stroke: add_alpha(plot_color(0), 0.25), dash: null, width: 1.5 },
      { stroke: plot_color(1), dash: null, width: 2.75 },
    ])
  })

  it.each([
    [true, [`−COHP (eV)`, `E − EF (eV)`, `bonding →`, `← antibonding`]],
    [false, [`E (eV)`]],
  ] as const)(`shift_to_fermi=%s labels axes and sides`, async (shift_to_fermi, labels) => {
    await mount_plot({ cohp: restricted, shift_to_fermi, show_integrated: true })
    const all_text = texts().join(`|`)
    for (const label of [...labels, `−ICOHP (eV)`]) expect(all_text).toContain(label)
    expect(document.querySelector(`.fermi-level-line`)).toBeInstanceOf(SVGLineElement)
    // legend rows name each pair by atoms, label and length
    expect(document.body.textContent).toContain(`Fe1–Fe2 #1 (2.451 Å)`)
  })

  // E_F sits where it is in the data, relative or absolute; a DOS beside the curves (real KF
  // DOSCAR.lobster, energies relative to its E_F like the COHPCAR's) shares their energy axis:
  // same ticks at the same heights, E_F on one line
  it.each([
    [true, 800, true],
    [false, 800, true],
    [true, 400, true],
    [true, 800, false],
    [false, 800, false],
  ])(
    `shift_to_fermi=%s, %ipx, DOS %s: E_F on the energy axis, panes aligned`,
    async (shift_to_fermi, width, with_dos) => {
      // energies -2..2 relative to E_F = -1.5 eV, -3.5..0.5 absolute
      const cohp = parse_cohpcar(cohpcar(1, -1.5), `COHP`)
      const root = await mount_sized(
        Cohp,
        { cohp, shift_to_fermi, ...(with_dos && { doses: { Total: kf_dos } }) },
        { selector: `.cohp-and-dos`, width, height: 400 },
      )
      const [cohp_plot, dos_plot] = root.querySelectorAll(`.scatter`)
      const fermi_y = (plot: Element) =>
        Number(plot.querySelector(`.fermi-level-line`)?.getAttribute(`y1`))
      const y_ticks = (plot: Element) =>
        [...plot.querySelectorAll(`.y-axis .tick`)].map((tick) => [
          tick.querySelector(`text`)?.textContent,
          translate_of(tick).y,
        ])
      const tick_y = Object.fromEntries(y_ticks(cohp_plot))
      expect(y_ticks(cohp_plot).map(([text]) => text)).toEqual(
        shift_to_fermi ? [`-2`, `-1`, `0`, `1`, `2`] : [`-3`, `-2`, `-1`, `0`],
      )
      if (shift_to_fermi) expect(fermi_y(cohp_plot)).toBeCloseTo(tick_y[`0`], 6)
      else expect(fermi_y(cohp_plot)).toBeCloseTo((tick_y[`-1`] + tick_y[`-2`]) / 2, 6)
      expect(root.classList.contains(`side`)).toBe(with_dos && width >= 520)
      expect(Boolean(dos_plot)).toBe(with_dos)
      if (!dos_plot || width < 520) return // stacked: the DOS plots energy along x
      expect(y_ticks(dos_plot)).toEqual(y_ticks(cohp_plot))
      expect(fermi_y(dos_plot)).toBeCloseTo(fermi_y(cohp_plot), 6)
    },
  )

  // the plot binds its view for the DOS link: new data must not keep the last data's view
  it(`new data with a DOS spans its own energies in both panes`, async () => {
    const data = fromStore(
      writable<{ cohp: CohpData; doses?: { Total: ElectronicDos } }>({ cohp: cobi }),
    )
    const props = {
      get cohp() {
        return data.current.cohp
      },
      get doses() {
        return data.current.doses
      },
    }
    await mount_sized(Cohp, props, { selector: `.scatter`, width: 800, height: 400 })
    const y_ticks = () =>
      [...document.querySelectorAll(`.scatter`)].map((plot) =>
        [...plot.querySelectorAll(`.y-axis .tick text`)].map((text) => text.textContent),
      )
    expect(y_ticks()).toEqual([[`-8`, `-6`, `-4`, `-2`, `0`, `2`, `4`, `6`]]) // COBI: -7.9..5 eV
    data.current = { cohp: parse_cohpcar(cohpcar(1), `COHP`), doses: { Total: kf_dos } }
    flushSync()
    const ticks = y_ticks()
    expect(ticks).toHaveLength(2)
    expect(ticks[0]).toEqual(ticks[1])
    expect(ticks[0]).not.toContain(`-8`) // energies -2..2
    expect(ticks[0]).toContain(`2`)
  })

  // the Average curve reports its hover but belongs to no pair, so clicks on it pass nothing
  // oxfmt-ignore
  it.each([
    [`a pair`, { bonds: [`2`] }, plot_color(0), `2`, [`2`]],
    [`the average`, { bonds: [], show_average: true }, `#8c8c8c`, `average`, []],
    // series_idx 1: hover and clicks resolve by the curve's own index
    [`a pair after the average`, { bonds: [`2`], show_average: true }, plot_color(0), `2`, [`2`]],
  ] as const)(
    `reports hovering %s and passes its clicks on`,
    async (_name, props, stroke, hovered, clicks) => {
      const on_bond_click = vi.fn()
      const state = { hovered_bond: null as string | null }
      const plot = await mount_plot(
        bind_props(
          { cohp: restricted, ...props, on_bond_click, line_tween: { duration: 0 } },
          state,
        ),
      )
      const svg = plot_svg(plot)
      svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 500, height: 400 })
      const path = plot.querySelector(`path[fill="none"][stroke="${stroke}"]`)
      const [clientX, clientY] = (path?.getAttribute(`d`)?.match(/-?[\d.]+/g) ?? []).map(
        Number,
      )
      svg.dispatchEvent(mouse(`mousemove`, { clientX, clientY }))
      await new Promise((resolve) => requestAnimationFrame(resolve))
      expect(state.hovered_bond).toBe(hovered)
      await fire(svg, mouse(`click`, { clientX, clientY, detail: 1 }))
      expect(on_bond_click.mock.calls).toEqual(clicks.map((label) => [label]))
      await fire(svg, mouse(`mouseleave`))
      expect(state.hovered_bond).toBeNull()
    },
  )

  it(`throws on unknown pair labels`, async () => {
    await expect(mount_plot({ cohp: restricted, bonds: [`99`] })).rejects.toThrow(
      /no pair or orbital pair "99"/,
    )
  })
})
