<script lang="ts">
  import type { AnyStructure } from '$lib/structure'
  import type { TrajectoryType } from '$lib/trajectory'
  import { Trajectory } from '$lib/trajectory'
  import { onMount } from 'svelte'

  const lattice_params = { a: 2, b: 2, c: 2, alpha: 90, beta: 90, gamma: 90, volume: 8 }

  // Test data - simple trajectory for testing
  const test_trajectory: TrajectoryType = {
    frames: [
      {
        step: 0,
        structure: {
          sites: [
            {
              species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
              abc: [0, 0, 0],
              xyz: [0, 0, 0],
              label: `H1`,
              properties: {},
            },
            {
              species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
              abc: [0.5, 0.5, 0.5],
              xyz: [1, 1, 1],
              label: `O1`,
              properties: {},
            },
          ],
          charge: 0,
          lattice: {
            matrix: [
              [2, 0, 0],
              [0, 2, 0],
              [0, 0, 2],
            ],
            ...lattice_params,
            pbc: [true, true, true],
          },
        } as AnyStructure,
        metadata: { energy: -10.5, force_max: 0.1 },
      },
      {
        step: 1,
        structure: {
          sites: [
            {
              species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
              abc: [0.1, 0, 0],
              xyz: [0.2, 0, 0],
              label: `H1`,
              properties: {},
            },
            {
              species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
              abc: [0.5, 0.5, 0.5],
              xyz: [1, 1, 1],
              label: `O1`,
              properties: {},
            },
          ],
          charge: 0,
          lattice: {
            matrix: [
              [2, 0, 0],
              [0, 2, 0],
              [0, 0, 2],
            ],
            ...lattice_params,
            pbc: [true, true, true],
          },
        } as AnyStructure,
        metadata: { energy: -10.8, force_max: 0.05 },
      },
      {
        step: 2,
        structure: {
          sites: [
            {
              species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
              abc: [0.2, 0, 0],
              xyz: [0.4, 0, 0],
              label: `H1`,
              properties: {},
            },
            {
              species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
              abc: [0.5, 0.5, 0.5],
              xyz: [1, 1, 1],
              label: `O1`,
              properties: {},
            },
          ],
          charge: 0,
          lattice: {
            matrix: [
              [2, 0, 0],
              [0, 2, 0],
              [0, 0, 2],
            ],
            ...lattice_params,
            pbc: [true, true, true],
          },
        } as AnyStructure,
        metadata: { energy: -11.2, force_max: 0.02 },
      },
    ],
    metadata: { source_format: `test_data`, frame_count: 3, total_atoms: 2 },
  }

  // Constant values trajectory for testing plot hiding
  const constant_trajectory: TrajectoryType = {
    frames: [
      {
        step: 0,
        structure: {
          sites: [
            {
              species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
              abc: [0, 0, 0],
              xyz: [0, 0, 0],
              label: `H1`,
              properties: {},
            },
          ],
          charge: 0,
        } as AnyStructure,
        metadata: { energy: -10.0, force_max: 0.1 },
      },
      {
        step: 1,
        structure: {
          sites: [
            {
              species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
              abc: [0, 0, 0],
              xyz: [0, 0, 0],
              label: `H1`,
              properties: {},
            },
          ],
          charge: 0,
        } as AnyStructure,
        metadata: { energy: -10.0, force_max: 0.1 },
      },
    ],
    metadata: { source_format: `test_data`, frame_count: 2, total_atoms: 1 },
  }

  // Single-frame trajectory for testing plot hiding
  const single_frame_trajectory: TrajectoryType = {
    frames: [
      {
        step: 0,
        structure: {
          sites: [
            {
              species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
              abc: [0, 0, 0],
              xyz: [0, 0, 0],
              label: `H1`,
              properties: {},
            },
          ],
          charge: 0,
        } as AnyStructure,
        metadata: { energy: -10.0, force_max: 0.1 },
      },
    ],
    metadata: { source_format: `test_data`, frame_count: 1, total_atoms: 1 },
  }

  let current_step = $state(0)
  let hydrated = $state(false)
  onMount(() => {
    hydrated = true
  })
</script>

<h1 data-hydrated={hydrated}>Trajectory Component Test Page</h1>

<Trajectory id="empty-state" allow_file_drop show_controls="always" />

<Trajectory
  id="loaded-trajectory"
  trajectory={test_trajectory}
  bind:current_step_idx={current_step}
  fps={1}
  allow_file_drop
  step_labels={3}
  show_controls="always"
/>

<Trajectory id="auto-layout" trajectory={test_trajectory} show_controls step_labels={3} />

<Trajectory
  id="vertical-layout"
  trajectory={test_trajectory}
  layout="vertical"
  step_labels={[-1]}
/>

<Trajectory
  id="no-controls"
  trajectory={test_trajectory}
  show_controls={false}
  layout="horizontal"
/>

<Trajectory
  id="negative-step-labels"
  trajectory={test_trajectory}
  step_labels={-1}
  layout="horizontal"
/>

<Trajectory
  id="array-step-labels"
  trajectory={test_trajectory}
  step_labels={[0, 2]}
  layout="horizontal"
/>

<Trajectory
  id="custom-controls"
  trajectory={test_trajectory}
  layout="horizontal"
  show_controls="always"
>
  {#snippet trajectory_controls({ current_step_idx, total_frames, on_step_change })}
    <button onclick={() => on_step_change(0)}>First</button>
    <span>Step {current_step_idx + 1} of {total_frames}</span>
    <button onclick={() => on_step_change(total_frames - 1)}>Last</button>
  {/snippet}
</Trajectory>

<Trajectory id="constant-values" trajectory={constant_trajectory} layout="horizontal" />

<Trajectory id="single-frame" trajectory={single_frame_trajectory} layout="horizontal" />

<Trajectory
  id="no-plot-skimming"
  trajectory={test_trajectory}
  layout="horizontal"
  plot_skimming={false}
/>
