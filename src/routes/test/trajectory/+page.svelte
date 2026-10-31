<script lang="ts">
  import { browser } from '$app/env'
  import { page } from '$app/state'
  import type { TrajectoryFrame } from '#lib/trajectory/index.js'
  import { calc_lattice_params, type Matrix3x3 } from '#lib/math.js'
  import { Structure, type Pbc } from '#lib/structure/index.js'
  import { Trajectory, trajectory_from_frames } from '#lib/trajectory/index.js'
  import { type ComponentProps, onMount } from 'svelte'
  import TestSection from '../TestSection.svelte'

  // Cubic cell with derived lengths, angles and volume (exact for the integer edges used here)
  const cubic_lattice = (edge: number) => {
    const matrix: Matrix3x3 = [
      [edge, 0, 0],
      [0, edge, 0],
      [0, 0, edge],
    ]
    return { matrix, pbc: [true, true, true] as Pbc, ...calc_lattice_params(matrix) }
  }

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
        lattice: cubic_lattice(2),
      },
      metadata,
    })),
    {
      metadata: { source_format: `test_data`, frame_count: 3, total_atoms: 2 },
      provenance: { filename: `test.xyz` },
    },
  )

  // Unrelated structures read as one trajectory (a benchmark set): a 2 Å, then a 6 Å cubic cell.
  const cubic_frame = (step: number, edge: number): TrajectoryFrame => ({
    step,
    structure: {
      sites: [
        {
          species: [{ element: `Fe`, occu: 1, oxidation_state: 0 }],
          abc: [0.5, 0.5, 0.5],
          xyz: [edge / 2, edge / 2, edge / 2],
          label: `Fe1`,
          properties: {},
        },
      ],
      charge: 0,
      lattice: cubic_lattice(edge),
    },
    metadata: {},
  })
  const dataset_trajectory = trajectory_from_frames([cubic_frame(0, 2), cubic_frame(1, 6)], {
    metadata: { source_format: `test_data`, frame_count: 2, total_atoms: 1 },
  })
  let dataset_camera = $state<{ target?: number[]; position?: number[] } | null>(null)
  // A plain Structure handed a new structure (a new file): a 4 Å, then a 6 Å cell
  let swapped = $state(false)
  let swap_camera = $state<{ target?: number[]; position?: number[] } | null>(null)

  // Horizontal-layout viewers that each differ from the loaded one in a single prop
  const horizontal_variants: (Partial<ComponentProps<typeof Trajectory>> & {
    id: string
    title: string
  })[] = [
    { id: `no-controls`, title: `No controls`, show_controls: false },
    { id: `negative-step-labels`, title: `Negative step labels`, step_labels: -1 },
    { id: `array-step-labels`, title: `Array step labels`, step_labels: [0, 2] },
    { id: `no-plot-skimming`, title: `No plot skimming`, plot_skimming: false },
  ]

  let hydrated = $state(false)
  const single_viewer = $derived(browser && page.url.searchParams.has(`single-viewer`))
  onMount(() => {
    hydrated = true
  })
</script>

<h1 data-hydrated={hydrated}>Trajectory test page</h1>

{#if !single_viewer}
  <TestSection title="Empty state">
    <Trajectory id="empty-state" show_controls="always" />
  </TestSection>
{/if}

<TestSection title="Loaded trajectory">
  <Trajectory
    id="loaded-trajectory"
    trajectory={test_trajectory}
    fps={1}
    step_labels={3}
    show_controls="always"
  />
</TestSection>

{#if !single_viewer}
  <TestSection
    title="Dataset of unrelated cells"
    description="Stepping to the 6 Å frame must re-frame the camera on its cell."
  >
    <Trajectory
      id="dataset-trajectory"
      trajectory={dataset_trajectory}
      show_controls="always"
      structure_props={{
        on_camera_move: ({ camera_target, camera_position }) =>
          (dataset_camera = { target: camera_target, position: camera_position }),
      }}
    />
    <output id="dataset-camera">{JSON.stringify(dataset_camera)}</output>
  </TestSection>

  <TestSection
    title="Structure swapped for a new cell"
    description="A plain Structure given a 6 Å cell after a 4 Å one frames it afresh."
  >
    <button id="swap-structure" onclick={() => (swapped = true)}>Swap structure</button>
    <Structure
      id="swapped-structure"
      structure={cubic_frame(0, swapped ? 6 : 4).structure}
      on_camera_move={({ camera_target, camera_position }) =>
        (swap_camera = { target: camera_target, position: camera_position })}
    />
    <output id="swap-camera">{JSON.stringify(swap_camera)}</output>
  </TestSection>

  <!-- the inspector sidebar takes part of the row, so the auto layout tests close it to measure
  how the structure and plot panes split the viewer alone -->
  <TestSection title="Auto layout">
    <Trajectory
      id="auto-layout"
      trajectory={test_trajectory}
      show_controls
      step_labels={3}
      data_inspector_open={false}
    />
  </TestSection>

  <TestSection title="Vertical layout">
    <Trajectory
      id="vertical-layout"
      trajectory={test_trajectory}
      layout="vertical"
      show_controls="hover"
      step_labels={[-1]}
    />
  </TestSection>

  {#each horizontal_variants as { title, ...props } (props.id)}
    <TestSection {title}>
      <Trajectory trajectory={test_trajectory} layout="horizontal" {...props} />
    </TestSection>
  {/each}
{/if}
