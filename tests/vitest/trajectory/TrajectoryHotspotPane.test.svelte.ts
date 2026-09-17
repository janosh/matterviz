import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { afterEach, expect, it, vi } from 'vitest'
import TrajectoryHotspotPane from '$lib/trajectory/TrajectoryHotspotPane.svelte'
import { trajectory_from_frames, type MemoryRunExtras } from '$lib/trajectory/runs/memory'
import { create_trajectory_frame } from '$lib/trajectory/helpers'
import type { HotspotRequest, HotspotResult } from '$lib/trajectory/hotspots'
import { doc_query, form_controls } from '../setup'

let mounted: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (mounted) await unmount(mounted)
  mounted = undefined
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
const mount_pane = async (props: ComponentProps<typeof TrajectoryHotspotPane>) => {
  mounted = mount(TrajectoryHotspotPane, { target: document.body, props })
  await tick()
}
const make_run = (extras: MemoryRunExtras = {}) =>
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
    extras,
  )
const calculate_run = (run: ReturnType<typeof make_run>, options: HotspotRequest = {}) => {
  if (!run.compute_hotspots) throw new Error(`Missing hotspot calculation`)
  return run.compute_hotspots({
    velocity_unit: `A/ps`,
    mass_unit: `amu`,
    ...options,
  })
}
const { control, set_value } = form_controls()
const map_status = () => document.querySelector(`.hotspot-map-status`)?.textContent
const calculate_button = () => {
  const button = [...document.querySelectorAll(`button`)].find((node) =>
    node.textContent?.includes(`Calculate hotspots`),
  )
  if (!button) throw new Error(`Missing calculate button`)
  return button
}
const expect_requirements = (message?: string) => {
  const button = calculate_button()
  expect(button.disabled).toBe(Boolean(message))
  const described_by = button.getAttribute(`aria-describedby`)
  expect(
    described_by ? document.querySelector(`[id="${described_by}"]`)?.textContent : undefined,
  ).toBe(message)
}

it(`requires units, calculates a map, and keeps display changes independent of analysis`, async () => {
  const run = make_run()
  const compute = vi.spyOn(run, `compute_hotspots`)
  const props = $state({ run, pane_open: true, show_heatmap: true })
  await mount_pane(props)
  expect(getComputedStyle(doc_query(`h3`)).marginTop).toBe(`0px`)
  expect_requirements(`Select velocity units.`)
  expect(control(`Mass units`).value).toBe(`amu`)
  expect(document.body.textContent).toContain(`Inferred from recorded masses`)
  await set_value(`Velocity units`, `A/ps`)
  expect(control(`Velocity units`).value).toBe(`A/ps`)
  expect_requirements()
  await set_value(`Mass units`, ``)
  expect_requirements(
    `Select mass units for recorded masses, or choose standard elemental masses.`,
  )
  await set_value(`Mass units`, `kg`)
  expect_requirements()
  await set_value(`Velocity property`, ` `)
  expect_requirements(`Enter the velocity property.`)
  await set_value(`Velocity property`, `velocity`)
  await set_value(`Mass units`, ``)
  await set_value(`Masses`, `standard`)
  await set_value(`Dimensions`, `2`)
  expect(control(`Degrees of freedom`).value).toBe(`2`)
  expect_requirements()
  compute.mockRejectedValueOnce(new Error(`Missing velocity at frame 0`))
  calculate_button().click()
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(`Missing velocity at frame 0`),
  )
  expect(calculate_button().disabled).toBe(false)
  calculate_button().click()
  await vi.waitFor(() => expect(document.querySelector(`.hotspot-map-status`)).not.toBeNull())
  expect(document.body.textContent).not.toContain(`Missing velocity at frame 0`)
  expect(document.body.textContent).not.toContain(`Settings changed`)
  await set_value(`Minimum average atoms/bin`, `-1`)
  await set_value(`Hotspot threshold`, `2`)
  const heatmap_toggle = control(`Heatmap on atoms`)
  heatmap_toggle.click()
  await tick()
  expect(props.show_heatmap).toBe(false)
  heatmap_toggle.click()
  await tick()
  expect(props.show_heatmap).toBe(true)
  const cloud_toggle = control(`Volume cloud`)
  expect(cloud_toggle).toBeInstanceOf(HTMLInputElement)
  cloud_toggle.click()
  await tick()
  for (const [label, initial, value] of [
    [`Cloud opacity`, `0.8`, `0.6`],
    [`Atom opacity`, `0.5`, `0.25`],
  ]) {
    expect(control(label).value).toBe(initial)
    await set_value(label, value)
    expect(control(label).value).toBe(value)
  }
  for (const [label, value] of [
    [`Cloud base color`, `#ff00ff`],
    [`Hotspot color`, `#00ffff`],
  ]) {
    const hex = doc_query<HTMLInputElement>(`[aria-label="${label} hex"]`)
    hex.value = value
    hex.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect(doc_query<HTMLInputElement>(`[aria-label="${label}"]`).value).toBe(value)
  }
  expect(compute).toHaveBeenCalledTimes(2)
  expect(compute.mock.calls[0][0]).toMatchObject({
    mass_source: `standard`,
    mass_unit: `amu`,
    dimensions: 2,
    dof_per_atom: 2,
  })
  expect(document.querySelector(`.hotspot-map-status`)).not.toBeNull()
  expect(document.body.textContent).not.toContain(`Settings changed`)
  await set_value(`Grid resolution`, `2`)
  expect(document.body.textContent).toContain(`Settings changed`)
  await set_value(`Grid resolution`, `0`)
  expect(document.body.textContent).not.toContain(`Settings changed`)
  await set_value(`Start frame`, `1`)
  await set_value(`End frame`, `2`)
  await set_value(`Frame stride`, `2`)
  calculate_button().click()
  expect(compute.mock.lastCall?.[0]).toMatchObject({
    start_frame: 1,
    end_frame: 2,
    frame_stride: 2,
  })
})

