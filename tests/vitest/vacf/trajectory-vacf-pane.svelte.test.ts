import type { TrajectoryType } from '$lib/trajectory'
import TrajectoryVacfPane from '$lib/vacf/TrajectoryVacfPane.svelte'
import { mount, tick } from 'svelte'
import { expect, test } from 'vitest'
import { bind_props, make_crystal } from '../setup'

const settle = async (): Promise<void> => {
  for (let round = 0; round < 3; round++) {
    await tick()
    await Promise.resolve()
    await tick()
  }
}

test(`uses physical time only with complete valid timestep metadata`, async () => {
  const structure = make_crystal(20, [[`H`, [0, 0, 0]]])
  const trajectory: TrajectoryType = {
    frames: Array.from({ length: 4 }, (_unused, step) => ({ step, structure })),
  }
  const defaults: { default_dt: number | null; default_time_unit?: string } = $state({
    default_dt: 2,
    default_time_unit: undefined,
  })
  mount(TrajectoryVacfPane, {
    target: document.body,
    props: bind_props({ trajectory, pane_open: true }, defaults),
  })
  await settle()

  const dt_input = document.querySelector<HTMLInputElement>(
    `.vacf-controls input[type="number"][step="0.001"]`,
  )
  const summary = document.querySelector<HTMLParagraphElement>(`.vacf-controls p.hint`)
  if (!dt_input || !summary) throw new Error(`missing VACF timestep controls`)
  expect(summary.textContent).toContain(`no valid timestep`)
  expect(document.body.textContent).toContain(`1/frame`)

  defaults.default_time_unit = `fs`
  await settle()
  expect(summary.textContent).toContain(`2 fs per collected frame`)

  dt_input.value = ``
  dt_input.dispatchEvent(new Event(`input`))
  await tick()
  expect(summary.textContent).toContain(`no valid timestep`)
  expect(document.body.textContent).toContain(`1/frame`)
})

test.each([
  [`zero timestep`, 0, `fs`],
  [`NaN timestep`, Number.NaN, `fs`],
  [`empty time unit`, 2, ``],
])(`rejects a %s default`, async (_label, default_dt, default_time_unit) => {
  const structure = make_crystal(20, [[`H`, [0, 0, 0]]])
  const trajectory: TrajectoryType = {
    frames: Array.from({ length: 4 }, (_unused, step) => ({ step, structure })),
  }
  mount(TrajectoryVacfPane, {
    target: document.body,
    props: { trajectory, pane_open: true, default_dt, default_time_unit },
  })
  await settle()
  expect(document.body.textContent).toContain(`no valid timestep`)
  expect(document.body.textContent).toContain(`1/frame`)
})
