import EosPlot from '#lib/eos/EosPlot.svelte'
import type { EosFit } from '#lib/eos/index.js'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vite-plus/test'
import { bind_props, mount_sized } from '../setup'

// Cu-like 9-point scan, see fit.test.ts
const volumes = [10.384, 10.738, 11.092, 11.446, 11.8, 12.154, 12.508, 12.862, 13.216]
const energies = [
  -3.60480992, -3.65001692, -3.67844077, -3.69497369, -3.70053567, -3.69525616, -3.68211321,
  -3.66370053, -3.64106684,
]

describe(`EosPlot`, () => {
  let component: ReturnType<typeof mount> | undefined
  afterEach(async () => {
    if (component) await unmount(component)
    document.body.replaceChildren()
  })

  const render = async (props: Record<string, unknown>) => {
    const bound: { fits: EosFit[] } = { fits: [] }
    component = mount(EosPlot, {
      target: document.body,
      props: bind_props({ volumes, energies, ...props }, bound),
    })
    flushSync()
    await tick()
    const text = (selector: string) =>
      document.querySelector(selector)?.textContent?.replaceAll(/\s+/g, ` `).trim()
    return {
      fits: bound.fits,
      legend: text(`.legend`),
      error: text(`.status-message`),
      n_markers: document.querySelectorAll(`path.marker`).length,
    }
  }

  // kinds is deduped and fitted in order; a lone data series needs no legend
  test.each([
    [
      `deduped kinds in order`,
      { kinds: [`vinet`, `birch_murnaghan`, `vinet`] },
      [`vinet`, `birch_murnaghan`],
      `E(V) data Vinet fit Birch–Murnaghan fit`,
    ],
    [`legend={null}`, { legend: null }, [`birch_murnaghan`], undefined],
    [`kinds=[]`, { kinds: [] }, [], undefined],
  ])(`%s: fits and legend`, async (_desc, props, fit_kinds, expected_legend) => {
    const { fits, legend, error, n_markers } = await render(props)
    expect(fits.map((fit) => fit.kind)).toEqual(fit_kinds)
    expect(legend).toBe(expected_legend)
    expect(error).toBeUndefined()
    expect(n_markers).toBe(volumes.length)
  })

  // series 0 is the data, 1 the (only) Birch–Murnaghan fit; the tooltip shows point_idx 0 of
  // the hovered series (V = 10.384 for the data, the curve's 10.2 start for the fit)
  test.each([
    [
      `fit with params`,
      1,
      {},
      [`Birch–Murnaghan fit`, `V: 10.2 Å³`, `B0: 139.1 GPa`, `RMSE: 0.54 meV`],
      [],
    ],
    [`fit without params`, 1, { show_fit_params: false }, [`Birch–Murnaghan fit`], [`B0`]],
    [`data point`, 0, {}, [`E(V) data`, `V: 10.4 Å³`], [`B0`, `RMSE`]],
  ])(`tooltip on %s`, async (_desc, series_idx, props, includes, excludes) => {
    const tooltip_point = { x: 0, y: 0, series_idx, point_idx: 0 }
    const root = await mount_sized(
      EosPlot,
      // hovered/tooltip_point pass through to ScatterPlot but aren't EosPlot's public props
      { volumes, energies, hovered: true, tooltip_point, ...props } as ComponentProps<
        typeof EosPlot
      >,
      { selector: `.scatter`, on_mount: (mounted) => (component = mounted) },
    )
    const text = root.querySelector(`.plot-tooltip`)?.textContent?.replaceAll(/\s+/g, ` `)
    for (const expected of includes) expect(text).toContain(expected)
    for (const unexpected of excludes) expect(text).not.toContain(unexpected)
  })

  // ScatterPlot throws on x/y length mismatch, which used to take down the whole component
  // before the fit error could be shown
  test.each([
    [{ energies: energies.slice(0, 5) }, /9 volumes but 5 energies/, 0],
    [{ volumes: [1, 2, 3, 4], energies: [1, 2, 3, 4] }, /must bracket/, 4],
  ])(`shows fit errors for %j and keeps rendering`, async (props, message, n_markers) => {
    const result = await render(props)
    expect(result.fits).toEqual([])
    expect(result.error).toMatch(message)
    expect(result.n_markers).toBe(n_markers)
    // one root (a sibling error took its own cell in grid parents) with the error floating on top
    expect(document.body.childElementCount).toBe(1)
    expect(document.querySelector(`.viewer-notices .status-message`)).not.toBeNull()
    // error_msg is a writable $derived: dismissing overrides it until the inputs change
    document.querySelector<HTMLButtonElement>(`.status-message button`)?.click()
    flushSync()
    await tick()
    expect(document.querySelector(`.status-message`)).toBeNull()
  })
})
