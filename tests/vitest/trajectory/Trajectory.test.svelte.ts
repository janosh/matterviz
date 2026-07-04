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
