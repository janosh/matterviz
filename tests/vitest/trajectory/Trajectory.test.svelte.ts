import {
  Trajectory,
  type TrajectoryType,
  type TrajectoryXQuantity,
  type TrajHandlerData,
} from '$lib/trajectory'
import { flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { make_trajectory_frame, resize_element } from '../setup'

const make_traj = (metadatas: Record<string, number>[]) => ({
  frames: metadatas.map((metadata, idx) => make_trajectory_frame(idx, 1, metadata)),
  metadata: {},
})
const make_stepped_traj = (time_step?: number) => ({
  frames: [0, 500, 1000].map((step, frame_idx) =>
    make_trajectory_frame(step, 1, { energy: -frame_idx }),
  ),
  metadata: {},
  time_step,
  time_unit: `fs` as const,
})
const xyz = (element: string) => `1\n${element} frame\n${element} 0 0 0\n`
const request_url = (url: string | URL | Request) =>
  typeof url === `string` ? url : url instanceof URL ? url.href : url.url
const loaded_element = (data: TrajHandlerData) =>
  data.trajectory?.frames[0]?.structure.sites[0]?.species[0]?.element ?? ``

const mount_traj = (props: Record<string, unknown>) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  mount(Trajectory, { target, props })
  return target
}
const flush_render = async () => {
  flushSync()
  await tick()
}
const selected_x_quantity = (target: ParentNode) =>
  target.querySelector<HTMLSelectElement>(`.x-quantity-select`)?.value

const with_fetch = async (fetch_impl: unknown, run: () => Promise<void>) => {
  vi.stubGlobal(`fetch`, fetch_impl)
  try {
    await run()
  } finally {
    vi.unstubAllGlobals()
  }
}

