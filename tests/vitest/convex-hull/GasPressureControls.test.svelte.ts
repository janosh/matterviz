import GasPressureControls from '$lib/convex-hull/GasPressureControls.svelte'
import TemperatureSlider from '$lib/convex-hull/TemperatureSlider.svelte'
import type { GasSpecies, GasThermodynamicsConfig } from '$lib/convex-hull/types'
import { flushSync, mount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const mount_controls = (
  config: GasThermodynamicsConfig,
  pressures: Partial<Record<GasSpecies, number>> = {},
) => {
  const state = $state({ pressures })
  mount(GasPressureControls, {
    target: document.body,
    props: {
      config,
      temperature: 1000,
      get pressures() {
        return state.pressures
      },
      set pressures(value) {
        state.pressures = value
      },
    },
  })
  return state
}
const slider = (gas: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${gas} partial pressure"]`)
const text_input = (gas: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${gas} pressure (bar)"]`)
const fire = (input: HTMLInputElement | null, type: string, value: string) => {
  if (!input) throw new Error(`missing input`)
  input.value = value
  input.dispatchEvent(new Event(type, { bubbles: true }))
  flushSync()
}

describe(`GasPressureControls`, () => {
  test(`renders nothing without enabled gases`, () => {
    mount_controls({ enabled_gases: [] })
    expect(document.querySelector(`.pressure-controls`)).toBeNull()
  })

  test(`one slider per enabled gas with subscripted formula and formatted default pressure`, () => {
    mount_controls({ enabled_gases: [`O2`, `CO2`, `CO`], pressures: { CO: 1e-6 } })
    expect(document.querySelectorAll(`.pressure-slider`)).toHaveLength(3)
    expect([...document.querySelectorAll(`.gas-name`)].map((name) => name.innerHTML)).toEqual([
      `O<sub>2</sub>`,
      `CO<sub>2</sub>`,
      `CO`,
    ])
    // 0.2095 -> 2 significant digits, 3.95e-4 -> exponential, 1e-6 -> power of ten shorthand
    expect([`O2`, `CO2`, `CO`].map((gas) => text_input(gas)?.value)).toEqual([
      `0.21`,
      `4.0e-4`,
      `1e-6`,
    ])
    // log10 slider position: (log10(P) + 10) / 12 * 100
    expect(Number(slider(`CO`)?.value)).toBeCloseTo(((-6 + 10) / 12) * 100, 10)
    expect(document.querySelector(`.sr-only`)?.textContent).toMatch(
      /O2 chemical potential: [\u2212-]?\d/,
    )
  })

  test(`slider change commits 10^(slider-mapped) pressure and clears the preview`, () => {
    const state = mount_controls({ enabled_gases: [`O2`] })
    // input (drag) previews + throttled commit; change (release) always commits
    fire(slider(`O2`), `input`, `50`) // 10^(-10 + 6) = 1e-4 bar
    expect(state.pressures.O2).toBeCloseTo(1e-4, 12)
    fire(slider(`O2`), `change`, `100`)
    expect(state.pressures.O2).toBeCloseTo(100, 10)
    expect(text_input(`O2`)?.value).toBe(`1e2`)
  })

  test.each([
    [`5`, 5],
    [`1e6`, 100], // clamped to 10^LOG_P_MAX
    [`1e-20`, 1e-10], // clamped to 10^LOG_P_MIN
  ])(`typed pressure %s commits %s bar`, (typed, expected) => {
    const state = mount_controls({ enabled_gases: [`H2`] })
    fire(text_input(`H2`), `change`, typed)
    expect(state.pressures.H2).toBeCloseTo(expected, 12)
  })

  test.each([`abc`, `-1`, `0`])(`invalid typed pressure %s is reverted`, (typed) => {
    const state = mount_controls({ enabled_gases: [`H2`] }, { H2: 0.5 })
    fire(text_input(`H2`), `change`, typed)
    expect(state.pressures).toEqual({ H2: 0.5 })
    expect(text_input(`H2`)?.value).toBe(`0.50`)
  })
})

// TemperatureSlider shares VerticalSlider with the gas controls: its range input runs over
// indices into the tabulated temperatures and drags commit at most every 100 ms
describe(`TemperatureSlider`, () => {
  const available_temperatures = [300, 400, 500, 600, 700, 800, 900]
  const mount_slider = (temperature = 300) => {
    const state = $state({ temperature })
    mount(TemperatureSlider, {
      target: document.body,
      props: {
        available_temperatures,
        get temperature() {
          return state.temperature
        },
        set temperature(value) {
          state.temperature = value
        },
      },
    })
    return state
  }
  const range = () =>
    document.querySelector<HTMLInputElement>(`.temperature-slider input[type="range"]`)
  const readout = () =>
    document.querySelector<HTMLInputElement>(`.temperature-slider input[type="number"]`)
  afterEach(() => vi.useRealTimers())

  test(`slider index maps to the tabulated temperature; drags preview and throttle commits`, () => {
    vi.useFakeTimers({ now: 1000 })
    const state = mount_slider(500)
    expect(range()?.value).toBe(`2`)
    expect(range()?.max).toBe(`6`)
    fire(range(), `input`, `3`) // first drag sample commits
    expect(state.temperature).toBe(600)
    fire(range(), `input`, `5`) // within the throttle window: readout previews, no commit
    expect(state.temperature).toBe(600)
    expect(readout()?.value).toBe(`800`)
    vi.setSystemTime(1200)
    fire(range(), `input`, `4`)
    expect(state.temperature).toBe(700)
    fire(range(), `change`, `6`) // release always commits and drops the preview
    expect(state.temperature).toBe(900)
    expect(readout()?.value).toBe(`900`)
  })

  test(`typed temperature snaps to the closest tabulated value`, () => {
    const state = mount_slider(300)
    fire(readout(), `change`, `640`)
    expect(state.temperature).toBe(600)
    expect(range()?.value).toBe(`3`)
  })
})
