import TrajectoryMsdPane from '$lib/msd/TrajectoryMsdPane.svelte'
import type { TrajectoryType } from '$lib/trajectory'
import { mount, tick, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import { bind_props, doc_query } from '../setup'
import { make_frame, on_x_axis } from './helpers'

let mounted_pane: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted_pane) await unmount(mounted_pane)
  mounted_pane = undefined
})

const settle = async (): Promise<void> => {
  for (let round = 0; round < 2; round++) {
    await tick()
    await Promise.resolve()
    await tick()
  }
}

const collect = async (): Promise<void> => {
  const button = doc_query(`.msd-controls button`, HTMLButtonElement)
  button.click()
  for (let round = 0; round < 40; round++) {
    await settle()
    if (!button.disabled) return
  }
  throw new Error(`collect never finished: button still disabled`)
}

const pane_inputs = () => ({
  use_dt_input: doc_query(`.msd-controls input[type="checkbox"]`, HTMLInputElement),
  dt_source_input: doc_query(
    `.msd-controls input[type="number"][step="0.001"]`,
    HTMLInputElement,
  ),
  time_unit_input: doc_query(`input[aria-label="Time unit"]`, HTMLInputElement),
})

test(`waits for a late time unit before enabling the timestep`, async () => {
  const trajectory: TrajectoryType = {
    frames: Array.from({ length: 20 }, (_unused, frame_idx) => {
      const drift = 0.1 * frame_idx
      return make_frame(frame_idx, on_x_axis(drift, 1 + drift))
    }),
  }
  // Both keys must exist at mount so bind_props installs accessors; adding
  // default_time_unit later would never reach the component.
  const defaults: {
    default_dt: number | null
    default_time_unit?: string
    pane_props: { style: string }
  } = $state({
    default_dt: null,
    default_time_unit: undefined,
    pane_props: { style: `max-height: 30em` },
  })
  mounted_pane = mount(TrajectoryMsdPane, {
    target: document.body,
    props: bind_props({ trajectory, pane_open: true }, defaults),
  })

  defaults.default_dt = 2
  await settle()
  const { use_dt_input, dt_source_input, time_unit_input } = pane_inputs()
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

  dt_source_input.value = `3`
  dt_source_input.dispatchEvent(new Event(`input`))
  defaults.pane_props = { style: `max-height: 20em` }
  await settle()
  expect(dt_source_input.valueAsNumber).toBe(3)

  dt_source_input.value = ``
  dt_source_input.dispatchEvent(new Event(`input`))
  await settle()
  expect(document.body.textContent).toContain(`lag axis in frames`)
  await collect()
  expect(document.body.textContent).toContain(`Å²/frame`)
})

test.each([
  [`undefined timestep`, undefined, `fs`],
  [`zero timestep`, 0, `fs`],
  [`negative timestep`, -1, `fs`],
  [`NaN timestep`, NaN, `fs`],
  [`infinite timestep`, Infinity, `fs`],
  [`empty time unit`, 2, ``],
])(`rejects a %s default`, async (_label, default_dt, default_time_unit) => {
  mounted_pane = mount(TrajectoryMsdPane, {
    target: document.body,
    props: {
      trajectory: { frames: [make_frame(0, on_x_axis(0, 1))] },
      pane_open: true,
      default_dt,
      default_time_unit,
    },
  })
  await settle()

  const { use_dt_input, dt_source_input, time_unit_input } = pane_inputs()
  expect(use_dt_input.checked).toBe(false)
  expect(dt_source_input.valueAsNumber).toBe(1)
  expect(time_unit_input.value).toBe(`ps`)
})
