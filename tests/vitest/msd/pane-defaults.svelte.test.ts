import TrajectoryMsdPane from '$lib/msd/TrajectoryMsdPane.svelte'
import type { TrajectoryType } from '$lib/trajectory'
import { mount, tick } from 'svelte'
import { expect, test } from 'vitest'
import { bind_props } from '../setup'
import { make_frame, on_x_axis } from './helpers'

const settle = async (): Promise<void> => {
  for (let round = 0; round < 2; round++) {
    await tick()
    await Promise.resolve()
    await tick()
  }
}

const collect = async (): Promise<void> => {
  const button = document.querySelector<HTMLButtonElement>(`.msd-controls button`)
  if (!button) throw new Error(`no compute button in the MSD pane`)
  button.click()
  for (let round = 0; round < 40; round++) {
    await settle()
    if (!button.disabled) return
  }
  throw new Error(`collect never finished: button still disabled`)
}

const get_input = (selector: string): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`missing MSD pane input: ${selector}`)
  return input
}

test(`waits for a late time unit before enabling the timestep`, async () => {
  const trajectory: TrajectoryType = {
    frames: Array.from({ length: 20 }, (_unused, frame_idx) => {
      const drift = 0.1 * frame_idx
      return make_frame(frame_idx, on_x_axis(drift, 1 + drift))
    }),
  }
  // Both keys must exist at mount so bind_props installs accessors; adding
  // default_time_unit later would never reach the component.
  const defaults: { default_dt: number | null; default_time_unit?: string } = $state({
    default_dt: null,
    default_time_unit: undefined,
  })
  mount(TrajectoryMsdPane, {
    target: document.body,
    props: bind_props({ trajectory, pane_open: true }, defaults),
  })

  defaults.default_dt = 2
  await settle()
  const use_dt_input = get_input(`.msd-controls input[type="checkbox"]`)
  const dt_source_input = get_input(`.msd-controls input[type="number"][step="0.001"]`)
  const time_unit_input = get_input(`input[aria-label="Time unit"]`)
  expect(use_dt_input.checked).toBe(false)
  expect(dt_source_input.valueAsNumber).toBe(1)
  expect(time_unit_input.value).toBe(`ps`)
  expect(time_unit_input.disabled).toBe(true)
  await collect()
  expect(document.body.textContent).toContain(`Å²/frame`)

  defaults.default_time_unit = `fs`
  await settle()
  expect(use_dt_input.checked).toBe(true)
  expect(dt_source_input.valueAsNumber).toBe(2)
  expect(time_unit_input.value).toBe(`fs`)
  expect(time_unit_input.disabled).toBe(false)
  expect(document.body.textContent).toContain(`Å²/fs`)
  expect(document.body.textContent).not.toContain(`Å²/frame`)
})
