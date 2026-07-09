import { Trajectory } from '$lib/trajectory'
import { flushSync, mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { make_trajectory_frame, resize_element } from '../setup'

const make_traj = (metadatas: Record<string, number>[]) => ({
  frames: metadatas.map((metadata, idx) => make_trajectory_frame(idx, 1, metadata)),
  metadata: {},
})

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
    const target = document.createElement(`div`)
    document.body.append(target)
    mount(Trajectory, { target, props })
    flushSync()
    await tick()
    let plot = target.querySelector<HTMLElement>(`.scatter`)
    if (!plot) throw new Error(`trajectory scatter plot not found`)
    await resize_element(plot, 600, 400)
    expect(plot.textContent).toContain(`Energy`)

    props.trajectory = make_traj([{ volume: 10 }, { volume: 12 }])
    flushSync()
    await tick()
    plot = target.querySelector<HTMLElement>(`.scatter`)
    if (!plot) throw new Error(`trajectory scatter plot not found after swap`)
    await resize_element(plot, 600, 400)
    expect(plot.textContent).toContain(`Volume`)
    expect(plot.textContent).not.toContain(`Energy`)
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
    const target = document.createElement(`div`)
    document.body.append(target)
    mount(Trajectory, { target, props })
    flushSync()
    await tick()

    expect(props.current_step_idx).toBe(2)
    expect(step_events.at(-1)).toEqual({ step_idx: 2, frame_count: 3 })

    const slider = target.querySelector<HTMLInputElement>(`.step-slider`)
    if (!slider) throw new Error(`step slider not found`)
    slider.value = `1`
    slider.dispatchEvent(new Event(`input`, { bubbles: true }))
    flushSync()
    expect(step_events.at(-1)).toEqual({ step_idx: 1, frame_count: 3 })
  })

  test(`view mode menu is layered and selectable`, async () => {
    const props = $state({
      trajectory: make_traj([{ energy: -1.5 }, { energy: -2.5 }]),
      display_mode: `structure+scatter` as const,
      show_controls: `always` as const,
    })
    const target = document.createElement(`div`)
    document.body.append(target)
    mount(Trajectory, { target, props })
    flushSync()
    await tick()

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
})
