<script lang="ts">
  import { Trajectory } from '$lib/trajectory'
  import { FilePicker } from '$site'

  const trajectory_files = import.meta.glob(`$site/trajectories/*`, {
    query: `?url`,
  })
  let active_files = $state<string[]>([])

  const trajectory_files_paths = [
    `/trajectories/torch-sim-gold-cluster-55-atoms.h5`,
    `/trajectories/vasp-XDATCAR-traj.gz`,
    `/trajectories/Cr0.25Fe0.25Co0.25Ni0.25-mace-omat-qha.xyz.gz`,
    `/trajectories/ase-images-Ag-0-to-97.xyz.gz`,
    undefined, //create one empty viewer
  ]

  const trajectory_type_mapper = (filename: string): string => {
    if (filename.match(/\.(h5|hdf5)$/i)) return `hdf5`
    if (filename.match(/\.json/i)) return `json`
    if (filename.match(/\.(xyz|extxyz)/i)) return `xyz`
    if (filename.match(/xdatcar/i)) return `xdatcar`
    if (filename.match(/\.traj$/i)) return `traj`
    return `unknown`
  }
</script>

<h1>Trajectory</h1>

{#each trajectory_files_paths as file (file)}
  <Trajectory
    data_url={file}
    class="full-bleed"
    style="margin-top: 5em"
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
  {active_files}
  show_category_filters={false}
  type_mapper={trajectory_type_mapper}
/>