it.each([`signal`, `metadata`])(
  `uses units from %s immediately and keeps the mass-unit override editable`,
  async (source) => {
    const run = make_run({
      atom_masses: [28, 28].map((mass) => mass * 1.66053906892e-27),
      metadata: { mass_unit: `kg`, ...(source === `metadata` && { velocity_unit: `A/ps` }) },
      signals:
        source === `signal`
          ? {
              velocity: {
                unit: `A/ps`,
                sample_shape: [2, 3],
                steps: [0, 1],
                values: new Float64Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]),
              },
            }
          : undefined,
    })
    const compute = vi.spyOn(run, `compute_hotspots`)
    await mount_pane({ run, pane_open: true })
    expect(control(`Mass units`).value).toBe(`kg`)
    expect(calculate_button().disabled).toBe(false)
    calculate_button().click()
    await vi.waitFor(() => expect(map_status()).toContain(`Time average · 2 frames`))
    expect(compute.mock.calls[0][0]).toMatchObject({ mass_unit: `kg`, velocity_unit: `A/ps` })
    await set_value(`Mass units`, `amu`)
    expect(control(`Mass units`).value).toBe(`amu`)
    expect(document.body.textContent).toContain(`Settings changed`)
  },
)

it(`explains all missing recorded-energy settings and clears them as they are supplied`, async () => {
  await mount_pane({ run: make_run(), pane_open: true })
  await set_value(`Source`, `energy`)
  await set_value(`Energy property`, ` `)
  expect_requirements(
    `Enter the energy property. Select energy units. Describe the stored energy reference.`,
  )
  await set_value(`Energy property`, `kinetic_energy`)
  await set_value(`Energy units`, `eV`)
  expect_requirements(`Describe the stored energy reference.`)
  await set_value(`Stored energy reference`, `device frame`)
  expect_requirements()
  expect(document.querySelector(`[role="status"]`)).toBeNull()
})

