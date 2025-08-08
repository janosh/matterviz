<script lang="ts">
  import { FilePicker } from '$lib'
  import { get_trajectory_type, trajectory_files } from '$site/trajectories'
  import { Trajectory, type TrajHandlerData } from 'matterviz/trajectory'

  let active_file = $state(``) // last drag-and-dropped trajectory file

  const trajectory_files_paths = [
    `/trajectories/torch-sim-gold-cluster-55-atoms.h5`,
    `/trajectories/vasp-XDATCAR-traj.gz`,
    `/trajectories/Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`,
    `/trajectories/ase-images-Ag-0-to-97.xyz.gz`,
    undefined, //create one empty viewer
  ]
</script>

<h1>Trajectory</h1>

{#each trajectory_files_paths as file (file)}
  <Trajectory
    data_url={file}
    class="full-bleed"
    style="margin-top: 5em; max-height: 700px"
    on_file_load={(data: TrajHandlerData) => {
      if (data.filename) active_file = data.filename
    }}
  />
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
