<script lang="ts">
  import type { AnyStructure } from '$lib/structure'
  import type { Trajectory, TrajectoryFrame } from '$lib/trajectory'
  import { TrajectoryViewer } from '$lib/trajectory'

  // Test data - simple trajectory for testing
  const test_trajectory: Trajectory = {
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
            a: 2,
            b: 2,
            c: 2,
            alpha: 90,
            beta: 90,
            gamma: 90,
            volume: 8,
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
            a: 2,
            b: 2,
            c: 2,
            alpha: 90,
            beta: 90,
            gamma: 90,
            volume: 8,
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
            a: 2,
            b: 2,
            c: 2,
            alpha: 90,
            beta: 90,
            gamma: 90,
            volume: 8,
            pbc: [true, true, true],
          },
        } as AnyStructure,
        metadata: { energy: -11.2, force_max: 0.02 },
      },
    ],
    metadata: {
      source_format: `test_data`,
      frame_count: 3,
      total_atoms: 2,
    },
  }

  // Constant values trajectory for testing plot hiding
  const constant_trajectory: Trajectory = {
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
    metadata: {
      source_format: `test_data`,
      frame_count: 2,
      total_atoms: 1,
    },
  }

  // Dual axis trajectory with different property types
  const dual_axis_trajectory: Trajectory = {
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
        metadata: { energy: -10.0, temperature: 300, pressure: 1.0 },
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
        metadata: { energy: -12.0, temperature: 350, pressure: 1.2 },
      },
    ],
    metadata: {
      source_format: `test_data`,
      frame_count: 2,
      total_atoms: 1,
    },
  }

  let empty_trajectory = $state<Trajectory | undefined>(undefined)
  let loaded_trajectory = $state<Trajectory | undefined>(test_trajectory)
  let error_trajectory = $state<Trajectory | undefined>(undefined)
  let current_step = $state(0)
</script>

<h1>Trajectory Component Test Page</h1>

<TrajectoryViewer
  id="empty-state"
  bind:trajectory={empty_trajectory}
  bind:current_step_idx={current_step}
  allow_file_drop
/>

<TrajectoryViewer
  id="loaded-trajectory"
  bind:trajectory={loaded_trajectory}
  bind:current_step_idx={current_step}
  allow_file_drop
  show_controls
  step_labels={3}
/>

<TrajectoryViewer
  id="auto-layout"
  trajectory={test_trajectory}
  show_controls
  step_labels={3}
/>

<TrajectoryViewer
  id="vertical-layout"
  trajectory={test_trajectory}
  layout="vertical"
  show_controls
  step_labels={[-1]}
/>

<TrajectoryViewer
  id="no-controls"
  trajectory={test_trajectory}
  show_controls={false}
  layout="horizontal"
/>

<TrajectoryViewer
  id="error-state"
  bind:trajectory={error_trajectory}
  data_url="/non-existent-trajectory.json"
  allow_file_drop
/>

<TrajectoryViewer
  id="custom-extractor"
  trajectory={test_trajectory}
  data_extractor={(frame: TrajectoryFrame) => ({
    energy: (frame.metadata?.energy as number) || 0,
    step: frame.step,
  })}
  layout="horizontal"
/>

<TrajectoryViewer
  id="custom-properties"
  trajectory={test_trajectory}
  data_extractor={(frame: TrajectoryFrame) => ({
    Step: frame.step,
    'Total Energy': (frame.metadata?.energy as number) || 0,
    'Max Force': (frame.metadata?.force_max as number) || 0,
  })}
  layout="horizontal"
/>

<TrajectoryViewer
  id="negative-step-labels"
  trajectory={test_trajectory}
  step_labels={-1}
  layout="horizontal"
/>

<TrajectoryViewer
  id="array-step-labels"
  trajectory={test_trajectory}
  step_labels={[0, 2]}
  layout="horizontal"
/>

<TrajectoryViewer
  id="trajectory-url"
  data_url="/test-trajectory.json"
  allow_file_drop
/>

<TrajectoryViewer id="custom-controls" trajectory={test_trajectory} layout="horizontal">
  {#snippet trajectory_controls(
    { current_step_idx, total_frames, on_step_change },
  )}
    <div class="custom-trajectory-controls">
      <button onclick={() => on_step_change(0)}>First</button>
      <span>Step {current_step_idx + 1} of {total_frames}</span>
      <button onclick={() => on_step_change(total_frames - 1)}>Last</button>
    </div>
  {/snippet}
</TrajectoryViewer>

<TrajectoryViewer
  id="error-snippet"
  trajectory={undefined}
  data_url="/non-existent-file.json"
>
  {#snippet error_snippet({ error_msg, on_dismiss })}
    <div class="custom-error">
      <h3>Custom Error Handler</h3>
      <p>{error_msg}</p>
      <button onclick={on_dismiss}>Dismiss Error</button>
    </div>
  {/snippet}
</TrajectoryViewer>

<TrajectoryViewer
  id="constant-values"
  trajectory={constant_trajectory}
  layout="horizontal"
/>

<TrajectoryViewer
  id="dual-axis"
  trajectory={dual_axis_trajectory}
  data_extractor={(frame: TrajectoryFrame) => ({
    step: frame.step,
    energy: (frame.metadata?.energy as number) || 0,
    temperature: (frame.metadata?.temperature as number) || 0,
    pressure: (frame.metadata?.pressure as number) || 0,
  })}
  layout="horizontal"
/>
