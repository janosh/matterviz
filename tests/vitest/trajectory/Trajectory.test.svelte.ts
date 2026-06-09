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
    const plot = target.querySelector<HTMLElement>(`.scatter`)
    if (!plot) throw new Error(`trajectory scatter plot not found`)
    await resize_element(plot, 600, 400)
    expect(plot.textContent).toContain(`Energy`)

    props.trajectory = make_traj([{ volume: 10 }, { volume: 12 }])
    flushSync()
    await tick()
    expect(plot.textContent).toContain(`Volume`)
    expect(plot.textContent).not.toContain(`Energy`)
  })
})
