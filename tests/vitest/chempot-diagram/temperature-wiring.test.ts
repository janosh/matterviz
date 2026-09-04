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

// Fe, Li, O carry 300 K data; P only 700 K, so the 300 K slice drops it
const quaternary_temp_entries: PhaseData[] = [
  ...[
    [`Fe`, -6.7],
    [`Li`, -1.9],
    [`O`, -8.0],
  ].map(([element, energy]) => ({
    composition: { [String(element)]: 1 },
    energy: Number(energy),
    energy_per_atom: Number(energy),
    temperatures: [300, 900],
    free_energies: [Number(energy) - 0.2, Number(energy) + 0.2],
  })),
  {
    composition: { Li: 1, Fe: 1, O: 2 },
    energy: -24,
    energy_per_atom: -6,
    temperatures: [300, 900],
    free_energies: [-6.3, -5.7],
  },
  {
    composition: { P: 1 },
    energy: -5.4,
    energy_per_atom: -5.4,
    temperatures: [700],
    free_energies: [-5.4],
  },
]

const base_config = { default_min_limit: -20, formal_chempots: false }
const mounted_components: ReturnType<typeof mount>[] = []

afterEach(() => {
  for (const mounted_component of mounted_components.splice(0)) {
    void unmount(mounted_component)
  }
  vi.restoreAllMocks()
})

// Computation runs through the (async) worker client: flush the effect that starts it (the
// first tick swaps the initial empty state for the spinner), then wait for the spinner to
// settle into either the plot or the error state instead of counting microtask hops
const settled = async () => {
  await tick()
  await vi.waitFor(() => expect(document.querySelector(`.spinner`)).toBeNull())
}

async function mount_2d_with_config(config: {
  interpolate_temperature: boolean
  max_interpolation_gap: number
}): Promise<void> {
  const mounted_component = mount(ChemPotDiagram2D, {
    target: document.body,
    props: {
      entries: binary_temp_entries,
      temperature: 700,
      config: { ...base_config, ...config },
    },
  })
  mounted_components.push(mounted_component)
  await settled()
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
    expect(document.querySelector(`.temperature-slider`)).toBeNull()
  })

  // Li only has free energies at 300 K and 900 K; at 700 K it survives only by interpolation
  // across a 600 K gap. Dropping it leaves O + LiO without an elemental Li reference.
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
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => undefined)
    await mount_2d_with_config(config)
    expect(document.querySelector(`.error-state`)).toBeInstanceOf(HTMLElement)
    expect(document.querySelector(`.temperature-slider`)).toBeNull()
    expect(error_spy).toHaveBeenCalledWith(
      `ChemPotDiagram2D:`,
      expect.objectContaining({ message: `Missing elemental reference entries for: Li` }),
    )
  })

  test(`2D computes successfully with permissive interpolation config`, async () => {
    await mount_2d_with_config({
      interpolate_temperature: true,
      max_interpolation_gap: 700,
    })
    expect(document.querySelector(`.error-state`)).toBeNull()
    expect(document.querySelector(`.temperature-slider`)).toBeInstanceOf(HTMLElement)
    expect(
      document.querySelector<HTMLInputElement>(`.temperature-slider input[type="range"]`)
        ?.value,
    ).toBe(`700`)
  })

  test(`3D honors interpolate_temperature override`, async () => {
    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    const mounted_component = mount(ChemPotDiagram3D, {
      target: document.body,
      props: {
        entries: ternary_temp_entries,
        temperature: 700,
        config: { ...base_config, interpolate_temperature: false, max_interpolation_gap: 700 },
      },
    })
    mounted_components.push(mounted_component)
    await settled()
    // Fe + O alone are below the 3-entry minimum for a 3D diagram; the slider stays since
    // the dataset still has temperature data to pick from
    expect(document.querySelector(`.error-state`)).toBeInstanceOf(HTMLElement)
    expect(document.querySelector(`.temperature-slider`)).toBeInstanceOf(HTMLElement)
    expect(
      document.querySelector<HTMLInputElement>(`.temperature-slider input[type="range"]`)
        ?.value,
    ).toBe(`1`)
  })

  test(`3D projection axes list every element of the system, not just the temperature slice`, async () => {
    const mounted_component = mount(ChemPotDiagram3D, {
      target: document.body,
      props: {
        entries: quaternary_temp_entries,
        temperature: 300,
        config: { ...base_config, interpolate_temperature: false },
      },
    })
    mounted_components.push(mounted_component)
    await settled()
    expect(document.querySelector(`.error-state`)).toBeNull()
    const options = [...document.querySelectorAll(`#chempot-proj-x option`)].map(
      (option) => option.textContent,
    )
    expect(options).toEqual([`Fe`, `Li`, `O`, `P`])
  })
})
