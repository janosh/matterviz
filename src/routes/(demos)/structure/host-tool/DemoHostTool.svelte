<script lang="ts">
  import { Trajectory } from '$lib/trajectory'
  import type {
    StructureToolProps,
    StructureToolRun,
    StructureToolViewProps,
  } from '$lib/structure'
  import { make_volume } from '$lib/isosurface'
  import { onDestroy } from 'svelte'
  import { make_demo_trajectory } from './demo'

  let { structure, start_run }: StructureToolProps = $props()
  let run = $state.raw<StructureToolRun>()
  let status = $state(`Ready`)
  let current_step_idx = $state(0)
  const trajectory = $derived(make_demo_trajectory(structure))

  function predict(): void {
    run = start_run({
      model: `Deterministic host example`,
      version: `1`,
      units: { charge: `e`, dipole: `e A`, density: `e/A^3` },
      settings: { grid_size: 12, seed: 0 },
    })
    const lattice = `lattice` in structure ? structure.lattice.matrix : undefined
    if (!lattice) throw new Error(`The demo requires a crystal`)
    const values = Float64Array.from({ length: 12 ** 3 }, (_, idx) => {
      const x_idx = Math.floor(idx / 144)
      const y_idx = Math.floor(idx / 12) % 12
      const z_idx = idx % 12
      return Math.exp(-((x_idx - 6) ** 2 + (y_idx - 6) ** 2 + (z_idx - 6) ** 2) / 10)
    })
    run.on_overlay({
      site_properties: structure.sites.map((_, idx) => ({
        charge: idx % 2 ? -0.4 : 0.4,
        dipole: [0.4, 0.2, 0.1],
      })),
      color_property: `charge`,
      volumes: [
        {
          ...make_volume(values, [12, 12, 12], {
            lattice,
            origin: [0, 0, 0],
            periodic: false,
            label: `Predicted density`,
          }),
          field_id: `density`,
        },
      ],
    })
    status = `Prediction ${run.id} ready: charges, dipoles and density`
  }
  function show_trajectory(): void {
    if (!run || run.signal.aborted) predict()
    current_step_idx = 0
    run?.on_view({ content: trajectory_view })
  }
  onDestroy(() => run?.cancel())
</script>

<div class="demo-tool" data-testid="host-tool-controls">
  <button onclick={predict}>Run prediction</button>
  <button onclick={show_trajectory}>Show predicted trajectory</button>
  <span role="status">{status}</span>
</div>

{#snippet trajectory_view(view: StructureToolViewProps)}
  <div class="trajectory-view" data-testid="predicted-trajectory">
    <div style="display: flex; align-items: center; gap: 1rem">
      <button onclick={() => run?.on_view(null)}>Return to structure</button>
      <output aria-label="Trajectory frame">Frame {current_step_idx + 1}</output>
    </div>
    <Trajectory
      {trajectory}
      bind:current_step_idx
      auto_play={false}
      display_mode="structure"
      show_controls="always"
      structure_props={{ ...view, show_host_tool: false, show_controls: `always` }}
      style="height: 100%; min-height: 0"
    />
  </div>
{/snippet}

<style>
  .demo-tool {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 2;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    max-width: 75%;
    background: var(--pane-bg, white);
    padding: 0.5rem;
  }
  .trajectory-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
  }
</style>
