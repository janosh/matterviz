import TrajectoryInfoPane from '$lib/trajectory/TrajectoryInfoPane.svelte'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
import { mount, tick } from 'svelte'
import { afterEach, expect, test } from 'vitest'

afterEach(() => document.body.replaceChildren())

test(`replaces indexed loading details with the resolved frame`, async () => {
  const frame: TrajectoryFrame = {
    structure: {
      sites: [
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [0, 0, 0],
          label: `Si1`,
          properties: {},
        },
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          abc: [0.25, 0.25, 0.25],
          xyz: [0.25, 0.25, 0.25],
          label: `Si2`,
          properties: {},
        },
      ],
    },
    step: 10,
    metadata: { energy: -1 },
  }
  const trajectory = {
    frames: Array.from({ length: 10 }, () => frame),
    total_frames: 11,
    is_indexed: true,
  } as TrajectoryType
  const props = $state<{
    trajectory: TrajectoryType
    current_step_idx: number
    current_frame: TrajectoryFrame | null
    pane_open: boolean
  }>({
    trajectory,
    current_step_idx: 10,
    current_frame: null,
    pane_open: true,
  })
  mount(TrajectoryInfoPane, { target: document.body, props })
  await tick()
  expect(document.body.textContent).toContain(`On-demand`)

  props.current_frame = frame
  await tick()
  expect(document.body.textContent).toContain(`Atoms`)
  expect(document.body.textContent).toContain(`2`)
  expect(document.body.textContent).toContain(`Si`)
  expect(document.body.textContent).not.toContain(`On-demand`)
})
