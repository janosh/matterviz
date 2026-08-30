import { EosPlot } from '$lib/eos'
import type { EosFit, EosKind } from '$lib/eos'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { bind_props } from '../setup'

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
      params_box: text(`.eos-fit-params`),
      legend: text(`.legend`),
      error: text(`.status-message`),
      n_markers: document.querySelectorAll(`path.marker`).length,
    }
  }

  test(`fits every kind once, in kinds order, and lists them in the params box`, async () => {
    const kinds: EosKind[] = [`vinet`, `birch_murnaghan`, `vinet`]
    const { fits, params_box, legend, n_markers } = await render({ kinds })
    expect(fits.map((fit) => fit.kind)).toEqual([`vinet`, `birch_murnaghan`])
    expect(params_box).toMatch(/Vinet fit.*Birch–Murnaghan fit/)
    expect(params_box).toContain(`B0 = 139.1 GPa`)
    expect(legend).toBeUndefined() // the params box doubles as the legend
    expect(n_markers).toBe(volumes.length)
  })

  test(`show_fit_params=false falls back to the plot legend`, async () => {
    const { params_box, legend } = await render({ show_fit_params: false })
    expect(params_box).toBeUndefined()
    expect(legend).toContain(`Birch–Murnaghan fit`)
  })

  test(`kinds=[] draws only the data points, with the legend since no params box replaces it`, async () => {
    const { fits, params_box, legend, error, n_markers } = await render({ kinds: [] })
    expect(fits).toEqual([])
    expect(params_box).toBeUndefined()
    expect(legend).toBe(`E(V) data`)
    expect(error).toBeUndefined()
    expect(n_markers).toBe(volumes.length)
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
    // error_msg is a writable $derived: dismissing overrides it until the inputs change
    document.querySelector<HTMLButtonElement>(`.status-message button`)?.click()
    flushSync()
    await tick()
    expect(document.querySelector(`.status-message`)).toBeNull()
  })
})
