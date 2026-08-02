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
    get_total_frames: async () => 5,
    build_frame_index: async () => [],
    extract_plot_metadata: async () => [],
    load_frame: async (_data, frame_number) =>
      new Promise<TrajectoryFrame>((resolve) => {
        pending_loads.set(frame_number, resolve)
      }),
  }

  const trajectory: TrajectoryType = {
    frames: [],
    total_frames: 5,
    indexed_frames: [{ frame_number: 0, byte_offset: 0, estimated_size: 0 }],
    frame_loader,
  }

  let current_step_idx = $state(0)
</script>

{#each [1, 2, 3, 4] as step_idx (step_idx)}
  <button
    type="button"
    data-testid="step-{step_idx}"
    onclick={() => (current_step_idx = step_idx)}
  >
    Step {step_idx}
  </button>
{/each}
{#each [0, 1, 2, 3, 4] as frame_idx (frame_idx)}
  <button
    type="button"
    data-testid="resolve-{frame_idx}"
    onclick={() => pending_loads.get(frame_idx)?.(frame(frame_idx))}
  >
    Resolve {frame_idx}
  </button>
{/each}
<output data-testid="pending-loads">{[...pending_loads.keys()].toSorted().join(`,`)}</output>
<Trajectory
  {trajectory}
  bind:current_step_idx
  display_mode="structure"
  show_controls="never"
/>
