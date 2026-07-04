<script lang="ts">
  import Trajectory from '$lib/trajectory/Trajectory.svelte'
  import type { FrameLoader, TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
  import { SvelteMap } from 'svelte/reactivity'

  const frame = (step: number): TrajectoryFrame => ({
    step,
    structure: {
      charge: 0,
      sites: [
        {
          label: `Frame ${step}`,
          species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [step, 0, 0],
          properties: {},
        },
      ],
    },
  })

  const pending_loads = new SvelteMap<number, (frame: TrajectoryFrame) => void>()

  const frame_loader: FrameLoader = {
    get_total_frames: async () => 2,
    build_frame_index: async () => [],
    extract_plot_metadata: async () => [],
    load_frame: async (_data, frame_number) =>
      new Promise<TrajectoryFrame>((resolve) => {
        pending_loads.set(frame_number, resolve)
      }),
  }

  const trajectory: TrajectoryType = { frames: [frame(0)], total_frames: 2, frame_loader }

  let current_step_idx = $state(0)
</script>

<button type="button" data-testid="step-1" onclick={() => (current_step_idx = 1)}>
  Step 1
</button>
<button type="button" data-testid="resolve-0" onclick={() => pending_loads.get(0)?.(frame(0))}>
  Resolve 0
</button>
<button type="button" data-testid="resolve-1" onclick={() => pending_loads.get(1)?.(frame(1))}>
  Resolve 1
</button>
<Trajectory
  {trajectory}
  bind:current_step_idx
  display_mode="structure"
  show_controls="never"
/>
