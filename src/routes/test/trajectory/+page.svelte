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

<section id="empty-state">
  <h2>Empty State</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer
      bind:trajectory={empty_trajectory}
      bind:current_step_idx={current_step}
      allow_file_drop
    />
  </div>
</section>

<section id="loaded-trajectory">
  <h2>Loaded Trajectory (Auto Layout)</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer
      bind:trajectory={loaded_trajectory}
      bind:current_step_idx={current_step}
      allow_file_drop
      show_controls
      step_labels={3}
    />
  </div>
</section>

<section id="auto-layout">
  <h2>Auto Layout (Responsive)</h2>
  <div style="height: 500px; border: 1px solid #ccc">
    <TrajectoryViewer
      trajectory={test_trajectory}
      show_controls
      step_labels={3}
    />
  </div>
</section>

<section id="vertical-layout">
  <h2>Vertical Layout (Explicit)</h2>
  <div style="height: 500px; border: 1px solid #ccc">
    <TrajectoryViewer
      trajectory={test_trajectory}
      layout="vertical"
      show_controls
      step_labels={[-1]}
    />
  </div>
</section>

<section id="no-controls">
  <h2>No Controls</h2>
  <div style="height: 300px; border: 1px solid #ccc">
    <TrajectoryViewer
      trajectory={test_trajectory}
      show_controls={false}
      layout="horizontal"
    />
  </div>
</section>

<section id="error-state">
  <h2>Error State (will show error after mount)</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer
      bind:trajectory={error_trajectory}
      trajectory_url="/non-existent-trajectory.json"
      allow_file_drop
    />
  </div>
</section>

<section id="custom-extractor">
  <h2>Custom Data Extractor</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer
      trajectory={test_trajectory}
      data_extractor={(frame: TrajectoryFrame) => ({
        energy: (frame.metadata?.energy as number) || 0,
        step: frame.step,
      })}
      layout="horizontal"
    />
  </div>
</section>

<section id="custom-properties">
  <h2>Custom Property Labels and Units</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer
      trajectory={test_trajectory}
      data_extractor={(frame: TrajectoryFrame) => ({
        Step: frame.step,
        'Total Energy': (frame.metadata?.energy as number) || 0,
        'Max Force': (frame.metadata?.force_max as number) || 0,
      })}
      layout="horizontal"
    />
  </div>
</section>

<section id="negative-step-labels">
  <h2>Negative Step Labels (Spacing-based)</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer trajectory={test_trajectory} step_labels={-1} layout="horizontal" />
  </div>
</section>

<section id="array-step-labels">
  <h2>Array Step Labels (Exact positions)</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer
      trajectory={test_trajectory}
      step_labels={[0, 2]}
      layout="horizontal"
    />
  </div>
</section>

<section id="trajectory-url">
  <h2>Trajectory URL Loading</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer trajectory_url="/test-trajectory.json" allow_file_drop />
  </div>
</section>

<section id="custom-controls">
  <h2>Custom Trajectory Controls</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer trajectory={test_trajectory} layout="horizontal">
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
  </div>
</section>

<section id="error-snippet">
  <h2>Custom Error Snippet</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer trajectory={undefined} trajectory_url="/non-existent-file.json">
      {#snippet error_snippet({ error_message, on_dismiss })}
        <div class="custom-error">
          <h3>Custom Error Handler</h3>
          <p>{error_message}</p>
          <button onclick={on_dismiss}>Dismiss Error</button>
        </div>
      {/snippet}
    </TrajectoryViewer>
  </div>
</section>

<section id="constant-values">
  <h2>Constant Values (Plot Hidden)</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer trajectory={constant_trajectory} layout="horizontal" />
  </div>
</section>

<section id="dual-axis">
  <h2>Dual Y-Axis Configuration</h2>
  <div style="height: 400px; border: 1px solid #ccc">
    <TrajectoryViewer
      trajectory={dual_axis_trajectory}
      data_extractor={(frame: TrajectoryFrame) => ({
        step: frame.step,
        energy: (frame.metadata?.energy as number) || 0,
        temperature: (frame.metadata?.temperature as number) || 0,
        pressure: (frame.metadata?.pressure as number) || 0,
      })}
      layout="horizontal"
    />
  </div>
</section>

<style>
  section {
    margin: 2rem 0;
    padding: 1rem;
    border: 1px solid #ddd;
    border-radius: 8px;
  }
  h2 {
    margin-top: 0;
    color: #333;
  }
  .custom-trajectory-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem;
    background: #f5f5f5;
    border-radius: 4px;
  }
  .custom-error {
    padding: 2rem;
    text-align: center;
    background: #fee;
    border: 1px solid #fcc;
    border-radius: 4px;
  }
  .custom-error h3 {
    color: #c33;
    margin-top: 0;
  }
  .custom-error button {
    background: #c33;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
