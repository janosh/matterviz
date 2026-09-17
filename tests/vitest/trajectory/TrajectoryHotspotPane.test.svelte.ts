import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { afterEach, expect, it, vi } from 'vitest'
import TrajectoryHotspotPane from '$lib/trajectory/TrajectoryHotspotPane.svelte'
import { trajectory_from_frames, type MemoryRunExtras } from '$lib/trajectory/runs/memory'
import { create_trajectory_frame } from '$lib/trajectory/helpers'
import {
  calculate_hotspots,
  type HotspotRequest,
  type HotspotResult,
} from '$lib/trajectory/hotspots'
import { doc_query, set_select } from '../setup'

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
const control = (label: string) => {
  const element = [...document.querySelectorAll(`label`)]
    .find((node) => node.textContent?.trim().startsWith(label))
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
  const props = $state({ run, pane_open: true, show_heatmap: true })
  await mount_pane(props)
  expect(getComputedStyle(doc_query(`h3`)).marginTop).toBe(`0px`)
  expect(calculate_button().disabled).toBe(true)
  const requirements = () =>
    document.querySelector(`[id="${calculate_button().getAttribute(`aria-describedby`)}"]`)
      ?.textContent
  expect(requirements()).toContain(`Select velocity units.`)
  expect(control(`Mass units`).value).toBe(`amu`)
  expect(document.body.textContent).toContain(`Inferred from recorded masses`)
  await set_value(`Velocity units`, `A/ps`)
  expect(control(`Velocity units`).value).toBe(`A/ps`)
  expect(calculate_button().disabled).toBe(false)
  expect(requirements()).toBeUndefined()
  await set_value(`Mass units`, ``)
  expect(calculate_button().disabled).toBe(true)
  expect(requirements()).not.toContain(`velocity`)
  expect(requirements()).toContain(`Select mass units for recorded masses`)
  await set_value(`Mass units`, `kg`)
  expect(calculate_button().disabled).toBe(false)
  expect(requirements()).toBeUndefined()
  await set_value(`Velocity property`, ` `)
  expect(calculate_button().disabled).toBe(true)
  expect(requirements()).toBe(`Enter the velocity property.`)
  await set_value(`Velocity property`, `velocity`)
  await set_value(`Mass units`, ``)
  await set_value(`Masses`, `standard`)
  await set_value(`Dimensions`, `2`)
  expect(control(`Degrees of freedom`).value).toBe(`2`)
  expect(calculate_button().disabled).toBe(false)
  expect(requirements()).toBeUndefined()
  compute.mockRejectedValueOnce(new Error(`Missing velocity at frame 0`))
  calculate_button().click()
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain(`Missing velocity at frame 0`),
  )
  expect(calculate_button().disabled).toBe(false)
  calculate_button().click()
  await vi.waitFor(() => expect(document.querySelector(`.hotspot-slice`)).not.toBeNull())
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
  await set_value(`Cloud opacity`, `0.6`)
  const hot_color = doc_query<HTMLInputElement>(`[aria-label="Hotspot color hex"]`)
  hot_color.value = `#00ffff`
  hot_color.dispatchEvent(new Event(`input`, { bubbles: true }))
  await tick()
  expect(control(`Cloud opacity`).value).toBe(`0.6`)
  expect(document.querySelector<HTMLInputElement>(`[aria-label="Hotspot color"]`)?.value).toBe(
    `#00ffff`,
  )
  expect(compute).toHaveBeenCalledTimes(2)
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
    await vi.waitFor(() =>
      expect(document.querySelector(`.hotspot-map-status`)?.textContent).toContain(
        `Time average · 2 frames`,
      ),
    )
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
  const requirements = () => document.querySelector(`[role="status"]`)?.textContent
  expect(calculate_button().disabled).toBe(true)
  expect(requirements()).toBe(
    `Enter the energy property. Select energy units. Describe the stored energy reference.`,
  )
  await set_value(`Energy property`, `kinetic_energy`)
  await set_value(`Energy units`, `eV`)
  expect(calculate_button().disabled).toBe(true)
  expect(requirements()).toBe(`Describe the stored energy reference.`)
  await set_value(`Stored energy reference`, `device frame`)
  expect(calculate_button().disabled).toBe(false)
  expect(requirements()).toBeUndefined()
})

it(`shows the selected-frame preview and partial average before completion, retaining coverage on cancel`, async () => {
  const run = make_run()
  if (!run.read_atoms) throw new Error(`Missing atom reader`)
  const preview = await calculate_hotspots(2, run.read_atoms, {
    start_frame: 1,
    end_frame: 2,
    velocity_unit: `A/ps`,
    mass_unit: `amu`,
  })
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
  expect(document.querySelector(`.hotspot-map-status`)?.textContent).toContain(
    `Frame 1 preview`,
  )
  expect(document.querySelector(`.hotspot-slice`)).not.toBeNull()
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
  expect(document.querySelector(`.hotspot-map-status`)?.textContent).toContain(
    `Incomplete time average · 1/2 frames`,
  )
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
  expect(document.querySelector(`.hotspot-map-status`)?.textContent).toContain(
    `Incomplete time average · 1/2 frames`,
  )
  pending.resolve({ ...partial, frames: 2 })
  await pending.promise
  await tick()
  expect(document.querySelector(`.hotspot-progress`)).toBeNull()
  expect(document.querySelector(`.hotspot-map-status`)?.textContent).toContain(
    `Time average · 2 frames`,
  )
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
  clock.mockReturnValue(16_000)
  on_progress?.({ current: 1, completed: 1, total: 4, stage: `Binning kinetic energy` })
  await tick()
  expect(progress()).toContain(`25.0% · ETA 45s`)
  clock.mockReturnValue(121_000)
  on_progress?.({ current: 2, completed: 2, total: 4, stage: `Binning kinetic energy` })
  await tick()
  expect(progress()).toContain(`50.0% · ETA 2m 0s`)
  on_progress?.({ current: 4, completed: 4, total: 4, stage: `Binning kinetic energy` })
  await tick()
  expect(progress()).toContain(`100.0% · ETA 0s`)
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
