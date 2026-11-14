import ChemPotDiagram2D from '#lib/chempot-diagram/ChemPotDiagram2D.svelte'
import ChemPotDiagram3D from '#lib/chempot-diagram/ChemPotDiagram3D.svelte'
import type { PhaseData } from '#lib/convex-hull/types.js'
import { type Component, type ComponentProps, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { bind_props, click_export, doc_query } from '../setup'
import { make_phase } from '../test-fixtures'

// Entry with tabulated free energies
const temp_phase = (
  composition: Record<string, number>,
  energy_per_atom: number,
  temperatures: number[],
  free_energies: number[],
): PhaseData => make_phase(composition, energy_per_atom, { temperatures, free_energies })

const binary_temp_entries = [
  temp_phase({ Li: 1 }, -1, [300, 900], [-1.2, -0.8]),
  temp_phase({ O: 1 }, -2, [700], [-2]),
  temp_phase({ Li: 1, O: 1 }, -1.6, [700], [-1.7]),
]
const ternary_temp_entries = [
  temp_phase({ Fe: 1 }, -6.7, [700], [-6.7]),
  temp_phase({ Li: 1 }, -1.9, [300, 900], [-2.1, -1.7]),
  temp_phase({ O: 1 }, -8, [700], [-8]),
]
// Fe, Li, O carry 300 K data; P only 700 K, so the 300 K slice drops it
const quaternary_temp_entries = [
  ...Object.entries({ Fe: -6.7, Li: -1.9, O: -8 }).map(([element, energy]) =>
    temp_phase({ [element]: 1 }, energy, [300, 900], [energy - 0.2, energy + 0.2]),
  ),
  temp_phase({ Li: 1, Fe: 1, O: 2 }, -6, [300, 900], [-6.3, -5.7]),
  temp_phase({ P: 1 }, -5.4, [700], [-5.4]),
]

const base_config = { default_min_limit: -20, formal_chempots: false }
const mounted_components: ReturnType<typeof mount>[] = []

afterEach(() => {
  for (const mounted_component of mounted_components.splice(0)) void unmount(mounted_component)
  vi.restoreAllMocks()
})

// Computation runs through the (async) worker client: flush the effect that starts it (the
// first tick swaps the initial empty state for the spinner), then wait for the spinner to
// settle into either the plot or the error state instead of counting microtask hops
const mount_settled = async (
  component: Component<ComponentProps<typeof ChemPotDiagram2D>>,
  props: ComponentProps<typeof ChemPotDiagram2D>,
): Promise<void> => {
  mounted_components.push(mount(component, { target: document.body, props }))
  await tick()
  await vi.waitFor(() => expect(document.querySelector(`.spinner`)).toBeNull())
}
const mount_2d_with_config = (config: {
  interpolate_temperature: boolean
  max_interpolation_gap: number
}) =>
  mount_settled(ChemPotDiagram2D, {
    entries: binary_temp_entries,
    temperature: 700,
    config: { ...base_config, ...config },
  })
const slider_value = () =>
  document.querySelector<HTMLInputElement>(`.temperature-slider input[type="range"]`)?.value
// The slider overlays the scene; left in flow it took ~170px of the viewer's fixed height and
// pushed the canvas into the content below
const expect_overlay_slider = () =>
  expect(getComputedStyle(doc_query(`.temperature-slider`)).position).toBe(`absolute`)

describe(`ChemPot temperature config wiring`, () => {
  test(`2D hides temperature slider for datasets without temperature data`, async () => {
    mounted_components.push(
      mount(ChemPotDiagram2D, {
        target: document.body,
        props: { entries: [{ composition: { Li: 1 }, energy: -1 }], config: base_config },
      }),
    )
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
    expect(document.querySelector(`.empty-state`)).toBeInstanceOf(HTMLElement)
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
    expect(document.querySelector(`.empty-state`)).toBeNull()
    // one export entry point: the plot's own pane, with the domains added as JSON
    expect(document.querySelectorAll(`button.export-toggle`)).toHaveLength(1)
    expect(await click_export(null)).toEqual([`PNG`, `SVG`, `CSV`, `JSON`])
    expect_overlay_slider()
    expect(slider_value()).toBe(`700`)
  })

  // Without interpolation an untabulated T snaps to the nearest tabulated one (lower on
  // ties); with it only out-of-range T snap
  test.each([
    [false, 500, 600],
    [false, 450, 300],
    [true, 500, 500],
    [true, 1200, 900],
  ])(`interpolate_temperature=%s snaps T=%s to %s`, async (interpolate, temperature, want) => {
    const temps = [300, 600, 900]
    const entries = [
      temp_phase({ Li: 1 }, -1, temps, [-1.2, -1, -0.8]),
      temp_phase({ O: 1 }, -2, temps, [-2.2, -2, -1.8]),
      temp_phase({ Li: 1, O: 1 }, -1.6, temps, [-1.8, -1.6, -1.4]),
    ]
    const state = { temperature }
    const config = { ...base_config, interpolate_temperature: interpolate }
    await mount_settled(ChemPotDiagram2D, bind_props({ entries, config }, state))
    expect(state.temperature).toBe(want)
  })

  test(`3D honors interpolate_temperature override`, async () => {
    vi.spyOn(console, `error`).mockImplementation(() => undefined)
    await mount_settled(ChemPotDiagram3D, {
      entries: ternary_temp_entries,
      temperature: 700,
      config: { ...base_config, interpolate_temperature: false, max_interpolation_gap: 700 },
    })
    // Fe + O alone are below the 3-entry minimum for a 3D diagram; the slider stays since
    // the dataset still has temperature data to pick from
    expect(document.querySelector(`.empty-state`)).toBeInstanceOf(HTMLElement)
    expect_overlay_slider()
    expect(slider_value()).toBe(`1`)
  })

  test(`3D projection axes list every element of the system, not just the temperature slice`, async () => {
    await mount_settled(ChemPotDiagram3D, {
      entries: quaternary_temp_entries,
      temperature: 300,
      config: { ...base_config, interpolate_temperature: false },
    })
    expect(document.querySelector(`.empty-state`)).toBeNull()
    document.querySelector<HTMLButtonElement>(`.chempot-controls-toggle`)?.click()
    await tick()
    const options = [...document.querySelectorAll(`#chempot-proj-x option`)].map(
      (option) => option.textContent,
    )
    expect(options).toEqual([`Fe`, `Li`, `O`, `P`])
  })
})
