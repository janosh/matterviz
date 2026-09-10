<script lang="ts">
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import { Trajectory, trajectory_from_frames, type TrajectoryFrame } from '$lib/trajectory'
  import { onMount } from 'svelte'

  const lattice_params = { a: 2, b: 2, c: 2, alpha: 90, beta: 90, gamma: 90, volume: 8 }

  const test_trajectory = trajectory_from_frames(
    [
      { energy: -10.5, force_max: 0.1 },
      { energy: -10.8, force_max: 0.05 },
      { energy: -11.2, force_max: 0.02 },
    ].map<TrajectoryFrame>((metadata, step) => ({
      step,
      structure: {
        sites: [
          {
            species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
            abc: [step / 10, 0, 0],
            xyz: [step / 5, 0, 0],
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
      },
      metadata,
    })),
    {
      metadata: { source_format: `test_data`, frame_count: 3, total_atoms: 2 },
      provenance: { filename: `test.xyz` },
    },
  )

  // Each call owns its structure so the constant and single-frame viewers stay independent.
  const constant_frame = (step: number): TrajectoryFrame => ({
    step,
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
    },
    metadata: { energy: -10, force_max: 0.1 },
  })
  const constant_trajectory = trajectory_from_frames([0, 1].map(constant_frame), {
    metadata: { source_format: `test_data`, frame_count: 2, total_atoms: 1 },
  })
  const single_frame_trajectory = trajectory_from_frames([constant_frame(0)], {
    metadata: { source_format: `test_data`, frame_count: 1, total_atoms: 1 },
  })

  let current_step = $state(0)
  let hydrated = $state(false)
  const single_viewer = $derived(browser && page.url.searchParams.has(`single-viewer`))
  onMount(() => {
    hydrated = true
  })
</script>

<h1 id="trajectory-component-test-page" data-hydrated={hydrated}>
  Trajectory Component Test Page
</h1>

{#if !single_viewer}
  <Trajectory id="empty-state" show_controls="always" />
{/if}

<Trajectory
  id="loaded-trajectory"
  trajectory={test_trajectory}
  bind:current_step_idx={current_step}
  fps={1}
  step_labels={3}
  show_controls="always"
/>

{#if !single_viewer}
  <Trajectory id="auto-layout" trajectory={test_trajectory} show_controls step_labels={3} />

  <Trajectory
    id="vertical-layout"
    trajectory={test_trajectory}
    layout="vertical"
    show_controls="hover"
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
{/if}
