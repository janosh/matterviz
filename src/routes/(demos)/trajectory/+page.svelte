<script lang="ts">
  import FilePicker from '$lib/FilePicker.svelte'
  import { get_trajectory_type, trajectory_files } from '$site/trajectories'
  import { Trajectory, type TrajHandlerData } from 'matterviz/trajectory'

  let active_file = $state(``) // last drag-and-dropped trajectory file
  let visible_props_cantor_qha = $state<string[] | undefined>(undefined)
  const handle_file_load = ({ source_filename }: TrajHandlerData): void => {
    if (source_filename) active_file = source_filename
  }

  const trajectory_files_paths = [
    `/trajectories/flame-gold-cluster-55-atoms.h5`,
    `/trajectories/vasp-XDATCAR-traj.gz`,
    `/trajectories/Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`,
    `/trajectories/ase-images-Ag-0-to-97.xyz.gz`,
    undefined, //create one empty viewer
  ]
</script>

<h1>Trajectory</h1>

<h2>Mean Squared Displacement</h2>
<p>
  Every viewer below carries an MSD / diffusion pane (the orbit icon in the controls bar). It
  averages |r(t₀+Δt) − r(t₀)|² over all atoms and all time origins, unwraps trajectories across
  periodic boundaries first (honouring LAMMPS <code>xu/yu/zu</code> coordinates, which are
  already unwrapped), decomposes by element, and fits <code>D = slope / 2d</code> over an adjustable
  lag window. The lag axis is labelled in frames unless you supply a timestep, since no trajectory
  format we read records one. Indexed (streamed) trajectories are swept in full rather than analysed
  over the handful of frames kept in memory.
</p>

{#each trajectory_files_paths as file (file)}
  {#if file === `/trajectories/Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`}
    <h2>Bindable <code>visible_properties</code></h2>
    <p>Legend toggles update the bound list of displayed trajectory properties.</p>
    <strong
      style="display: block; margin: 1em auto; padding: 1em; background: var(--surface-bg-hover); border-radius: var(--border-radius); font-family: monospace; font-size: 0.9em"
    >
      bind:visible_properties = {JSON.stringify(visible_props_cantor_qha)}
    </strong>
    <Trajectory
      data_url={file}
      bind:visible_properties={visible_props_cantor_qha}
      class="full-bleed"
      style="margin-top: 1em; max-height: 700px; --traj-border-radius: 6pt; --traj-overflow: clip; --sequence-controls-border-radius: 0"
      on_file_load={handle_file_load}
    />
  {:else}
    <Trajectory
      data_url={file}
      class="full-bleed"
      style="margin-top: 5em; max-height: 700px; --traj-border-radius: 6pt; --traj-overflow: clip; --sequence-controls-border-radius: 0"
      on_file_load={handle_file_load}
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
