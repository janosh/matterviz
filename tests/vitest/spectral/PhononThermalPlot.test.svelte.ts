import { PhononThermalPlot } from '$lib/spectral'
import type { PhononDos } from '$lib/spectral'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

// Einstein solid with 3 modes at 5 THz (see thermal.test.ts)
const dos: PhononDos = {
  type: `phonon`,
  frequencies: [5 - 1e-4, 5, 5 + 1e-4],
  densities: [0, 3 / 1e-4, 0],
}

describe(`PhononThermalPlot`, () => {
  let component: ReturnType<typeof mount> | undefined
  afterEach(async () => {
    if (component) await unmount(component)
    document.body.replaceChildren()
  })

  const render = async (props: Record<string, unknown>) => {
    component = mount(PhononThermalPlot, {
      target: document.body,
      props: { dos, temperatures: [0, 100, 300], ...props },
    })
    flushSync()
    await tick()
    const text = (selector: string) =>
      document.querySelector(selector)?.textContent?.replaceAll(/\s+/g, ` `).trim()
    return { legend: text(`.legend`), error: text(`.status-message`) }
  }

  test(`plots F, U, S and C_v`, async () => {
    const { legend, error } = await render({})
    expect(error).toBeUndefined()
    expect(legend).toMatch(/Free energy F.*Internal energy U.*Entropy S.*Heat capacity Cv/)
  })

  // thermal_properties throws inside a $derived, which used to take down the whole component
  test.each([
    [{ temperatures: [0, -5] }, /Temperatures must be finite and ≥ 0 K/],
    [{ dos: { ...dos, densities: [0, 1] } }, /3 frequencies but 2 densities/],
  ])(`shows the input error for %j and keeps rendering`, async (props, message) => {
    const { legend, error } = await render(props)
    expect(legend).toBeUndefined()
    expect(error).toMatch(message)
  })
})
