import ChemPotDiagram2D from '$lib/chempot-diagram/ChemPotDiagram2D.svelte'
import ChemPotDiagram3D from '$lib/chempot-diagram/ChemPotDiagram3D.svelte'
import type { PhaseData } from '$lib/convex-hull/types'
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const binary_temp_entries: PhaseData[] = [
  {
    composition: { Li: 1 },
    energy: -1,
    energy_per_atom: -1,
    temperatures: [300, 900],
    free_energies: [-1.2, -0.8],
  },
  {
    composition: { O: 1 },
    energy: -2,
    energy_per_atom: -2,
    temperatures: [700],
    free_energies: [-2.0],
  },
  {
    composition: { Li: 1, O: 1 },
    energy: -3.2,
    energy_per_atom: -1.6,
    temperatures: [700],
    free_energies: [-1.7],
  },
]

const ternary_temp_entries: PhaseData[] = [
  {
    composition: { Fe: 1 },
    energy: -6.7,
    energy_per_atom: -6.7,
    temperatures: [700],
    free_energies: [-6.7],
  },
  {
    composition: { Li: 1 },
    energy: -1.9,
    energy_per_atom: -1.9,
    temperatures: [300, 900],
    free_energies: [-2.1, -1.7],
  },
  {
    composition: { O: 1 },
    energy: -8.0,
    energy_per_atom: -8.0,
    temperatures: [700],
    free_energies: [-8.0],
  },
]

const base_config = { default_min_limit: -20, formal_chempots: false }
const mounted_components: ReturnType<typeof mount>[] = []

afterEach(() => {
  for (const mounted_component of mounted_components.splice(0)) {
    unmount(mounted_component)
  }
  vi.restoreAllMocks()
})

async function mount_2d_with_config(
  config: {
    interpolate_temperature: boolean
    max_interpolation_gap: number
  },
): Promise<void> {
  const { interpolate_temperature, max_interpolation_gap } = config
  const mounted_component = mount(ChemPotDiagram2D, {
    target: document.body,
    props: {
      entries: binary_temp_entries,
      temperature: 700,
      config: base_config,
      interpolate_temperature,
      max_interpolation_gap,
    },
  })
  mounted_components.push(mounted_component)
  await tick()
}

describe(`ChemPot temperature config wiring`, () => {
  test(`2D hides temperature slider for datasets without temperature data`, async () => {
    const mounted_component = mount(ChemPotDiagram2D, {
      target: document.body,
      props: {
        entries: [{ composition: { Li: 1 }, energy: -1, energy_per_atom: -1 }],
        config: base_config,
      },
    })
    mounted_components.push(mounted_component)
    await tick()
    expect(document.querySelector(`.temperature-slider`)).toBeFalsy()
  })

  test.each([
    {
      label: `2D honors interpolate_temperature override`,
      config: { interpolate_temperature: false, max_interpolation_gap: 700 },
    },
    {
      label: `2D honors max_interpolation_gap override`,
      config: { interpolate_temperature: true, max_interpolation_gap: 500 },
    },
  ])(`$label`, async ({ config }) => {
    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    await mount_2d_with_config(config)
    expect(document.querySelector(`.error-state`)).toBeTruthy()
    expect(document.querySelector(`.temperature-slider`)).toBeFalsy()
  })

  test(`2D computes successfully with permissive interpolation config`, async () => {
    await mount_2d_with_config({
      interpolate_temperature: true,
      max_interpolation_gap: 700,
    })
    expect(document.querySelector(`.error-state`)).toBeFalsy()
    expect(document.querySelector(`.temperature-slider`)).toBeTruthy()
  })

  test(`3D honors interpolate_temperature override`, async () => {
    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    const interpolate_temperature = false
    const max_interpolation_gap = 700
    const mounted_component = mount(ChemPotDiagram3D, {
      target: document.body,
      props: {
        entries: ternary_temp_entries,
        temperature: 700,
        config: base_config,
        interpolate_temperature,
        max_interpolation_gap,
      },
    })
    mounted_components.push(mounted_component)
    await tick()
    expect(document.querySelector(`.error-state`)).toBeTruthy()
    expect(document.querySelector(`.temperature-slider`)).toBeTruthy()
  })
})
