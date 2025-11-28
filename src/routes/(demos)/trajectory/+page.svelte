<script lang="ts">
  import { FilePicker } from '$lib'
  import { get_trajectory_type, trajectory_files } from '$site/trajectories'
  import { Trajectory, type TrajHandlerData } from 'matterviz/trajectory'

  let active_file = $state(``) // last drag-and-dropped trajectory file
  let visible_props_cantor_qha = $state<string[] | undefined>(undefined)

  const trajectory_files_paths = [
    `/trajectories/flame-gold-cluster-55-atoms.h5`,
    `/trajectories/vasp-XDATCAR-traj.gz`,
    `/trajectories/Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`,
    `/trajectories/ase-images-Ag-0-to-97.xyz.gz`,
    undefined, //create one empty viewer
  ]
</script>

<h1>Trajectory</h1>

{#each trajectory_files_paths as file (file)}
  {#if file === `/trajectories/Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`}
    <h2>Bindable <code>visible_properties</code> Demo</h2>
    <p>
      This trajectory has multiple properties (energy, force_max, volume, etc.). The plot
      shows those defined in the <code>visible_properties</code> on page load. But the
      prop is two-way bindable and allows for external monitoring and modification. Toggle
      other properties in the plot legend to see the binding below update to show which
      properties are currently displayed.
    </p>
    <strong
      style="display: block; margin: 1em auto; padding: 1em; background: var(--surface-bg-hover); border-radius: var(--border-radius); font-family: monospace; font-size: 0.9em"
    >
      bind:visible_properties = {JSON.stringify(visible_props_cantor_qha)}
    </strong>
    <Trajectory
      data_url={file}
      bind:visible_properties={visible_props_cantor_qha}
      class="full-bleed"
      style="margin-top: 1em; max-height: 700px"
      on_file_load={(data: TrajHandlerData) => {
        if (data.filename) active_file = data.filename
      }}
    />
  {:else}
    <Trajectory
      data_url={file}
      class="full-bleed"
      style="margin-top: 5em; max-height: 700px"
      on_file_load={(data: TrajHandlerData) => {
        if (data.filename) active_file = data.filename
      }}
    />
  {/if}
{/each}

<p style="margin: 2em auto; text-align: center">
  Drag any of these trajectory files onto a viewer above to load them:
</p>

<FilePicker
  files={Object.keys(trajectory_files).map((file_path) => ({
    name: file_path.split(`/`).pop() || file_path,
    url: file_path.split(`/site`).at(-1) || ``,
  }))}
  active_files={[active_file]}
  show_category_filters={false}
  type_mapper={get_trajectory_type}
/>
