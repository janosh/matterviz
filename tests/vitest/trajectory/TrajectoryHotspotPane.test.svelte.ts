import { mount, tick, unmount } from 'svelte'
import { afterEach, expect, it, vi } from 'vitest'
import TrajectoryHotspotPane from '$lib/trajectory/TrajectoryHotspotPane.svelte'
import { trajectory_from_frames } from '$lib/trajectory/runs/memory'
import { create_trajectory_frame } from '$lib/trajectory/helpers'
import { calculate_hotspots, type HotspotResult } from '$lib/trajectory/hotspots'
import { set_select } from '../setup'

let mounted: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  document.body.replaceChildren()
})
const make_run = () =>
  trajectory_from_frames(
    [0, 1].map((step) => {
      const frame = create_trajectory_frame(
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        [`Si`, `Si`],
        undefined,
        undefined,
        step,
      )
      for (const site of frame.structure.sites)
        site.properties = { mass: 28, velocity: [1, 0, 0] }
      return frame
    }),
  )
const control = (label: string) => {
  const element = [...document.querySelectorAll(`label`)]
    .find((node) => node.textContent?.startsWith(label))
    ?.querySelector<HTMLInputElement | HTMLSelectElement>(`input, select`)
  if (!element) throw new Error(`Missing control ${label}`)
  return element
}
const set_value = async (label: string, value: string) => {
  const element = control(label)
  if (element instanceof HTMLSelectElement) set_select(element, value)
  else {
    element.value = value
    element.dispatchEvent(new Event(`input`, { bubbles: true }))
  }
  await tick()
}
const calculate_button = () => {
  const button = [...document.querySelectorAll(`button`)].find((node) =>
    node.textContent?.includes(`Calculate hotspots`),
  )
  if (!button) throw new Error(`Missing calculate button`)
  return button
}

it(`requires units, calculates a slice, and keeps display changes independent of analysis`, async () => {
  const run = make_run()
  const compute = vi.spyOn(run, `compute_hotspots`)
  mounted = mount(TrajectoryHotspotPane, {
    target: document.body,
    props: { run, pane_open: true },
  })
  await tick()
  expect(calculate_button().disabled).toBe(true)
  await set_value(`Velocity units`, `A/ps`)
  expect(control(`Velocity units`).value).toBe(`A/ps`)
  expect(calculate_button().disabled).toBe(true)
  await set_value(`Mass units`, `kg`)
  await set_value(`Masses`, `standard`)
  await set_value(`Dimensions`, `2`)
  expect(control(`Degrees of freedom`).value).toBe(`2`)
  expect(calculate_button().disabled).toBe(false)
  calculate_button().click()
  await vi.waitFor(() => expect(document.querySelector(`.hotspot-slice`)).not.toBeNull())
  expect(document.body.textContent).not.toContain(`Settings changed`)
  await set_value(`Minimum average atoms/bin`, `-1`)
  await set_value(`Hotspot threshold`, `2`)
  expect(compute).toHaveBeenCalledTimes(1)
  expect(compute.mock.calls[0][0]).toMatchObject({
    mass_source: `standard`,
    mass_unit: `amu`,
    dimensions: 2,
    dof_per_atom: 2,
  })
  expect(document.querySelector(`.hotspot-slice`)).not.toBeNull()
  expect(document.body.textContent).not.toContain(`Settings changed`)
  await set_value(`Grid resolution`, `2`)
  expect(document.body.textContent).toContain(`Settings changed`)
  await set_value(`Grid resolution`, `0`)
  expect(document.body.textContent).not.toContain(`Settings changed`)
})

it(`aborts an old computation when the source changes`, async () => {
  const old_run = make_run()
  let signal: AbortSignal | undefined
  const pending = Promise.withResolvers<HotspotResult>()
  old_run.compute_hotspots = (options) => {
    signal = options.signal
    return pending.promise
  }
  const props = $state({ run: old_run, pane_open: true })
  mounted = mount(TrajectoryHotspotPane, { target: document.body, props })
  await tick()
  await set_value(`Velocity units`, `A/ps`)
  await set_value(`Mass units`, `kg`)
  await set_value(`Dimensions`, `2`)
  calculate_button().click()
  await tick()
  const next = make_run()
  props.run = next
  await tick()
  expect(signal?.aborted).toBe(true)
  expect(control(`Mass units`).value).toBe(``)
  expect(control(`Dimensions`).value).toBe(`3`)
  expect(control(`Degrees of freedom`).value).toBe(`3`)
  expect(calculate_button().disabled).toBe(true)
  if (!next.read_atoms) throw new Error(`Missing atom reader`)
  pending.resolve(
    await calculate_hotspots(next.frame_count, next.read_atoms, {
      velocity_unit: `A/ps`,
      mass_unit: `amu`,
    }),
  )
  await tick()
  expect(document.querySelector(`.hotspot-slice`)).toBeNull()
})