it(`shows the selected-frame preview and partial average before completion, retaining coverage on cancel`, async () => {
  const run = make_run()
  const preview = await calculate_run(run, { start_frame: 1, end_frame: 2 })
  const partial = { ...preview, first_step: 0, last_step: 0 }
  let request: HotspotRequest | undefined
  let pending = Promise.withResolvers<HotspotResult>()
  run.compute_hotspots = (options) => {
    request = options
    return pending.promise
  }
  await mount_pane({ run, current_frame_idx: 1, pane_open: true })
  await set_value(`Velocity units`, `A/ps`)
  await set_value(`Mass units`, `amu`)
  calculate_button().click()
  expect(request?.preview_frame).toBe(1)
  await request?.on_preview?.(preview)
  await tick()
  expect(map_status()).toContain(`Frame 1 preview`)
  expect(document.body.textContent).not.toContain(`Settings changed`)
  request?.on_progress?.({
    current: 1.5,
    completed: 1,
    total: 2,
    stage: `Binning kinetic energy`,
  })
  await set_value(`Grid resolution`, `2`)
  await request?.on_partial?.(partial)
  await tick()
  expect(document.body.textContent).toContain(`Settings changed`)
  await set_value(`Grid resolution`, `0`)
  expect(document.body.textContent).not.toContain(`Settings changed`)
  expect(map_status()).toContain(`Incomplete time average · 1/2 frames`)
  const cancel = [...document.querySelectorAll(`button`)].find(
    (button) => button.textContent === `Cancel`,
  )
  const actions = doc_query(`.hotspot-actions`)
  expect(cancel?.parentElement).toBe(actions)
  expect(document.querySelector(`.hotspot-progress`)?.parentElement).toBe(actions)
  expect(getComputedStyle(actions).display).toBe(`flex`)
  cancel?.click()
  await tick()
  expect(request?.signal?.aborted).toBe(true)
  expect(document.querySelector(`.hotspot-progress`)).toBeNull()
  const cancelled_request = request
  const cancelled_result = pending
  pending = Promise.withResolvers<HotspotResult>()
  calculate_button().click()
  await cancelled_request?.on_preview?.(preview)
  cancelled_result.resolve({ ...partial, frames: 2 })
  await cancelled_result.promise
  await tick()
  expect(document.body.textContent).toContain(`Calculating hotspots…`)
  expect(map_status()).toContain(`Incomplete time average · 1/2 frames`)
  pending.resolve({ ...partial, frames: 2 })
  await pending.promise
  await tick()
  expect(document.querySelector(`.hotspot-progress`)).toBeNull()
  expect(map_status()).toContain(`Time average · 2 frames`)
})

it(`aborts an old computation when the source changes`, async () => {
  const old_run = make_run()
  let signal: AbortSignal | undefined
  let on_progress: HotspotRequest[`on_progress`]
  const clock = vi.spyOn(performance, `now`).mockReturnValue(1000)
  const pending = Promise.withResolvers<HotspotResult>()
  old_run.compute_hotspots = (options) => {
    signal = options.signal
    on_progress = options.on_progress
    return pending.promise
  }
  const props = $state({ run: old_run, pane_open: true })
  await mount_pane(props)
  await set_value(`Velocity units`, `A/ps`)
  await set_value(`Mass units`, `kg`)
  await set_value(`Dimensions`, `2`)
  calculate_button().click()
  await tick()
  expect(document.body.textContent).toContain(`Calculating hotspots…`)
  const progress = () => document.querySelector(`.hotspot-progress`)?.textContent
  expect(progress()).toContain(`0.0% · ETA estimating…`)
  for (const [now, current, expected] of [
    [16_000, 1, `25.0% · ETA 45s`],
    [121_000, 2, `50.0% · ETA 2m 0s`],
    [121_000, 4, `100.0% · ETA 0s`],
  ] as const) {
    clock.mockReturnValue(now)
    on_progress?.({ current, completed: current, total: 4, stage: `Binning kinetic energy` })
    await tick()
    expect(progress()).toContain(expected)
  }
  clock.mockRestore()
  const next = make_run()
  props.run = next
  await tick()
  expect(signal?.aborted).toBe(true)
  on_progress?.({ current: 1, completed: 1, total: 4, stage: `Binning kinetic energy` })
  await tick()
  expect(progress()).toBeUndefined()
  expect(control(`Mass units`).value).toBe(`amu`)
  expect(control(`Dimensions`).value).toBe(`3`)
  expect(control(`Degrees of freedom`).value).toBe(`3`)
  expect(calculate_button().disabled).toBe(true)
  pending.resolve(await calculate_run(next))
  await tick()
  expect(document.querySelector(`.hotspot-map-status`)).toBeNull()
})