describe(`Trajectory`, () => {
  // Regression: the series-regeneration effect must survive the visible_properties
  // write-back from the legend-sync effect. That write re-runs the regeneration
  // effect while the syncing flag is set; returning before reading any reactive dep
  // leaves the effect dep-less, and Svelte permanently unlinks dep-less effects -
  // after which loading a new trajectory kept showing the previous one's series.
  test(`swapping the trajectory prop regenerates plot series`, async () => {
    const props = $state({
      trajectory: make_traj([{ energy: -1.5 }, { energy: -2.5 }]),
      display_mode: `scatter` as const,
      show_controls: false,
    })
    const target = mount_traj(props)
    await flush_render()
    let plot = target.querySelector<HTMLElement>(`.scatter`)
    if (!plot) throw new Error(`trajectory scatter plot not found`)
    await resize_element(plot, 600, 400)
    expect(plot.textContent).toContain(`Energy`)

    props.trajectory = make_traj([{ volume: 10 }, { volume: 12 }])
    await flush_render()
    plot = target.querySelector<HTMLElement>(`.scatter`)
    if (!plot) throw new Error(`trajectory scatter plot not found after swap`)
    await resize_element(plot, 600, 400)
    expect(plot.textContent).toContain(`Volume`)
    expect(plot.textContent).not.toContain(`Energy`)
  })

  test.each([
    { time_step: 2, expected_quantity: `time` },
    { time_step: undefined, expected_quantity: `step` },
  ] as const)(
    `defaults to the most informative supported $expected_quantity axis`,
    async ({ time_step, expected_quantity }) => {
      // Bindable x_quantity starts unset; after auto-pick it must write back the
      // effective axis so hosts can read which quantity is in effect.
      const props = $state({
        trajectory: make_stepped_traj(time_step),
        x_quantity: undefined as TrajectoryXQuantity | undefined,
        display_mode: `scatter` as const,
        show_controls: `always` as const,
      })
      const target = mount_traj(props)
      await flush_render()

      expect(selected_x_quantity(target)).toBe(expected_quantity)
      expect(props.x_quantity).toBe(expected_quantity)
    },
  )

  test(`syncs unsupported x_quantity to the effective frame fallback`, async () => {
    // Identity step numbering → only `frame` is available; requesting `time` must
    // write the fallback back to the bindable prop rather than leave a stale value.
    const props = $state({
      trajectory: make_traj([{ energy: -1 }, { energy: -2 }, { energy: -3 }]),
      x_quantity: `time`,
      display_mode: `scatter` as const,
      show_controls: false as const,
    })
    mount_traj(props)
    await flush_render()
    expect(props.x_quantity).toBe(`frame`)
  })

  test(`defers x_quantity sync until trajectory samples exist`, async () => {
    // Writing `frame` while still empty would lock the bindable and skip auto-pick
    // once a time-capable trajectory arrives.
    const props = $state({
      trajectory: undefined as TrajectoryType | undefined,
      x_quantity: undefined as TrajectoryXQuantity | undefined,
      display_mode: `scatter` as const,
      show_controls: `always` as const,
    })
    const target = mount_traj(props)
    await flush_render()
    expect(props.x_quantity).toBeUndefined()

    props.trajectory = make_stepped_traj(2)
    await flush_render()
    expect(props.x_quantity).toBe(`time`)
    expect(selected_x_quantity(target)).toBe(`time`)
  })

  // Regression: hosts restore viewer position by passing an out-of-range
  // current_step_idx (MAX_SAFE_INTEGER = "last frame"); the clamp must both
  // write back the corrected index and notify on_step_change. Slider input
  // must report the event target's value — bind:value may not have written
  // the binding yet when oninput fires, so reading the bound state is stale.
  test(`clamps out-of-range steps and reports slider values from the event`, async () => {
    const step_events: { step_idx: number; frame_count: number }[] = []
    const props = $state({
      trajectory: make_traj([{ energy: -1 }, { energy: -2 }, { energy: -3 }]),
      current_step_idx: Number.MAX_SAFE_INTEGER,
      show_controls: `always` as const,
      // TrajHandlerData's fields are optional; the assertions below pin the
      // concrete values so `?? -1` can't mask a missing field
      on_step_change: (data: { step_idx?: number; frame_count?: number }) => {
        step_events.push({
          step_idx: data.step_idx ?? -1,
          frame_count: data.frame_count ?? -1,
        })
      },
    })
    const target = mount_traj(props)
    await flush_render()

    expect(props.current_step_idx).toBe(2)
    expect(step_events.at(-1)).toEqual({ step_idx: 2, frame_count: 3 })

    const slider = target.querySelector<HTMLInputElement>(`.step-slider`)
    if (!slider) throw new Error(`step slider not found`)
    slider.value = `1`
    slider.dispatchEvent(new Event(`input`, { bubbles: true }))
    flushSync()
    expect(step_events.at(-1)).toEqual({ step_idx: 1, frame_count: 3 })
  })

  // Every finished analysis pane is reachable from the one menu, and each menu entry drives
  // its own bindable open flag rather than all of them sharing one. MSD also must not
  // reappear as a top-level toggle outside the menu.
  test.each([
    {
      label: `Mean squared displacement`,
      open_prop: `msd_pane_open`,
      no_toplevel: `.trajectory-msd-toggle:not(.analysis-toggle-anchor)`,
    },
    { label: `Velocity autocorrelation & VDOS`, open_prop: `vacf_pane_open` },
    { label: `Structure identification`, open_prop: `structure_id_pane_open` },
    { label: `Data inspector`, open_prop: `data_inspector_open` },
  ])(`analysis menu opens $label`, async ({ label, open_prop, no_toplevel }) => {
    const props: Record<string, unknown> = $state({
      trajectory: make_traj([{ energy: -1.5 }, { energy: -2.5 }]),
      show_controls: `always` as const,
      [open_prop]: false,
    })
    const target = mount_traj(props)
    await flush_render()

    if (no_toplevel) expect(target.querySelector(no_toplevel)).toBeNull()

    target.querySelector<HTMLButtonElement>(`.analysis-button`)?.click()
    await tick()
    const option = [
      ...target.querySelectorAll<HTMLButtonElement>(`.analysis-dropdown .view-mode-option`),
    ].find((button) => button.textContent?.includes(label))
    if (!option) throw new Error(`${label} analysis option not found`)
    option.click()
    await tick()

    expect(props[open_prop]).toBe(true)
    expect(target.querySelector(`.analysis-dropdown`)).toBeNull()
  })

  // setup.ts ResizeObserver reports 600; old code used calc(wrapper - 50px).
  test(`info pane max-height follows content-area height`, async () => {
    const target = mount_traj({
      trajectory: make_traj([{ energy: -1.5 }]),
      show_controls: `always` as const,
      info_pane_open: true,
    })
    await flush_render()
    expect(target.querySelector<HTMLElement>(`.trajectory-info-pane`)?.style.maxHeight).toBe(
      `600px`,
    )
  })

  // show_controls.style is appended after the z-index the controls bar sets on itself, so
  // both have to survive; a caller that names z-index deliberately wins, being last.
  test.each([
    [`without a trailing semicolon`, `color: rgb(255, 0, 0)`, `10`, `rgb(255, 0, 0)`],
    [`with a trailing semicolon`, `color: rgb(255, 0, 0);`, `10`, `rgb(255, 0, 0)`],
    [`overriding the z-index`, `z-index: 5`, `5`, ``],
  ])(`show_controls.style %s`, async (_label, style, z_index, color) => {
    const target = mount_traj({
      trajectory: make_traj([{ energy: -1.5 }]),
      show_controls: { mode: `always`, style },
    })
    await flush_render()

    const controls = target.querySelector<HTMLElement>(`.trajectory-controls`)
    if (!controls) throw new Error(`trajectory controls not found`)
    expect(getComputedStyle(controls).zIndex).toBe(z_index)
    expect(getComputedStyle(controls).color).toBe(color)
  })

  test(`view mode menu is layered and selectable`, async () => {
    const props = $state({
      trajectory: make_traj([{ energy: -1.5 }, { energy: -2.5 }]),
      display_mode: `structure+scatter` as const,
      show_controls: `always` as const,
    })
    const target = mount_traj(props)
    await flush_render()

    const controls = target.querySelector<HTMLElement>(`.trajectory-controls`)
    if (!controls) throw new Error(`trajectory controls not found`)
    // Inline, because jsdom applies no scoped styles: keeps the menu above the
    // content-area siblings that follow it rather than under the scatter.
    expect(Number(getComputedStyle(controls).zIndex)).toBeGreaterThan(0)

    target.querySelector<HTMLButtonElement>(`.view-mode-button`)?.click()
    await tick()

    const dropdown = target.querySelector<HTMLElement>(`.view-mode-dropdown`)
    if (!dropdown) throw new Error(`view mode dropdown not found`)
    const dropdown_style = getComputedStyle(dropdown)
    expect(dropdown_style.pointerEvents).toBe(`auto`)
    expect(Number(dropdown_style.zIndex)).toBeGreaterThan(0)

    const scatter_only = [
      ...dropdown.querySelectorAll<HTMLButtonElement>(`.view-mode-option`),
    ].find((button) => button.textContent?.includes(`Scatter-only`))
    if (!scatter_only) throw new Error(`scatter-only option not found`)
    scatter_only.click()
    await tick()

    expect(props.display_mode).toBe(`scatter`)
    expect(target.querySelector(`.view-mode-dropdown`)).toBeNull()
  })

  test(`reloads URL-owned trajectory when data_url changes`, async () => {
    const loaded_elements: string[] = []
    await with_fetch(
      vi.fn(
        async (url: string | URL | Request) =>
          new Response(xyz(request_url(url).includes(`b.xyz`) ? `He` : `H`)),
      ),
      async () => {
        const props = $state({
          data_url: `/a.xyz`,
          display_mode: `structure` as const,
          show_controls: `never` as const,
          on_file_load: (data: TrajHandlerData) => loaded_elements.push(loaded_element(data)),
        })
        mount_traj(props)
        await vi.waitFor(() => expect(loaded_elements).toEqual([`H`]))

        props.data_url = `/b.xyz`
        await vi.waitFor(() => expect(loaded_elements).toEqual([`H`, `He`]))
      },
    )
  })

  test(`caller-supplied trajectory takes precedence over data_url`, async () => {
    const fetch_mock = vi.fn()
    await with_fetch(fetch_mock, async () => {
      mount_traj({
        data_url: `/ignored.xyz`,
        trajectory: make_traj([{ energy: -1 }]),
        show_controls: `never`,
      })
      await tick()
      expect(fetch_mock).not.toHaveBeenCalled()
    })
  })

  test(`ignores a stale trajectory URL completion`, async () => {
    const responses = new Map<string, (response: Response) => void>()
    await with_fetch(
      vi.fn(
        (url: string | URL | Request) =>
          new Promise<Response>((resolve) => responses.set(request_url(url), resolve)),
      ),
      async () => {
        const on_file_load = vi.fn()
        const props = $state({
          data_url: `/a.xyz`,
          display_mode: `structure` as const,
          show_controls: `never` as const,
          on_file_load,
        })
        mount_traj(props)
        await vi.waitFor(() => expect(responses.has(`/a.xyz`)).toBe(true))

        props.data_url = `/b.xyz`
        await vi.waitFor(() => expect(responses.has(`/b.xyz`)).toBe(true))
        responses.get(`/b.xyz`)?.(new Response(xyz(`He`)))
        await vi.waitFor(() => expect(on_file_load).toHaveBeenCalledTimes(1))

        responses.get(`/a.xyz`)?.(new Response(xyz(`H`)))
        await tick()
        expect(on_file_load).toHaveBeenCalledTimes(1)
        expect(loaded_element(on_file_load.mock.calls[0][0])).toBe(`He`)
      },
    )
  })

  // oxfmt-ignore
  test.each([
    { label: `parse failures include file_size`, data_url: `/bad.xyz`,
      fetch_impl: () => new Response(`not a valid trajectory`),
      expected: { filename: `bad.xyz`, file_size: new Blob([`not a valid trajectory`]).size,
        error_msg: expect.stringMatching(/Failed to parse|unsupported/i) } },
    { label: `fetch failures use basename`, data_url: `/missing/traj.xyz`,
      fetch_impl: () => Promise.reject(new Error(`network down`)),
      expected: { filename: `traj.xyz`, error_msg: expect.stringContaining(`network down`) } },
  ])(`on_error reports $label`, async ({ data_url, fetch_impl, expected }) => {
    const on_error = vi.fn()
    await with_fetch(vi.fn(fetch_impl), async () => {
      mount_traj({ data_url, display_mode: `structure`, show_controls: `never`, on_error })
      await vi.waitFor(() => expect(on_error).toHaveBeenCalledTimes(1))
      expect(on_error.mock.calls[0][0]).toEqual(expect.objectContaining(expected))
    })
  })
})
